/**
 * Monitor evaluation. Pure helpers (threshold comparison, telemetry sample evaluation, the flap-suppression
 * state machine, probe script generation and output parsing) are exported for tests; the async functions wire
 * them to the database, the bus and the alerts table. Loaded at boot by the monitoring module: no Next imports.
 *
 * Engines:
 *  - telemetry : handleTelemetry() on every `device.telemetry` event
 *  - heartbeat : handleDeviceOffline()/handleDeviceOnline() + tickHeartbeat()
 *  - inventory : evaluateInventoryMonitors(device) on inventory/patch/posture events and every tick
 *  - probe     : tickProbes() creates "Monitor: <name>" script jobs; handleMonitorJobResult() consumes them
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import tls from "node:tls";
import net from "node:net";
import dns from "node:dns/promises";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { createLogger } from "../logger";
import { agentRegistry, DeviceOfflineError } from "../realtime/agent-registry";
import { createJob } from "./jobs";
import { applicableMonitors, enabledMonitors, monitorDevices, monitorTypeDef, type Monitor, type MonitorState } from "./monitors";
import { isInMaintenance } from "./maintenance";
import type { MonitorStatus, MonitorThresholds, Severity } from "../db/schema/monitoring";
import type { DeviceFilter } from "../db/schema/devices";

const log = createLogger("monitor-eval");

type DeviceRow = typeof schema.devices.$inferSelect;
export interface CheckResult { status: MonitorStatus; value: number | null; message: string; data?: Record<string, unknown> }

/* ------------------------------------------------------------------ pure helpers */

export function compareThreshold(value: number | null, t: MonitorThresholds, defaultOp: MonitorThresholds["op"] = ">"): MonitorStatus {
  if (value === null || value === undefined || Number.isNaN(value)) return "unknown";
  const op = t.op ?? defaultOp;
  const hit = (limit: number | undefined) => {
    if (limit === undefined || limit === null) return false;
    switch (op) {
      case ">": return value > limit;
      case ">=": return value >= limit;
      case "<": return value < limit;
      case "<=": return value <= limit;
      case "==": return value === limit;
      case "!=": return value !== limit;
      default: return value > limit;
    }
  };
  if (hit(t.critical)) return "critical";
  if (hit(t.warning)) return "warning";
  return "ok";
}

