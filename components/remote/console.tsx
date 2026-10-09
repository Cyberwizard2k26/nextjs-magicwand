"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Copy, CornerDownLeft, Eraser, Loader2, Play, Square, Terminal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/menu";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { assessCommand } from "@/lib/client/command-risk";
import { formatDateTime, formatMs, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { useDevice } from "@/components/devices/device-context";
import { DeviceOfflineNotice } from "@/components/devices/device-header";
import { RiskNotice } from "@/components/jobs/quick-job-dialog";
import { stripAnsi } from "./use-rpc";

interface Entry {
  runId: string;
  jobId: string;
  command: string;
  shell?: string;
  runAs?: string;
  by?: string | null;
  startedAt: string;
  status: "pending" | "running" | "succeeded" | "failed" | "timeout" | "cancelled" | "offline_queued" | "skipped";
  chunks: { stream: "stdout" | "stderr"; data: string }[];
  exitCode: number | null;
  durationMs: number | null;
  error?: string | null;
  loaded: boolean; // output fetched for historical entries
  expanded: boolean;
}

const SNIPPETS: Record<string, { label: string; cmd: string }[]> = {
  windows: [
    { label: "Stopped auto services", cmd: "Get-Service | Where-Object { $_.StartType -eq 'Automatic' -and $_.Status -ne 'Running' } | Format-Table Name, DisplayName, Status" },
    { label: "Top CPU", cmd: "Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Name, Id, CPU, @{n='MemMB';e={[int]($_.WorkingSet64/1MB)}} | Format-Table" },
    { label: "Network config", cmd: "ipconfig /all" },
    { label: "Recent hotfixes", cmd: "Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 10 HotFixID, InstalledOn, Description | Format-Table" },
    { label: "System errors", cmd: "Get-WinEvent -FilterHashtable @{LogName='System'; Level=2} -MaxEvents 15 | Format-Table TimeCreated, Id, ProviderName, Message -Wrap" },
    { label: "Disk space", cmd: "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{n='UsedGB';e={[int]($_.Used/1GB)}}, @{n='FreeGB';e={[int]($_.Free/1GB)}} | Format-Table" },
    { label: "Pending reboot?", cmd: "Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired'" },
  ],
  linux: [
    { label: "Disk space", cmd: "df -h --output=target,size,used,avail,pcent -x tmpfs -x devtmpfs" },
    { label: "Load & memory", cmd: "uptime && free -m" },
    { label: "Top CPU", cmd: "ps aux --sort=-%cpu | head -n 12" },
    { label: "Recent errors", cmd: "journalctl -p err -n 20 --no-pager" },
    { label: "Failed units", cmd: "systemctl --failed --no-pager" },
    { label: "Network", cmd: "ip -brief addr && ip route" },
    { label: "Listening ports", cmd: "ss -tulpn" },
  ],
  macos: [
    { label: "Disk space", cmd: "df -h" },
    { label: "Load & memory", cmd: "uptime && vm_stat | head -n 8" },
    { label: "Top CPU", cmd: "ps aux -r | head -n 12" },
    { label: "Network", cmd: "ifconfig | grep -E 'inet |^[a-z]'" },
    { label: "Software updates", cmd: "softwareupdate --list" },
    { label: "Recent crashes", cmd: "ls -t ~/Library/Logs/DiagnosticReports | head" },
  ],
};

export function DeviceConsole() {
  const { data, can } = useDevice();
  const d = data.device;
  const params = useSearchParams();
  const online = d.status === "online";
  const isWin = d.platform === "windows";
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [input, setInput] = React.useState("");
  const [shell, setShell] = React.useState("auto");
  const [runAs, setRunAs] = React.useState<"system" | "user">("system");
  const [confirmRisk, setConfirmRisk] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [histIdx, setHistIdx] = React.useState(-1);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const risk = assessCommand(input);
  const focusJob = params.get("job");

  // History: previous console commands on this device (durable job runs).
  React.useEffect(() => {
    api.get<{ items: { id: string; jobId: string; status: Entry["status"]; createdAt: string; exitCode: number | null; durationMs: number | null; error: string | null; jobType: string; createdByName: string | null; payload: Record<string, unknown> }[] }>(`devices/${d.id}/jobs`, { limit: 100 })
      .then((r) => {
        const hist = r.items.filter((x) => x.jobType === "command").slice(0, 30).reverse().map<Entry>((x) => ({ runId: x.id, jobId: x.jobId, command: String(x.payload.command ?? ""), shell: x.payload.shell as string | undefined, runAs: x.payload.runAs as string | undefined, by: x.createdByName, startedAt: x.createdAt, status: x.status, chunks: [], exitCode: x.exitCode, durationMs: x.durationMs, error: x.error, loaded: false, expanded: x.jobId === focusJob || ["running", "sent", "pending"].includes(x.status) }));
        setEntries((prev) => {
          const have = new Set(prev.map((e) => e.runId));
          return [...hist.filter((h) => !have.has(h.runId)), ...prev];
        });
        for (const h of hist) if (h.expanded) void loadOutput(h.runId, h.jobId);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id]);

  useRealtime(["job.run.output", "job.run.updated"], (ev) => {
    const p = ev.payload as { runId: string; jobId: string; stream?: "stdout" | "stderr"; data?: string; status?: Entry["status"]; exitCode?: number; error?: string };
    setEntries((prev) => {
      const i = prev.findIndex((e) => e.runId === p.runId);
      if (i < 0) return prev;
      const e = { ...prev[i] };
      if (ev.name === "job.run.output" && p.data) e.chunks = [...e.chunks, { stream: p.stream ?? "stdout", data: p.data }];
      if (ev.name === "job.run.updated" && p.status) {
        e.status = p.status === ("sent" as string) ? "running" : p.status;
        if (p.exitCode !== undefined) e.exitCode = p.exitCode;
        if (p.error) e.error = p.error;
        if (["succeeded", "failed", "timeout", "cancelled"].includes(p.status)) { e.loaded = true; void refreshRun(p.runId, p.jobId); }
      }
      const next = prev.slice();
      next[i] = e;
      return next;
    });
  }, [`device:${d.id}`]);

  const lastChunkCount = entries[entries.length - 1]?.chunks.length ?? 0;
  React.useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [entries.length, lastChunkCount]);

  async function refreshRun(runId: string, jobId: string) {
    try {
      const r = await api.get<{ run: { stdout: string | null; stderr: string | null; exitCode: number | null; durationMs: number | null; status: Entry["status"]; error: string | null } }>(`jobs/${jobId}/runs/${runId}`);
      setEntries((prev) => prev.map((e) => (e.runId === runId ? { ...e, loaded: true, exitCode: r.run.exitCode, durationMs: r.run.durationMs, status: r.run.status, error: r.run.error, chunks: e.chunks.length ? e.chunks : [...(r.run.stdout ? [{ stream: "stdout" as const, data: r.run.stdout }] : []), ...(r.run.stderr ? [{ stream: "stderr" as const, data: r.run.stderr }] : [])] } : e)));
    } catch { /* ignore */ }
  }
  async function loadOutput(runId: string, jobId: string) {
    await refreshRun(runId, jobId);
  }

  async function run(cmd: string) {
    const command = cmd.trim();
    if (!command || submitting) return;
    const r = assessCommand(command);
    if (r.level === "destructive" && !confirmRisk) { setConfirmRisk(true); return; }
    setSubmitting(true);
    try {
      const res = await api.post<{ job: { id: string }; run: { id: string; status: Entry["status"] } | null }>(`devices/${d.id}/actions`, { action: "command", payload: { command, shell: shell === "auto" ? undefined : shell, runAs } });
      if (!res.run) throw new Error("No run was created");
      setEntries((prev) => [...prev, { runId: res.run!.id, jobId: res.job.id, command, shell, runAs, startedAt: new Date().toISOString(), status: res.run!.status === "pending" ? "running" : res.run!.status, chunks: [], exitCode: null, durationMs: null, loaded: true, expanded: true }]);
      setInput("");
      setConfirmRisk(false);
      setHistIdx(-1);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  }

  async function cancel(e: Entry) {
    try { await api.post(`jobs/${e.jobId}/cancel`); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Cancel failed"); }
  }

  const commands = entries.map((e) => e.command);
  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void run(input); return; }
    if (e.key === "ArrowUp" && !input.includes("\n") && commands.length) {
      e.preventDefault();
      const i = histIdx < 0 ? commands.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(i); setInput(commands[i]);
    } else if (e.key === "ArrowDown" && histIdx >= 0) {
      e.preventDefault();
      const i = histIdx + 1;
      if (i >= commands.length) { setHistIdx(-1); setInput(""); } else { setHistIdx(i); setInput(commands[i]); }
    } else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); setEntries([]); }
  }

  if (!can("scripts.run")) return <p className="text-sm text-fg-muted">You need the &quot;scripts.run&quot; permission to use the console.</p>;
  if (!online) return <DeviceOfflineNotice what="The console" />;

  return (
    <div className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-border bg-[#0b0d12] shadow-card" style={{ colorScheme: "dark" }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
        <Terminal className="h-4 w-4 text-accent-hover" />
        <span className="font-medium text-zinc-200">{d.name}</span>
        <span>·</span>
        <span>{isWin ? "PowerShell" : "bash"} as {runAs === "system" ? (isWin ? "SYSTEM" : "root") : d.loggedInUser || "user"}</span>
        <span className="ml-auto flex items-center gap-1.5"><Kbd className="border-white/15 bg-white/5 text-zinc-400">↑</Kbd><Kbd className="border-white/15 bg-white/5 text-zinc-400">↓</Kbd> history <Kbd className="ml-2 border-white/15 bg-white/5 text-zinc-400">Ctrl L</Kbd> clear</span>
        <Tooltip content="Clear screen (history stays in Jobs)"><button type="button" onClick={() => setEntries([])} className="rounded p-1 hover:bg-white/10 hover:text-zinc-200" aria-label="Clear"><Eraser className="h-3.5 w-3.5" /></button></Tooltip>
      </div>

      <div className="flex-1 overflow-auto px-3 py-2 font-mono text-[12.5px] leading-relaxed text-zinc-200" style={{ maxHeight: "60vh" }}>
        {entries.length === 0 && (
          <div className="py-6 text-zinc-500">
            <div>Every command runs as a tracked job on <span className="text-zinc-300">{d.name}</span>: output streams here and stays in the device timeline.</div>
            <div className="mt-1">Commands that delete data, reboot or weaken security are flagged before they run.</div>
          </div>
        )}
        {entries.map((e) => <EntryView key={e.runId} e={e} onToggle={() => { setEntries((prev) => prev.map((x) => (x.runId === e.runId ? { ...x, expanded: !x.expanded } : x))); if (!e.loaded) void loadOutput(e.runId, e.jobId); }} onCancel={() => cancel(e)} onRerun={() => { setInput(e.command); inputRef.current?.focus(); }} />)}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/10 bg-white/[0.02] p-2">
        {risk.level !== "safe" && <div className="mb-2"><RiskNotice risk={risk} confirm={confirmRisk} compact /></div>}
        <div className="flex items-start gap-2">
          <span className="mt-2 select-none pl-1 font-mono text-sm text-accent-hover">{isWin ? "PS>" : "$"}</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); setConfirmRisk(false); }}
            onKeyDown={onKey}
            rows={input.includes("\n") ? Math.min(8, input.split("\n").length) : 1}
            placeholder={isWin ? "Get-Service | Where-Object Status -eq 'Stopped'" : "df -h && uptime"}
            spellCheck={false}
            autoFocus
            className="min-h-9 flex-1 resize-none rounded-md border border-white/10 bg-black/40 px-3 py-2 font-mono text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-accent/60 focus:outline-none"
            aria-label="Command"
          />
          <Select value={shell} onChange={(e) => setShell(e.target.value)} className="h-9 w-auto border-white/10 bg-black/40 text-xs text-zinc-300" aria-label="Shell">
            <option value="auto">{isWin ? "PowerShell" : "bash"}</option>
            {isWin ? <><option value="pwsh">pwsh 7</option><option value="cmd">cmd</option></> : <><option value="sh">sh</option><option value="zsh">zsh</option></>}
          </Select>
          <Select value={runAs} onChange={(e) => setRunAs(e.target.value as "system" | "user")} className="h-9 w-auto border-white/10 bg-black/40 text-xs text-zinc-300" aria-label="Run as">
            <option value="system">{isWin ? "SYSTEM" : "root"}</option>
            <option value="user">user</option>
          </Select>
          <Button onClick={() => run(input)} loading={submitting} disabled={!input.trim()} variant={risk.level === "destructive" ? "danger" : "primary"} leftIcon={confirmRisk ? <TriangleAlert className="h-4 w-4" /> : <CornerDownLeft className="h-4 w-4" />}>{confirmRisk ? "Run anyway" : "Run"}</Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Snippets</span>
          {(SNIPPETS[d.platform] ?? SNIPPETS.linux).map((s) => <button key={s.label} type="button" onClick={() => { setInput(s.cmd); inputRef.current?.focus(); }} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-accent/50 hover:text-white focus-ring">{s.label}</button>)}
        </div>
      </div>
    </div>
  );
}

