"use client";
import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { Play } from "lucide-react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Pill } from "@/components/ui/misc";
import { useRealtime } from "@/components/shell/realtime-provider";
import { formatDateTime, formatMs, relativeTime } from "@/lib/client/format";
import { PanelEmpty, PanelSkeleton, Section, type PanelProps } from "./panel-bits";

interface RunRow { id: string; jobId: string; status: string; createdAt: string; finishedAt: string | null; exitCode: number | null; error: string | null; durationMs: number | null; jobName: string; jobType: string; createdByName: string | null }
const FILTERS = [["", "All"], ["active", "Active"], ["failed", "Failed"], ["succeeded", "Succeeded"]] as const;
const ACTIVE = new Set(["pending", "sent", "running", "offline_queued", "awaiting_approval"]);

export function JobsPanel({ detail, can }: PanelProps) {
  const id = detail.device.id;
  const [filter, setFilter] = React.useState<string>("");
  const { data, isLoading, mutate } = useSWR<{ items: RunRow[] }>([`devices/${id}/jobs`, { limit: 100 }]);
  useRealtime(["job.run.updated", "job.created"], (ev) => { if (ev.deviceId === id || !ev.deviceId) mutate(); }, [`device:${id}`]);
  const all = data?.items ?? [];
  const items = all.filter((r) => (filter === "" ? true : filter === "active" ? ACTIVE.has(r.status) : filter === "failed" ? r.status === "failed" || r.status === "timeout" : r.status === "succeeded"));
  const counts = { active: all.filter((r) => ACTIVE.has(r.status)).length, failed: all.filter((r) => r.status === "failed" || r.status === "timeout").length };

  return (
    <Section title={<>Job history{counts.active > 0 && <Badge tone="warning" size="xs" className="ml-2">{counts.active} active</Badge>}</>} action={can("scripts.run") && <Link href={`/jobs/new?device=${id}`} className="inline-flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-medium text-accent-fg hover:bg-accent-hover focus-ring"><Play className="h-3 w-3" /> New job</Link>}>
      <div className="mb-2 flex flex-wrap gap-1">{FILTERS.map(([v, l]) => <Pill key={v} active={filter === v} onClick={() => setFilter(v)} className="h-6 px-2 text-[11px]">{l}{v === "failed" && counts.failed > 0 ? ` · ${counts.failed}` : ""}</Pill>)}</div>
      {isLoading ? <PanelSkeleton rows={6} /> : items.length === 0 ? (
        <PanelEmpty icon={<Play />} title={filter ? "No matching jobs" : "No jobs have run here"} description="Every console command, script, reboot and software install is recorded as a job run." />
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border">
          {items.map((r) => (
            <li key={r.id}>
              <Link href={`/jobs/${r.jobId}?run=${r.id}`} className="flex items-center gap-2 px-2.5 py-2 hover:bg-surface-hover/70 focus-ring">
                <Badge tone={statusTone(r.status)} size="xs" dot className="w-[88px] shrink-0 justify-start capitalize">{r.status.replace("_", " ")}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-fg">{r.jobName}</div>
                  <div className="truncate text-[11px] text-fg-subtle">{[r.jobType.replace("_", " "), r.createdByName, r.durationMs !== null ? formatMs(r.durationMs) : null, r.exitCode !== null && r.exitCode !== 0 ? `exit ${r.exitCode}` : null].filter(Boolean).join(" · ")}{r.error ? <span className="text-danger"> · {r.error}</span> : null}</div>
                </div>
                <span className="shrink-0 text-[10px] text-fg-subtle" title={formatDateTime(r.createdAt)}>{relativeTime(r.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