export interface TelemetrySample { cpuPercent?: number | null; memUsedBytes?: number | null; memTotalBytes?: number | null; disks?: { mount: string; usedBytes: number; totalBytes: number }[] | null; netRxBps?: number | null; netTxBps?: number | null; uptimeSeconds?: number | null; batteryPercent?: number | null; temperatures?: { sensor: string; celsius: number }[] | null }

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtBytes = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`);

/** Value + message for a telemetry-engine monitor from one sample (status is derived from thresholds). */
export function evaluateTelemetrySample(m: Pick<Monitor, "type" | "config" | "thresholds">, s: TelemetrySample): CheckResult {
  const def = monitorTypeDef(m.type);
  const finish = (value: number | null, message: string, data?: Record<string, unknown>): CheckResult => ({ status: compareThreshold(value, m.thresholds, def?.op), value, message, data });
  switch (m.type) {
    case "cpu": return s.cpuPercent === null || s.cpuPercent === undefined ? finish(null, "No CPU sample") : finish(round1(s.cpuPercent), `CPU at ${round1(s.cpuPercent)}%`);
    case "memory": {
      if (!s.memTotalBytes || s.memUsedBytes === null || s.memUsedBytes === undefined) return finish(null, "No memory sample");
      const pct = round1((s.memUsedBytes / s.memTotalBytes) * 100);
      return finish(pct, `Memory at ${pct}% (${fmtBytes(s.memUsedBytes)} of ${fmtBytes(s.memTotalBytes)})`);
    }
    case "disk_space": {
      const cfg = m.config as { mounts?: string[]; minSizeBytes?: number };
      const minSize = Number(cfg.minSizeBytes ?? 2_000_000_000);
      const wanted = (cfg.mounts ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
      const disks = (s.disks ?? []).filter((d) => d.totalBytes > 0 && (wanted.length ? wanted.some((w) => d.mount.toLowerCase() === w || d.mount.toLowerCase().startsWith(w)) : d.totalBytes >= minSize));
      if (!disks.length) return finish(null, wanted.length ? `None of the configured mounts (${wanted.join(", ")}) were reported` : "No volumes reported");
      const worst = disks.map((d) => ({ ...d, pct: (d.usedBytes / d.totalBytes) * 100 })).sort((a, b) => b.pct - a.pct)[0];
      return finish(round1(worst.pct), `${worst.mount} at ${round1(worst.pct)}% (${fmtBytes(worst.totalBytes - worst.usedBytes)} free of ${fmtBytes(worst.totalBytes)})`, { mounts: disks.map((d) => ({ mount: d.mount, pct: round1((d.usedBytes / d.totalBytes) * 100), freeBytes: d.totalBytes - d.usedBytes })) });
    }
    case "battery": return s.batteryPercent === null || s.batteryPercent === undefined ? { status: "ok", value: null, message: "No battery" } : finish(round1(s.batteryPercent), `Battery at ${round1(s.batteryPercent)}%`);
    case "temperature": {
      const temps = s.temperatures ?? [];
      if (!temps.length) return { status: "ok", value: null, message: "No temperature sensors" };
      const hot = [...temps].sort((a, b) => b.celsius - a.celsius)[0];
      return finish(round1(hot.celsius), `${hot.sensor} at ${round1(hot.celsius)} °C`);
    }
    case "uptime": {
      if (s.uptimeSeconds === null || s.uptimeSeconds === undefined) return finish(null, "No uptime sample");
      const days = round1(s.uptimeSeconds / 86400);
      return finish(days, `Up for ${days} days`);
    }
    case "network_throughput": {
      const mbps = round1((((s.netRxBps ?? 0) + (s.netTxBps ?? 0)) * 8) / 1e6);
      return finish(mbps, `${mbps} Mbit/s combined`);
    }
    default: return { status: "unknown", value: null, message: `No telemetry evaluator for ${m.type}` };
  }
}

export interface StateLike { status: MonitorStatus; consecutiveFailures: number; failingSince: Date | null; lastOkAt: Date | null; alertId: string | null; data: Record<string, unknown> }
export type Transition = "none" | "alert" | "recover" | "worsen";

/**
 * Flap suppression. A check result becomes "alerting" once `consecutive` failures AND `durationSeconds` of
 * continuous failure are reached; recovery happens after `autoResolveAfterSeconds` of OK results.
 */
export function advanceState(prev: StateLike | null, result: CheckResult, now: Date, t: MonitorThresholds, autoResolveAfterSeconds = 0): { next: StateLike; transition: Transition; alerting: boolean } {
  const failing = result.status === "warning" || result.status === "critical";
  const p: StateLike = prev ?? { status: "pending", consecutiveFailures: 0, failingSince: null, lastOkAt: null, alertId: null, data: {} };
  const needConsecutive = Math.max(1, t.consecutive ?? 1);
  const needDuration = Math.max(0, t.durationSeconds ?? 0) * 1000;
  if (failing) {
    const consecutive = p.consecutiveFailures + 1;
    const failingSince = p.failingSince ?? now;
    const reached = consecutive >= needConsecutive && now.getTime() - failingSince.getTime() >= needDuration;
    const data = { ...p.data };
    delete data.okSince;
    const next: StateLike = { status: reached ? result.status : p.alertId ? result.status : p.status === "ok" || p.status === "pending" || p.status === "unknown" ? p.status : result.status, consecutiveFailures: consecutive, failingSince, lastOkAt: p.lastOkAt, alertId: p.alertId, data };
    if (reached && !p.alertId) return { next: { ...next, status: result.status }, transition: "alert", alerting: true };
    if (p.alertId && result.status === "critical" && p.status === "warning") return { next: { ...next, status: result.status }, transition: "worsen", alerting: true };
    return { next: { ...next, status: reached || p.alertId ? result.status : next.status }, transition: "none", alerting: !!p.alertId || reached };
  }
  if (result.status === "unknown") {
    // Unknown never opens or closes alerts; it just records that we could not evaluate.
    return { next: { ...p, status: p.alertId ? p.status : "unknown", data: { ...p.data, lastUnknown: now.toISOString() } }, transition: "none", alerting: !!p.alertId };
  }
  // ok
  const okSince = typeof p.data.okSince === "string" ? new Date(p.data.okSince) : now;
  const data = { ...p.data, okSince: okSince.toISOString() };
  if (p.alertId) {
    if (now.getTime() - okSince.getTime() >= autoResolveAfterSeconds * 1000) return { next: { status: "ok", consecutiveFailures: 0, failingSince: null, lastOkAt: now, alertId: null, data: { ...data, okSince: undefined } as Record<string, unknown> }, transition: "recover", alerting: false };
    return { next: { ...p, consecutiveFailures: 0, lastOkAt: now, data }, transition: "none", alerting: true };
  }
  return { next: { status: "ok", consecutiveFailures: 0, failingSince: null, lastOkAt: now, alertId: null, data: {} }, transition: "none", alerting: false };
}

/* ------------------------------------------------------------------ probe scripts */

const sh = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const ps = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[\n,]+/)).map((s) => s.trim()).filter(Boolean);

/** Script (bash or PowerShell) that prints one JSON line {value,status?,message} for a probe monitor. */
export function buildProbeScript(type: string, config: Record<string, unknown>, platform: string): { language: "bash" | "powershell"; content: string } | null {
  const win = platform === "windows";
  switch (type) {
    case "service": {
      const names = list(config.names);
      if (win) return { language: "powershell", content: `$names = @(${names.map(ps).join(",")})\n$stopped=@();$missing=@();$running=@()\nforeach($n in $names){ $s = Get-Service -Name $n -ErrorAction SilentlyContinue; if(-not $s){$missing+=$n; continue}; if($s.Status -eq 'Running'){$running+=$n}else{$stopped+="$n ($($s.Status))"} }\n$status = if($stopped.Count -gt 0){'critical'}else{'ok'}\n$msg = if($stopped.Count -gt 0){"Stopped: $($stopped -join ', ')"}else{"$($running.Count) running"}\nif($missing.Count -gt 0){$msg += " (not installed: $($missing -join ', '))"}\n@{value=$stopped.Count;status=$status;message=$msg} | ConvertTo-Json -Compress` };
      return { language: "bash", content: `stopped=""; running=0; missing=""\nfor n in ${names.map(sh).join(" ")}; do\n  if command -v systemctl >/dev/null 2>&1; then\n    if systemctl list-unit-files --type=service --no-legend 2>/dev/null | grep -q "^$n.service" || systemctl cat "$n" >/dev/null 2>&1; then\n      if systemctl is-active --quiet "$n"; then running=$((running+1)); else stopped="$stopped $n($(systemctl is-active "$n" 2>/dev/null))"; fi\n    else missing="$missing $n"; fi\n  elif command -v launchctl >/dev/null 2>&1; then\n    if launchctl list 2>/dev/null | grep -q "$n"; then running=$((running+1)); else missing="$missing $n"; fi\n  else\n    if pgrep -x "$n" >/dev/null 2>&1; then running=$((running+1)); else stopped="$stopped $n"; fi\n  fi\ndone\ncount=$(echo $stopped | wc -w | tr -d ' ')\nif [ "$count" -gt 0 ]; then st=critical; msg="Stopped:$stopped"; else st=ok; msg="$running running"; fi\n[ -n "$missing" ] && msg="$msg (not installed:$missing)"\nprintf '{"value":%s,"status":"%s","message":"%s"}\\n' "$count" "$st" "$(echo "$msg" | sed 's/"/\\\\"/g')"` };
    }
    case "process": {
      const name = String(config.name ?? "");
      if (win) return { language: "powershell", content: `$p = @(Get-Process -Name ${ps(name.replace(/\.exe$/i, ""))} -ErrorAction SilentlyContinue)\n@{value=$p.Count;message="$($p.Count) process(es) named ${name.replace(/"/g, "")}"} | ConvertTo-Json -Compress` };
      return { language: "bash", content: `c=$(pgrep -c -f ${sh(name)} 2>/dev/null || echo 0)\n# exclude ourselves\nif [ "$c" -gt 0 ]; then c=$(pgrep -f ${sh(name)} | grep -v "^$$\\$" | wc -l | tr -d ' '); fi\nprintf '{"value":%s,"message":"%s process(es) named %s"}\\n' "$c" "$c" ${sh(name.replace(/"/g, ""))}` };
    }
    case "port": {
      const host = String(config.host || "127.0.0.1"), port = Number(config.port);
      if (win) return { language: "powershell", content: `$sw=[Diagnostics.Stopwatch]::StartNew(); $c = New-Object Net.Sockets.TcpClient; try { $ar=$c.BeginConnect(${ps(host)},${port},$null,$null); $ok=$ar.AsyncWaitHandle.WaitOne(5000) -and $c.Connected } catch { $ok=$false }; $c.Close(); $ms=[int]$sw.ElapsedMilliseconds\n@{value=$ms;status=$(if($ok){'ok'}else{'critical'});message=$(if($ok){"${host}:${port} open in $ms ms"}else{"${host}:${port} closed or filtered"})} | ConvertTo-Json -Compress` };
      return { language: "bash", content: `start=$(date +%s%N 2>/dev/null || echo 0)\nif command -v nc >/dev/null 2>&1; then nc -z -w 5 ${sh(host)} ${port} >/dev/null 2>&1; ok=$?; else timeout 5 bash -c ${sh(`cat < /dev/null > /dev/tcp/${host}/${port}`)} >/dev/null 2>&1; ok=$?; fi\nend=$(date +%s%N 2>/dev/null || echo 0); ms=$(( (end-start)/1000000 ))\nif [ "$ok" -eq 0 ]; then printf '{"value":%s,"status":"ok","message":"%s open in %s ms"}\\n' "$ms" ${sh(`${host}:${port}`)} "$ms"; else printf '{"value":null,"status":"critical","message":"%s closed or filtered"}\\n' ${sh(`${host}:${port}`)}; fi` };
    }
    case "ping": {
      const host = String(config.host ?? "");
      if (win) return { language: "powershell", content: `$r = Test-Connection -ComputerName ${ps(host)} -Count 3 -ErrorAction SilentlyContinue\nif($r){ $avg=[int](($r | Measure-Object -Property ResponseTime -Average).Average); @{value=$avg;message="${host.replace(/"/g, "")} avg $avg ms"} | ConvertTo-Json -Compress } else { @{value=$null;status='critical';message="${host.replace(/"/g, "")} unreachable"} | ConvertTo-Json -Compress }` };
      return { language: "bash", content: `out=$(ping -c 3 -W 2 ${sh(host)} 2>/dev/null || ping -c 3 -t 2 ${sh(host)} 2>/dev/null)\navg=$(echo "$out" | awk -F'/' '/min\\/avg|rtt|round-trip/ {print $5}' | head -1)\nif [ -n "$avg" ]; then printf '{"value":%s,"message":"%s avg %s ms"}\\n' "$avg" ${sh(host)} "$avg"; else printf '{"value":null,"status":"critical","message":"%s unreachable"}\\n' ${sh(host)}; fi` };
    }
    case "http": {
      const url = String(config.url ?? ""), expect = Number(config.expectStatus ?? 200), contains = String(config.bodyContains ?? "");
      if (win) return { language: "powershell", content: `$sw=[Diagnostics.Stopwatch]::StartNew()\ntry { $r = Invoke-WebRequest -Uri ${ps(url)} -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 3 -ErrorAction Stop; $code=[int]$r.StatusCode; $body=[string]$r.Content } catch { $code = if($_.Exception.Response){[int]$_.Exception.Response.StatusCode}else{0}; $body='' }\n$ms=[int]$sw.ElapsedMilliseconds\n$ok = ($code -eq ${expect})${contains ? ` -and ($body -like ('*' + ${ps(contains)} + '*'))` : ""}\n@{value=$ms;status=$(if($ok){'ok'}else{'critical'});message="HTTP $code in $ms ms"} | ConvertTo-Json -Compress` };
      return { language: "bash", content: `tmp=$(mktemp); res=$(curl -sS -L -m 20 -o "$tmp" -w '%{http_code} %{time_total}' ${sh(url)} 2>/dev/null); code=$(echo "$res" | awk '{print $1}'); t=$(echo "$res" | awk '{print $2}'); ms=$(awk -v t="$t" 'BEGIN{printf "%d", t*1000}')\nok=0; [ "$code" = "${expect}" ] && ok=1\n${contains ? `if [ "$ok" = 1 ] && ! grep -q -F -- ${sh(contains)} "$tmp"; then ok=0; fi\n` : ""}rm -f "$tmp"\nif [ "$ok" = 1 ]; then st=ok; else st=critical; fi\nprintf '{"value":%s,"status":"%s","message":"HTTP %s in %s ms"}\\n' "\${ms:-0}" "$st" "\${code:-0}" "\${ms:-0}"` };
    }
    case "dns": {
      const hostname = String(config.hostname ?? ""), expectIp = String(config.expectIp ?? "");
      if (win) return { language: "powershell", content: `try { $a = @(Resolve-DnsName -Name ${ps(hostname)} -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress }) } catch { $a=@() }\n$ok = $a.Count -gt 0${expectIp ? ` -and ($a -contains ${ps(expectIp)})` : ""}\n@{value=$a.Count;status=$(if($ok){'ok'}else{'critical'});message=$(if($a.Count){"${hostname.replace(/"/g, "")} -> $($a -join ', ')"}else{"${hostname.replace(/"/g, "")} did not resolve"})} | ConvertTo-Json -Compress` };
      return { language: "bash", content: `ips=$(getent ahostsv4 ${sh(hostname)} 2>/dev/null | awk '{print $1}' | sort -u | tr '\\n' ' ' | sed 's/ *$//')\n[ -z "$ips" ] && ips=$(dig +short ${sh(hostname)} 2>/dev/null | tr '\\n' ' ' | sed 's/ *$//')\nn=$(echo $ips | wc -w | tr -d ' ')\nok=0; [ "$n" -gt 0 ] && ok=1\n${expectIp ? `echo " $ips " | grep -q -F -- ${sh(` ${expectIp} `)} || ok=0\n` : ""}if [ "$ok" = 1 ]; then printf '{"value":%s,"status":"ok","message":"%s -> %s"}\\n' "$n" ${sh(hostname)} "$ips"; else printf '{"value":%s,"status":"critical","message":"%s did not resolve as expected"}\\n' "$n" ${sh(hostname)}; fi` };
    }
    case "cert_expiry": {
      const host = String(config.host ?? ""), port = Number(config.port ?? 443);
      if (win) return { language: "powershell", content: `try { $c = New-Object Net.Sockets.TcpClient(${ps(host)}, ${port}); $s = New-Object Net.Security.SslStream($c.GetStream(), $false, ({ $true })); $s.AuthenticateAsClient(${ps(host)}); $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($s.RemoteCertificate); $days=[int](($cert.NotAfter - (Get-Date)).TotalDays); $c.Close(); @{value=$days;message="Expires $($cert.NotAfter.ToString('yyyy-MM-dd')) ($days days) - $($cert.Subject)"} | ConvertTo-Json -Compress } catch { @{value=$null;status='critical';message="TLS handshake failed: $($_.Exception.Message)"} | ConvertTo-Json -Compress }` };
      return { language: "bash", content: `end=$(echo | timeout 15 openssl s_client -servername ${sh(host)} -connect ${sh(`${host}:${port}`)} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)\nif [ -z "$end" ]; then printf '{"value":null,"status":"critical","message":"TLS handshake to %s failed"}\\n' ${sh(`${host}:${port}`)}; exit 0; fi\nexp=$(date -d "$end" +%s 2>/dev/null || date -j -f '%b %d %T %Y %Z' "$end" +%s 2>/dev/null)\nnow=$(date +%s); days=$(( (exp-now)/86400 ))\nprintf '{"value":%s,"message":"Expires %s (%s days)"}\\n' "$days" "$end" "$days"` };
    }
    case "eventlog": {
      const logName = String(config.logName || "System"), level = String(config.level || "error"), pattern = String(config.pattern ?? ""), minutes = Number(config.minutes ?? 15);
      if (win) {
        const levels = level === "critical" ? "1" : level === "error" ? "1,2" : "1,2,3";
        return { language: "powershell", content: `$since=(Get-Date).AddMinutes(-${minutes})\n$f=@{LogName=${ps(logName)};Level=@(${levels});StartTime=$since}\n${/^\d+$/.test(pattern) ? `$f.Id=${pattern}\n` : ""}$e=@(Get-WinEvent -FilterHashtable $f -ErrorAction SilentlyContinue${pattern && !/^\d+$/.test(pattern) ? ` | Where-Object { $_.Message -like ('*' + ${ps(pattern)} + '*') }` : ""})\n$last = if($e.Count){ ($e[0].Message -split "\`n")[0] } else { '' }\n@{value=$e.Count;message="$($e.Count) ${level}+ events in ${logName} (last ${minutes} min)$(if($last){': ' + $last.Substring(0,[Math]::Min(120,$last.Length))})"} | ConvertTo-Json -Compress` };
      }
      const prio = level === "critical" ? "2" : level === "error" ? "3" : "4";
      return { language: "bash", content: `if command -v journalctl >/dev/null 2>&1; then\n  out=$(journalctl --since "-${minutes}min" -p ${prio} --no-pager -q ${logName && logName !== "System" ? `-u ${sh(logName)} ` : ""}2>/dev/null${pattern ? ` | grep -i -F -- ${sh(pattern)}` : ""})\nelse\n  out=$(find /var/log -maxdepth 1 -name '*.log' -mmin -${minutes} -exec grep -h -i -E ${sh(pattern || (level === "warning" ? "error|warn|crit" : "error|crit"))} {} + 2>/dev/null)\nfi\nn=$(printf '%s' "$out" | grep -c . || true)\nlast=$(printf '%s' "$out" | tail -1 | cut -c1-120 | sed 's/"/\\\\"/g')\nprintf '{"value":%s,"message":"%s ${level}+ entries in the last ${minutes} min%s"}\\n' "\${n:-0}" "\${n:-0}" "$( [ -n "$last" ] && printf ': %s' "$last" )"` };
    }
    case "file_exists": {
      const path = String(config.path ?? ""), expect = String(config.expect ?? "exists");
      if (win) return { language: "powershell", content: `$e = Test-Path -LiteralPath ${ps(path)}\n$ok = if(${ps(expect)} -eq 'missing'){ -not $e } else { $e }\n@{value=$(if($e){1}else{0});status=$(if($ok){'ok'}else{'critical'});message=$(if($e){"${path.replace(/"/g, "")} exists"}else{"${path.replace(/"/g, "")} is missing"})} | ConvertTo-Json -Compress` };
      return { language: "bash", content: `if [ -e ${sh(path)} ]; then e=1; else e=0; fi\nif [ ${sh(expect)} = missing ]; then ok=$((1-e)); else ok=$e; fi\nif [ "$ok" = 1 ]; then st=ok; else st=critical; fi\nif [ "$e" = 1 ]; then m="exists"; else m="is missing"; fi\nprintf '{"value":%s,"status":"%s","message":"%s %s"}\\n' "$e" "$st" ${sh(path)} "$m"` };
    }
    case "file_size": {
      const path = String(config.path ?? "");
      if (win) return { language: "powershell", content: `$p=${ps(path)}\nif(Test-Path -LiteralPath $p){ $b = (Get-ChildItem -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum; if(-not $b){ $b = (Get-Item -LiteralPath $p).Length }; $mb=[math]::Round($b/1MB,1); @{value=$mb;message="$p is $mb MB"} | ConvertTo-Json -Compress } else { @{value=$null;status='unknown';message="$p not found"} | ConvertTo-Json -Compress }` };
      return { language: "bash", content: `if [ -e ${sh(path)} ]; then kb=$(du -sk ${sh(path)} 2>/dev/null | awk '{print $1}'); mb=$(awk -v k="$kb" 'BEGIN{printf "%.1f", k/1024}'); printf '{"value":%s,"message":"%s is %s MB"}\\n' "$mb" ${sh(path)} "$mb"; else printf '{"value":null,"status":"unknown","message":"%s not found"}\\n' ${sh(path)}; fi` };
    }
    case "backup_status": {
      const path = String(config.path ?? "");
      if (win) return { language: "powershell", content: `$p=${ps(path)}\n$f = Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1\nif($f){ $h=[math]::Round(((Get-Date)-$f.LastWriteTime).TotalHours,1); @{value=$h;message="Newest file $($f.Name) is $h h old"} | ConvertTo-Json -Compress } else { @{value=$null;status='critical';message="No files under $p"} | ConvertTo-Json -Compress }` };
      return { language: "bash", content: `newest=$(find ${sh(path)} -type f -printf '%T@ %p\\n' 2>/dev/null | sort -n | tail -1)\nif [ -z "$newest" ]; then newest=$(find ${sh(path)} -type f -exec stat -f '%m %N' {} + 2>/dev/null | sort -n | tail -1); fi\nif [ -z "$newest" ]; then printf '{"value":null,"status":"critical","message":"No files under %s"}\\n' ${sh(path)}; exit 0; fi\nts=$(echo "$newest" | awk '{print int($1)}'); name=$(echo "$newest" | cut -d' ' -f2-)\nh=$(awk -v t="$ts" -v n="$(date +%s)" 'BEGIN{printf "%.1f", (n-t)/3600}')\nprintf '{"value":%s,"message":"Newest file %s is %s h old"}\\n' "$h" "$(basename "$name")" "$h"` };
    }
    default: return null;
  }
}