function EntryView({ e, onToggle, onCancel, onRerun }: { e: Entry; onToggle: () => void; onCancel: () => void; onRerun: () => void }) {
  const running = e.status === "running" || e.status === "pending";
  const ok = e.status === "succeeded";
  const text = e.chunks.map((c) => stripAnsi(c.data)).join("");
  return (
    <div className="group mb-2 rounded-md border border-transparent hover:border-white/10">
      <div className="flex items-start gap-2 px-1 py-0.5">
        <button type="button" onClick={onToggle} className="mt-0.5 shrink-0 text-zinc-500 hover:text-zinc-200" aria-label={e.expanded ? "Collapse" : "Expand"}>{e.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
        <span className="select-none text-accent-hover">{e.shell === "cmd" ? "C:\\>" : e.runAs === "user" ? "%" : "$"}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-zinc-100">{e.command}</span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-zinc-500">
          {running ? <span className="flex items-center gap-1 text-warning"><Loader2 className="h-3 w-3 animate-spin" /> {e.status === "pending" ? "queued" : "running"}</span>
            : <Badge tone={ok ? "success" : e.status === "cancelled" ? "neutral" : "danger"} size="xs">{ok ? `exit ${e.exitCode ?? 0}` : e.status === "timeout" ? "timed out" : e.exitCode !== null && e.exitCode !== undefined ? `exit ${e.exitCode}` : e.status}</Badge>}
          {e.durationMs !== null && e.durationMs !== undefined && <span>{formatMs(e.durationMs)}</span>}
          <Tooltip content={formatDateTime(e.startedAt)}><span>{relativeTime(e.startedAt)}</span></Tooltip>
          {e.by && <span className="hidden sm:inline">by {e.by}</span>}
          <span className="hidden items-center gap-0.5 group-hover:flex">
            <Tooltip content="Re-use command"><button type="button" onClick={onRerun} className="rounded p-1 hover:bg-white/10" aria-label="Re-run"><Play className="h-3 w-3" /></button></Tooltip>
            {text && <Tooltip content="Copy output"><button type="button" onClick={() => { navigator.clipboard.writeText(text).then(() => toast.success("Output copied")); }} className="rounded p-1 hover:bg-white/10" aria-label="Copy output"><Copy className="h-3 w-3" /></button></Tooltip>}
            {running && <Tooltip content="Cancel"><button type="button" onClick={onCancel} className="rounded p-1 text-danger hover:bg-white/10" aria-label="Cancel"><Square className="h-3 w-3" /></button></Tooltip>}
          </span>
        </span>
      </div>
      {e.expanded && (
        <div className="ml-6 border-l border-white/10 pl-3">
          {e.chunks.length === 0 ? <div className="py-1 text-zinc-500">{running ? "waiting for output…" : e.error ? <span className="text-danger">{e.error}</span> : e.loaded ? "(no output)" : "…"}</div>
            : <pre className={cn("max-h-[420px] overflow-auto whitespace-pre-wrap break-words py-1")}>{e.chunks.map((c, i) => <span key={i} className={c.stream === "stderr" ? "text-danger" : undefined}>{stripAnsi(c.data)}</span>)}</pre>}
          {!running && e.error && e.chunks.length > 0 && <div className="pb-1 text-danger">{e.error}</div>}
        </div>
      )}
    </div>
  );
}
