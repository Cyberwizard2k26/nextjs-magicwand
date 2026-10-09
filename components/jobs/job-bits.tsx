"use client";
import * as React from "react";
import { Badge, statusTone, type BadgeTone } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/menu";
import { cn } from "@/lib/util/cn";

export interface JobStats { total: number; pending: number; running: number; succeeded: number; failed: number; skipped: number }
export interface JobRow { id: string; type: string; name: string; status: string; targetType: string; targetIds: string[]; stats: JobStats; source: string; createdBy: string | null; createdByName: string | null; createdAt: string; startedAt: string | null; completedAt: string | null; scheduledAt: string | null; requiresApproval: boolean; concurrency: number; abortOnFailurePercent: number | null; runWhenOnline: boolean; payload: Record<string, unknown>; sourceId: string | null; timeoutSeconds: number; maxRetries: number }

const JOB_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  queued: { label: "Queued", tone: "warning" },
  awaiting_approval: { label: "Awaiting approval", tone: "accent" },
  running: { label: "Running", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function JobStatusBadge({ status, size = "xs" }: { status: string; size?: "xs" | "sm" | "md" }) {
  const s = JOB_STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return <Badge tone={s.tone} size={size} dot className={cn(status === "running" && "[&>span]:animate-pulse")}>{s.label}</Badge>;
}

export function RunStatusBadge({ status, exitCode, size = "xs" }: { status: string; exitCode?: number | null; size?: "xs" | "sm" }) {
  const label = status === "offline_queued" ? "waiting for device" : status === "sent" ? "running" : status.replace(/_/g, " ");
  return <Badge tone={statusTone(status === "sent" ? "running" : status)} size={size} dot>{label}{status === "failed" && exitCode !== null && exitCode !== undefined ? ` (exit ${exitCode})` : ""}</Badge>;
}

/** Stacked progress of a job's runs: succeeded · failed · running · pending/skipped. Status colours only. */
export function JobProgress({ stats, className, showNumbers = true }: { stats: JobStats; className?: string; showNumbers?: boolean }) {
  const total = Math.max(1, stats.total);
  const seg = (n: number, color: string, label: string) => (n > 0 ? <Tooltip key={label} content={`${n} ${label}`}><span className="h-full" style={{ width: `${(n / total) * 100}%`, background: color }} /></Tooltip> : null);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex h-1.5 w-full min-w-[80px] gap-px overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${stats.succeeded} succeeded, ${stats.failed} failed, ${stats.running} running, ${stats.pending} pending`}>
        {seg(stats.succeeded, "var(--success)", "succeeded")}
        {seg(stats.failed, "var(--danger)", "failed")}
        {seg(stats.running, "var(--warning)", "running")}
        {seg(stats.skipped, "var(--fg-subtle)", "skipped")}
      </div>
      {showNumbers && <span className="shrink-0 tabular text-xs text-fg-muted"><span className="text-success">{stats.succeeded}</span>{stats.failed > 0 && <>/<span className="text-danger">{stats.failed}</span></>} of {stats.total}</span>}
    </div>
  );
}

export const JOB_TYPE_LABEL: Record<string, string> = {
  script: "Script", command: "Command", software_install: "Install software", software_uninstall: "Uninstall software", patch_scan: "Patch scan", patch_install: "Install patches", reboot: "Reboot", shutdown: "Shut down", wake_on_lan: "Wake", inventory: "Inventory", file_push: "Push file", file_pull: "Pull file", registry: "Registry", service_action: "Service", process_kill: "End process", policy_apply: "Apply policy", agent_update: "Agent update", agent_uninstall: "Agent uninstall", lock_screen: "Lock screen", logoff_user: "Log off", message_user: "Message user", rotate_local_admin: "Rotate admin password", network_scan: "Network scan", security_scan: "Security scan", clear_cache: "Clear temp files", custom: "Custom",
};
export function jobTypeLabel(t: string) { return JOB_TYPE_LABEL[t] ?? t.replace(/_/g, " "); }