/** Parse the JSON a probe printed (structured `output` first, then the last JSON-looking stdout line). */
export function parseProbeOutput(output: unknown, stdout?: string | null, valueKey = "value"): CheckResult | null {
  let obj: Record<string, unknown> | null = output && typeof output === "object" && !Array.isArray(output) ? (output as Record<string, unknown>) : null;
  if (!obj && stdout) {
    const lines = stdout.trim().split("\n").reverse();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try { obj = JSON.parse(t) as Record<string, unknown>; break; } catch { /* keep looking */ }
    }
  }
  if (!obj) return null;
  const raw = obj[valueKey] ?? obj.value;
  const value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
  const status = typeof obj.status === "string" && ["ok", "warning", "critical", "unknown"].includes(obj.status) ? (obj.status as MonitorStatus) : null;
  const message = typeof obj.message === "string" ? obj.message : status ? status : value !== null ? `value ${value}` : "no value";
  return { status: status ?? "unknown", value: value !== null && Number.isFinite(value) ? value : null, message: message.slice(0, 500), data: obj };
}

/** Combine the probe's own verdict with numeric thresholds. */
export function finaliseProbe(m: Pick<Monitor, "type" | "thresholds">, parsed: CheckResult | null, fallbackError?: string | null): CheckResult {
  if (!parsed) return { status: "unknown", value: null, message: fallbackError ? `Check failed: ${fallbackError.slice(0, 300)}` : "Check produced no result" };
  const def = monitorTypeDef(m.type);
  const hasNumeric = m.thresholds.warning !== undefined || m.thresholds.critical !== undefined;
  const explicit = parsed.data && typeof parsed.data.status === "string";
  if (explicit && parsed.status !== "ok") return parsed;
  if (hasNumeric && parsed.value !== null) return { ...parsed, status: compareThreshold(parsed.value, m.thresholds, def?.op) };
  if (explicit) return parsed;
  if (parsed.value === null) return { ...parsed, status: "unknown" };
  return { ...parsed, status: "ok" };
}

