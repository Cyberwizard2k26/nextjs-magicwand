"use client";
import * as React from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCode2, LayoutPanelLeft, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useRealtime } from "@/components/shell/realtime-provider";
import { DeviceBulkBar, DeviceList } from "@/components/devices/device-list";
import { QuickJobDialog, type QuickAction } from "@/components/jobs/quick-job-dialog";
import { ScreenshotDialog } from "@/components/remote/screenshot-dialog";
import { api, ApiClientError, type Paginated } from "@/lib/client/api";
import { useDebounce, useLocalStorage, useUrlState } from "@/lib/client/hooks";
import { isOutdated } from "@/lib/client/agent-version";
import { cn } from "@/lib/util/cn";
import { ThreePane } from "./three-pane";
import { AccessTree } from "./access-tree";
import { MachineList } from "./machine-list";
import { MachineToolbar } from "./machine-toolbar";
import { DetailPanel } from "./detail-panel";
import { EditDeviceSheet } from "./edit-device-sheet";
import { useNow } from "./use-media";
import { groupQuery, makeCan, type DeviceActions, type GroupKey, type LiveSample, type MachineRow, type TreeData } from "./access-model";

type Layout = "access" | "table";
const DEFAULTS = { g: "all", q: "", status: "", siteId: "", d: "" };
const LIVE_SESSION = new Set(["requested", "pending_consent", "active"]);

/** The /devices page: ScreenConnect-style three-pane Access console with a persisted "Table" layout fallback. */
export function AccessConsole({ permissions }: { permissions: string[] }) {
  const [layout, setLayout] = useLocalStorage<Layout>("mw.devices.layout", "access");
  const toggle = <LayoutToggle value={layout} onChange={setLayout} />;
  if (layout === "table") return <DeviceList permissions={permissions} headerExtra={toggle} />;
  return <Console permissions={permissions} layoutToggle={toggle} />;
}

