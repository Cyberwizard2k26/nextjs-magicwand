"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, Boxes, Building2, Clock, Download, Folder, Layers, Monitor, SquareTerminal, Tag, TriangleAlert, UserCheck, Wifi, WifiOff, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/lib/client/hooks";
import { platformLabel } from "@/lib/client/format";
import { PaneHeader } from "./three-pane";
import { TreeGroupLabel, TreeRow, TreeSection, TreeSkeleton } from "./tree";
import { TYPE_LABELS, type GroupKey, type TreeData } from "./access-model";

const DEFAULT_EXPANDED: Record<string, boolean> = { company: true, os: false, type: false, groups: true, tags: false };

/** Left pane of the Access console: ScreenConnect-style session groups with live counts and attention dots. */
export function AccessTree({ tree, loading, selected, onSelect, can }: { tree: TreeData | undefined; loading: boolean; selected: GroupKey; onSelect: (key: GroupKey) => void; can: (p: string) => boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useLocalStorage<Record<string, boolean>>("mw.access.tree.expanded", DEFAULT_EXPANDED);
  const [allTags, setAllTags] = React.useState(false);
  const toggle = (k: string) => setExpanded((e) => ({ ...e, [k]: !(e[k] ?? DEFAULT_EXPANDED[k]) }));
  const isOpen = (k: string) => expanded[k] ?? DEFAULT_EXPANDED[k] ?? false;
  const t = tree;
  const activeIn = (prefix: string) => selected.startsWith(prefix);

  return (
    <>
      <PaneHeader className="justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Access</span>
        {t && <span className="tabular text-[11px] text-fg-subtle"><span className="text-success">{t.totals.online}</span> / {t.totals.all} online</span>}
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
        {can("devices.enroll") && (
          <Button className="mb-3 w-full" leftIcon={<Download className="h-4 w-4" />} onClick={() => router.push("/deploy")}>Deploy agent</Button>
        )}
        {loading && !t ? (
          <TreeSkeleton rows={12} />
        ) : !t ? (
          <div className="px-3 py-6 text-center text-xs text-fg-muted">The device tree could not be loaded.</div>
        ) : (
          <nav aria-label="Session groups" className="space-y-px">
            <TreeRow icon={<Boxes />} label="All Machines" total={t.totals.all} online={t.totals.online} active={selected === "all"} onClick={() => onSelect("all")} />

            <TreeSection label="All Machines by Company" icon={<Building2 />} total={t.totals.all} online={t.totals.online} expanded={isOpen("company")} onToggle={() => toggle("company")} active={false} onSelect={() => toggle("company")} emptyHint="No sites yet - create one under Settings to group machines by customer.">
              {t.sites.map((s) => <TreeRow key={s.id} depth={1} icon={<Building2 />} label={s.name} total={s.total} online={s.online} dot={s.openAlerts > 0 ? "danger" : null} hint={s.openAlerts ? `${s.openAlerts} open alert${s.openAlerts === 1 ? "" : "s"}` : undefined} active={selected === `site:${s.id}`} onClick={() => onSelect(`site:${s.id}`)} />)}
              {t.unassigned.total > 0 && <TreeRow depth={1} icon={<Building2 />} label={<span className="italic">Unassigned</span>} total={t.unassigned.total} online={t.unassigned.online} active={selected === "unassigned"} onClick={() => onSelect("unassigned")} />}
            </TreeSection>

            <TreeSection label="All Machines by OS" icon={<Monitor />} expanded={isOpen("os")} onToggle={() => toggle("os")} active={false} onSelect={() => toggle("os")}>
              {t.platforms.map((p) => <TreeRow key={p.platform} depth={1} icon={<Monitor />} label={platformLabel[p.platform] ?? p.platform} total={p.total} online={p.online} active={selected === `platform:${p.platform}`} onClick={() => onSelect(`platform:${p.platform}`)} />)}
            </TreeSection>

            <TreeSection label="All Machines by Type" icon={<Layers />} expanded={isOpen("type")} onToggle={() => toggle("type")} active={false} onSelect={() => toggle("type")}>
              {t.deviceTypes.map((d) => <TreeRow key={d.type} depth={1} icon={<Layers />} label={TYPE_LABELS[d.type] ?? d.type} total={d.total} online={d.online} active={selected === `type:${d.type}`} onClick={() => onSelect(`type:${d.type}`)} />)}
            </TreeSection>

            <TreeGroupLabel>Sessions</TreeGroupLabel>
            <TreeRow icon={<TriangleAlert />} label="Outdated Clients" total={t.outdated.total} dot={t.outdated.total > 0 ? "warning" : null} hint={t.outdated.newestAgentVersion ? `Agents older than ${t.outdated.newestAgentVersion}` : undefined} active={selected === "outdated"} onClick={() => onSelect("outdated")} />
            <TreeRow icon={<SquareTerminal />} label="Host Connected" total={t.hostConnected.total} dot={t.hostConnected.total > 0 ? "success" : null} hint="Machines with a live technician session" active={selected === "host_connected"} onClick={() => onSelect("host_connected")} />
            <TreeRow icon={<Wifi />} label="Guest Connected" total={t.totals.online} online={t.totals.online} hint="Agent online right now" active={selected === "online"} onClick={() => onSelect("online")} />
            <TreeRow icon={<Clock />} label="Recently Accessed" total={t.recent.total} hint="Session or job in the last 24 hours" active={selected === "recent"} onClick={() => onSelect("recent")} />
            <TreeRow icon={<Bell />} label="Needs Attention" total={t.attention.total} dot={t.attention.total > 0 ? "danger" : null} hint={`${t.attention.openAlerts} open alerts · ${t.attention.pendingReboot} pending reboot`} active={selected === "attention"} onClick={() => onSelect("attention")} />
            <TreeRow icon={<WifiOff />} label="Offline" total={t.totals.offline} active={selected === "offline"} onClick={() => onSelect("offline")} />
            <TreeRow icon={<UserCheck />} label="Pending approval" total={t.totals.pending} dot={t.totals.pending > 0 ? "warning" : null} active={selected === "pending"} onClick={() => onSelect("pending")} />
            {t.totals.maintenance > 0 && <TreeRow icon={<Wrench />} label="In maintenance" total={t.totals.maintenance} dot="info" active={selected === "maintenance"} onClick={() => onSelect("maintenance")} />}

            <TreeGroupLabel>Groups</TreeGroupLabel>
            <TreeSection label="Device groups" icon={<Folder />} expanded={isOpen("groups")} onToggle={() => toggle("groups")} active={activeIn("group:") && !isOpen("groups")} onSelect={() => toggle("groups")} emptyHint="No groups yet.">
              {t.groups.map((g) => <TreeRow key={g.id} depth={1} icon={<span className="h-2.5 w-2.5 rounded-sm" style={{ background: g.color ?? "var(--fg-subtle)" }} />} label={g.name} total={g.total} online={g.online} hint={g.isDynamic ? "Dynamic group - membership resolves when a job targets it" : undefined} active={selected === `group:${g.id}`} onClick={() => onSelect(`group:${g.id}`)} />)}
            </TreeSection>
            <TreeSection label="Tags" icon={<Tag />} expanded={isOpen("tags")} onToggle={() => toggle("tags")} active={activeIn("tag:") && !isOpen("tags")} onSelect={() => toggle("tags")} emptyHint="Tag devices from the Edit sheet to see them here.">
              {(allTags ? t.tags : t.tags.slice(0, 12)).map((x) => <TreeRow key={x.tag} depth={1} icon={<Tag />} label={x.tag} total={x.total} online={x.online} active={selected === `tag:${x.tag}`} onClick={() => onSelect(`tag:${x.tag}`)} />)}
              {t.tags.length > 12 && <button type="button" className="ml-9 mt-1 text-[11px] text-accent-hover hover:underline focus-ring rounded" onClick={() => setAllTags((v) => !v)}>{allTags ? "Show fewer" : `Show all ${t.tags.length} tags`}</button>}
            </TreeSection>
          </nav>
        )}
      </div>
    </>
  );
}