/* ------------------------------------------------------------------ server-side probes */

async function serverProbe(m: Monitor): Promise<CheckResult> {
  const cfg = m.config as Record<string, unknown>;
  const started = Date.now();
  try {
    switch (m.type) {
      case "http": {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        try {
          const res = await fetch(String(cfg.url), { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "MagicWand-Monitor/1.0" } });
          const body = cfg.bodyContains ? await res.text() : "";
          const ms = Date.now() - started;
          const ok = res.status === Number(cfg.expectStatus ?? 200) && (!cfg.bodyContains || body.includes(String(cfg.bodyContains)));
          return finaliseProbe(m, { status: ok ? "ok" : "critical", value: ms, message: `HTTP ${res.status} in ${ms} ms`, data: { status: ok ? "ok" : "critical", code: res.status } });
        } finally { clearTimeout(timer); }
      }
      case "port": {
        const ms = await new Promise<number>((resolve, reject) => {
          const s = net.connect({ host: String(cfg.host || "127.0.0.1"), port: Number(cfg.port), timeout: 5000 });
          s.once("connect", () => { s.destroy(); resolve(Date.now() - started); });
          s.once("timeout", () => { s.destroy(); reject(new Error("timeout")); });
          s.once("error", reject);
        });
        return { status: "ok", value: ms, message: `${cfg.host || "127.0.0.1"}:${cfg.port} open in ${ms} ms` };
      }
      case "dns": {
        const addrs = await dns.resolve4(String(cfg.hostname));
        const ok = addrs.length > 0 && (!cfg.expectIp || addrs.includes(String(cfg.expectIp)));
        return { status: ok ? "ok" : "critical", value: addrs.length, message: ok ? `${cfg.hostname} -> ${addrs.join(", ")}` : `${cfg.hostname} resolved to ${addrs.join(", ") || "nothing"}, expected ${cfg.expectIp}` };
      }
      case "cert_expiry": {
        const host = String(cfg.host), port = Number(cfg.port ?? 443);
        const cert = await new Promise<tls.PeerCertificate>((resolve, reject) => {
          const s = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 10_000 }, () => { const c = s.getPeerCertificate(); s.end(); resolve(c); });
          s.once("error", reject);
          s.once("timeout", () => { s.destroy(); reject(new Error("timeout")); });
        });
        if (!cert?.valid_to) return { status: "critical", value: null, message: `No certificate presented by ${host}:${port}` };
        const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400_000);
        return finaliseProbe(m, { status: "ok", value: days, message: `Expires ${new Date(cert.valid_to).toISOString().slice(0, 10)} (${days} days) - ${cert.subject?.CN ?? host}`, data: {} });
      }
      default:
        return { status: "unknown", value: null, message: `${m.type} cannot run from the server` };
    }
  } catch (err) {
    return { status: "critical", value: null, message: `${String((err as Error).message || err)}`.slice(0, 300) };
  }
}

/* ------------------------------------------------------------------ inventory engine */

