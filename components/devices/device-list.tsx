"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Bell, ChevronDown, Download, FileCode2, RotateCw, Search, UserCheck, X, Columns3 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Pill } from "@/components/ui/misc";
import { Menu, MenuItem, MenuLabel, MenuSeparator, MenuCheckItem, Tooltip } from "@/components/ui/menu";
import { usePaginated, useUrlState, useLocalStorage } from "@/lib/client/hooks";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatBytes, platformLabel } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { DeviceTypeIcon, HealthScore, LastSeen, PlatformChip, StatusDotLive, TagList, type DeviceRow } from "./device-bits";
import { QuickJobDialog, QUICK_ACTIONS, type QuickAction } from "@/components/jobs/quick-job-dialog";

const STATUS_PILLS = [
  { v: "", label: "All" },
  { v: "online", label: "Online" },
  { v: "offline", label: "Offline" },
  { v: "pending", label: "Awaiting approval" },
  { v: "maintenance", label: "Maintenance" },
];

type Filters = { status: string; platform: string; siteId: string; groupId: string; tag: string; q: string; sort: string; dir: string; health: string };
const DEFAULTS: Filters = { status: "", platform: "", siteId: "", groupId: "", tag: "", q: "", sort: "", dir: "", health: "" };

const OPTIONAL_COLUMNS: { id: string; label: string; default: boolean }[] = [
  { id: "user", label: "User", default: true },
  { id: "os", label: "OS", default: true },
  { id: "ip", label: "IP address", default: true },
  { id: "site", label: "Site / group", default: true },
  { id: "health", label: "Health", default: true },
  { id: "alerts", label: "Alerts", default: true },
  { id: "lastSeen", label: "Last seen", default: true },
  { id: "hardware", label: "Hardware", default: false },
  { id: "agent", label: "Agent", default: false },
  { id: "tags", label: "Tags", default: false },
];

