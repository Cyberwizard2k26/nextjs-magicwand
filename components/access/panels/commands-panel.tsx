"use client";
import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, History, Play, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, statusTone } from "@/components/ui/badge";
import { Select, Textarea } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/menu";
import { useRealtime } from "@/components/shell/realtime-provider";
import { RiskNotice } from "@/components/jobs/quick-job-dialog";
import { api, ApiClientError } from "@/lib/client/api";
import { assessCommand } from "@/lib/client/command-risk";
import { formatDateTime, formatMs, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { PanelSkeleton, Section, stripAnsi, type PanelProps } from "./panel-bits";

interface RunRow { id: string; jobId: string; status: string; createdAt: string; exitCode: number | null; durationMs: number | null; jobType: string; jobName: string; createdByName: string | null; payload: Record<string, unknown> | null }
interface Active { jobId: string; runId: string; status: string; exitCode: number | null; error: string | null; chunks: { stream: string; data: string }[]; command: string }
const DONE = new Set(["succeeded", "failed", "timeout", "cancelled", "offline_queued"]);

/** Quick command box: creates a `command` job for this device and streams the run's output in place. */
export function CommandsPanel({ detail, can }: PanelProps) {
  const id = detail.device.id;
  const online = detail.device.status === "online";
  const windows = detail.device.platform === "windows";
  const [command, setCommand] = React.useState("");
  const [shell, setShell] = React.useState("auto");
  const [runAs, setRunAs] = React.useState<"system" | "user">("system");
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [active, setActive] = React.useState<Active | null>(null);
  const risk = assessCommand(command);
  const { data, isLoading, mutate } = useSWR<{ items: RunRow[] }>([`devices/${id}/jobs`, { limit: 100 }]);
  const history = (data?.items ?? []).filter((r) => r.jobType === "command").slice(0, 15);
  const activeRef = React.useRef<Active | null>(null);
  activeRef.current = active;

  useRealtime(["job.run.output", "job.run.updated", "job.created"], (ev) => {
    if (ev.deviceId !== id) return;
    const p = ev.payload as { runId?: string; stream?: string; data?: string; status?: string; exitCode?: number | null; error?: string | null };
    if (ev.name === "job.created") { mutate(); return; }
    if (!activeRef.current || p.runId !== activeRef.current.runId) return;
    if (ev.name === "job.run.output" && p.data) setActive((a) => a && { ...a, chunks: [...a.chunks, { stream: p.stream ?? "stdout", data: p.data! }] });
    if (ev.name === "job.run.updated" && p.status) {
      setActive((a) => a && { ...a, status: p.status!, exitCode: p.exitCode ?? a.exitCode, error: p.error ?? a.error });
      if (DONE.has(p.status)) { mutate(); loadRun(activeRef.current.jobId, activeRef.current.runId, false); }
    }
  }, [`device:${id}`]);

  async function loadRun(jobId: string, runId: string, replace: boolean) {
    try {
      const r = await api.get<{ run: { status: string; exitCode: number | null; error: string | null; stdout: string | null; stderr: string | null; command: { command?: string } } }>(`jobs/${jobId}/runs/${runId}`);
      const chunks = [...(r.run.stdout ? [{ stream: "stdout", data: r.run.stdout }] : []), ...(r.run.stderr ? [{ stream: "stderr", data: r.run.stderr }] : [])];
      setActive((a) => replace || !a || a.runId !== runId ? { jobId, runId, status: r.run.status, exitCode: r.run.exitCode, error: r.run.error, chunks, command: String(r.run.command?.command ?? "") } : { ...a, status: r.run.status, exitCode: r.run.exitCode, error: r.run.error, chunks: chunks.length ? chunks : a.chunks });
    } catch { /* keep the streamed output */ }
  }

  async function run() {
    if (!command.trim()) return;
    if (risk.level === "destructive" && !confirm) { setConfirm(true); return; }
    setBusy(true);
    try {
      const r = await api.post<{ job: { id: string }; run: { id: string; status: string } | null }>(`devices/${id}/actions`, { action: "command", payload: { command: command.trim(), shell: shell === "auto" ? undefined : shell, runAs } });
      if (r.run) setActive({ jobId: r.job.id, runId: r.run.id, status: r.run.status, exitCode: null, error: null, chunks: [], command: command.trim() });
      toast.success(online ? "Command sent" : "Command queued until the device reconnects");
      setConfirm(false);
      mutate();
    } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not run the command"); } finally { setBusy(false); }
  }

  const output = active ? active.chunks.map((c) => ({ ...c, data: stripAnsi(c.data) })) : [];
  const running = active ? !DONE.has(active.status) : false;
  const text = output.map((c) => c.data).join("");

  if (!can("scripts.run")) return <Section><p className="text-xs text-fg-muted">You do not have permission to run commands.</p></Section>;
  return (
    <>
      <Section>
        <Textarea value={command} onChange={(e) => { setCommand(e.target.value); setConfirm(false); }} placeholder={windows ? "Get-Service | Where-Object Status -eq 'Stopped'" : "df -h && uptime"} className="mono min-h-[80px] text-[12.5px]" spellCheck={false} aria-label="Command" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run(); }} />
        <div className="mt-2"><RiskNotice risk={risk} confirm={confirm} compact /></div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={shell} onChange={(e) => setShell(e.target.value)} className="h-8 w-auto text-xs" aria-label="Shell">
            <option value="auto">{windows ? "PowerShell" : "bash"} (auto)</option>
            {windows ? <><option value="pwsh">PowerShell 7</option><option value="cmd">cmd.exe</option></> : <><option value="sh">sh</option><option value="zsh">zsh</option></>}
          </Select>
          <Select value={runAs} onChange={(e) => setRunAs(e.target.value as "system" | "user")} className="h-8 w-auto text-xs" aria-label="Run as">
            <option value="system">as SYSTEM / root</option>
            <option value="user">as signed-in user</option>
          </Select>
          <Button size="sm" className="ml-auto" variant={confirm ? "danger" : "primary"} onClick={run} loading={busy} disabled={!command.trim()} leftIcon={<Play className="h-3.5 w-3.5" />}>{confirm ? "Run anyway" : online ? "Run" : "Queue"}</Button>
        </div>
      </Section>

      {active && (
        <Section title={<span className="flex items-center gap-2">Output <Badge tone={statusTone(active.status)} size="xs" className="capitalize">{active.status.replace("_", " ")}{active.exitCode !== null ? ` · exit ${active.exitCode}` : ""}</Badge></span>} action={<span className="flex items-center gap-1">{text && <Button size="xs" variant="ghost" leftIcon={<Copy className="h-3 w-3" />} onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}>Copy</Button>}<Link href={`/jobs/${active.jobId}?run=${active.runId}`} className="text-[11px] text-accent-hover hover:underline">Job</Link></span>}>
          <div className="mono mb-1.5 truncate text-[11px] text-fg-subtle">$ {active.command}</div>
          <pre className="mono max-h-[40vh] min-h-[96px] overflow-auto rounded-lg bg-[#0b0d12] px-3 py-2 text-[11.5px] leading-relaxed text-zinc-200" style={{ colorScheme: "dark" }}>
            {active.error && <span className="text-danger">{active.error}{"\n"}</span>}
            {output.length === 0 ? <span className="text-zinc-500">{running ? (online ? "waiting for output…" : "queued - runs when the device reconnects") : "(no output)"}</span> : output.map((c, i) => <span key={i} className={c.stream === "stderr" ? "text-danger" : undefined}>{c.data}</span>)}
          </pre>
        </Section>
      )}

      <Section title="Recent commands">
        {isLoading ? <PanelSkeleton rows={3} /> : history.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-fg-subtle"><History className="h-3.5 w-3.5" />No commands have run on this machine yet.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border">
            {history.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => { setCommand(String(r.payload?.command ?? "")); loadRun(r.jobId, r.id, true); }} className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-hover/70 focus-ring", active?.runId === r.id && "bg-accent-soft/40")}>
                  <SquareTerminal className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  <span className="mono min-w-0 flex-1 truncate text-[12px] text-fg">{String(r.payload?.command ?? r.jobName.replace(/^Console: /, ""))}</span>
                  <Tooltip content={`${formatDateTime(r.createdAt)}${r.createdByName ? ` · ${r.createdByName}` : ""}${r.durationMs !== null ? ` · ${formatMs(r.durationMs)}` : ""}`}><span className="shrink-0 text-[10px] text-fg-subtle">{relativeTime(r.createdAt)}</span></Tooltip>
                  <Badge tone={statusTone(r.status)} size="xs" className="shrink-0">{r.exitCode !== null ? `exit ${r.exitCode}` : r.status}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
