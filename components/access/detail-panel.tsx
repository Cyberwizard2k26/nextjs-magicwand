"use client";
import * as React from "react";
import useSWR from "swr";
import { Bell, History, Info, MessageSquare, MousePointerClick, Play, Sparkles, SquareTerminal, StickyNote, Wrench, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/misc";
import { DeviceStatusBadge, PlatformChip } from "@/components/devices/device-bits";
import type { DeviceDetail } from "@/components/devices/device-context";
import { useRealtime } from "@/components/shell/realtime-provider";
import { useLocalStorage } from "@/lib/client/hooks";
import { cn } from "@/lib/util/cn";
import { PaneHeader, useThreePane } from "./three-pane";
import type { DeviceActions, LiveSample } from "./access-model";
import { PanelSkeleton, type PanelId, type PanelProps } from "./panels/panel-bits";
import { GeneralPanel } from "./panels/general-panel";
import { TimelinePanel } from "./panels/timeline-panel";
import { NotesPanel } from "./panels/notes-panel";
import { MessagesPanel } from "./panels/messages-panel";
import { CommandsPanel } from "./panels/commands-panel";
import { ToolboxHost } from "./panels/toolbox-host";
import { JobsPanel } from "./panels/jobs-panel";
import { AlertsPanel } from "./panels/alerts-panel";
import { AiPanel } from "./panels/ai-panel";

const PANELS: { id: PanelId; label: string; icon: LucideIcon; permission: string; component: React.ComponentType<PanelProps> }[] = [
  { id: "general", label: "General", icon: Info, permission: "devices.view", component: GeneralPanel },
  { id: "timeline", label: "Timeline", icon: History, permission: "devices.view", component: TimelinePanel },
  { id: "notes", label: "Notes", icon: StickyNote, permission: "devices.view", component: NotesPanel },
  { id: "messages", label: "Messages", icon: MessageSquare, permission: "remote.tools", component: MessagesPanel },
  { id: "commands", label: "Commands", icon: SquareTerminal, permission: "scripts.run", component: CommandsPanel },
  { id: "toolbox", label: "Toolbox", icon: Wrench, permission: "scripts.run", component: ToolboxHost },
  { id: "jobs", label: "Jobs", icon: Play, permission: "jobs.view", component: JobsPanel },
  { id: "alerts", label: "Alerts", icon: Bell, permission: "alerts.view", component: AlertsPanel },
  { id: "ai", label: "Ask AI", icon: Sparkles, permission: "ai.use", component: AiPanel },
];

/** Right pane: vertical icon rail switching between the per-device panels. Loads the full device record itself. */
export function DetailPanel({ deviceId, can, actions, newestAgentVersion, live, now, onClose }: { deviceId: string | null; can: (p: string) => boolean; actions: DeviceActions; newestAgentVersion: string | null; live?: LiveSample; now: number; onClose: () => void }) {
  const { isDesktop } = useThreePane();
  const [panel, setPanel] = useLocalStorage<PanelId>("mw.access.panel", "general");
  const { data, error, isLoading, mutate } = useSWR<DeviceDetail>(deviceId ? `devices/${deviceId}` : null, { refreshInterval: 60_000 });
  useRealtime(["device.online", "device.offline", "device.heartbeat", "device.inventory", "device.updated", "device.approved"], (ev) => { if (deviceId && (ev.deviceId === deviceId || (ev.payload as { deviceId?: string })?.deviceId === deviceId)) mutate(); }, deviceId ? [`device:${deviceId}`] : []);
  const visible = PANELS.filter((p) => can(p.permission));
  const current = visible.find((p) => p.id === panel) ?? visible[0];
  const detail = data && data.device.id === deviceId ? data : undefined;

  if (!deviceId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState icon={<MousePointerClick />} title="Select a machine" description="Click a row to see its details, timeline, notes and tools here. Use ↑ ↓ to move, Enter to open, / to search." className="border-0" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-border bg-surface-2/40 py-2" aria-label="Device sections">
        {visible.map((p) => (
          <Tooltip key={p.id} content={p.label} side="right">
            <button type="button" onClick={() => setPanel(p.id)} aria-label={p.label} aria-pressed={current?.id === p.id} className={cn("flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-ring", current?.id === p.id ? "bg-accent-soft text-accent-hover shadow-[inset_0_0_0_1px_var(--accent-soft)]" : "text-fg-muted hover:bg-surface-hover hover:text-fg")}>
              <p.icon className="h-4 w-4" />
            </button>
          </Tooltip>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {isDesktop && (
          <PaneHeader>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><h2 className="truncate text-sm font-semibold text-fg">{detail?.device.name ?? "Loading…"}</h2>{detail && <DeviceStatusBadge status={detail.device.status} />}{detail && <PlatformChip platform={detail.device.platform} />}</div>
              <div className="truncate text-[11px] text-fg-subtle">{current?.label}{detail?.site ? ` · ${detail.site.name}` : ""}</div>
            </div>
            <Button size="icon-sm" variant="ghost" aria-label="Close details" onClick={onClose}><X className="h-4 w-4" /></Button>
          </PaneHeader>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
          {error ? (
            <EmptyState className="border-danger/30" title="Could not load this device" description={(error as Error).message} action={<Button size="sm" variant="secondary" onClick={() => mutate()}>Retry</Button>} />
          ) : !detail || isLoading && !detail ? (
            <PanelSkeleton rows={8} />
          ) : current ? (
            <current.component key={`${deviceId}:${current.id}`} detail={detail} can={can} actions={actions} newestAgentVersion={newestAgentVersion} live={live} now={now} goTo={setPanel} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
