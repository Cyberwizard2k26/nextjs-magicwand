"use client";
import * as React from "react";
import { Bell, RotateCw, SquareTerminal, TriangleAlert, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/menu";
import { Progress } from "@/components/ui/misc";
import { DeviceTypeIcon, PlatformChip, StatusDotLive } from "@/components/devices/device-bits";
import { formatDateTime, platformLabel } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { shortAgo, uptimeLabel, type LiveSample, type MachineRow as Row } from "./access-model";

/**
 * Compact machine row. Columns appear as the list pane gets wider (container queries), so the same row works in the
 * 390px sheet layout and on a 4K monitor: company at @sm, load bars at @lg, signed-in user at @2xl.
 */
export const MachineRow = React.memo(function MachineRow({ row, selected, checked, onSelect, onToggle, onOpen, live, outdated, hostConnected, now }: { row: Row; selected: boolean; checked: boolean; onSelect: () => void; onToggle: () => void; onOpen: () => void; live?: LiveSample; outdated: boolean; hostConnected: boolean; now: number }) {
  const online = row.status === "online";
  const os = row.osName ? `${row.osName}${row.osVersion && !row.osName.includes(row.osVersion) ? ` ${row.osVersion}` : ""}` : row.hostname && row.hostname !== row.name ? row.hostname : platformLabel[row.platform] ?? row.platform;
  const uptime = online ? uptimeLabel(row.lastBootAt, now) : null;
  return (
    <div
      role="option"
      id={`machine-${row.id}`}
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={cn(
        "group flex h-12 cursor-default select-none items-center gap-2 border-b border-border/60 px-2 text-sm transition-colors last:border-0",
        selected ? "bg-accent-soft/70 shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface-hover/70",
        checked && !selected && "bg-accent-soft/25",
        row.status === "pending" && !selected && "bg-warning-soft/10",
      )}
    >
      <Checkbox checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} aria-label={`Select ${row.name}`} className="shrink-0" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <StatusDotLive status={row.status} />
        <DeviceTypeIcon type={row.deviceType} className="hidden shrink-0 text-fg-subtle @sm/list:block" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-fg">{row.name}</span>
            {row.isProbe && <Badge size="xs" tone="info">probe</Badge>}
          </div>
          <div className="truncate text-[11px] text-fg-subtle">
            {os}
            {row.loggedInUser && <span className="@2xl/list:hidden"> · {row.loggedInUser}</span>}
          </div>
        </div>
      </div>

      <div className="hidden w-[124px] shrink-0 @sm/list:block">
        <div className={cn("truncate text-xs", row.siteName ? "text-fg-muted" : "italic text-fg-subtle")}>{row.siteName ?? "Unassigned"}</div>
        {row.groupName && <div className="truncate text-[11px] text-fg-subtle">{row.groupName}</div>}
      </div>

      <div className="hidden w-[136px] shrink-0 @2xl/list:block">
        <div className="flex items-center gap-1.5 truncate text-xs text-fg-muted"><User className="h-3 w-3 shrink-0 text-fg-subtle" />{row.loggedInUser || <span className="text-fg-subtle">nobody</span>}</div>
        <div className="truncate text-[11px] text-fg-subtle">{uptime ? `up ${uptime}` : online ? "online" : `last seen ${shortAgo(row.lastSeenAt, now)} ago`}</div>
      </div>

      <div className="hidden w-[104px] shrink-0 flex-col justify-center gap-1 @lg/list:flex" aria-label="Load">
        <MiniBar label="CPU" value={online ? live?.cpuPercent : null} />
        <MiniBar label="MEM" value={online ? live?.memPercent : null} />
      </div>

      <div className="w-[86px] shrink-0"><GuestChip row={row} now={now} /></div>

      <div className="flex w-[68px] shrink-0 items-center justify-end gap-1">
        {hostConnected && <Tooltip content="Technician session in progress"><span className="text-success"><SquareTerminal className="h-3.5 w-3.5" /></span></Tooltip>}
        {row.openAlerts > 0 && <Tooltip content={`${row.openAlerts} open alert${row.openAlerts === 1 ? "" : "s"}`}><span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-danger"><Bell className="h-3 w-3" />{row.openAlerts}</span></Tooltip>}
        {row.pendingReboot && <Tooltip content="Pending reboot"><span className="text-warning"><RotateCw className="h-3.5 w-3.5" /></span></Tooltip>}
        {outdated && <Tooltip content={`Agent ${row.agentVersion} is outdated`}><span className="text-warning"><TriangleAlert className="h-3.5 w-3.5" /></span></Tooltip>}
        <PlatformChip platform={row.platform} />
      </div>
    </div>
  );
});

function MiniBar({ label, value }: { label: string; value: number | null | undefined }) {
  const v = value === null || value === undefined ? null : Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-1.5 text-[10px] leading-none text-fg-subtle" title={v === null ? `${label}: no recent sample` : `${label} ${v}%`}>
      <span className="w-6 shrink-0">{label}</span>
      <Progress value={v ?? 0} thin tone={v === null ? "accent" : "auto"} className={cn("flex-1", v === null && "opacity-40")} />
      <span className="w-7 shrink-0 text-right tabular">{v === null ? "—" : `${v}%`}</span>
    </div>
  );
}

function GuestChip({ row, now }: { row: Row; now: number }) {
  if (row.status === "online") return <Badge tone="success" size="xs" dot className="[&>span]:animate-pulse">Guest · live</Badge>;
  if (row.status === "pending") return <Badge tone="warning" size="xs" dot>Pending</Badge>;
  if (row.status === "maintenance") return <Badge tone="info" size="xs" dot>Maint.</Badge>;
  return (
    <Tooltip content={row.lastSeenAt ? `Last seen ${formatDateTime(row.lastSeenAt)}` : "Never connected"}>
      <span className="inline-flex"><Badge tone="neutral" size="xs">Guest · {shortAgo(row.lastSeenAt, now)}</Badge></span>
    </Tooltip>
  );
}