export async function evaluateInventoryMonitor(m: Monitor, device: DeviceRow, now = new Date()): Promise<CheckResult> {
  const db = await getDb();
  const def = monitorTypeDef(m.type);
  const finish = (value: number | null, message: string, data?: Record<string, unknown>): CheckResult => ({ status: compareThreshold(value, m.thresholds, def?.op), value, message, data });
  switch (m.type) {
    case "reboot_pending": {
      if (!device.pendingReboot) return { status: "ok", value: 0, message: "No reboot pending" };
      const since = device.lastBootAt ?? device.lastInventoryAt ?? device.enrolledAt;
      const days = since ? Math.floor((now.getTime() - since.getTime()) / 86400_000) : null;
      return days === null ? { status: "unknown", value: null, message: "Reboot pending; last boot time unknown" } : finish(days, `Reboot pending; last boot ${days} days ago`);
    }
    case "windows_update": {
      if (!device.lastPatchScanAt) return { status: "unknown", value: null, message: "No patch scan yet" };
      const cfg = m.config as { maxAgeDays?: number; severities?: string[]; securityOnly?: boolean };
      const cutoff = new Date(now.getTime() - Number(cfg.maxAgeDays ?? 14) * 86400_000);
      const where = [eq(schema.patches.deviceId, device.id), inArray(schema.patches.status, ["available", "approved", "failed", "scheduled", "pending_reboot"]), lt(schema.patches.firstSeenAt, cutoff)];
      const sev = (cfg.severities ?? []).filter(Boolean);
      if (sev.length) where.push(inArray(schema.patches.severity, sev as ("critical" | "important")[]));
      if (cfg.securityOnly) where.push(eq(schema.patches.category, "security"));
      const rows = await db.select({ title: schema.patches.title }).from(schema.patches).where(and(...where)).limit(50);
      return finish(rows.length, rows.length ? `${rows.length} update(s) outstanding for more than ${cfg.maxAgeDays ?? 14} days: ${rows.slice(0, 3).map((r) => r.title).join("; ")}${rows.length > 3 ? "…" : ""}` : `No updates older than ${cfg.maxAgeDays ?? 14} days`, { count: rows.length });
    }
    case "software_present":
    case "software_absent": {
      if (!device.lastInventoryAt) return { status: "unknown", value: null, message: "No software inventory yet" };
      const name = String((m.config as { name?: string }).name ?? "");
      const rows = await db.select({ name: schema.deviceSoftware.name, version: schema.deviceSoftware.version }).from(schema.deviceSoftware).where(and(eq(schema.deviceSoftware.deviceId, device.id), isNull(schema.deviceSoftware.removedAt), sql`${schema.deviceSoftware.name} ilike ${"%" + name.replace(/[%_]/g, "\\$&") + "%"}`)).limit(5);
      const present = rows.length > 0;
      const ok = m.type === "software_present" ? present : !present;
      return { status: ok ? "ok" : "critical", value: rows.length, message: present ? `${rows.map((r) => `${r.name}${r.version ? ` ${r.version}` : ""}`).join(", ")} installed` : `No application matching "${name}"` };
    }
    case "av_status":
    case "firewall_status":
    case "disk_encryption": {
      const [sec] = await db.select().from(schema.deviceSecurity).where(eq(schema.deviceSecurity.deviceId, device.id));
      if (!sec) return { status: "unknown", value: null, message: "No security posture reported yet" };
      const p = sec.posture;
      if (m.type === "av_status") {
        if (!p.antivirus) return { status: "unknown", value: null, message: "Antivirus state not reported" };
        const good = p.antivirus.filter((a) => a.enabled && a.upToDate);
        return { status: good.length ? "ok" : "critical", value: good.length, message: good.length ? `${good.map((a) => a.name).join(", ")} enabled and up to date` : p.antivirus.length ? `${p.antivirus.map((a) => `${a.name} (${a.enabled ? "enabled" : "disabled"}${a.upToDate ? "" : ", out of date"})`).join(", ")}` : "No antivirus product found" };
      }
      if (m.type === "firewall_status") {
        if (!p.firewall) return { status: "unknown", value: null, message: "Firewall state not reported" };
        return { status: p.firewall.enabled ? "ok" : "critical", value: p.firewall.enabled ? 1 : 0, message: p.firewall.enabled ? "Firewall enabled" : "Firewall disabled" };
      }
      if (!p.diskEncryption?.length) return { status: "unknown", value: null, message: "Disk encryption state not reported" };
      const unencrypted = p.diskEncryption.filter((v) => !v.encrypted);
      return { status: unencrypted.length ? "critical" : "ok", value: unencrypted.length, message: unencrypted.length ? `Unencrypted: ${unencrypted.map((v) => v.volume).join(", ")}` : `All ${p.diskEncryption.length} volume(s) encrypted` };
    }
    case "disk_smart": {
      const [hw] = await db.select({ disks: schema.deviceHardware.disks }).from(schema.deviceHardware).where(eq(schema.deviceHardware.deviceId, device.id));
      const withSmart = (hw?.disks ?? []).filter((d) => d.smart);
      if (!withSmart.length) return { status: "unknown", value: null, message: "No SMART data reported" };
      const bad = withSmart.filter((d) => d.smart && !d.smart.healthy);
      return { status: bad.length ? "critical" : "ok", value: bad.length, message: bad.length ? `Unhealthy: ${bad.map((d) => `${d.name}${d.model ? ` (${d.model})` : ""}`).join(", ")}` : `${withSmart.length} disk(s) healthy` };
    }
    default: return { status: "unknown", value: null, message: `No inventory evaluator for ${m.type}` };
  }
}

/* ------------------------------------------------------------------ state persistence + alerts */

async function loadState(monitorId: string, deviceId: string): Promise<MonitorState | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.monitorStates).where(and(eq(schema.monitorStates.monitorId, monitorId), eq(schema.monitorStates.deviceId, deviceId)));
  return row ?? null;
}

const lastResultAt = new Map<string, number>();

/** Apply a check result to the (monitor, device) state: persist, record a result row, open/close alerts, remediate. */
export async function applyResult(m: Monitor, device: DeviceRow, result: CheckResult, opts: { now?: Date; durationMs?: number; source?: string } = {}) {
  const db = await getDb();
  const now = opts.now ?? new Date();
  const prev = await loadState(m.id, device.id);
  const { next, transition } = advanceState(prev, result, now, m.thresholds, m.autoResolveAfterSeconds);
  const changed = !prev || prev.status !== next.status;
  const key = `${m.id}:${device.id}`;
  const minGap = Math.max(60, m.intervalSeconds) * 1000;
  if (changed || !lastResultAt.has(key) || now.getTime() - (lastResultAt.get(key) ?? 0) >= minGap) {
    await db.insert(schema.monitorResults).values({ monitorId: m.id, deviceId: device.id, ts: now, status: result.status, value: result.value, message: result.message.slice(0, 500), durationMs: opts.durationMs ?? null });
    lastResultAt.set(key, now.getTime());
  }
  const row = { status: next.status, value: result.value, message: result.message.slice(0, 1000), consecutiveFailures: next.consecutiveFailures, failingSince: next.failingSince, lastCheckedAt: now, lastOkAt: next.lastOkAt, alertId: next.alertId, data: { ...next.data, ...(result.data ? { last: result.data } : {}) } as Record<string, unknown>, updatedAt: now };
  let state: MonitorState;
  if (prev) [state] = await db.update(schema.monitorStates).set(row).where(eq(schema.monitorStates.id, prev.id)).returning();
  else [state] = await db.insert(schema.monitorStates).values({ monitorId: m.id, deviceId: device.id, ...row }).returning();

  if (transition === "alert" || transition === "worsen") {
    const alert = await openMonitorAlert(m, device, state, result, transition === "worsen");
    if (alert && state.alertId !== alert.id) {
      await db.update(schema.monitorStates).set({ alertId: alert.id }).where(eq(schema.monitorStates.id, state.id));
      state = { ...state, alertId: alert.id };
    }
    if (transition === "alert" && alert) await maybeRemediate(m, device, state, alert.id);
  } else if (transition === "recover" && prev?.alertId) {
    await resolveMonitorAlert(prev.alertId, m, device, result);
  } else if (prev?.alertId && (result.status === "warning" || result.status === "critical")) {
    // Still failing: keep the open alert fresh (occurrences + last message); un-suppress when maintenance ended.
    await touchMonitorAlert(prev.alertId, m, device, result);
  }
  if (changed) bus.publish("monitor.state.changed", { monitorId: m.id, monitorName: m.name, deviceId: device.id, status: next.status, previous: prev?.status ?? null, value: result.value, message: result.message }, { orgId: m.orgId, deviceId: device.id });
  return { state, transition };
}

function alertTitle(m: Monitor, device: DeviceRow) { return `${m.name} on ${device.displayName || device.name}`; }

