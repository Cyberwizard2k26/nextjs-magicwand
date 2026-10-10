"use client";
import * as React from "react";
import useSWR from "swr";
import { ExternalLink, LogIn, Pencil, Pin, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/menu";
import { Progress } from "@/components/ui/misc";
import { DeviceStatusBadge, HealthScore, PlatformChip, TagList } from "@/components/devices/device-bits";
import { formatBytes, formatDateTime, platformLabel, relativeTime } from "@/lib/client/format";
import { isOutdated } from "@/lib/client/agent-version";
import { cn } from "@/lib/util/cn";
import type { DeviceNote } from "@/lib/api/contracts/device-notes";
import { uptimeLabel } from "../access-model";
import { KV, Section, type PanelProps } from "./panel-bits";

export function GeneralPanel({ detail, can, actions, newestAgentVersion, live, now, goTo }: PanelProps) {
  const d = detail.device;
  const online = d.status === "online";
  const uptime = uptimeLabel(d.lastBootAt, now);
  const outdated = isOutdated(d.agentVersion, newestAgentVersion);
  const department = typeof d.customFields?.department === "string" ? (d.customFields.department as string) : null;
  const { data: pinned } = useSWR<{ items: DeviceNote[] }>([`devices/${d.id}/notes`, { pinned: true, limit: 3 }]);
  const users = d.loggedInUsers?.length ? d.loggedInUsers : d.loggedInUser ? [{ user: d.loggedInUser, session: "", type: "", since: undefined }] : [];

  return (
    <>
      <div className={cn("mb-4 rounded-lg border px-3 py-2.5", online ? "border-success/30 bg-success-soft/40" : d.status === "pending" ? "border-warning/30 bg-warning-soft/40" : "border-border bg-surface-2/60")}>
        <div className="flex items-center gap-2 text-sm">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", online ? "bg-success pulse-dot" : d.status === "pending" ? "bg-warning" : "bg-fg-subtle")} />
          <span className="font-medium text-fg">{online ? "Agent connected" : d.status === "pending" ? "Awaiting approval" : "Agent offline"}</span>
          <span className="text-fg-muted">{online ? uptime ? `· up ${uptime}` : "" : d.lastSeenAt ? `· last seen ${relativeTime(d.lastSeenAt, now || undefined)}` : "· never connected"}</span>
        </div>
        {online && live && (live.cpuPercent !== null || live.memPercent !== null) && (
          <div className="mt-2 grid grid-cols-2 gap-3 text-[11px] text-fg-muted [&>*]:min-w-0">
            <div><div className="mb-1 flex justify-between"><span>CPU</span><span className="tabular text-fg">{live.cpuPercent ?? "—"}%</span></div><Progress value={live.cpuPercent ?? 0} thin tone="auto" /></div>
            <div><div className="mb-1 flex justify-between"><span>Memory</span><span className="tabular text-fg">{live.memPercent ?? "—"}%</span></div><Progress value={live.memPercent ?? 0} thin tone="auto" /></div>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {can("remote.terminal") && <Tooltip content={!online ? "Device is offline" : null}><span className="inline-flex"><Button size="sm" leftIcon={<LogIn className="h-3.5 w-3.5" />} disabled={!online} onClick={() => actions.join(d.id)}>Join</Button></span></Tooltip>}
        <Button size="sm" variant="secondary" leftIcon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => actions.open(d.id)}>Open device</Button>
        {!online && can("devices.power") && d.status !== "pending" && <Button size="sm" variant="secondary" leftIcon={<Zap className="h-3.5 w-3.5" />} onClick={() => actions.wake(d.id)}>Wake</Button>}
        {d.status === "pending" && can("devices.approve") && <Button size="sm" variant="success" onClick={() => actions.approve(d.id)}>Approve</Button>}
        {can("devices.manage") && <Button size="icon-sm" variant="ghost" aria-label="Edit device" onClick={() => actions.edit(d.id)}><Pencil className="h-4 w-4" /></Button>}
      </div>

      {pinned?.items?.length ? (
        <Section title="Pinned notes" action={<button type="button" className="text-[11px] text-accent-hover hover:underline focus-ring rounded" onClick={() => goTo("notes")}>All notes</button>}>
          <ul className="space-y-1.5">
            {pinned.items.map((n) => <li key={n.id} className="flex items-start gap-2 rounded-md border border-warning/20 bg-warning-soft/30 px-2.5 py-1.5 text-xs text-fg"><Pin className="mt-0.5 h-3 w-3 shrink-0 text-warning" /><span className="min-w-0 whitespace-pre-wrap break-words">{n.body}</span></li>)}
          </ul>
        </Section>
      ) : null}

      <Section title="Machine">
        <dl className="grid grid-cols-1 gap-x-4 @sm/detail:grid-cols-2 [&>*]:min-w-0">
          <KV label="Name">{d.name}{d.hostname && d.hostname !== d.name ? <span className="text-fg-subtle"> · {d.hostname}</span> : null}</KV>
          <KV label="Status"><DeviceStatusBadge status={d.status} /></KV>
          <KV label="Company / site">{detail.site?.name ?? <span className="italic text-fg-subtle">Unassigned</span>}</KV>
          <KV label="Department">{department}</KV>
          <KV label="Group">{detail.group?.name}</KV>
          <KV label="Device type"><span className="capitalize">{d.deviceType}</span></KV>
          <KV label="Operating system"><span className="flex items-center gap-1.5"><PlatformChip platform={d.platform} /><span className="truncate">{d.osName ? `${d.osName} ${d.osVersion ?? ""}`.trim() : platformLabel[d.platform]}</span></span></KV>
          <KV label="Kernel / arch" mono>{[d.kernel, d.arch].filter(Boolean).join(" · ") || null}</KV>
          <KV label="Local IP" mono>{d.localIps?.length ? d.localIps.join(", ") : null}</KV>
          <KV label="Public IP" mono>{d.publicIp}</KV>
          <KV label="Last seen">{d.lastSeenAt ? <Tooltip content={formatDateTime(d.lastSeenAt)}><span>{online ? "now" : relativeTime(d.lastSeenAt, now || undefined)}</span></Tooltip> : "never"}</KV>
          <KV label="Last boot">{d.lastBootAt ? <Tooltip content={formatDateTime(d.lastBootAt)}><span>{relativeTime(d.lastBootAt, now || undefined)}</span></Tooltip> : null}</KV>
          <KV label="Agent"><span className="flex items-center gap-1.5"><span className="mono text-xs">{d.agentVersion ?? "—"}</span>{outdated && <Badge tone="warning" size="xs">outdated · newest {newestAgentVersion}</Badge>}{d.pendingReboot && <Badge tone="warning" size="xs" dot>reboot pending</Badge>}</span></KV>
          <KV label="Health">{d.healthScore !== null ? <HealthScore score={d.healthScore} /> : null}</KV>
          <KV label="Hardware">{[d.cpuModel?.replace(/\(R\)|\(TM\)|CPU|Processor/g, "").trim(), d.cpuCores ? `${d.cpuCores} cores` : null, d.memoryBytes ? formatBytes(d.memoryBytes, 0) : null].filter(Boolean).join(" · ") || null}</KV>
          <KV label="Serial / model">{[d.serialNumber, d.manufacturer, d.model].filter(Boolean).join(" · ") || null}</KV>
          <KV label="Timezone / domain">{[d.timezone, d.domain].filter(Boolean).join(" · ") || null}</KV>
          <KV label="Enrolled">{d.enrolledAt ? formatDateTime(d.enrolledAt, { dateStyle: "medium", timeStyle: undefined }) : null}</KV>
        </dl>
      </Section>

      <Section title="Signed-in users">
        {users.length ? (
          <ul className="divide-y divide-border/60 rounded-lg border border-border">
            {users.map((u, i) => <li key={`${u.user}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"><span className="truncate font-medium text-fg">{u.user}</span><span className="shrink-0 text-fg-subtle">{[u.type, u.since ? `since ${relativeTime(u.since, now || undefined)}` : null].filter(Boolean).join(" · ")}</span></li>)}
          </ul>
        ) : <p className="text-xs text-fg-subtle">Nobody is signed in.</p>}
      </Section>

      <Section title="Tags">
        {d.tags?.length ? <TagList tags={d.tags} max={12} /> : <p className="text-xs text-fg-subtle">No tags. {can("devices.manage") && <button type="button" className="text-accent-hover hover:underline" onClick={() => actions.edit(d.id)}>Add some</button>}</p>}
      </Section>

      {d.description && <Section title="Description"><p className="text-xs text-fg-muted">{d.description}</p></Section>}
    </>
  );
}
