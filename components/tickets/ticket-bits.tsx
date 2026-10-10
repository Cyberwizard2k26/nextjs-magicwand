"use client";
import * as React from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/menu";
import { formatDateTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { slaState, type SlaFields } from "./sla";

/* ----------------------------------------------------------------------------------------------- shapes */
export interface TicketRow {
  id: string; number: number; title: string; status: string; priority: string; type: string; category: string | null;
  siteId: string | null; siteName: string | null; deviceId: string | null; deviceName: string | null; devicePlatform: string | null; deviceStatus: string | null;
  contactId: string | null; contactName: string | null; contactEmail: string | null; assigneeId: string | null; assigneeName: string | null; assigneeAvatarUrl: string | null;
  alertId: string | null; source: string; tags: string[]; firstResponseDueAt: string | null; resolveDueAt: string | null; firstRespondedAt: string | null; slaBreached: boolean; dueAt: string | null;
  timeSpentMinutes: number; satisfactionRating: number | null; aiSummary: string | null; commentCount: number; lastCommentAt: string | null; lastCommentPreview: string | null;
  resolvedAt: string | null; closedAt: string | null; createdBy: string | null; createdAt: string; updatedAt: string;
}
export interface TicketSummary { byStatus: Record<string, number>; byPriority: Record<string, number>; open: number; unassigned: number; dueToday: number; breached: number; atRisk: number; resolvedThisWeek: number; mine: number }
export interface Comment { id: string; ticketId: string; authorType: "user" | "contact" | "system" | "ai"; authorId: string | null; authorName: string | null; authorAvatarUrl?: string | null; body: string; isInternal: boolean; attachments: { id: string; name: string; size: number }[]; createdAt: string; updatedAt: string }
export interface TimeEntry { id: string; userId: string; userName: string | null; minutes: number; note: string | null; billable: boolean; startedAt: string | null; createdAt: string }
export interface Assignee { id: string; name: string; email: string; avatarUrl: string | null; roleName: string; openTickets: number }
export interface TicketDetailData {
  ticket: TicketRow & { description: string | null; customFields: Record<string, unknown>; externalSystem: string | null; externalId: string | null; externalUrl: string | null; slaPolicyId: string | null };
  comments: Comment[];
  timeEntries: TimeEntry[];
  device: { id: string; name: string; platform: string; status: string; loggedInUser: string | null; siteId: string | null; osName: string | null } | null;
  contact: { id: string; name: string; email: string | null; phone: string | null; title: string | null; isVip: boolean; siteId: string | null } | null;
  assignee: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  alert: { id: string; title: string; severity: string; status: string; openedAt: string } | null;
  related: { id: string; number: number; title: string; status: string; priority: string }[];
  slaPolicy: { id: string; name: string; targets: Record<string, { responseMinutes: number; resolveMinutes: number }> } | null;
  createdByName: string | null;
}
export interface ContactRow { id: string; name: string; email: string | null; phone: string | null; title: string | null; department: string | null; siteId: string | null; siteName: string | null; isVip: boolean; portalEnabled: boolean; notes: string | null; deviceCount: number; openTickets: number; primaryDeviceId: string | null; primaryDeviceName: string | null; createdAt: string; updatedAt: string }

/* ----------------------------------------------------------------------------------------------- vocab */
export const STATUSES: { value: string; label: string; tone: BadgeTone }[] = [
  { value: "new", label: "New", tone: "accent" }, { value: "open", label: "Open", tone: "warning" }, { value: "pending", label: "Waiting on user", tone: "info" },
  { value: "on_hold", label: "On hold", tone: "neutral" }, { value: "resolved", label: "Resolved", tone: "success" }, { value: "closed", label: "Closed", tone: "outline" },
];
export const PRIORITIES: { value: string; label: string; tone: BadgeTone }[] = [
  { value: "urgent", label: "Urgent", tone: "critical" }, { value: "high", label: "High", tone: "danger" }, { value: "normal", label: "Normal", tone: "info" }, { value: "low", label: "Low", tone: "neutral" },
];
export const TYPES = ["incident", "request", "problem", "change", "task", "alert"] as const;
export const statusLabel = (s: string) => STATUSES.find((x) => x.value === s)?.label ?? s;
export const statusTone = (s: string): BadgeTone => STATUSES.find((x) => x.value === s)?.tone ?? "neutral";
export const priorityTone = (p: string): BadgeTone => PRIORITIES.find((x) => x.value === p)?.tone ?? "neutral";
export const isOpenStatus = (s: string) => ["new", "open", "pending", "on_hold"].includes(s);

export function makeCan(permissions: string[]) {
  return (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
}

/** Re-render every `ms` so countdowns stay fresh without computing time in render. */
export function useTicker(ms = 30_000) {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/* ----------------------------------------------------------------------------------------------- atoms */
export function TicketStatusBadge({ status, size = "xs", className }: { status: string; size?: "xs" | "sm" | "md"; className?: string }) {
  return <Badge tone={statusTone(status)} size={size} dot className={cn("whitespace-nowrap", className)}>{statusLabel(status)}</Badge>;
}

export function TicketPriorityBadge({ priority, size = "xs", className }: { priority: string; size?: "xs" | "sm" | "md"; className?: string }) {
  const bars = { urgent: 4, high: 3, normal: 2, low: 1 }[priority] ?? 2;
  return (
    <Badge tone={priorityTone(priority)} size={size} className={cn("capitalize", className)}>
      <span className="flex items-end gap-px" aria-hidden>{[1, 2, 3, 4].map((i) => <span key={i} className={cn("w-[3px] rounded-sm bg-current", i <= bars ? "opacity-100" : "opacity-25")} style={{ height: 3 + i * 2 }} />)}</span>
      {priority}
    </Badge>
  );
}

export function TicketTypeBadge({ type, className }: { type: string; className?: string }) {
  return <Badge tone="outline" size="xs" className={cn("capitalize", className)}>{type}</Badge>;
}

export function SlaPill({ ticket, className, verbose }: { ticket: SlaFields; className?: string; verbose?: boolean }) {
  const s = slaState(ticket);
  const tone = s.tone;
  return (
    <Tooltip content={<span>{s.title}{s.dueAt && <><br />Due {formatDateTime(s.dueAt)}</>}</span>}>
      <Badge tone={tone} size="xs" className={cn("tabular", s.kind === "breached" && "animate-pulse", className)}>
        {s.kind === "ok" || s.kind === "warning" || s.kind === "critical" ? <span className={cn("h-1.5 w-1.5 rounded-full", s.kind === "ok" ? "bg-success" : "bg-current")} /> : null}
        {verbose && s.target ? `${s.target === "response" ? "Respond" : "Resolve"} · ` : ""}{s.label}
      </Badge>
    </Tooltip>
  );
}

export function AssigneeAvatar({ name, src, size = "sm", className }: { name: string | null; src?: string | null; size?: "xs" | "sm" | "md"; className?: string }) {
  if (!name) return <Tooltip content="Unassigned"><span className={cn("inline-flex items-center justify-center rounded-full border border-dashed border-border-strong text-fg-subtle", size === "xs" ? "h-5 w-5 text-[9px]" : size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs", className)}>?</span></Tooltip>;
  return <Tooltip content={name}><span className={cn("inline-flex", className)}><Avatar name={name} src={src} size={size} /></span></Tooltip>;
}

export function TicketNumber({ number, className }: { number: number; className?: string }) {
  return <span className={cn("mono tabular text-xs text-fg-subtle", className)}>#{number}</span>;
}

export function Stars({ value, onChange, size = "sm" }: { value: number | null; onChange?: (v: number) => void; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-0.5" role={onChange ? "radiogroup" : undefined} aria-label="Satisfaction rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" disabled={!onChange} onClick={() => onChange?.(i)} aria-label={`${i} star${i === 1 ? "" : "s"}`} className={cn("rounded focus-ring disabled:cursor-default", size === "sm" ? "text-sm" : "text-lg", value !== null && i <= value ? "text-warning" : "text-fg-subtle/60", onChange && "hover:text-warning")}>★</button>
      ))}
    </span>
  );
}