export async function openMonitorAlert(m: Monitor, device: DeviceRow, state: MonitorState, result: CheckResult, worsened = false) {
  const db = await getDb();
  const fingerprint = `monitor:${m.id}:${device.id}`;
  const suppress = await isInMaintenance(device.id, "alerts");
  const def = monitorTypeDef(m.type);
  const severity: Severity = result.status === "warning" && (m.severity === "critical" || m.severity === "high") ? (m.severity === "critical" ? "high" : "medium") : m.severity;
  const [existing] = await db.select().from(schema.alerts).where(and(eq(schema.alerts.fingerprint, fingerprint), inArray(schema.alerts.status, ["open", "acknowledged", "snoozed", "suppressed"]))).orderBy(desc(schema.alerts.openedAt)).limit(1);
  const data = { monitorType: m.type, value: result.value, unit: def?.unit ?? null, thresholds: m.thresholds, status: result.status, consecutiveFailures: state.consecutiveFailures, failingSince: state.failingSince?.toISOString() ?? null, ...(result.data ?? {}) };
  if (existing) {
    const reopen = existing.status === "suppressed" && !suppress;
    const [row] = await db.update(schema.alerts).set({ occurrences: existing.occurrences + 1, lastSeenAt: new Date(), message: result.message, data, severity: worsened ? m.severity : existing.severity, ...(reopen ? { status: "open" as const, openedAt: new Date() } : {}) }).where(eq(schema.alerts.id, existing.id)).returning();
    if (reopen) bus.publish("alert.opened", alertPayload(row, device), { orgId: m.orgId, deviceId: device.id });
    else if (worsened) bus.publish("alert.updated", { ...alertPayload(row, device), worsened: true }, { orgId: m.orgId, deviceId: device.id });
    return row;
  }
  const [row] = await db.insert(schema.alerts).values({ orgId: m.orgId, deviceId: device.id, monitorId: m.id, siteId: device.siteId, severity, status: suppress ? "suppressed" : "open", title: alertTitle(m, device), message: result.message, fingerprint, category: def?.category ?? "other", source: "monitor", data }).returning();
  bus.publish(suppress ? "alert.suppressed" : "alert.opened", { ...alertPayload(row, device), suppressed: suppress, channelIds: m.notificationChannelIds, createTicket: m.createTicket }, { orgId: m.orgId, deviceId: device.id });
  log.info(suppress ? "alert suppressed (maintenance)" : "alert opened", { monitor: m.name, device: device.name, status: result.status, value: result.value });
  return row;
}

function alertPayload(a: typeof schema.alerts.$inferSelect, device: DeviceRow) {
  return { id: a.id, title: a.title, message: a.message, severity: a.severity, status: a.status, category: a.category, source: a.source, deviceId: a.deviceId, deviceName: device.displayName || device.name, monitorId: a.monitorId, fingerprint: a.fingerprint, occurrences: a.occurrences, data: a.data };
}

async function touchMonitorAlert(alertId: string, m: Monitor, device: DeviceRow, result: CheckResult) {
  const db = await getDb();
  const [a] = await db.select().from(schema.alerts).where(eq(schema.alerts.id, alertId));
  if (!a || a.status === "resolved") return;
  const now = Date.now();
  if (now - a.lastSeenAt.getTime() < 60_000 && a.status !== "suppressed") return;
  const reopen = a.status === "suppressed" && !(await isInMaintenance(device.id, "alerts"));
  const [row] = await db.update(schema.alerts).set({ occurrences: a.occurrences + 1, lastSeenAt: new Date(), message: result.message, data: { ...a.data, value: result.value, status: result.status }, ...(reopen ? { status: "open" as const, openedAt: new Date() } : {}) }).where(eq(schema.alerts.id, alertId)).returning();
  if (reopen) bus.publish("alert.opened", { ...alertPayload(row, device), channelIds: m.notificationChannelIds, createTicket: m.createTicket }, { orgId: m.orgId, deviceId: device.id });
}

export async function resolveMonitorAlert(alertId: string, m: Monitor, device: DeviceRow, result: CheckResult) {
  const db = await getDb();
  const rows = await db.update(schema.alerts).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: null, resolution: `Auto-resolved: ${result.message}`.slice(0, 500) }).where(and(eq(schema.alerts.id, alertId), inArray(schema.alerts.status, ["open", "acknowledged", "snoozed", "suppressed"]))).returning();
  for (const a of rows) bus.publish("alert.resolved", { ...alertPayload(a, device), auto: true, channelIds: m.notificationChannelIds }, { orgId: m.orgId, deviceId: device.id });
  if (rows.length) log.info("alert auto-resolved", { monitor: m.name, device: device.name });
}

async function maybeRemediate(m: Monitor, device: DeviceRow, state: MonitorState, alertId: string) {
  if (!m.autoRemediationScriptId) return;
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const count = state.remediationDay === today ? state.remediationCountToday : 0;
  if (count >= m.autoRemediationMaxPerDay) { log.info("remediation cap reached", { monitor: m.name, device: device.name }); return; }
  const [script] = await db.select().from(schema.scripts).where(eq(schema.scripts.id, m.autoRemediationScriptId));
  if (!script || (script.orgId && script.orgId !== m.orgId)) { log.warn("remediation script missing", { monitor: m.name }); return; }
  if (script.platforms.length && !script.platforms.includes(device.platform)) return;
  try {
    const { job } = await createJob({ orgId: m.orgId, type: "script", name: `Remediate: ${m.name} on ${device.name}`, targetType: "device", targetIds: [device.id], source: "alert", sourceId: alertId, timeoutSeconds: script.timeoutSeconds, runWhenOnline: true, expiresAt: new Date(Date.now() + 6 * 3600_000), createdByName: "Monitor auto-remediation",
      payload: { scriptId: script.id, name: script.name, language: script.language, content: script.content, params: {}, outputJson: script.outputJson, successCodes: script.successCodes, runAs: script.runAs, timeoutSeconds: script.timeoutSeconds, monitorRemediation: m.id, alertId } });
    await db.update(schema.monitorStates).set({ remediationCountToday: count + 1, remediationDay: today }).where(eq(schema.monitorStates.id, state.id));
    await db.update(schema.alerts).set({ remediationJobId: job.id }).where(eq(schema.alerts.id, alertId));
    bus.publish("monitor.remediation.started", { monitorId: m.id, deviceId: device.id, alertId, jobId: job.id, script: script.name, attempt: count + 1 }, { orgId: m.orgId, deviceId: device.id });
  } catch (err) {
    log.error("remediation job failed", { monitor: m.name, err: String(err) });
  }
}

/* ------------------------------------------------------------------ engines: event handlers */

const deviceCache = new Map<string, { at: number; row: DeviceRow }>();
async function loadDevice(deviceId: string, fresh = false): Promise<DeviceRow | null> {
  const c = deviceCache.get(deviceId);
  if (!fresh && c && Date.now() - c.at < 30_000) return c.row;
  const db = await getDb();
  const [row] = await db.select().from(schema.devices).where(eq(schema.devices.id, deviceId));
  if (row) deviceCache.set(deviceId, { at: Date.now(), row });
  return row ?? null;
}

const telemetryThrottle = new Map<string, number>();

export async function handleTelemetry(deviceId: string, sample: TelemetrySample) {
  const device = await loadDevice(deviceId);
  if (!device) return;
  const monitors = await applicableMonitors(device, "telemetry");
  if (!monitors.length) return;
  const now = new Date();
  for (const m of monitors) {
    const key = `${m.id}:${deviceId}`;
    const last = telemetryThrottle.get(key) ?? 0;
    const result = evaluateTelemetrySample(m, sample);
    const prev = await loadState(m.id, deviceId);
    const sameStatus = prev && prev.status === result.status;
    // Samples arrive every few seconds; persist every 15 s unless the status changes.
    if (sameStatus && now.getTime() - last < 15_000) continue;
    telemetryThrottle.set(key, now.getTime());
    await applyResult(m, device, result, { now });
  }
}

export async function handleDeviceOffline(deviceId: string) {
  const device = await loadDevice(deviceId, true);
  if (!device) return;
  for (const m of await applicableMonitors(device, "heartbeat")) {
    // Record the failure start; the alert itself opens from tickHeartbeat once the threshold is exceeded.
    const prev = await loadState(m.id, deviceId);
    if (prev?.failingSince) continue;
    const db = await getDb();
    const row = { status: prev?.alertId ? prev.status : ("pending" as MonitorStatus), failingSince: device.lastSeenAt ?? new Date(), lastCheckedAt: new Date(), message: "Agent disconnected", value: 0, updatedAt: new Date() };
    if (prev) await db.update(schema.monitorStates).set(row).where(eq(schema.monitorStates.id, prev.id));
    else await db.insert(schema.monitorStates).values({ monitorId: m.id, deviceId, ...row });
  }
}