export function DeviceList({ permissions, headerExtra }: { permissions: string[]; headerExtra?: React.ReactNode }) {
  const router = useRouter();
  const [f, setF] = useUrlState(DEFAULTS);
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const params = React.useMemo(() => ({ status: f.status || undefined, platform: f.platform || undefined, siteId: f.siteId || undefined, groupId: f.groupId || undefined, tag: f.tag || undefined, healthBelow: f.health ? Number(f.health) : undefined }), [f.status, f.platform, f.siteId, f.groupId, f.tag, f.health]);
  const list = usePaginated<DeviceRow>("devices", params, { pageSize: 50 });
  const { data: sites } = useSWR<{ items: { id: string; name: string; deviceCount: number }[] }>("sites");
  const { data: groups } = useSWR<{ items: { id: string; name: string; deviceCount: number }[] }>("groups");
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [quick, setQuick] = React.useState<QuickAction | null>(null);
  const [cols, setCols] = useLocalStorage<string[]>("mw.devices.columns", OPTIONAL_COLUMNS.filter((c) => c.default).map((c) => c.id));

  // Keep the search box in sync with the URL (shareable links) without re-fetching on each keystroke.
  React.useEffect(() => { list.setQ(f.q); }, [f.q]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { list.setSort(f.sort ? { field: f.sort, dir: (f.dir as "asc" | "desc") || "asc" } : null); }, [f.sort, f.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtime(["device.online", "device.offline", "device.enrolled", "device.approved", "device.heartbeat"], () => list.mutate());

  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const selectedRows = list.items.filter((d) => selection[d.id]);
  const show = (id: string) => cols.includes(id);

  const columns = ((): ColumnDef<DeviceRow, unknown>[] => {
    const c: ColumnDef<DeviceRow, unknown>[] = [
      {
        id: "name",
        accessorKey: "name",
        header: "Device",
        size: 280,
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <StatusDotLive status={d.status} />
              <DeviceTypeIcon type={d.deviceType} className="shrink-0 text-fg-subtle" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Link href={`/devices/${d.id}`} className="truncate font-medium text-fg hover:text-accent-hover focus-ring rounded" onClick={(e) => e.stopPropagation()}>{d.name}</Link>
                  {d.pendingReboot && <Tooltip content="Pending reboot"><RotateCw className="h-3 w-3 shrink-0 text-warning" /></Tooltip>}
                  {d.isProbe && <Badge tone="info" size="xs">probe</Badge>}
                </div>
                {(d.hostname && d.hostname !== d.name) || d.serialNumber || d.model ? <div className="truncate text-xs text-fg-subtle">{d.hostname && d.hostname !== d.name ? d.hostname : d.serialNumber || d.model}</div> : null}
              </div>
            </div>
          );
        },
      },
    ];
    if (show("user")) c.push({ id: "loggedInUser", accessorKey: "loggedInUser", header: "User", size: 150, cell: ({ getValue }) => <span className="truncate text-fg-muted">{(getValue() as string) || <span className="text-fg-subtle">nobody</span>}</span> });
    if (show("os")) c.push({ id: "osName", accessorKey: "osName", header: "OS", size: 220, cell: ({ row }) => <span className="flex items-center gap-2"><PlatformChip platform={row.original.platform} /><span className="truncate text-fg-muted">{row.original.osName ? `${row.original.osName}${row.original.osVersion ? ` ${row.original.osVersion}` : ""}` : platformLabel[row.original.platform]}</span></span> });
    if (show("ip")) c.push({ id: "ip", header: "IP", size: 140, enableSorting: false, cell: ({ row }) => <span className="mono text-xs text-fg-muted">{row.original.localIps?.[0] ?? row.original.publicIp ?? "—"}</span> });
    if (show("site")) c.push({ id: "site", header: "Site / group", size: 170, enableSorting: false, cell: ({ row }) => <span className="truncate text-xs text-fg-muted">{[row.original.siteName, row.original.groupName].filter(Boolean).join(" · ") || "—"}</span> });
    if (show("health")) c.push({ id: "healthScore", accessorKey: "healthScore", header: "Health", size: 110, cell: ({ getValue }) => <HealthScore score={getValue() as number | null} /> });
    if (show("alerts")) c.push({ id: "alerts", header: "Alerts", size: 80, enableSorting: false, cell: ({ row }) => row.original.openAlerts ? <Link href={`/alerts?deviceId=${row.original.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-px text-xs font-medium text-danger hover:underline"><Bell className="h-3 w-3" />{row.original.openAlerts}</Link> : <span className="text-xs text-fg-subtle">—</span> });
    if (show("hardware")) c.push({ id: "hardware", header: "Hardware", size: 220, enableSorting: false, cell: ({ row }) => <span className="truncate text-xs text-fg-muted">{[row.original.cpuModel?.replace(/\(R\)|\(TM\)|CPU|Processor/g, "").trim(), row.original.memoryBytes ? formatBytes(row.original.memoryBytes, 0) : null].filter(Boolean).join(" · ") || "—"}</span> });
    if (show("agent")) c.push({ id: "agent", header: "Agent", size: 90, enableSorting: false, cell: ({ row }) => <span className="mono text-xs text-fg-muted">{row.original.agentVersion ?? "—"}</span> });
    if (show("tags")) c.push({ id: "tags", header: "Tags", size: 180, enableSorting: false, cell: ({ row }) => <TagList tags={row.original.tags} /> });
    if (show("lastSeen")) c.push({ id: "lastSeenAt", accessorKey: "lastSeenAt", header: "Last seen", size: 110, cell: ({ row }) => <LastSeen at={row.original.lastSeenAt} status={row.original.status} /> });
    return c;
  })();

  const hasFilters = !!(f.status || f.platform || f.siteId || f.groupId || f.tag || f.q || f.health);
  const activeSite = sites?.items.find((s) => s.id === f.siteId);
  const target = { type: "device" as const, ids: selectedIds, label: `${selectedIds.length} selected device${selectedIds.length === 1 ? "" : "s"}` };

  return (
    <>
      <PageHeader
        title="Devices"
        description={list.data ? `${list.total.toLocaleString()} device${list.total === 1 ? "" : "s"}${activeSite ? ` at ${activeSite.name}` : ""}` : "Loading…"}
        actions={
          <>
            {headerExtra}
            {can("scripts.run") && <Button variant="secondary" leftIcon={<FileCode2 className="h-4 w-4" />} onClick={() => router.push("/jobs/new")}>Run script</Button>}
            {can("devices.enroll") && <Button leftIcon={<Download className="h-4 w-4" />} onClick={() => router.push("/deploy")}>Deploy agent</Button>}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Input value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Search name, user, IP, serial, tag…" leftIcon={<Search />} aria-label="Search devices" />
            {f.q && <button type="button" onClick={() => setF({ q: "" })} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg" aria-label="Clear search"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <Select value={f.platform} onChange={(e) => setF({ platform: e.target.value })} className="w-auto min-w-[140px]" aria-label="Platform">
            <option value="">All platforms</option>
            {Object.entries(platformLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {!!sites?.items.length && (
            <Select value={f.siteId} onChange={(e) => setF({ siteId: e.target.value })} className="w-auto min-w-[140px]" aria-label="Site">
              <option value="">All sites</option>
              {sites.items.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.deviceCount})</option>)}
            </Select>
          )}
          {!!groups?.items.length && (
            <Select value={f.groupId} onChange={(e) => setF({ groupId: e.target.value })} className="w-auto min-w-[140px]" aria-label="Group">
              <option value="">All groups</option>
              {groups.items.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          )}
          <Select value={f.health} onChange={(e) => setF({ health: e.target.value })} className="w-auto min-w-[140px]" aria-label="Health">
            <option value="">Any health</option>
            <option value="80">Health below 80</option>
            <option value="60">Health below 60</option>
            <option value="40">Health below 40</option>
          </Select>
          {f.tag && <Pill active onClick={() => setF({ tag: "" })}>tag: {f.tag} <X className="ml-1 inline h-3 w-3" /></Pill>}
          {hasFilters && <Button variant="ghost" size="sm" onClick={() => setF({ ...DEFAULTS })}>Clear filters</Button>}
          <div className="ml-auto">
            <Menu trigger={<Button variant="ghost" size="sm" leftIcon={<Columns3 className="h-4 w-4" />} rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>Columns</Button>}>
              <MenuLabel>Show columns</MenuLabel>
              {OPTIONAL_COLUMNS.map((c) => <MenuCheckItem key={c.id} checked={cols.includes(c.id)} onCheckedChange={(v) => setCols((prev) => (v ? [...prev, c.id] : prev.filter((x) => x !== c.id)))}>{c.label}</MenuCheckItem>)}
            </Menu>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Status">
          {STATUS_PILLS.map((p) => <Pill key={p.v} active={f.status === p.v} onClick={() => setF({ status: p.v })}>{p.label}</Pill>)}
        </div>
      </div>

      {selectedIds.length > 0 && <DeviceBulkBar selectedIds={selectedIds} selectedRows={selectedRows} can={can} onClear={() => setSelection({})} onQuick={setQuick} onChanged={() => { setSelection({}); list.mutate(); }} />}

      {!list.isLoading && list.total === 0 && !hasFilters ? (
        <EmptyState icon={<Download />} title="No devices yet" description="Deploy the agent on your first machine and it will show up here within seconds." action={can("devices.enroll") ? <Button onClick={() => router.push("/deploy")} leftIcon={<Download className="h-4 w-4" />}>Deploy agent</Button> : undefined} />
      ) : (
        <DataTable<DeviceRow>
          columns={columns}
          data={list.items}
          loading={list.isLoading}
          emptyMessage={<span>No devices match these filters. <button type="button" className="text-accent-hover hover:underline" onClick={() => setF({ ...DEFAULTS })}>Clear filters</button></span>}
          selectable
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          getRowId={(d) => d.id}
          onRowClick={(d) => router.push(`/devices/${d.id}`)}
          manualSorting
          sorting={f.sort ? [{ id: f.sort, desc: f.dir === "desc" }] : []}
          onSortingChange={(u) => { const next = typeof u === "function" ? u(f.sort ? [{ id: f.sort, desc: f.dir === "desc" }] : []) : u; setF({ sort: next[0]?.id ?? "", dir: next[0]?.desc ? "desc" : "" }); }}
          rowClassName={(d) => cn(d.status === "pending" && "bg-warning-soft/20")}
          pagination={{ page: list.page, pages: list.pages, total: list.total, pageSize: list.pageSize, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
        />
      )}

      {quick && <QuickJobDialog open onOpenChange={(o) => !o && setQuick(null)} action={quick} target={target} onCreated={() => setSelection({})} />}
    </>
  );
}

/**
 * Bulk-action bar shared by the Table layout and the Access console: run command / script, approve pending devices,
 * the full quick-action menu and clear. Approvals are performed here so both layouts behave identically.
 */
export function DeviceBulkBar({ selectedIds, selectedRows, can, onClear, onQuick, onChanged, className }: { selectedIds: string[]; selectedRows: DeviceRow[]; can: (p: string) => boolean; onClear: () => void; onQuick: (action: QuickAction) => void; onChanged: () => void; className?: string }) {
  const router = useRouter();
  const [approving, setApproving] = React.useState(false);
  const pending = selectedRows.filter((d) => d.status === "pending");
  async function approveSelected() {
    setApproving(true);
    let ok = 0;
    for (const d of pending) {
      try { await api.post(`devices/${d.id}/approve`); ok++; } catch (err) { toast.error(`${d.name}: ${err instanceof ApiClientError ? err.message : "failed"}`); }
    }
    setApproving(false);
    if (ok) toast.success(`Approved ${ok} device${ok === 1 ? "" : "s"}`);
    onChanged();
  }
  return (
    <div className={cn("mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2 text-sm animate-in", className)} role="toolbar" aria-label="Bulk actions">
      <span className="font-medium">{selectedIds.length} selected</span>
      <span className="mx-1 h-4 w-px bg-border-strong" />
      {can("scripts.run") && <Button size="sm" variant="secondary" onClick={() => onQuick("command")}>Run command</Button>}
      {can("scripts.run") && <Button size="sm" variant="secondary" onClick={() => router.push(`/jobs/new?devices=${selectedIds.join(",")}`)}>Run script…</Button>}
      {can("devices.approve") && pending.length > 0 && <Button size="sm" variant="success" leftIcon={<UserCheck className="h-4 w-4" />} loading={approving} onClick={approveSelected}>Approve {pending.length}</Button>}
      <Menu trigger={<Button size="sm" variant="secondary" rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>More actions</Button>} align="start">
        {QUICK_ACTIONS.filter((a) => a.id !== "command" && can(a.permission)).map((a) => <MenuItem key={a.id} icon={a.icon} danger={a.tone === "danger"} onSelect={() => onQuick(a.id)}>{a.label}</MenuItem>)}
        <MenuSeparator />
        <MenuItem onSelect={onClear}>Clear selection</MenuItem>
      </Menu>
      <button type="button" className="ml-auto rounded p-1 text-fg-muted hover:text-fg focus-ring" onClick={onClear} aria-label="Clear selection"><X className="h-4 w-4" /></button>
    </div>
  );
}
