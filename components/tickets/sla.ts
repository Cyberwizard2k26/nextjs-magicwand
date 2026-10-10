/** Client-safe SLA display maths (also unit-tested from lib/services/tickets.test.ts). */
export interface SlaFields { status: string; firstResponseDueAt: string | Date | null; resolveDueAt: string | Date | null; firstRespondedAt: string | Date | null; slaBreached: boolean }
export type SlaKind = "none" | "paused" | "met" | "breached" | "critical" | "warning" | "ok";
export type SlaTone = "neutral" | "info" | "success" | "danger" | "critical" | "warning";
export interface SlaView { kind: SlaKind; tone: SlaTone; label: string; title: string; dueAt: string | null; remainingMs: number | null; target: "response" | "resolution" | null }

const ms = (v: string | Date | null) => (v ? new Date(v).getTime() : null);
const toIso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);

/** "2h 15m", "45m", "3d 4h" */
export function formatRemaining(msLeft: number): string {
  const total = Math.max(0, Math.round(Math.abs(msLeft) / 60_000));
  const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function slaState(t: SlaFields, now = Date.now()): SlaView {
  const responseDue = ms(t.firstResponseDueAt), resolveDue = ms(t.resolveDueAt);
  const closed = t.status === "resolved" || t.status === "closed";
  if (responseDue === null && resolveDue === null) return { kind: "none", tone: "neutral", label: "No SLA", title: "No SLA policy applies to this ticket", dueAt: null, remainingMs: null, target: null };
  if (closed) {
    return t.slaBreached
      ? { kind: "breached", tone: "danger", label: "Breached", title: "An SLA target was missed before this ticket was resolved", dueAt: toIso(t.resolveDueAt), remainingMs: null, target: null }
      : { kind: "met", tone: "success", label: "Met", title: "Resolved within the SLA targets", dueAt: toIso(t.resolveDueAt), remainingMs: null, target: null };
  }
  const awaitingResponse = !t.firstRespondedAt && responseDue !== null;
  const target: "response" | "resolution" = awaitingResponse ? "response" : "resolution";
  const due = awaitingResponse ? responseDue! : resolveDue;
  const dueAt = due === null ? null : new Date(due).toISOString();
  if (t.status === "pending" || t.status === "on_hold") return { kind: "paused", tone: "info", label: "Paused", title: `SLA clock paused while ${t.status === "pending" ? "waiting on the requester" : "on hold"}`, dueAt, remainingMs: null, target };
  if (due === null) return { kind: "none", tone: "neutral", label: "No SLA", title: "No remaining SLA target", dueAt: null, remainingMs: null, target: null };
  const remaining = due - now;
  const targetLabel = target === "response" ? "First response" : "Resolution";
  if (t.slaBreached || remaining < 0) return { kind: "breached", tone: "danger", label: `${formatRemaining(remaining)} over`, title: `${targetLabel} target missed`, dueAt, remainingMs: remaining, target };
  if (remaining < 30 * 60_000) return { kind: "critical", tone: "critical", label: formatRemaining(remaining), title: `${targetLabel} due in ${formatRemaining(remaining)}`, dueAt, remainingMs: remaining, target };
  if (remaining < 2 * 60 * 60_000) return { kind: "warning", tone: "warning", label: formatRemaining(remaining), title: `${targetLabel} due in ${formatRemaining(remaining)}`, dueAt, remainingMs: remaining, target };
  return { kind: "ok", tone: "neutral", label: formatRemaining(remaining), title: `${targetLabel} due in ${formatRemaining(remaining)}`, dueAt, remainingMs: remaining, target };
}
