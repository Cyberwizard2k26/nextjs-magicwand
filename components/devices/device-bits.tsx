"use client";
import * as React from "react";
import { Laptop, Monitor, Printer, Router, Server, Smartphone, Box, Cpu, type LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/menu";
import { cn } from "@/lib/util/cn";
import { platformLabel, relativeTime, formatDateTime } from "@/lib/client/format";

export const PLATFORM_SHORT: Record<string, string> = { windows: "WIN", linux: "LNX", macos: "MAC", freebsd: "BSD", android: "AND", ios: "iOS", network: "NET", other: "—" };

/** Compact platform chip: three letters, always paired with the full name in a tooltip. */
export function PlatformChip({ platform, className }: { platform: string; className?: string }) {
  return (
    <Tooltip content={platformLabel[platform] ?? platform}>
      <span className={cn("mono inline-flex h-5 items-center rounded border border-border bg-surface-3 px-1.5 text-[10px] font-semibold tracking-wide text-fg-muted", className)}>{PLATFORM_SHORT[platform] ?? platform.slice(0, 3).toUpperCase()}</span>
    </Tooltip>
  );
}

const TYPE_ICON: Record<string, LucideIcon> = { workstation: Monitor, laptop: Laptop, server: Server, vm: Box, network: Router, printer: Printer, mobile: Smartphone, iot: Cpu, other: Monitor };
export function DeviceTypeIcon({ type, className }: { type?: string | null; className?: string }) {
  const Icon = TYPE_ICON[type ?? "other"] ?? Monitor;
  return <Icon className={cn("h-4 w-4", className)} />;
}

const STATUS: Record<string, { tone: BadgeTone; label: string; dot: string }> = {
  online: { tone: "success", label: "Online", dot: "bg-success" },
  offline: { tone: "danger", label: "Offline", dot: "bg-danger" },
  maintenance: { tone: "info", label: "Maintenance", dot: "bg-info" },
  pending: { tone: "warning", label: "Awaiting approval", dot: "bg-warning" },
  decommissioned: { tone: "neutral", label: "Decommissioned", dot: "bg-fg-subtle" },
};

export function DeviceStatusBadge({ status, size = "xs", className }: { status: string; size?: "xs" | "sm" | "md"; className?: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as BadgeTone, label: status, dot: "bg-fg-subtle" };
  return <Badge tone={s.tone} size={size} dot className={className}>{s.label}</Badge>;
}

export function StatusDotLive({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { dot: "bg-fg-subtle" };
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", s.dot, status === "online" && "pulse-dot", className)} aria-label={STATUS[status]?.label ?? status} />;
}

export function healthTone(score: number | null | undefined): "success" | "warning" | "danger" | "neutral" {
  if (score === null || score === undefined) return "neutral";
  return score >= 80 ? "success" : score >= 60 ? "warning" : "danger";
}

export function HealthScore({ score, className }: { score: number | null | undefined; className?: string }) {
  const tone = healthTone(score);
  const color = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-fg-subtle" }[tone];
  if (score === null || score === undefined) return <span className={cn("text-xs text-fg-subtle", className)}>—</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-3"><span className={cn("block h-full rounded-full", color)} style={{ width: `${score}%` }} /></span>
      <span className="tabular text-xs font-medium text-fg">{score}</span>
    </span>
  );
}

export function LastSeen({ at, status, className }: { at: string | Date | null | undefined; status?: string; className?: string }) {
  if (status === "online") return <span className={cn("whitespace-nowrap text-xs text-success", className)}>now</span>;
  return (
    <Tooltip content={at ? formatDateTime(at) : "Never connected"}>
      <span className={cn("whitespace-nowrap text-xs text-fg-muted", className)}>{relativeTime(at)}</span>
    </Tooltip>
  );
}

export function TagList({ tags, max = 3, className }: { tags: string[]; max?: number; className?: string }) {
  if (!tags?.length) return null;
  const shown = tags.slice(0, max);
  const more = tags.length - shown.length;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((t) => <span key={t} className="rounded bg-surface-3 px-1.5 py-px text-[10px] text-fg-muted">{t}</span>)}
      {more > 0 && <Tooltip content={tags.slice(max).join(", ")}><span className="rounded bg-surface-3 px-1.5 py-px text-[10px] text-fg-subtle">+{more}</span></Tooltip>}
    </span>
  );
}

/** Row shape returned by GET /api/v1/devices */
export interface DeviceRow {
  id: string; name: string; displayName: string | null; hostname: string | null; platform: string; deviceType: string; osName: string | null; osVersion: string | null; status: string;
  lastSeenAt: string | null; lastBootAt: string | null; publicIp: string | null; localIps: string[]; loggedInUser: string | null; siteId: string | null; groupId: string | null; tags: string[]; healthScore: number | null;
  agentVersion: string | null; pendingReboot: boolean; manufacturer: string | null; model: string | null; serialNumber: string | null; cpuModel: string | null; memoryBytes: number | null; isProbe: boolean; isAgentless: boolean;
  siteName: string | null; groupName: string | null; openAlerts: number; connected: boolean;
}
