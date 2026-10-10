"use client";
import * as React from "react";
import { Camera, ChevronDown, ExternalLink, LogIn, MoreHorizontal, Pencil, Play, Sparkles, Square, UserCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Tooltip } from "@/components/ui/menu";
import { QUICK_ACTIONS } from "@/components/jobs/quick-job-dialog";
import type { DeviceActions, MachineRow } from "./access-model";

/**
 * ScreenConnect-style "Join / Edit / End / More" toolbar. Acts on the highlighted machine; the More menu targets the
 * checked machines when there are any, so bulk commands are one click away without leaving the keyboard flow.
 */
export function MachineToolbar({ selected, checkedIds, hostConnected, can, actions }: { selected: MachineRow | null; checkedIds: string[]; hostConnected: boolean; can: (p: string) => boolean; actions: DeviceActions }) {
  const online = selected?.status === "online";
  const targets = checkedIds.length ? checkedIds : selected ? [selected.id] : [];
  const targetLabel = checkedIds.length > 1 ? `${checkedIds.length} selected machines` : selected?.name ?? "selection";
  const joinHint = !selected ? "Select a machine first" : !online ? `${selected.name} is offline` : !can("remote.terminal") ? "You cannot open terminals" : null;
  const endHint = !selected ? "Select a machine first" : !hostConnected ? "No live session on this machine" : null;

  return (
    <>
      {can("remote.terminal") && (
        <Tooltip content={joinHint}>
          <span className="inline-flex"><Button size="sm" leftIcon={<LogIn className="h-3.5 w-3.5" />} disabled={!selected || !online} onClick={() => selected && actions.join(selected.id)}>Join</Button></span>
        </Tooltip>
      )}
      {can("devices.manage") && (
        <Tooltip content={!selected ? "Select a machine first" : null}>
          <span className="inline-flex"><Button size="sm" variant="secondary" leftIcon={<Pencil className="h-3.5 w-3.5" />} disabled={!selected} onClick={() => selected && actions.edit(selected.id)} className="hidden @sm/list:inline-flex">Edit</Button></span>
        </Tooltip>
      )}
      {can("remote.terminal") && (
        <Tooltip content={endHint}>
          <span className="inline-flex"><Button size="sm" variant="secondary" leftIcon={<Square className="h-3.5 w-3.5" />} disabled={!selected || !hostConnected} onClick={() => selected && actions.end(selected.id)} className="hidden @md/list:inline-flex">End</Button></span>
        </Tooltip>
      )}
      <Menu trigger={<Button size="sm" variant="secondary" aria-label="More actions" leftIcon={<MoreHorizontal className="h-3.5 w-3.5 @sm/list:hidden" />} rightIcon={<ChevronDown className="hidden h-3.5 w-3.5 @sm/list:inline" />} disabled={!selected && !checkedIds.length}><span className="hidden @sm/list:inline">More</span></Button>}>
        <MenuLabel>{targetLabel}</MenuLabel>
        {QUICK_ACTIONS.filter((a) => can(a.permission)).map((a) => <MenuItem key={a.id} icon={a.icon} danger={a.tone === "danger"} disabled={!targets.length} onSelect={() => actions.quick(a.id, targets)}>{a.label}</MenuItem>)}
        {selected && (
          <>
            <MenuSeparator />
            <MenuLabel>{selected.name}</MenuLabel>
            {selected.status === "pending" && can("devices.approve") && <MenuItem icon={<UserCheck />} onSelect={() => actions.approve(selected.id)}>Approve device</MenuItem>}
            {!online && can("devices.power") && <MenuItem icon={<Zap />} onSelect={() => actions.wake(selected.id)}>Wake on LAN</MenuItem>}
            {online && can("remote.desktop") && <MenuItem icon={<Camera />} onSelect={() => actions.screenshot(selected.id)}>Take screenshot</MenuItem>}
            {can("devices.manage") && <MenuItem icon={<Pencil />} onSelect={() => actions.edit(selected.id)}>Edit details…</MenuItem>}
            {can("scripts.run") && <MenuItem icon={<Play />} onSelect={() => { location.href = `/jobs/new?device=${selected.id}`; }}>Run a script…</MenuItem>}
            {can("ai.use") && <MenuItem icon={<Sparkles />} onSelect={() => actions.askAi(selected.id)}>Ask AI about this machine</MenuItem>}
            <MenuItem icon={<ExternalLink />} onSelect={() => actions.open(selected.id)} shortcut="↵">Open device page</MenuItem>
          </>
        )}
      </Menu>
    </>
  );
}