export async function handleDeviceOnline(deviceId: string) {
  const device = await loadDevice(deviceId, true);
  if (!device) return;
  for (const m of await applicableMonitors(device, "heartbeat")) await applyResult(m, device, { status: "ok", value: 0, message: "Agent connected" });
}

/** Offline monitors: compare minutes offline against thresholds for every offline device. */
export async function tickHeartbeat(now = new Date()) {
  const db = await getDb();
  const monitors = await db.select().from(schema.monitors).where(and(eq(schema.monitors.enabled, true), eq(schema.monitors.type, "agent_offline")));
  if (!monitors.length) return 0;
  let evaluated = 0;
  const byOrg = new Map<string, Monitor[]>();
  for (const m of monitors) byOrg.set(m.orgId, [...(byOrg.get(m.orgId) ?? []), m]);
  for (const [orgId] of byOrg) {
    const offline = await db.select().from(schema.devices).where(and(eq(schema.devices.orgId, orgId), eq(schema.devices.status, "offline"), sql`${schema.devices.lastSeenAt} is not null`));
    for (const device of offline) {
      const applicable = await applicableMonitors(device, "heartbeat");
      for (const m of applicable) {
        const minutes = Math.floor((now.getTime() - (device.lastSeenAt?.getTime() ?? now.getTime())) / 60_000);
        const status = compareThreshold(minutes, m.thresholds, ">");
        const prev = await loadState(m.id, device.id);
        if (status === "ok" && !prev) continue; // not yet past the threshold and nothing to update
        await applyResult(m, device, { status, value: minutes, message: status === "ok" ? `Offline for ${minutes} min` : `Offline for ${minutes} min (last seen ${device.lastSeenAt?.toISOString() ?? "unknown"})` }, { now });
        evaluated++;
      }
    }
  }
  return evaluated;
}

/** Inventory-engine monitors for one device (called on inventory/patch/posture events and from the tick). */
export async function evaluateInventoryMonitors(deviceId: string, now = new Date()) {
  const device = await loadDevice(deviceId, true);
  if (!device || device.status === "decommissioned") return 0;
  const monitors = await applicableMonitors(device, "inventory");
  let n = 0;
  for (const m of monitors) {
    const prev = await loadState(m.id, deviceId);
    if (prev?.lastCheckedAt && now.getTime() - prev.lastCheckedAt.getTime() < m.intervalSeconds * 1000 * 0.5) continue;
    const result = await evaluateInventoryMonitor(m, device, now);
    await applyResult(m, device, result, { now });
    n++;
  }
  return n;
}

export async function tickInventory(now = new Date()) {
  const db = await getDb();
  const monitors = await db.select().from(schema.monitors).where(and(eq(schema.monitors.enabled, true), inArray(schema.monitors.type, ["reboot_pending", "windows_update", "software_present", "software_absent", "av_status", "firewall_status", "disk_encryption", "disk_smart"])));
  let n = 0;
  const seen = new Set<string>();
  for (const m of monitors) {
    for (const device of await monitorDevices(m)) {
      if (seen.has(device.id)) continue;
      seen.add(device.id);
      n += await evaluateInventoryMonitors(device.id, now);
    }
  }
  return n;
}

/* ------------------------------------------------------------------ probe engine */

function probeJobPayload(m: Monitor, device: DeviceRow, script: { language: string; content: string; scriptId?: string; params?: Record<string, unknown>; timeoutSeconds?: number; successCodes?: number[]; runAs?: string }) {
  return { monitorId: m.id, monitorType: m.type, deviceId: device.id, ...(script.scriptId ? { scriptId: script.scriptId, params: script.params ?? {} } : {}), language: script.language, content: script.content, outputJson: true, successCodes: script.successCodes ?? [0, 1, 2], runAs: script.runAs ?? "system", timeoutSeconds: script.timeoutSeconds ?? 90 };
}

async function probeScriptFor(m: Monitor, device: DeviceRow): Promise<{ language: string; content: string; scriptId?: string; params?: Record<string, unknown>; timeoutSeconds?: number; successCodes?: number[]; runAs?: string } | null> {
  if (m.type === "script") {
    const db = await getDb();
    const cfg = m.config as { scriptId?: string; params?: string | Record<string, unknown> };
    if (!cfg.scriptId) return null;
    const [script] = await db.select().from(schema.scripts).where(eq(schema.scripts.id, cfg.scriptId));
    if (!script || (script.orgId && script.orgId !== m.orgId)) return null;
    if (script.platforms.length && !script.platforms.includes(device.platform)) return null;
    let params: Record<string, unknown> = {};
    if (typeof cfg.params === "string" && cfg.params.trim()) { try { params = JSON.parse(cfg.params); } catch { params = {}; } } else if (cfg.params && typeof cfg.params === "object") params = cfg.params;
    return { language: script.language, content: script.content, scriptId: script.id, params, timeoutSeconds: script.timeoutSeconds, successCodes: script.successCodes, runAs: script.runAs };
  }
  return buildProbeScript(m.type, m.config, device.platform);
}

const PROBE_TYPES = ["service", "process", "port", "ping", "http", "dns", "cert_expiry", "eventlog", "file_exists", "file_size", "backup_status", "script"] as const;

/** Create check jobs for probe monitors that are due; run server-side checks inline. */
export async function tickProbes(now = new Date()) {
  const db = await getDb();
  const monitors = await db.select().from(schema.monitors).where(and(eq(schema.monitors.enabled, true), inArray(schema.monitors.type, [...PROBE_TYPES])));
  let jobs = 0;
  for (const m of monitors) {
    const devices = await monitorDevices(m);
    const due: DeviceRow[] = [];
    for (const d of devices) {
      const prev = await loadState(m.id, d.id);
      if (prev?.lastCheckedAt && now.getTime() - prev.lastCheckedAt.getTime() < m.intervalSeconds * 1000) continue;
      due.push(d);
    }
    if (!due.length) continue;
    const runFrom = String((m.config as { runFrom?: string }).runFrom ?? "agent");
    if (runFrom === "server" && ["http", "port", "dns", "cert_expiry"].includes(m.type)) {
      const started = Date.now();
      const result = await serverProbe(m);
      for (const d of due) await applyResult(m, d, result, { now, durationMs: Date.now() - started, source: "server" });
      continue;
    }
    const online = due.filter((d) => agentRegistry.isOnline(d.id));
    const offline = due.filter((d) => !agentRegistry.isOnline(d.id));
    for (const d of offline) {
      // Mark checked so we do not spin; the heartbeat monitor owns "device offline".
      const prev = await loadState(m.id, d.id);
      const row = { lastCheckedAt: now, status: prev?.alertId ? prev.status : ("unknown" as MonitorStatus), message: "Device offline - check skipped", updatedAt: now };
      if (prev) await db.update(schema.monitorStates).set(row).where(eq(schema.monitorStates.id, prev.id));
      else await db.insert(schema.monitorStates).values({ monitorId: m.id, deviceId: d.id, value: null, ...row });
    }
    // Group by platform: one job per (monitor, platform, script).
    const groups = new Map<string, { script: NonNullable<Awaited<ReturnType<typeof probeScriptFor>>>; devices: DeviceRow[] }>();
    for (const d of online) {
      const script = await probeScriptFor(m, d);
      if (!script) {
        await applyResult(m, d, { status: "unknown", value: null, message: `No check available for ${m.type} on ${d.platform}` }, { now });
        continue;
      }
      const key = `${d.platform}:${script.language}`;
      const g = groups.get(key) ?? { script, devices: [] };
      g.devices.push(d);
      groups.set(key, g);
    }
    for (const [, g] of groups) {
      const payload = probeJobPayload(m, g.devices[0], g.script);
      delete (payload as Record<string, unknown>).deviceId;
      try {
        await createJob({ orgId: m.orgId, type: "script", name: `Monitor: ${m.name}`, targetType: "device", targetIds: g.devices.map((d) => d.id), payload, source: "automation", sourceId: `monitor:${m.id}`, timeoutSeconds: payload.timeoutSeconds, runWhenOnline: false, expiresAt: new Date(now.getTime() + Math.max(120, m.intervalSeconds) * 1000), createdByName: "Monitoring" });
        jobs++;
        for (const d of g.devices) {
          const prev = await loadState(m.id, d.id);
          if (prev) await db.update(schema.monitorStates).set({ lastCheckedAt: now, updatedAt: now }).where(eq(schema.monitorStates.id, prev.id));
          else await db.insert(schema.monitorStates).values({ monitorId: m.id, deviceId: d.id, status: "pending", message: "First check running", lastCheckedAt: now });
        }
      } catch (err) {
        log.error("probe job failed", { monitor: m.name, err: String(err) });
      }
    }
  }
  return jobs;
}

