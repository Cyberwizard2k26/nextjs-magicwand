"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import { Download, MessageSquare, MoreHorizontal, Plus, Search, Ticket, Users, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, Kbd, PageHeader, Pill } from "@/components/ui/misc";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { usePaginated, useUrlState } from "@/lib/client/hooks";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { PlatformChip, StatusDotLive, TagList } from "@/components/devices/device-bits";
import { AssigneeAvatar, PRIORITIES, SlaPill, STATUSES, TicketNumber, TicketPriorityBadge, TicketStatusBadge, TYPES, makeCan, useTicker, type Assignee, type TicketRow, type TicketSummary } from "./ticket-bits";
import { BulkBar, SummaryTiles, ViewPills, type TileKey } from "./ticket-list-parts";
import { NewTicketDialog } from "./new-ticket-dialog";

type Filters = { view: string; status: string; priority: string; type: string; assigneeId: string; siteId: string; tag: string; q: string; sort: string; dir: string; new: string; deviceId: string; contactId: string; alertId: string; title: string };
const DEFAULTS: Filters = { view: "open", status: "", priority: "", type: "", assigneeId: "", siteId: "", tag: "", q: "", sort: "", dir: "", new: "", deviceId: "", contactId: "", alertId: "", title: "" };
const OPEN = "new,open,pending,on_hold";
const VIEWS = [{ v: "open", label: "All open" }, { v: "mine", label: "Mine" }, { v: "unassigned", label: "Unassigned" }, { v: "waiting", label: "Waiting on user" }, { v: "breached", label: "Breached" }, { v: "due", label: "Due today" }, { v: "closed", label: "Closed" }, { v: "all", label: "All" }];
function viewParams(view: string): { status?: string; assigneeId?: string; slaBreached?: boolean; dueToday?: boolean } {
  switch (view) {
    case "mine": return { status: OPEN, assigneeId: "me" };
    case "unassigned": return { status: OPEN, assigneeId: "none" };
    case "waiting": return { status: "pending" };
    case "breached": return { status: OPEN, slaBreached: true };
    case "due": return { dueToday: true };
    case "closed": return { status: "resolved,closed" };
    case "all": return {};
    default: return { status: OPEN };
  }
}
const TILE_VIEW: Record<TileKey, string> = { open: "open", unassigned: "unassigned", due: "due", breached: "breached", resolved: "closed" };