function Console({ permissions, layoutToggle }: { permissions: string[]; layoutToggle: React.ReactNode }) {
  const router = useRouter();
  const can = React.useMemo(() => makeCan(permissions), [permissions]);
  const [f, setF] = useUrlState(DEFAULTS);
  const groupKey: GroupKey = f.g && f.g !== "all" ? f.g : f.siteId ? `site:${f.siteId}` : "all";
  const [selectedId, setSelectedId] = React.useState<string | null>(f.d || null);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = useLocalStorage<number>("mw.access.pageSize", 100);
  const [sort, setSort] = useLocalStorage<{ field: string; dir: "asc" | "desc" } | null>("mw.access.sort", null);
  const [liveOverrides, setLiveOverrides] = React.useState<Record<string, LiveSample>>({});
  const [quick, setQuick] = React.useState<{ action: QuickAction; ids: string[] } | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [ending, setEnding] = React.useState<{ id: string; name: string; sessionIds: string[] } | null>(null);
  const [shot, setShot] = React.useState<{ id: string; name: string } | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const now = useNow(30_000);
  const dq = useDebounce(f.q, 250);

  const { data: tree, isLoading: treeLoading, mutate: mutateTree } = useSWR<TreeData>("devices/tree", { refreshInterval: 60_000 });
  const gq = groupQuery(groupKey);
  const path = gq.source === "tree" ? "devices/tree" : "devices";
  const params = { ...gq.params, status: f.status || gq.params.status, q: dq || undefined, page, pageSize, sort: sort?.field, dir: sort?.dir };
  const { data: list, error: listError, isLoading: listLoading, mutate: mutateList } = useSWR<Paginated<MachineRow>>([path, params], { keepPreviousData: true });
  const rows = list?.items ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const live = React.useMemo(() => ({ ...(tree?.live ?? {}), ...liveOverrides }), [tree?.live, liveOverrides]);
  const hostConnected = React.useMemo(() => new Set(tree?.hostConnected.deviceIds ?? []), [tree?.hostConnected.deviceIds]);
  const newest = tree?.outdated.newestAgentVersion ?? null;

  // Live updates: coalesce bursts of device/session events into one refresh; apply telemetry samples directly to the bars.
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = () => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => { refreshTimer.current = null; mutateList(); mutateTree(); }, 600);
  };
  React.useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  useRealtime(["device.online", "device.offline", "device.enrolled", "device.approved", "device.updated", "device.deleted", "device.heartbeat", "session.started", "session.ended", "alert.opened", "alert.resolved", "job.created"], scheduleRefresh);
  useRealtime(["device.telemetry"], (ev) => {
    const p = ev.payload as { deviceId?: string; cpuPercent?: number | null; memUsedBytes?: number | null; memTotalBytes?: number | null; ts?: string };
    const id = p.deviceId ?? ev.deviceId;
    if (!id) return;
    setLiveOverrides((prev) => ({ ...prev, [id]: { cpuPercent: p.cpuPercent === null || p.cpuPercent === undefined ? null : Math.round(p.cpuPercent), memPercent: p.memUsedBytes && p.memTotalBytes ? Math.round((p.memUsedBytes / p.memTotalBytes) * 100) : null, ts: p.ts ?? ev.ts } }));
  });

  // "/" focuses the search box (captured before the app shell opens the command palette).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const selectGroup = (key: GroupKey) => { setF({ g: key === "all" ? "" : key, siteId: "" }); setPage(1); };
  const select = (id: string | null) => { setSelectedId(id); };
  const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? "machine";
  const refreshAll = () => { mutateList(); mutateTree(); };

  const actions: DeviceActions = {
    join: (id) => router.push(`/devices/${id}/terminal`),
    open: (id) => router.push(`/devices/${id}`),
    edit: (id) => setEditId(id),
    end: async (id) => {
      try {
        const r = await api.get<{ items: { id: string; status: string; live: boolean }[] }>(`devices/${id}/sessions`);
        const ids = r.items.filter((s) => s.live || LIVE_SESSION.has(s.status)).map((s) => s.id);
        if (!ids.length) { toast.info(`No live session on ${nameOf(id)}`); refreshAll(); return; }
        setEnding({ id, name: nameOf(id), sessionIds: ids });
      } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not load sessions"); }
    },
    quick: (action, ids) => setQuick({ action, ids }),
    approve: async (id) => {
      try { await api.post(`devices/${id}/approve`); toast.success(`${nameOf(id)} approved`); refreshAll(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Approval failed"); }
    },
    wake: async (id) => {
      try { const r = await api.post<{ via: { name: string }; job: { id: string } }>(`devices/${id}/actions`, { action: "wake_on_lan" }); toast.success(`Wake packet sent via ${r.via.name}`, { action: { label: "Job", onClick: () => router.push(`/jobs/${r.job.id}`) } }); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Wake failed"); }
    },
    screenshot: (id) => setShot({ id, name: nameOf(id) }),
    askAi: (id) => router.push(`/copilot?device=${encodeURIComponent(id)}`),
  };

  async function endSessions() {
    if (!ending) return;
    let ok = 0;
    for (const sid of ending.sessionIds) {
      try { await api.delete(`sessions/${sid}`); ok++; } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not end a session"); }
    }
    if (ok) toast.success(`Ended ${ok} session${ok === 1 ? "" : "s"} on ${ending.name}`);
    refreshAll();
  }

  const checkedIds = [...checked];
  const checkedRows = rows.filter((r) => checked.has(r.id));
  const quickLabel = quick ? (quick.ids.length === 1 ? nameOf(quick.ids[0]) : `${quick.ids.length} machines`) : "";

  return (
    <>
      <ThreePane
        storageKey="mw.access"
        header={
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-fg">Devices</h1>
              <p className="truncate text-xs text-fg-muted">{tree ? <>Access console · {tree.totals.all.toLocaleString()} machine{tree.totals.all === 1 ? "" : "s"} · <span className="text-success">{tree.totals.online} online</span>{tree.attention.total > 0 && <> · <span className="text-danger">{tree.attention.total} need attention</span></>}</> : "Access console"}</p>
            </div>
            <div className="flex items-center gap-2">
              {layoutToggle}
              {can("scripts.run") && <Button variant="secondary" size="sm" leftIcon={<FileCode2 className="h-4 w-4" />} onClick={() => router.push(checkedIds.length ? `/jobs/new?devices=${checkedIds.join(",")}` : "/jobs/new")} className="hidden sm:inline-flex">Run script</Button>}
            </div>
          </div>
        }
        treeTitle="Session groups"
        tree={<AccessTree tree={tree} loading={treeLoading} selected={groupKey} onSelect={selectGroup} can={can} />}
        list={
          <MachineList
            groupKey={groupKey}
            tree={tree}
            rows={rows}
            total={list?.total ?? 0}
            page={list?.page ?? page}
            pages={list?.pages ?? 1}
            pageSize={pageSize}
            loading={listLoading}
            error={listError ? (listError as Error).message : null}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
            onRefresh={refreshAll}
            q={f.q}
            onQ={(q) => { setF({ q }); setPage(1); }}
            status={f.status}
            onStatus={(s) => { setF({ status: s }); setPage(1); }}
            sort={sort}
            onSort={(s) => { setSort(s); setPage(1); }}
            selectedId={selectedId}
            onSelect={select}
            checked={checked}
            onChecked={setChecked}
            onOpen={actions.open}
            live={live}
            newestAgentVersion={newest}
            hostConnected={hostConnected}
            now={now}
            isOutdated={isOutdated}
            searchRef={searchRef}
            can={can}
            toolbar={<MachineToolbar selected={selected} checkedIds={checkedIds} hostConnected={!!selected && (hostConnected.has(selected.id) || (selected.liveSessions ?? 0) > 0)} can={can} actions={actions} />}
            bulkBar={checkedIds.length > 0 ? <DeviceBulkBar className="mx-2 mb-0 mt-2" selectedIds={checkedIds} selectedRows={checkedRows} can={can} onClear={() => setChecked(new Set())} onQuick={(a) => setQuick({ action: a, ids: checkedIds })} onChanged={() => { setChecked(new Set()); refreshAll(); }} /> : null}
          />
        }
        detailTitle={selected?.name ?? "Machine"}
        detailOpen={!!selectedId}
        onDetailClose={() => select(null)}
        detail={<DetailPanel deviceId={selectedId} can={can} actions={actions} newestAgentVersion={newest} live={selectedId ? live[selectedId] : undefined} now={now} onClose={() => select(null)} />}
      />

      {quick && <QuickJobDialog open onOpenChange={(o) => !o && setQuick(null)} action={quick.action} target={{ type: "device", ids: quick.ids, label: quickLabel }} onCreated={() => { setChecked(new Set()); refreshAll(); }} />}
      {editId && <EditDeviceSheet deviceId={editId} open onOpenChange={(o) => !o && setEditId(null)} onSaved={refreshAll} />}
      {ending && <ConfirmDialog open onOpenChange={(o) => !o && setEnding(null)} title={`End ${ending.sessionIds.length === 1 ? "the live session" : `${ending.sessionIds.length} live sessions`} on ${ending.name}?`} description="The technician's terminal closes immediately; the session stays in the history with who, when and how long." confirmLabel="End session" onConfirm={endSessions} />}
      {shot && <ScreenshotDialog deviceId={shot.id} deviceName={shot.name} open onOpenChange={(o) => !o && setShot(null)} />}
    </>
  );
}

export function LayoutToggle({ value, onChange }: { value: Layout; onChange: (v: Layout) => void }) {
  const opts: { v: Layout; label: string; icon: React.ReactNode }[] = [
    { v: "access", label: "Access", icon: <LayoutPanelLeft className="h-3.5 w-3.5" /> },
    { v: "table", label: "Table", icon: <Table2 className="h-3.5 w-3.5" /> },
  ];
  return (
    <div role="radiogroup" aria-label="Layout" className="inline-flex h-8 items-center rounded-lg border border-border bg-surface-2 p-0.5">
      {opts.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-ring", value === o.v ? "bg-surface text-fg shadow" : "text-fg-muted hover:text-fg")}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}
