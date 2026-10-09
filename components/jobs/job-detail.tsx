"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, Copy, FlaskConical, Loader2, RotateCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Code, PageHeader, Pill, Skeleton } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, formatMs, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { PlatformChip, StatusDotLive } from "@/components/devices/device-bits";
import { stripAnsi } from "@/components/remote/use-rpc";
import { JobProgress, JobStatusBadge, RunStatusBadge, jobTypeLabel, type JobRow } from "./job-bits";

interface Run { id: string; deviceId: string; status: string; attempt: number; sentAt: string | null; finishedAt: string | null; exitCode: number | null; error: string | null; durationMs: number | null; output: Record<string, unknown> | null; deviceName: string | null; platform: string | null; deviceStatus: string | null; connected: boolean }
interface Detail { job: JobRow; runs: Run[]; canaryOf: { id: string; name: string; status: string } | null; rollout: { id: string; name: string; status: string; stats: JobRow["stats"] } | null }

export function JobDetail({ id, permissions }: { id: string; permissions: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const { data, mutate, isLoading } = useSWR<Detail>(`jobs/${id}`);
  const [selected, setSelected] = React.useState<string | null>(params.get("run"));
  const [filter, setFilter] = React.useState<"all" | "failed" | "running" | "pending">("all");
  const [q, setQ] = React.useState("");
  const [showPayload, setShowPayload] = React.useState(false);
  useRealtime(["job.*"], (ev) => { const p = ev.payload as { jobId?: string }; if (p.jobId === id || !p.jobId) mutate(); }, [`job:${id}`]);

  async function act(action: "approve" | "cancel" | "retry") {
    try { await api.post(`jobs/${id}/${action}`); toast.success({ approve: "Job approved", cancel: "Job cancelled", retry: "Failed runs re-queued" }[action]); mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Failed"); }
  }

  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-8 w-80" /><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  const { job, runs } = data;
  const p = job.payload;
  const shownRuns = runs.filter((r) => {
    if (filter === "failed" && !["failed", "timeout"].includes(r.status)) return false;
    if (filter === "running" && !["sent", "running"].includes(r.status)) return false;
    if (filter === "pending" && !["pending", "offline_queued"].includes(r.status)) return false;
    if (q && !(r.deviceName ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const selectedRun = runs.find((r) => r.id === selected) ?? (runs.length === 1 ? runs[0] : null);
  const active = ["queued", "running", "awaiting_approval"].includes(job.status);
  const summary = job.type === "command" ? String(p.command ?? "") : job.type === "script" ? `${p.name ?? "script"}${p.language ? ` (${p.language})` : ""}` : job.type === "message_user" ? `${p.title ?? ""}: ${p.body ?? ""}` : "";

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Jobs", href: "/jobs" }, { label: jobTypeLabel(job.type) }]}
        title={job.name}
        badge={<JobStatusBadge status={job.status} size="sm" />}
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><span>Created {relativeTime(job.createdAt)} by {job.createdByName ?? "system"}</span>{job.startedAt && <span>· started {formatDateTime(job.startedAt)}</span>}{job.completedAt && job.startedAt && <span>· took {formatMs(new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime())}</span>}{job.scheduledAt && !job.startedAt && <span>· scheduled for {formatDateTime(job.scheduledAt)}</span>}</span>}
        actions={can("jobs.manage") && (
          <>
            {job.status === "awaiting_approval" && <Button variant="success" leftIcon={<Check className="h-4 w-4" />} onClick={() => act("approve")}>Approve and run</Button>}
            {active && <Button variant="danger" leftIcon={<X className="h-4 w-4" />} onClick={() => act("cancel")}>Cancel job</Button>}
            {!active && job.stats.failed > 0 && <Button variant="secondary" leftIcon={<RotateCw className="h-4 w-4" />} onClick={() => act("retry")}>Retry {job.stats.failed} failed</Button>}
            {(job.type === "command" || job.type === "script") && can("scripts.run") && <Button variant="secondary" leftIcon={<Copy className="h-4 w-4" />} onClick={() => router.push(`/jobs/new?clone=${job.id}`)}>Run again…</Button>}
          </>
        )}
      />

      {(data.canaryOf || data.rollout) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft/40 px-4 py-3 text-sm">
          <FlaskConical className="h-4 w-4 text-accent-hover" />
          {data.canaryOf && <span>This is the rollout wave of <Link href={`/jobs/${data.canaryOf.id}`} className="font-medium underline-offset-2 hover:underline">{data.canaryOf.name}</Link> ({data.canaryOf.status.replace(/_/g, " ")}).{job.status === "awaiting_approval" && " It is promoted automatically when the canary finishes clean, or approve it now."}</span>}
          {data.rollout && <span>Canary wave. The rollout <Link href={`/jobs/${data.rollout.id}`} className="font-medium underline-offset-2 hover:underline">{data.rollout.name}</Link> is <JobStatusBadge status={data.rollout.status} /> and continues automatically only if every canary device succeeds.</span>}
        </div>
      )}

      <div className="mb-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Progress" description={`${job.stats.total} device${job.stats.total === 1 ? "" : "s"} · concurrency ${job.concurrency || "unlimited"} · ${job.runWhenOnline ? "queues for offline devices" : "online devices only"}${job.abortOnFailurePercent ? ` · aborts above ${job.abortOnFailurePercent}% failures` : ""}${job.maxRetries ? ` · ${job.maxRetries} retries` : ""}`} />
          <CardBody>
            <JobProgress stats={job.stats} showNumbers={false} className="mb-3" />
            <div className="grid grid-cols-5 gap-2 text-center">
              {([["succeeded", "text-success"], ["failed", "text-danger"], ["running", "text-warning"], ["pending", "text-fg"], ["skipped", "text-fg-subtle"]] as const).map(([k, cls]) => <div key={k} className="rounded-lg bg-surface-2/70 py-2"><div className={cn("text-xl font-semibold tabular", cls)}>{job.stats[k]}</div><div className="text-[11px] uppercase tracking-wider text-fg-subtle">{k}</div></div>)}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What runs" description={jobTypeLabel(job.type)} actions={Object.keys(p).length > 0 && <button type="button" className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg" onClick={() => setShowPayload((s) => !s)}>{showPayload ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} details</button>} />
          <CardBody>
            {summary ? <Code block className="max-h-40 whitespace-pre-wrap">{summary}</Code> : <p className="text-sm text-fg-muted">No parameters.</p>}
            {showPayload && <Code block className="mt-2 max-h-60">{JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => k !== "content")), null, 2)}</Code>}
            {job.type === "script" && typeof p.content === "string" && showPayload && <Code block className="mt-2 max-h-72">{p.content as string}</Code>}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title={`Devices (${shownRuns.length})`} actions={<div className="flex items-center gap-1.5"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find device" leftIcon={<Search />} className="h-7 w-40 text-xs" />{([["all", "All"], ["failed", "Failed"], ["running", "Running"], ["pending", "Pending"]] as const).map(([v, l]) => <Pill key={v} active={filter === v} onClick={() => setFilter(v)} className="h-7 px-2.5">{l}</Pill>)}</div>} />
          <CardBody className="max-h-[60vh] overflow-auto px-0 pb-0">
            <ul className="divide-y divide-border/70">
              {shownRuns.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => { setSelected(r.id); router.replace(`/jobs/${id}?run=${r.id}`, { scroll: false }); }} className={cn("flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface-hover/60 focus-ring", selectedRun?.id === r.id && "bg-accent-soft/40")}>
                    <StatusDotLive status={r.connected ? "online" : r.deviceStatus ?? "offline"} />
                    <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><Link href={`/devices/${r.deviceId}`} onClick={(e) => e.stopPropagation()} className="truncate text-sm font-medium text-fg hover:text-accent-hover">{r.deviceName ?? r.deviceId}</Link>{r.platform && <PlatformChip platform={r.platform} />}</span>{r.error && <span className="block truncate text-xs text-danger">{r.error}</span>}</span>
                    <RunStatusBadge status={r.status} exitCode={r.exitCode} />
                    <span className="w-16 shrink-0 text-right text-xs text-fg-subtle">{r.durationMs ? formatMs(r.durationMs) : r.status === "sent" || r.status === "running" ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" /> : ""}</span>
                  </button>
                </li>
              ))}
              {shownRuns.length === 0 && <li className="px-5 py-10 text-center text-sm text-fg-subtle">No devices match.</li>}
            </ul>
          </CardBody>
        </Card>
        <div className="min-w-0">{selectedRun ? <RunOutput jobId={id} run={selectedRun} /> : <div className="card flex h-full min-h-[200px] items-center justify-center text-sm text-fg-subtle">Select a device to see its output.</div>}</div>
      </div>
      <Badge className="hidden" />
    </>
  );
}