export function TicketList({ permissions, userId }: { permissions: string[]; userId: string | null }) {
  const router = useRouter();
  const can = makeCan(permissions);
  const [f, setF] = useUrlState(DEFAULTS);
  const vp = viewParams(f.view);
  const params = React.useMemo(() => ({ ...vp, ...(f.status ? { status: f.status } : {}), priority: f.priority || undefined, type: f.type || undefined, assigneeId: f.assigneeId || vp.assigneeId, siteId: f.siteId || undefined, tag: f.tag || undefined, deviceId: f.deviceId || undefined, contactId: f.contactId || undefined, alertId: f.alertId || undefined, summary: true }), [vp, f.status, f.priority, f.type, f.assigneeId, f.siteId, f.tag, f.deviceId, f.contactId, f.alertId]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = usePaginated<TicketRow>("tickets", params, { pageSize: 50 });
  const summary = (list.data as unknown as { summary?: TicketSummary } | undefined)?.summary;
  const { data: assignees } = useSWR<{ items: Assignee[] }>("tickets/assignees");
  const { data: sites } = useSWR<{ items: { id: string; name: string }[] }>("sites");
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [focus, setFocus] = React.useState(-1);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  useTicker();
  React.useEffect(() => { list.setQ(f.q); }, [f.q]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { list.setSort(f.sort ? { field: f.sort, dir: (f.dir as "asc" | "desc") || "desc" } : null); }, [f.sort, f.dir]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime(["ticket.*"], () => list.mutate());
  const ids = Object.keys(selection).filter((k) => selection[k]);
  const newOpen = f.new === "1";
  const openNew = React.useCallback(() => setF({ new: "1" }), [setF]);

  // Keyboard: j/k move, Enter open, x select, c compose.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (newOpen || confirmDelete || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || t.closest("[role=dialog]"))) return;
      const n = list.items.length;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setFocus((i) => { const next = e.key === "j" ? Math.min(n - 1, i + 1) : Math.max(0, i - 1); document.querySelectorAll<HTMLElement>("[data-ticket-table] tbody tr")[next]?.scrollIntoView({ block: "nearest" }); return next; });
      } else if (e.key === "Enter" && focus >= 0 && list.items[focus]) router.push(`/tickets/${list.items[focus].id}`);
      else if (e.key === "x" && focus >= 0 && list.items[focus]) setSelection((s) => ({ ...s, [list.items[focus].id]: !s[list.items[focus].id] }));
      else if (e.key === "c" && can("tickets.manage")) openNew();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list.items, focus, newOpen, confirmDelete, router, openNew, can]);

  async function bulk(body: Record<string, unknown>, label: string) {
    setBusy(true);
    try {
      const r = await api.post<{ updated: number; failed: { id: string; error: string }[] }>("tickets/bulk", { ids, ...body });
      if (r.failed.length) toast.warning(`${r.updated} updated, ${r.failed.length} skipped: ${r.failed[0].error}`);
      else toast.success(`${r.updated} ticket${r.updated === 1 ? "" : "s"} ${label}`);
      setSelection({});
      list.mutate();
    } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Bulk action failed"); } finally { setBusy(false); }
  }
  async function quick(id: string, body: Record<string, unknown>, label: string) {
    try { await api.patch(`tickets/${id}`, body); toast.success(label); list.mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Update failed"); }
  }
  function exportCsv() {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, q: f.q || undefined, summary: undefined, sort: f.sort || undefined, dir: f.dir || undefined })) if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v));
    window.open(`/api/v1/tickets/export?${sp.toString()}`, "_blank");
  }

  const sorting: SortingState = f.sort ? [{ id: f.sort, desc: f.dir !== "asc" }] : [];
  const onSortingChange = (updater: SortingState | ((old: SortingState) => SortingState)) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    setF(next[0] ? { sort: next[0].id, dir: next[0].desc ? "desc" : "asc" } : { sort: "", dir: "" });
  };
  const noSort = { enableSorting: false } as const;
  const columns: ColumnDef<TicketRow, unknown>[] = [
    { id: "number", accessorKey: "number", header: "#", size: 64, cell: ({ row }) => <TicketNumber number={row.original.number} /> },
    { id: "title", accessorKey: "title", header: "Ticket", size: 420, cell: ({ row }) => { const t = row.original; return (
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2"><Link href={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} className="truncate font-medium text-fg hover:text-accent-hover">{t.title}</Link>{t.tags.length > 0 && <TagList tags={t.tags} max={2} className="hidden md:inline-flex" />}</div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted"><MessageSquare className="h-3 w-3 shrink-0 text-fg-subtle" /><span className="truncate">{t.lastCommentPreview ? `${t.lastCommentPreview}` : "No replies yet"}</span>{t.lastCommentAt && <span className="shrink-0 text-fg-subtle">· {relativeTime(t.lastCommentAt)}</span>}{t.commentCount > 0 && <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] tabular text-fg-subtle">{t.commentCount}</span>}</div>
      </div>); } },
    { id: "contact", header: "Requester", size: 170, ...noSort, cell: ({ row }) => row.original.contactName ? <div className="min-w-0"><div className="truncate text-sm">{row.original.contactName}</div>{row.original.contactEmail && <div className="truncate text-xs text-fg-subtle">{row.original.contactEmail}</div>}</div> : <span className="text-xs text-fg-subtle">—</span> },
    { id: "device", header: "Device", size: 170, ...noSort, cell: ({ row }) => row.original.deviceId ? <Link href={`/devices/${row.original.deviceId}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-2 hover:text-accent-hover"><StatusDotLive status={row.original.deviceStatus ?? "offline"} /><span className="truncate text-sm">{row.original.deviceName}</span>{row.original.devicePlatform && <PlatformChip platform={row.original.devicePlatform} />}</Link> : <span className="text-xs text-fg-subtle">—</span> },
    { id: "priority", accessorKey: "priority", header: "Priority", size: 100, cell: ({ getValue }) => <TicketPriorityBadge priority={getValue() as string} /> },
    { id: "status", accessorKey: "status", header: "Status", size: 130, cell: ({ getValue }) => <TicketStatusBadge status={getValue() as string} /> },
    { id: "assignee", header: "Assignee", size: 70, ...noSort, cell: ({ row }) => <AssigneeAvatar name={row.original.assigneeName} src={row.original.assigneeAvatarUrl} /> },
    { id: "resolveDueAt", header: "SLA", size: 110, cell: ({ row }) => <SlaPill ticket={row.original} /> },
    { id: "updatedAt", accessorKey: "updatedAt", header: "Updated", size: 100, cell: ({ getValue }) => <span className="whitespace-nowrap text-xs text-fg-muted" title={formatDateTime(getValue() as string)}>{relativeTime(getValue() as string)}</span> },
    { id: "actions", header: "", size: 44, ...noSort, cell: ({ row }) => can("tickets.manage") ? <span onClick={(e) => e.stopPropagation()} className="flex justify-end"><Menu trigger={<Button size="icon-sm" variant="ghost" aria-label="Ticket actions"><MoreHorizontal className="h-4 w-4" /></Button>}>
      <MenuItem onSelect={() => router.push(`/tickets/${row.original.id}`)}>Open</MenuItem>
      {userId && row.original.assigneeId !== userId && <MenuItem onSelect={() => quick(row.original.id, { assigneeId: userId }, `#${row.original.number} assigned to you`)}>Assign to me</MenuItem>}
      <MenuSeparator />
      {row.original.status !== "pending" && !["resolved", "closed"].includes(row.original.status) && <MenuItem onSelect={() => quick(row.original.id, { status: "pending" }, `#${row.original.number} waiting on user`)}>Waiting on user</MenuItem>}
      {!["resolved", "closed"].includes(row.original.status) && <MenuItem onSelect={() => quick(row.original.id, { status: "resolved" }, `#${row.original.number} resolved`)}>Mark resolved</MenuItem>}
      {row.original.status === "resolved" && <MenuItem onSelect={() => quick(row.original.id, { status: "closed" }, `#${row.original.number} closed`)}>Close</MenuItem>}
      {["resolved", "closed"].includes(row.original.status) && <MenuItem onSelect={() => quick(row.original.id, { status: "open" }, `#${row.original.number} reopened`)}>Reopen</MenuItem>}
    </Menu></span> : null },
  ];

  const activeTile = (Object.entries(TILE_VIEW).find(([, v]) => v === f.view)?.[0] as TileKey | undefined) ?? null;
  const hasFilters = f.view !== DEFAULTS.view || !!(f.status || f.priority || f.type || f.assigneeId || f.siteId || f.tag || f.q || f.deviceId || f.contactId || f.alertId);
  const nothingAtAll = !list.isLoading && summary && Object.values(summary.byStatus).reduce((a, b) => a + b, 0) === 0;

  return (
    <>
      <PageHeader title="Tickets" description={summary ? `${summary.open} open · ${summary.unassigned} unassigned · ${summary.breached} breached · ${summary.resolvedThisWeek} resolved this week` : "Loading…"}
        actions={<>
          <Button variant="secondary" leftIcon={<Users className="h-4 w-4" />} onClick={() => router.push("/tickets/contacts")}>Contacts</Button>
          <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={exportCsv}>Export CSV</Button>
          {can("tickets.manage") && <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openNew}>New ticket <Kbd className="ml-1 hidden sm:inline-flex">c</Kbd></Button>}
        </>} />
      <SummaryTiles summary={summary} active={activeTile} onSelect={(k) => setF({ view: TILE_VIEW[k], status: "", assigneeId: "" })} />
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Search tickets, requesters, devices, #number…" leftIcon={<Search />} className="sm:w-80" aria-label="Search tickets" />
          <Select value={f.status} onChange={(e) => setF({ status: e.target.value })} className="w-auto min-w-[130px]" aria-label="Status"><option value="">View status</option>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
          <Select value={f.priority} onChange={(e) => setF({ priority: e.target.value })} className="w-auto min-w-[120px]" aria-label="Priority"><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
          <Select value={f.type} onChange={(e) => setF({ type: e.target.value })} className="w-auto min-w-[110px]" aria-label="Type"><option value="">Any type</option>{TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</Select>
          <Select value={f.assigneeId} onChange={(e) => setF({ assigneeId: e.target.value })} className="w-auto min-w-[140px]" aria-label="Assignee"><option value="">Any assignee</option><option value="none">Unassigned</option>{assignees?.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          {!!sites?.items.length && <Select value={f.siteId} onChange={(e) => setF({ siteId: e.target.value })} className="w-auto min-w-[120px]" aria-label="Site"><option value="">Any site</option>{sites.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
          {f.tag && <Pill active onClick={() => setF({ tag: "" })}>tag: {f.tag} <X className="ml-1 inline h-3 w-3" /></Pill>}
          {f.deviceId && <Pill active onClick={() => setF({ deviceId: "" })}>device filter <X className="ml-1 inline h-3 w-3" /></Pill>}
          {f.contactId && <Pill active onClick={() => setF({ contactId: "" })}>contact filter <X className="ml-1 inline h-3 w-3" /></Pill>}
          {f.alertId && <Pill active onClick={() => setF({ alertId: "" })}>alert filter <X className="ml-1 inline h-3 w-3" /></Pill>}
          {hasFilters && <Button variant="ghost" size="sm" onClick={() => setF({ ...DEFAULTS, new: f.new })}>Reset</Button>}
        </div>
        <ViewPills views={VIEWS} active={f.view} onSelect={(v) => setF({ view: v, status: "", assigneeId: "" })} />
      </div>
      {ids.length > 0 && can("tickets.manage") && (
        <BulkBar count={ids.length} assignees={assignees?.items ?? []} meId={userId} busy={busy}
          onAssign={(id) => bulk({ action: "assign", assigneeId: id }, id ? "assigned" : "unassigned")} onStatus={(s) => bulk({ action: "status", status: s }, `moved to ${s.replace("_", " ")}`)} onPriority={(p) => bulk({ action: "priority", priority: p }, `set to ${p}`)}
          onTag={(tag, remove) => bulk({ action: remove ? "untag" : "tag", tag }, remove ? "untagged" : "tagged")} onDelete={() => setConfirmDelete(true)} onClear={() => setSelection({})} />
      )}
      {nothingAtAll && !hasFilters ? (
        <EmptyState icon={<Ticket />} title="No tickets yet" description="Tickets track every request from your users: who is affected, which device, how urgent, and the full conversation. The AI copilot and the API create them here too." action={can("tickets.manage") && <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openNew}>Create the first ticket</Button>} />
      ) : (
        <div data-ticket-table>
          <DataTable columns={columns} data={list.items} loading={list.isLoading} selectable rowSelection={selection} onRowSelectionChange={setSelection} getRowId={(t) => t.id} onRowClick={(t) => router.push(`/tickets/${t.id}`)}
            sorting={sorting} onSortingChange={onSortingChange} manualSorting
            rowClassName={(t) => cn(list.items[focus]?.id === t.id && "ring-1 ring-inset ring-accent/60", t.slaBreached && ["new", "open"].includes(t.status) && "bg-danger-soft/15", t.status === "new" && "font-medium")}
            emptyMessage={<span>No tickets match this view. <button type="button" className="text-accent-hover hover:underline" onClick={() => setF({ ...DEFAULTS, view: "all" })}>Show all</button></span>}
            pagination={{ page: list.page, pages: list.pages, total: list.total, pageSize: list.pageSize, onPageChange: list.setPage }} />
          <p className="mt-2 hidden text-[11px] text-fg-subtle md:block"><Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>x</Kbd> select · <Kbd>c</Kbd> new ticket</p>
        </div>
      )}
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${ids.length} ticket${ids.length === 1 ? "" : "s"}?`} description="Conversations and time entries are removed permanently. Linked alerts are kept but unlinked." confirmLabel="Delete" onConfirm={() => bulk({ action: "delete" }, "deleted")} />
      <NewTicketDialog open={newOpen} onOpenChange={(o) => { if (!o) setF({ new: "", title: "", alertId: "" }); }} canCreateContacts={can("contacts.manage")} initial={{ deviceId: f.deviceId || null, contactId: f.contactId || null, alertId: f.alertId || null, title: f.title || undefined }} onCreated={(t) => { list.mutate(); router.push(`/tickets/${t.id}`); }} />
    </>
  );
}
