"use client";
import * as React from "react";
import { ArrowUpDown, Check, ChevronLeft, ChevronRight, Download, RefreshCw, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/input";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { EmptyState, Kbd, Pill, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/util/cn";
import { PaneHeader, TreeToggle } from "./three-pane";
import { MachineRow } from "./machine-row";
import { groupCounts, groupLabel, isVirtualGroup, SORT_OPTIONS, STATUS_PILLS, type GroupKey, type LiveSample, type MachineRow as Row, type TreeData } from "./access-model";

export interface MachineListProps {
  groupKey: GroupKey;
  tree: TreeData | undefined;
  rows: Row[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  loading: boolean;
  error?: string | null;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  onRefresh: () => void;
  q: string;
  onQ: (q: string) => void;
  status: string;
  onStatus: (s: string) => void;
  sort: { field: string; dir: "asc" | "desc" } | null;
  onSort: (s: { field: string; dir: "asc" | "desc" } | null) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  checked: Set<string>;
  onChecked: (next: Set<string>) => void;
  onOpen: (id: string) => void;
  live: Record<string, LiveSample>;
  newestAgentVersion: string | null;
  hostConnected: Set<string>;
  now: number;
  isOutdated: (version: string | null, newest: string | null) => boolean;
  toolbar: React.ReactNode;
  bulkBar: React.ReactNode;
  searchRef: React.RefObject<HTMLInputElement | null>;
  can: (p: string) => boolean;
}

/** Middle pane: group header + toolbar, filter row, select-all header, keyboard-navigable rows and pagination. */
export function MachineList(p: MachineListProps) {
  const router = useRouter();
  const listRef = React.useRef<HTMLDivElement>(null);
  const counts = groupCounts(p.groupKey, p.tree);
  const label = groupLabel(p.groupKey, p.tree);
  const allChecked = p.rows.length > 0 && p.rows.every((r) => p.checked.has(r.id));
  const someChecked = !allChecked && p.rows.some((r) => p.checked.has(r.id));

  React.useEffect(() => {
    if (!p.selectedId) return;
    document.getElementById(`machine-${p.selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [p.selectedId]);

  function toggleAll() {
    const next = new Set(p.checked);
    if (allChecked) p.rows.forEach((r) => next.delete(r.id));
    else p.rows.forEach((r) => next.add(r.id));
    p.onChecked(next);
  }
  function toggleOne(id: string) {
    const next = new Set(p.checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    p.onChecked(next);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (!p.rows.length) return;
    const idx = p.rows.findIndex((r) => r.id === p.selectedId);
    const go = (i: number) => { const r = p.rows[Math.max(0, Math.min(p.rows.length - 1, i))]; if (r) p.onSelect(r.id); };
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); go(idx + 1); break;
      case "ArrowUp": e.preventDefault(); go(idx - 1); break;
      case "Home": e.preventDefault(); go(0); break;
      case "End": e.preventDefault(); go(p.rows.length - 1); break;
      case "PageDown": e.preventDefault(); go(idx + 10); break;
      case "PageUp": e.preventDefault(); go(idx - 10); break;
      case "Enter": if (p.selectedId) { e.preventDefault(); p.onOpen(p.selectedId); } break;
      case " ": if (p.selectedId) { e.preventDefault(); toggleOne(p.selectedId); } break;
      case "Escape": p.onSelect(null); break;
      case "a": if (e.ctrlKey || e.metaKey) { e.preventDefault(); toggleAll(); } break;
    }
  }

  const colHead = "text-[10px] font-semibold uppercase tracking-wider text-fg-subtle";
  const hasFilters = !!(p.q || p.status);

  return (
    <>
      <PaneHeader className="flex-wrap gap-y-2">
        <TreeToggle label="Session groups" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-fg">{label}</h2>
          <div className="truncate text-[11px] text-fg-subtle">
            {counts ? <>{counts.total.toLocaleString()} machine{counts.total === 1 ? "" : "s"}{counts.online > 0 && counts.total !== counts.online ? <> · <span className="text-success">{counts.online} online</span></> : counts.online > 0 && counts.online === counts.total && counts.total > 0 ? " · all online" : ""}</> : p.loading ? "Loading…" : `${p.total.toLocaleString()} machines`}
            {p.q && <> · matching “{p.q}”</>}
          </div>
        </div>
        <div className="flex items-center gap-1">{p.toolbar}</div>
      </PaneHeader>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative min-w-[160px] flex-1 @md/list:max-w-xs">
          <Input ref={p.searchRef} value={p.q} onChange={(e) => p.onQ(e.target.value)} placeholder="Search name, user, IP, serial, tag…" leftIcon={<Search />} aria-label="Search machines" className="h-8 text-[13px]" onKeyDown={(e) => { if (e.key === "Escape") { p.onQ(""); (e.target as HTMLInputElement).blur(); } if (e.key === "ArrowDown") { e.preventDefault(); listRef.current?.focus(); } }} />
          {p.q ? <button type="button" onClick={() => p.onQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg focus-ring" aria-label="Clear search"><X className="h-3.5 w-3.5" /></button> : <Kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 @sm/list:inline-flex">/</Kbd>}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Status filter">
          {STATUS_PILLS.filter((s) => !(isVirtualGroup(p.groupKey) && p.groupKey === "host_connected" && s.v && s.v !== "online")).map((s) => <Pill key={s.v} active={p.status === s.v} onClick={() => p.onStatus(s.v)} className="h-7 px-2.5">{s.label}</Pill>)}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Menu trigger={<Button size="xs" variant="ghost" leftIcon={<ArrowUpDown className="h-3.5 w-3.5" />} aria-label="Sort">{SORT_OPTIONS.find((o) => o.field === p.sort?.field)?.label ?? "Name"}{p.sort?.dir === "desc" ? " ↓" : ""}</Button>}>
            <MenuLabel>Sort by</MenuLabel>
            {SORT_OPTIONS.map((o) => <MenuItem key={o.field} icon={p.sort?.field === o.field || (!p.sort && o.field === "name") ? <Check /> : <span className="h-4 w-4" />} onSelect={() => p.onSort(p.sort?.field === o.field ? { field: o.field, dir: p.sort.dir === "asc" ? "desc" : "asc" } : { field: o.field, dir: o.field === "lastSeenAt" || o.field === "healthScore" ? "desc" : "asc" })}>{o.label}</MenuItem>)}
          </Menu>
          <Button size="icon-sm" variant="ghost" aria-label="Refresh" onClick={p.onRefresh}><RefreshCw className={cn("h-3.5 w-3.5", p.loading && "animate-spin")} /></Button>
        </div>
      </div>

      {p.bulkBar}

      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface-2/40 px-2" aria-hidden>
        <Checkbox checked={allChecked} ref={(el) => { if (el) el.indeterminate = someChecked; }} onChange={toggleAll} aria-label="Select all on this page" className="shrink-0" />
        <div className={cn("flex-1", colHead)}>Machine</div>
        <div className={cn("hidden w-[124px] shrink-0 @sm/list:block", colHead)}>Company</div>
        <div className={cn("hidden w-[136px] shrink-0 @2xl/list:block", colHead)}>User</div>
        <div className={cn("hidden w-[104px] shrink-0 @lg/list:block", colHead)}>Load</div>
        <div className={cn("w-[86px] shrink-0", colHead)}>Guest</div>
        <div className={cn("w-[68px] shrink-0 text-right", colHead)}>OS</div>
      </div>

      <div ref={listRef} role="listbox" tabIndex={0} aria-label={`${label} machines`} aria-activedescendant={p.selectedId ? `machine-${p.selectedId}` : undefined} aria-multiselectable onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]">
        {p.loading && p.rows.length === 0 ? (
          <div className="divide-y divide-border/60">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="flex h-12 items-center gap-3 px-3"><Skeleton className="h-3.5 w-3.5 rounded" /><Skeleton className="h-2 w-2 rounded-full" /><Skeleton className="h-3.5 w-[38%]" /><Skeleton className="ml-auto h-4 w-16 rounded-md" /></div>)}</div>
        ) : p.error ? (
          <EmptyState className="m-3 border-danger/30" title="Could not load machines" description={p.error} action={<Button variant="secondary" size="sm" onClick={p.onRefresh}>Retry</Button>} />
        ) : p.rows.length === 0 ? (
          hasFilters || p.groupKey !== "all" ? (
            <EmptyState className="m-3" icon={<Search />} title="No machines match" description={p.q ? `Nothing in ${label} matches “${p.q}”.` : `${label} is empty right now.`} action={hasFilters ? <Button variant="secondary" size="sm" onClick={() => { p.onQ(""); p.onStatus(""); }}>Clear filters</Button> : undefined} />
          ) : (
            <EmptyState className="m-3" icon={<Download />} title="No devices yet" description="Deploy the agent on your first machine and it will show up here within seconds." action={p.can("devices.enroll") ? <Button size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={() => router.push("/deploy")}>Deploy agent</Button> : undefined} />
          )
        ) : (
          p.rows.map((r) => (
            <MachineRow
              key={r.id}
              row={r}
              selected={r.id === p.selectedId}
              checked={p.checked.has(r.id)}
              onSelect={() => p.onSelect(r.id)}
              onToggle={() => toggleOne(r.id)}
              onOpen={() => p.onOpen(r.id)}
              live={p.live[r.id]}
              outdated={r.agentOutdated ?? p.isOutdated(r.agentVersion, p.newestAgentVersion)}
              hostConnected={p.hostConnected.has(r.id) || (r.liveSessions ?? 0) > 0}
              now={p.now}
            />
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-surface-2/50 px-3 py-1.5 text-[11px] text-fg-muted">
        <div className="tabular">{p.total === 0 ? "0 machines" : `${(p.page - 1) * p.pageSize + 1}–${Math.min(p.total, p.page * p.pageSize)} of ${p.total.toLocaleString()}`}{p.checked.size > 0 && <span className="ml-2 text-accent-hover">{p.checked.size} selected</span>}</div>
        <div className="flex items-center gap-1">
          <select className="mr-1 h-6 rounded-md border border-border bg-surface-2 px-1 text-[11px]" value={p.pageSize} onChange={(e) => p.onPageSizeChange(Number(e.target.value))} aria-label="Rows per page">{[50, 100, 250, 500].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
          <button type="button" className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-40 focus-ring" disabled={p.page <= 1} onClick={() => p.onPageChange(p.page - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <span className="tabular px-1">{p.page} / {Math.max(1, p.pages)}</span>
          <button type="button" className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-40 focus-ring" disabled={p.page >= p.pages} onClick={() => p.onPageChange(p.page + 1)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </>
  );
}