function RunOutput({ jobId, run }: { jobId: string; run: Run }) {
  const running = run.status === "sent" || run.status === "running";
  const { data, mutate } = useSWR<{ run: { stdout: string | null; stderr: string | null; output: unknown; command: Record<string, unknown> } }>(`jobs/${jobId}/runs/${run.id}`);
  const [live, setLive] = React.useState<{ stream: string; data: string }[]>([]);
  React.useEffect(() => { setLive([]); }, [run.id]);
  React.useEffect(() => { if (!running) mutate(); }, [running, mutate]);
  useRealtime("job.run.output", (ev) => { const p = ev.payload as { runId: string; stream: string; data: string }; if (p.runId === run.id) setLive((l) => [...l, { stream: p.stream, data: p.data }]); });
  const text = running || !data ? live : [...(data.run.stdout ? [{ stream: "stdout", data: data.run.stdout }] : []), ...(data.run.stderr ? [{ stream: "stderr", data: data.run.stderr }] : [])];
  const all = text.map((c) => stripAnsi(c.data)).join("");
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={run.deviceName ?? run.deviceId} description={<span className="flex flex-wrap items-center gap-2"><RunStatusBadge status={run.status} exitCode={run.exitCode} />{run.sentAt && <span>sent {relativeTime(run.sentAt)}</span>}{run.finishedAt && <span>· finished {relativeTime(run.finishedAt)}</span>}{run.attempt > 1 && <span>· attempt {run.attempt}</span>}</span>} actions={all && <Button size="xs" variant="ghost" leftIcon={<Copy className="h-3 w-3" />} onClick={() => navigator.clipboard.writeText(all).then(() => toast.success("Copied"))}>Copy</Button>} />
      <CardBody className="flex-1 px-0 pb-0">
        {run.error && <div className="mx-5 mb-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{run.error}</div>}
        <pre className="mono max-h-[52vh] min-h-[200px] overflow-auto rounded-b-[var(--radius)] bg-[#0b0d12] px-4 py-3 text-[12px] leading-relaxed text-zinc-200" style={{ colorScheme: "dark" }}>
          {text.length === 0 ? <span className="text-zinc-500">{running ? "waiting for output…" : run.status === "offline_queued" ? "Queued - runs when the device reconnects." : run.status === "pending" ? "Queued." : "(no output)"}</span> : text.map((c, i) => <span key={i} className={c.stream === "stderr" ? "text-danger" : undefined}>{stripAnsi(c.data)}</span>)}
        </pre>
        {run.output && Object.keys(run.output).length > 0 && <Code block className="m-5 mt-3 max-h-60">{JSON.stringify(run.output, null, 2)}</Code>}
      </CardBody>
    </Card>
  );
}
