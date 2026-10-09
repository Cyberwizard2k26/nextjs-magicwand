"use client";
import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, Cpu, HardDrive, HeartPulse, MemoryStick, Network, StickyNote, Timer } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, severityTone } from "@/components/ui/badge";
import { Progress, Skeleton } from "@/components/ui/misc";
import { Pill } from "@/components/ui/misc";
import { useRealtime } from "@/components/shell/realtime-provider";
import { useChartTheme } from "@/lib/client/chart-palette";
import { formatBytes, formatDateTime, formatDuration, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { useDevice } from "./device-context";
import { healthTone } from "./device-bits";

interface Sample { ts: string; cpuPercent: number | null; memUsedBytes: number | null; memTotalBytes: number | null; disks: { mount: string; usedBytes: number; totalBytes: number }[] | null; netRxBps: number | null; netTxBps: number | null; uptimeSeconds: number | null; processCount: number | null; loadAvg: [number, number, number] | null; batteryPercent: number | null; topProcesses: { name: string; pid: number; cpu: number; memBytes: number }[] | null; temperatures: { sensor: string; celsius: number }[] | null }
type Range = "1h" | "6h" | "24h" | "7d";

function formatBps(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  const units = ["b/s", "Kb/s", "Mb/s", "Gb/s"];
  let x = v * 8, i = 0;
  while (x >= 1000 && i < units.length - 1) { x /= 1000; i++; }
  return `${x.toFixed(x >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function DeviceOverview() {
  const { data } = useDevice();
  const d = data.device;
  const [range, setRange] = React.useState<Range>("1h");
  const { data: history, isLoading } = useSWR<{ samples: Sample[]; since: string }>([`devices/${d.id}/telemetry`, { range }]);
  const [live, setLive] = React.useState<Sample[]>([]);
  useRealtime("device.telemetry", (ev) => {
    const p = ev.payload as Partial<Sample> & { deviceId?: string; ts?: string | Date };
    if (p.deviceId !== d.id) return;
    const ts = typeof p.ts === "string" ? p.ts : new Date(p.ts ?? Date.now()).toISOString();
    setLive((prev) => [...prev.slice(-720), { cpuPercent: null, memUsedBytes: null, memTotalBytes: null, disks: null, netRxBps: null, netTxBps: null, uptimeSeconds: null, processCount: null, loadAvg: null, batteryPercent: null, topProcesses: null, temperatures: null, ...p, ts }]);
  }, [`device:${d.id}`]);

  const samples = React.useMemo(() => {
    // The server tells us the window start; live samples are always newer than it.
    const since = history?.since ?? "";
    const seen = new Set<string>();
    return [...(history?.samples ?? []), ...live].filter((s) => { if (s.ts < since || seen.has(s.ts)) return false; seen.add(s.ts); return true; }).sort((a, b) => a.ts.localeCompare(b.ts));
  }, [history, live]);
  const latest = samples[samples.length - 1];
  const memPct = latest?.memUsedBytes && latest.memTotalBytes ? (latest.memUsedBytes / latest.memTotalBytes) * 100 : null;
  const worstDisk = latest?.disks?.length ? [...latest.disks].sort((a, b) => b.usedBytes / b.totalBytes - a.usedBytes / a.totalBytes)[0] : null;
  const chartData = samples.map((s) => ({ t: new Date(s.ts).getTime(), cpu: s.cpuPercent ?? null, mem: s.memUsedBytes && s.memTotalBytes ? Math.round((s.memUsedBytes / s.memTotalBytes) * 1000) / 10 : null, rx: s.netRxBps ?? null, tx: s.netTxBps ?? null }));
  const theme = useChartTheme();
  const tickFmt = (t: number) => new Date(t).toLocaleTimeString(undefined, range === "7d" ? { weekday: "short", hour: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
  const { data: alerts } = useSWR<{ items: { id: string; title: string; severity: string; status: string; openedAt: string; occurrences: number }[] }>([`alerts`, { deviceId: d.id, status: "open,acknowledged", pageSize: 5 }]);
  const hw = (data.hardware ?? {}) as { cpu?: { model?: string; cores?: number; threads?: number }; memory?: { totalBytes?: number; slots?: unknown[] }; disks?: { name?: string; model?: string; sizeBytes?: number; type?: string; health?: string }[]; gpus?: { name: string }[]; nics?: { name: string; mac?: string; ips?: string[]; speedMbps?: number; type?: string }[]; bios?: { vendor?: string; version?: string; secureBoot?: boolean }; tpm?: { present: boolean; version?: string }; virtualization?: { isVm: boolean; hypervisor?: string }; batteries?: { healthPercent?: number; cycleCount?: number }[] };

  return (
    <div className="space-y-4">
      {/* Live tiles */}
      <section className="stagger-in grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4 [&>*]:min-w-0" aria-label="Live metrics">
        <LiveTile icon={<Cpu />} label="CPU" value={latest?.cpuPercent !== null && latest?.cpuPercent !== undefined ? `${Math.round(latest.cpuPercent)}%` : "—"} pct={latest?.cpuPercent ?? null} hint={latest?.loadAvg ? `load ${latest.loadAvg.map((x) => x.toFixed(2)).join(" / ")}` : d.cpuModel ? `${d.cpuCores ?? "?"} cores` : undefined} loading={isLoading && !latest} />
        <LiveTile icon={<MemoryStick />} label="Memory" value={memPct !== null ? `${Math.round(memPct)}%` : "—"} pct={memPct} hint={latest?.memTotalBytes ? `${formatBytes(latest.memUsedBytes ?? 0, 1)} of ${formatBytes(latest.memTotalBytes, 0)}` : undefined} loading={isLoading && !latest} />
        <LiveTile icon={<HardDrive />} label={worstDisk ? `Disk ${worstDisk.mount}` : "Disk"} value={worstDisk ? `${Math.round((worstDisk.usedBytes / worstDisk.totalBytes) * 100)}%` : "—"} pct={worstDisk ? (worstDisk.usedBytes / worstDisk.totalBytes) * 100 : null} hint={worstDisk ? `${formatBytes(worstDisk.totalBytes - worstDisk.usedBytes, 0)} free${latest?.disks && latest.disks.length > 1 ? ` · ${latest.disks.length} volumes` : ""}` : undefined} loading={isLoading && !latest} />
        <LiveTile icon={<Network />} label="Network" value={latest ? <span className="flex items-baseline gap-2 text-lg"><span className="flex items-center gap-0.5"><ArrowDown className="h-3.5 w-3.5 text-fg-subtle" />{formatBps(latest.netRxBps)}</span><span className="flex items-center gap-0.5"><ArrowUp className="h-3.5 w-3.5 text-fg-subtle" />{formatBps(latest.netTxBps)}</span></span> : "—"} hint={latest?.uptimeSeconds ? `up ${formatDuration(latest.uptimeSeconds)}${latest.processCount ? ` · ${latest.processCount} processes` : ""}` : d.lastBootAt ? `booted ${relativeTime(d.lastBootAt)}` : undefined} loading={isLoading && !latest} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Performance"
            description={samples.length ? `${samples.length} samples · ${latest ? `latest ${relativeTime(latest.ts)}` : ""}` : "No telemetry in this window"}
            actions={<div className="flex gap-1">{(["1h", "6h", "24h", "7d"] as Range[]).map((r) => <Pill key={r} active={range === r} onClick={() => setRange(r)} className="h-7 px-2.5">{r}</Pill>)}</div>}
          />
          <CardBody className="space-y-5">
            <ChartBlock title="CPU and memory" legend={[{ label: "CPU %", color: theme.series[0] }, { label: "Memory %", color: theme.series[1] }]} empty={!chartData.length}>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={theme.series[0]} stopOpacity={0.25} /><stop offset="100%" stopColor={theme.series[0]} stopOpacity={0} /></linearGradient>
                    <linearGradient id="memFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={theme.series[1]} stopOpacity={0.2} /><stop offset="100%" stopColor={theme.series[1]} stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke={theme.text.grid} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickFmt} tick={{ fill: theme.text.muted, fontSize: 11 }} axisLine={{ stroke: theme.text.axis }} tickLine={false} minTickGap={40} />
                  <YAxis domain={[0, 100]} tick={{ fill: theme.text.muted, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={40} />
                  <ChartTooltip contentStyle={theme.tooltipStyle} labelFormatter={(t) => formatDateTime(new Date(Number(t)))} formatter={(v, name) => [`${Number(v).toFixed(1)}%`, String(name) === "cpu" ? "CPU" : "Memory"]} />
                  <Area type="monotone" dataKey="cpu" stroke={theme.series[0]} strokeWidth={2} fill="url(#cpuFill)" dot={false} isAnimationActive={false} connectNulls />
                  <Area type="monotone" dataKey="mem" stroke={theme.series[1]} strokeWidth={2} fill="url(#memFill)" dot={false} isAnimationActive={false} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </ChartBlock>
            <ChartBlock title="Network throughput" legend={[{ label: "Download", color: theme.series[2] }, { label: "Upload", color: theme.series[3] }]} empty={!chartData.some((x) => x.rx !== null)}>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={theme.text.grid} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickFmt} tick={{ fill: theme.text.muted, fontSize: 11 }} axisLine={{ stroke: theme.text.axis }} tickLine={false} minTickGap={40} />
                  <YAxis tick={{ fill: theme.text.muted, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatBps(Number(v))} width={78} />
                  <ChartTooltip contentStyle={theme.tooltipStyle} labelFormatter={(t) => formatDateTime(new Date(Number(t)))} formatter={(v, name) => [formatBps(Number(v)), String(name) === "rx" ? "Download" : "Upload"]} />
                  <Line type="monotone" dataKey="rx" stroke={theme.series[2]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="tx" stroke={theme.series[3]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </ChartBlock>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Health" description={d.healthScore === null ? "Not scored yet" : `${d.healthScore} / 100`} actions={<HeartPulse className={cn("h-4 w-4", { success: "text-success", warning: "text-warning", danger: "text-danger", neutral: "text-fg-subtle" }[healthTone(d.healthScore)])} />} />
            <CardBody>
              {d.healthFactors?.length ? (
                <ul className="space-y-2.5">
                  {d.healthFactors.map((f) => (
                    <li key={f.key}>
                      <div className="flex items-center justify-between text-sm"><span className="text-fg-muted">{f.label}</span><span className="tabular font-medium">{Math.round(f.score)}</span></div>
                      <Progress value={f.score} tone={f.score >= 80 ? "success" : f.score >= 60 ? "warning" : "danger"} thin className="mt-1" />
                      {f.detail && <div className="mt-0.5 text-xs text-fg-subtle">{f.detail}</div>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-muted">The health score is computed from telemetry, alerts, patch state and security posture once the agent has reported for a while.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Open alerts" actions={alerts?.items.length ? <Link href={`/alerts?deviceId=${d.id}`} className="text-xs text-fg-muted hover:text-fg">View all</Link> : undefined} />
            <CardBody className="px-0 pb-2">
              {!alerts?.items.length ? (
                <p className="px-5 pb-3 text-sm text-fg-muted">No open alerts.</p>
              ) : (
                <ul className="divide-y divide-border/70">
                  {alerts.items.map((a) => (
                    <li key={a.id}><Link href={`/alerts/${a.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-hover/60"><Badge tone={severityTone(a.severity)} size="xs" className="w-[60px] justify-center capitalize">{a.severity}</Badge><span className="min-w-0 flex-1 truncate text-sm">{a.title}</span><span className="text-xs text-fg-subtle">{relativeTime(a.openedAt)}</span></Link></li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader title="System" description={d.lastInventoryAt ? `Inventory ${relativeTime(d.lastInventoryAt)}` : "No inventory yet"} />
          <CardBody>
            <FactList items={[
              ["Hostname", d.hostname], ["Operating system", d.osName ? `${d.osName} ${d.osVersion ?? ""}`.trim() : null], ["Build", d.osBuild], ["Kernel", d.kernel], ["Architecture", d.arch], ["Domain", d.domain],
              ["Manufacturer", d.manufacturer], ["Model", d.model], ["Serial number", d.serialNumber], ["Time zone", d.timezone], ["Last boot", d.lastBootAt ? `${formatDateTime(d.lastBootAt)} (${relativeTime(d.lastBootAt)})` : null],
              ["Agent", d.agentVersion ? `v${d.agentVersion}` : null], ["Enrolled", d.enrolledAt ? formatDateTime(d.enrolledAt) : null], ["Public IP", d.publicIp], ["Local IPs", d.localIps?.join(", ")], ["MAC addresses", d.macAddresses?.join(", ")],
              ["Signed-in users", d.loggedInUsers?.length ? d.loggedInUsers.map((u) => `${u.user} (${u.type})`).join(", ") : null],
              ["Warranty", d.warranty?.status ? `${d.warranty.status}${d.warranty.endDate ? ` until ${d.warranty.endDate}` : ""}` : null],
              ["Location", d.location ? [d.location.city, d.location.region, d.location.country].filter(Boolean).join(", ") || `${d.location.lat.toFixed(3)}, ${d.location.lng.toFixed(3)}` : null],
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Hardware" />
          <CardBody className="space-y-4">
            <FactList items={[
              ["Processor", hw.cpu?.model ?? d.cpuModel ? `${hw.cpu?.model ?? d.cpuModel}${hw.cpu?.cores ? ` · ${hw.cpu.cores} cores${hw.cpu.threads ? ` / ${hw.cpu.threads} threads` : ""}` : ""}` : null],
              ["Memory", (hw.memory?.totalBytes ?? d.memoryBytes) ? `${formatBytes(hw.memory?.totalBytes ?? d.memoryBytes, 0)}${hw.memory?.slots?.length ? ` in ${hw.memory.slots.length} slots` : ""}` : null],
              ["Graphics", hw.gpus?.map((g) => g.name).join(", ")], ["BIOS", hw.bios ? `${hw.bios.vendor ?? ""} ${hw.bios.version ?? ""}`.trim() || null : null],
              ["Secure Boot", hw.bios?.secureBoot === undefined ? null : hw.bios.secureBoot ? "Enabled" : "Disabled"], ["TPM", hw.tpm ? (hw.tpm.present ? `Present${hw.tpm.version ? ` (v${hw.tpm.version})` : ""}` : "Not present") : null],
              ["Virtualization", hw.virtualization ? (hw.virtualization.isVm ? `Virtual machine${hw.virtualization.hypervisor ? ` on ${hw.virtualization.hypervisor}` : ""}` : "Physical") : null],
              ["Battery", hw.batteries?.[0] ? `${hw.batteries[0].healthPercent !== undefined ? `${hw.batteries[0].healthPercent}% health` : ""}${hw.batteries[0].cycleCount !== undefined ? ` · ${hw.batteries[0].cycleCount} cycles` : ""}${latest?.batteryPercent !== null && latest?.batteryPercent !== undefined ? ` · ${Math.round(latest.batteryPercent)}% charged` : ""}`.replace(/^ · /, "") || null : null],
            ]} />
            {!!latest?.disks?.length && (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">Volumes</div>
                <ul className="space-y-2.5">
                  {latest.disks.map((v) => {
                    const pct = (v.usedBytes / v.totalBytes) * 100;
                    return (
                      <li key={v.mount}>
                        <div className="flex items-center justify-between text-sm"><span className="mono text-fg">{v.mount}</span><span className="text-xs text-fg-muted">{formatBytes(v.totalBytes - v.usedBytes, 0)} free of {formatBytes(v.totalBytes, 0)}</span></div>
                        <Progress value={pct} tone="auto" className="mt-1" />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {!!hw.nics?.length && (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">Network adapters</div>
                <ul className="space-y-1.5 text-sm">
                  {hw.nics.slice(0, 6).map((n, i) => <li key={i} className="flex items-baseline justify-between gap-3"><span className="truncate text-fg-muted">{n.name}</span><span className="mono shrink-0 text-xs text-fg-subtle">{n.ips?.[0] ?? n.mac ?? ""}</span></li>)}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Top processes" description={latest?.topProcesses?.length ? "From the latest sample" : undefined} actions={<Link href={`/devices/${d.id}/processes`} className="text-xs text-fg-muted hover:text-fg">Manage</Link>} />
            <CardBody className="px-0 pb-2">
              {!latest?.topProcesses?.length ? <p className="px-5 pb-3 text-sm text-fg-muted">No process data yet.</p> : (
                <table className="w-full table-fixed text-sm">
                  <tbody>
                    {latest.topProcesses.slice(0, 8).map((p) => (
                      <tr key={`${p.pid}-${p.name}`} className="border-t border-border/60 first:border-0">
                        <td className="max-w-0 truncate px-5 py-1.5 text-fg" title={p.name}>{p.name}</td>
                        <td className="w-16 tabular px-2 py-1.5 text-right text-xs text-fg-muted">{p.cpu.toFixed(1)}%</td>
                        <td className="w-24 tabular px-5 py-1.5 text-right text-xs text-fg-muted">{formatBytes(p.memBytes, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
          {(d.notes || d.description) && (
            <Card>
              <CardHeader title="Notes" actions={<StickyNote className="h-4 w-4 text-fg-subtle" />} />
              <CardBody className="space-y-2 text-sm">
                {d.description && <p className="text-fg">{d.description}</p>}
                {d.notes && <p className="whitespace-pre-wrap text-fg-muted">{d.notes}</p>}
              </CardBody>
            </Card>
          )}
          {!!latest?.temperatures?.length && (
            <Card>
              <CardHeader title="Temperatures" actions={<Timer className="h-4 w-4 text-fg-subtle" />} />
              <CardBody><FactList items={latest.temperatures.slice(0, 6).map((t) => [t.sensor, `${Math.round(t.celsius)} °C`] as [string, string])} /></CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveTile({ icon, label, value, pct, hint, loading }: { icon: React.ReactNode; label: string; value: React.ReactNode; pct?: number | null; hint?: string; loading?: boolean }) {
  const tone = pct === null || pct === undefined ? "accent" : pct >= 90 ? "danger" : pct >= 75 ? "warning" : "accent";
  const toneCls = { accent: "text-accent-hover bg-accent-soft", warning: "text-warning bg-warning-soft", danger: "text-danger bg-danger-soft" }[tone];
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4", toneCls)}>{icon}</span>
        <span className="text-xs font-medium text-fg-muted">{label}</span>
      </div>
      {loading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-semibold tabular tracking-tight text-fg">{value}</div>}
      {pct !== null && pct !== undefined && <Progress value={pct} tone="auto" thin />}
      {hint && <div className="truncate text-xs text-fg-subtle">{hint}</div>}
    </div>
  );
}

function ChartBlock({ title, legend, empty, children }: { title: string; legend: { label: string; color: string }[]; empty: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{title}</div>
        <ul className="flex items-center gap-3 text-xs text-fg-muted">{legend.map((l) => <li key={l.label} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: l.color }} />{l.label}</li>)}</ul>
      </div>
      {empty ? <div className="flex h-[140px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-fg-subtle">No samples in this window</div> : children}
    </div>
  );
}

export function FactList({ items }: { items: [string, React.ReactNode | null | undefined][] }) {
  const rows = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!rows.length) return <p className="text-sm text-fg-muted">Nothing reported yet.</p>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-fg-subtle">{k}</dt>
          <dd className="min-w-0 break-words text-fg">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