/** Consume job.run.succeeded / job.run.failed for "Monitor:" jobs. */
export async function handleMonitorJobResult(payload: { jobId: string; runId: string; deviceId: string; payload?: Record<string, unknown>; output?: unknown; exitCode?: number; stdout?: string; stderr?: string; error?: string }, failed: boolean) {
  const monitorId = payload.payload?.monitorId as string | undefined;
  if (!monitorId) return;
  const db = await getDb();
  const [m] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, monitorId));
  if (!m || !m.enabled) return;
  const device = await loadDevice(payload.deviceId, true);
  if (!device) return;
  const [run] = await db.select({ stdout: schema.jobRuns.stdout, stderr: schema.jobRuns.stderr, error: schema.jobRuns.error, durationMs: schema.jobRuns.durationMs }).from(schema.jobRuns).where(eq(schema.jobRuns.id, payload.runId));
  const valueKey = String((m.config as { valueKey?: string }).valueKey || "value");
  const parsed = parseProbeOutput(payload.output, payload.stdout ?? run?.stdout, valueKey);
  const result = finaliseProbe(m, parsed, failed ? (payload.error ?? run?.error ?? run?.stderr ?? payload.stderr ?? `exit code ${payload.exitCode}`) : null);
  await applyResult(m, device, result, { durationMs: run?.durationMs ?? undefined });
}

/* ------------------------------------------------------------------ on-demand test */

/** Evaluate one monitor against one device right now without touching state (used by POST /monitors/[id]/test). */
export async function testMonitor(m: Monitor, deviceId: string): Promise<CheckResult & { engine: string; durationMs: number; script?: { language: string; content: string } }> {
  const db = await getDb();
  const device = await loadDevice(deviceId, true);
  if (!device) throw new Error("Device not found");
  const def = monitorTypeDef(m.type);
  const started = Date.now();
  switch (def?.engine) {
    case "telemetry": {
      const [sample] = await db.select().from(schema.telemetry).where(eq(schema.telemetry.deviceId, deviceId)).orderBy(desc(schema.telemetry.ts)).limit(1);
      if (!sample) return { status: "unknown", value: null, message: "No telemetry recorded for this device yet", engine: "telemetry", durationMs: 0 };
      const age = Math.round((Date.now() - sample.ts.getTime()) / 60_000);
      const r = evaluateTelemetrySample(m, sample);
      return { ...r, message: `${r.message} (sample ${age} min old)`, engine: "telemetry", durationMs: Date.now() - started };
    }
    case "heartbeat": {
      const minutes = device.status === "online" ? 0 : Math.floor((Date.now() - (device.lastSeenAt?.getTime() ?? Date.now())) / 60_000);
      return { status: device.status === "online" ? "ok" : compareThreshold(minutes, m.thresholds, ">"), value: minutes, message: device.status === "online" ? "Agent connected" : `Offline for ${minutes} min`, engine: "heartbeat", durationMs: Date.now() - started };
    }
    case "inventory": {
      const r = await evaluateInventoryMonitor(m, device);
      return { ...r, engine: "inventory", durationMs: Date.now() - started };
    }
    default: {
      const runFrom = String((m.config as { runFrom?: string }).runFrom ?? "agent");
      if (runFrom === "server" && ["http", "port", "dns", "cert_expiry"].includes(m.type)) {
        const r = await serverProbe(m);
        return { ...r, engine: "server", durationMs: Date.now() - started };
      }
      const script = await probeScriptFor(m, device);
      if (!script) return { status: "unknown", value: null, message: `No check available for ${m.type} on ${device.platform}`, engine: "probe", durationMs: 0 };
      if (!agentRegistry.isOnline(deviceId)) throw new DeviceOfflineError(deviceId);
      const res = await agentRegistry.command(deviceId, "run_script", { language: script.language, content: script.content, params: script.params ?? {}, outputJson: true, successCodes: [0, 1, 2] }, { timeoutSeconds: Math.min(120, script.timeoutSeconds ?? 90), runAs: (script.runAs as "system") ?? "system" });
      const parsed = parseProbeOutput(res.data, res.stdout, String((m.config as { valueKey?: string }).valueKey || "value"));
      const r = finaliseProbe(m, parsed, res.ok ? null : res.error ?? res.stderr ?? `exit code ${res.exitCode}`);
      return { ...r, engine: "probe", durationMs: Date.now() - started, script: { language: script.language, content: script.content }, data: { ...(r.data ?? {}), stdout: res.stdout?.slice(0, 4000), stderr: res.stderr?.slice(0, 2000), exitCode: res.exitCode } };
    }
  }
}

/* ------------------------------------------------------------------ housekeeping */

/** Resolve alerts whose monitor was disabled/deleted, drop states of decommissioned devices, prune old results. */
export async function housekeeping() {
  const db = await getDb();
  const orphaned = await db.select({ id: schema.alerts.id, orgId: schema.alerts.orgId, deviceId: schema.alerts.deviceId, title: schema.alerts.title, severity: schema.alerts.severity }).from(schema.alerts).leftJoin(schema.monitors, eq(schema.monitors.id, schema.alerts.monitorId)).where(and(eq(schema.alerts.source, "monitor"), inArray(schema.alerts.status, ["open", "acknowledged", "snoozed", "suppressed"]), or(isNull(schema.monitors.id), eq(schema.monitors.enabled, false)))).limit(200);
  for (const a of orphaned) {
    await db.update(schema.alerts).set({ status: "resolved", resolvedAt: new Date(), resolution: "Monitor disabled or removed" }).where(eq(schema.alerts.id, a.id));
    bus.publish("alert.resolved", { id: a.id, title: a.title, severity: a.severity, auto: true, reason: "monitor disabled" }, { orgId: a.orgId, deviceId: a.deviceId });
  }
  await db.delete(schema.monitorResults).where(lt(schema.monitorResults.ts, new Date(Date.now() - 14 * 86400_000)));
  return orphaned.length;
}

/** Devices matched by a monitor filter preview (used by the UI "applies to N devices" hint). */
export async function previewMonitorTargets(orgId: string, scope: { deviceId?: string | null; groupId?: string | null; siteId?: string | null; platforms?: string[] }) {
  const stub = { id: "preview", orgId, name: "preview", description: null, type: "cpu", config: {}, thresholds: {}, intervalSeconds: 60, severity: "medium", enabled: true, policyId: null, deviceId: scope.deviceId ?? null, groupId: scope.groupId ?? null, siteId: scope.siteId ?? null, platforms: scope.platforms ?? [], runOnProbe: false, autoRemediationScriptId: null, autoRemediationMaxPerDay: 3, autoResolve: true, autoResolveAfterSeconds: 0, notificationChannelIds: [], escalationPolicyId: null, createTicket: false, tags: [], isBuiltin: false, createdBy: null, createdAt: new Date(), updatedAt: new Date() } as Monitor;
  const devices = await monitorDevices(stub);
  return { count: devices.length, sample: devices.slice(0, 5).map((d) => ({ id: d.id, name: d.name, platform: d.platform, status: d.status })) };
}

export type { DeviceFilter };
void enabledMonitors;
