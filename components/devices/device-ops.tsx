"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Braces, CalendarClock, ChevronRight, Download, Loader2, Pencil, Play, Plus, RefreshCw, ScrollText, Search, ShieldAlert, Trash2 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, severityTone } from "@/components/ui/badge";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState, Pill, Skeleton } from "@/components/ui/misc";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatBytes, formatDateTime, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { useDevice } from "./device-context";
import { DeviceOfflineNotice } from "./device-header";
import { useRpc } from "@/components/remote/use-rpc";

function TabFrame({ icon: Icon, title, count, toolbar, children }: { icon: React.ComponentType<{ className?: string }>; title: string; count?: number; toolbar?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-fg-subtle" />{title}{count !== undefined && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-medium tabular text-fg-muted">{count}</span>}</h2>
        {toolbar}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ Logs */
interface LogEntry { ts: string; level: string; source?: string; id?: string; message: string }
const LEVEL_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = { error: "danger", warning: "warning", info: "info", debug: "neutral" };

export function DeviceLogs() {
  const { data, can } = useDevice();
  const d = data.device;
  const rpc = useRpc(d.id);
  const isWin = d.platform === "windows";
  const [source, setSource] = React.useState(isWin ? "System" : "");
  const [level, setLevel] = React.useState<"error" | "warning" | "info">("warning");
  const [since, setSince] = React.useState(60 * 24);
  const [search, setSearch] = React.useState("");
  const [entries, setEntries] = React.useState<LogEntry[] | null>(null);
  const [open, setOpen] = React.useState<number | null>(null);
  const online = d.status === "online";
  const load = React.useCallback(async () => {
    try { const r = await rpc.call<{ entries: LogEntry[] }>("eventlog_query", { source: source || undefined, level: level === "info" ? undefined : level, limit: 300, sinceMinutes: since, search: search || undefined }); setEntries(r.data.entries ?? []); } catch { setEntries([]); }
  }, [rpc, source, level, since, search]);
  React.useEffect(() => { if (online) void load(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can("remote.tools")) return <p className="text-sm text-fg-muted">You need the &quot;remote.tools&quot; permission to read logs.</p>;
  if (!online) return <DeviceOfflineNotice what="Reading logs" />;
  return (
    <TabFrame icon={ScrollText} title={isWin ? "Event log" : d.platform === "macos" ? "Unified log" : "System journal"} count={entries?.length} toolbar={<>
      {isWin ? <Select value={source} onChange={(e) => setSource(e.target.value)} className="h-8 w-auto text-xs">{["System", "Application", "Security", "Setup", "Microsoft-Windows-TaskScheduler/Operational", "Microsoft-Windows-WindowsUpdateClient/Operational", "Microsoft-Windows-PowerShell/Operational"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        : <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder={d.platform === "macos" ? "process (e.g. kernel)" : "unit (e.g. sshd)"} className="h-8 w-44 text-xs" />}
      {([["error", "Errors"], ["warning", "Warnings+"], ["info", "Everything"]] as const).map(([v, l]) => <Pill key={v} active={level === v} onClick={() => setLevel(v)}>{l}</Pill>)}
      <Select value={String(since)} onChange={(e) => setSince(Number(e.target.value))} className="h-8 w-auto text-xs"><option value="15">Last 15 min</option><option value="60">Last hour</option><option value="1440">Last 24 h</option><option value="10080">Last 7 days</option></Select>
      <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Contains…" leftIcon={<Search />} className="h-8 w-44 text-xs" />
      <Button size="sm" variant="secondary" onClick={load} loading={rpc.busy === "eventlog_query"} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>Load</Button>
    </>}>
      {rpc.error && <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{rpc.error}</div>}
      {entries === null ? <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div> : entries.length === 0 ? <EmptyState icon={<ScrollText />} title="No entries" description="Nothing matched in this window. Widen the time range or lower the level." /> : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-border/70">
            {entries.map((e, i) => (
              <li key={i}>
                <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-surface-hover/60 focus-ring">
                  <span className="mt-0.5 w-[130px] shrink-0 whitespace-nowrap text-[11px] tabular text-fg-subtle" title={e.ts ? formatDateTime(e.ts) : ""}>{e.ts ? new Date(e.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</span>
                  <Badge tone={LEVEL_TONE[e.level] ?? "neutral"} size="xs" className="w-[64px] justify-center capitalize">{e.level}</Badge>
                  <span className="w-[160px] shrink-0 truncate text-xs text-fg-muted" title={e.source}>{e.source || "—"}{e.id ? <span className="text-fg-subtle"> #{e.id}</span> : null}</span>
                  <span className={cn("min-w-0 flex-1 text-sm text-fg", open === i ? "whitespace-pre-wrap break-words" : "truncate")}>{e.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </TabFrame>
  );
}

/* ------------------------------------------------------------------ Scheduled tasks */
interface Task { name: string; path?: string; source: string; state: string; schedule?: string; command?: string; user?: string; lastRun?: string; nextRun?: string; lastResult?: string; author?: string; canControl: boolean }

export function DeviceTasks() {
  const { data, can } = useDevice();
  const d = data.device;
  const rpc = useRpc(d.id);
  const [tasks, setTasks] = React.useState<Task[] | null>(null);
  const [q, setQ] = React.useState("");
  const [source, setSource] = React.useState("");
  const online = d.status === "online";
  const load = React.useCallback(async () => { try { const r = await rpc.call<{ tasks: Task[] }>("task_scheduler_list"); setTasks(r.data.tasks ?? []); } catch { setTasks([]); } }, [rpc]);
  React.useEffect(() => { if (online) void load(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(t: Task, action: "run" | "enable" | "disable") {
    try { await rpc.call("task_scheduler_action", { name: t.name, path: t.path, source: t.source, action }); toast.success(`${t.name}: ${action}`); setTimeout(load, 1500); } catch (err) { toast.error((err as Error).message); }
  }
  if (!can("remote.tools")) return <p className="text-sm text-fg-muted">You need the &quot;remote.tools&quot; permission to view scheduled tasks.</p>;
  if (!online) return <DeviceOfflineNotice what="Listing scheduled tasks" />;
  const sources = [...new Set((tasks ?? []).map((t) => t.source))];
  const items = (tasks ?? []).filter((t) => (!source || t.source === source) && (!q || `${t.name} ${t.command ?? ""} ${t.user ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const columns: ColumnDef<Task, unknown>[] = [
    { accessorKey: "name", header: "Task", cell: ({ row }) => <div className="min-w-0 max-w-[36vw]"><div className="truncate font-medium text-fg" title={row.original.name}>{row.original.name}</div>{row.original.command && <div className="mono truncate text-[11px] text-fg-subtle" title={row.original.command}>{row.original.command}</div>}</div> },
    { accessorKey: "source", header: "Source", size: 120, cell: ({ getValue }) => <Badge tone="outline" size="xs">{(getValue() as string).replace(/_/g, " ")}</Badge> },
    { accessorKey: "state", header: "State", size: 100, cell: ({ getValue }) => { const s = getValue() as string; return <Badge tone={s === "running" ? "success" : s === "disabled" ? "neutral" : s === "ready" ? "info" : "warning"} size="xs" dot>{s}</Badge>; } },
    { accessorKey: "schedule", header: "Schedule", size: 150, cell: ({ getValue }) => <span className="mono truncate text-xs text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "user", header: "Runs as", size: 120, cell: ({ getValue }) => <span className="truncate text-xs text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "lastRun", header: "Last run", size: 120, cell: ({ row }) => <span className="whitespace-nowrap text-xs text-fg-muted" title={row.original.lastRun ? formatDateTime(row.original.lastRun) : ""}>{row.original.lastRun ? relativeTime(row.original.lastRun) : "—"}{row.original.lastResult && row.original.lastResult !== "0" ? <span className="ml-1 text-danger">({row.original.lastResult})</span> : null}</span> },
    { accessorKey: "nextRun", header: "Next run", size: 120, cell: ({ getValue }) => <span className="whitespace-nowrap text-xs text-fg-muted">{getValue() ? relativeTime(getValue() as string) : "—"}</span> },
    { id: "actions", header: "", size: 110, enableSorting: false, cell: ({ row }) => row.original.canControl ? <span className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}><Button size="icon-sm" variant="ghost" aria-label="Run now" onClick={() => act(row.original, "run")}><Play className="h-3.5 w-3.5" /></Button>{row.original.state === "disabled" ? <Button size="xs" variant="ghost" onClick={() => act(row.original, "enable")}>Enable</Button> : <Button size="xs" variant="ghost" onClick={() => act(row.original, "disable")}>Disable</Button>}</span> : null },
  ];
  return (
    <TabFrame icon={CalendarClock} title="Scheduled tasks" count={items.length} toolbar={<><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" leftIcon={<Search />} className="h-8 w-56 text-xs" />{sources.length > 1 && sources.map((s) => <Pill key={s} active={source === s} onClick={() => setSource(source === s ? "" : s)}>{s.replace(/_/g, " ")}</Pill>)}<Button size="sm" variant="ghost" className="ml-auto" onClick={load} leftIcon={rpc.busy === "task_scheduler_list" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}>Refresh</Button></>}>
      {rpc.error && <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{rpc.error}</div>}
      <DataTable columns={columns} data={items} loading={tasks === null} dense emptyMessage="No scheduled tasks found." />
    </TabFrame>
  );
}

/* ------------------------------------------------------------------ Patches */
interface PatchRow { id: string; externalId: string; title: string; description: string | null; source: string; category: string; severity: string; kb: string | null; version: string | null; currentVersion: string | null; sizeBytes: number | null; status: string; rebootRequired: boolean; releaseDate: string | null; firstSeenAt: string; lastSeenAt: string; installedAt: string | null; lastError: string | null; supportUrl: string | null }
const PATCH_STATUS_TONE: Record<string, "danger" | "warning" | "success" | "info" | "neutral"> = { available: "warning", failed: "danger", pending_reboot: "info", installed: "success", installing: "info", approved: "info", scheduled: "info", deferred: "neutral", rejected: "neutral", superseded: "neutral", not_applicable: "neutral" };

export function DevicePatches() {
  const { data, can, mutate: mutateDevice } = useDevice();
  const d = data.device;
  const router = useRouter();
  const { data: res, isLoading, mutate } = useSWR<{ items: PatchRow[]; lastScanAt: string | null; pendingReboot: boolean }>(`devices/${d.id}/patches`);
  const [view, setView] = React.useState<"outstanding" | "installed" | "all">("outstanding");
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [confirm, setConfirm] = React.useState<null | { all: boolean; ids: string[] }>(null);
  const [scanning, setScanning] = React.useState(false);
  useRealtime(["patches.*", "job.run.updated"], (ev) => { if (ev.deviceId === d.id) { mutate(); mutateDevice(); if ((ev.payload as { type?: string }).type === "patch_scan" || ev.name.startsWith("patches.")) setScanning(false); } }, [`device:${d.id}`]);
  const items = (res?.items ?? []).filter((p) => view === "all" || (view === "outstanding" ? ["available", "failed", "pending_reboot", "approved", "installing", "scheduled"].includes(p.status) : p.status === "installed"));
  const outstanding = (res?.items ?? []).filter((p) => ["available", "failed"].includes(p.status));
  const security = outstanding.filter((p) => p.category === "security").length;
  const selected = Object.keys(selection).filter((k) => selection[k]);

  async function scan() {
    setScanning(true);
    try { const r = await api.post<{ job: { id: string } }>(`devices/${d.id}/actions`, { action: "patch_scan" }); toast.success("Patch scan started", { action: { label: "Job", onClick: () => router.push(`/jobs/${r.job.id}`) } }); setTimeout(() => setScanning(false), 120_000); } catch (err) { setScanning(false); toast.error(err instanceof ApiClientError ? err.message : "Failed"); }
  }
  async function install(target: { all: boolean; ids: string[] }) {
    try { const r = await api.post<{ job: { id: string } }>(`devices/${d.id}/actions`, { action: "patch_install", payload: target.all ? { all: true } : { externalIds: target.ids } }); toast.success(target.all ? "Installing all updates" : `Installing ${target.ids.length} update(s)`, { action: { label: "Job", onClick: () => router.push(`/jobs/${r.job.id}`) } }); setSelection({}); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Failed"); }
  }
  const columns: ColumnDef<PatchRow, unknown>[] = [
    { accessorKey: "severity", header: "Severity", size: 100, cell: ({ getValue }) => <Badge tone={severityTone((getValue() as string) === "important" ? "high" : (getValue() as string) === "moderate" ? "medium" : (getValue() as string))} size="xs" className="w-[72px] justify-center capitalize">{getValue() as string}</Badge> },
    { accessorKey: "title", header: "Update", cell: ({ row }) => <div className="min-w-0 max-w-[40vw]"><div className="truncate font-medium text-fg" title={row.original.title}>{row.original.title}</div><div className="truncate text-[11px] text-fg-subtle">{[row.original.kb, row.original.category, row.original.source.replace(/_/g, " ")].filter(Boolean).join(" · ")}{row.original.lastError ? <span className="text-danger"> · {row.original.lastError}</span> : null}</div></div> },
    { id: "version", header: "Version", size: 170, enableSorting: false, cell: ({ row }) => <span className="mono truncate text-xs text-fg-muted">{row.original.currentVersion ? `${row.original.currentVersion} → ` : ""}{row.original.version ?? ""}</span> },
    { accessorKey: "sizeBytes", header: "Size", size: 80, cell: ({ getValue }) => <span className="tabular text-xs text-fg-muted">{getValue() ? formatBytes(getValue() as number, 0) : "—"}</span> },
    { accessorKey: "status", header: "Status", size: 130, cell: ({ row }) => <Badge tone={PATCH_STATUS_TONE[row.original.status] ?? "neutral"} size="xs" dot>{row.original.status.replace(/_/g, " ")}{row.original.rebootRequired && row.original.status !== "installed" ? " · reboot" : ""}</Badge> },
    { accessorKey: "lastSeenAt", header: "Seen", size: 100, cell: ({ row }) => <span className="whitespace-nowrap text-xs text-fg-muted" title={formatDateTime(row.original.firstSeenAt)}>{relativeTime(row.original.status === "installed" ? row.original.installedAt : row.original.firstSeenAt)}</span> },
  ];
  return (
    <TabFrame icon={Download} title="Patches" count={outstanding.length} toolbar={<>
      {([["outstanding", "Outstanding"], ["installed", "Installed"], ["all", "All"]] as const).map(([v, l]) => <Pill key={v} active={view === v} onClick={() => setView(v)}>{l}</Pill>)}
      <span className="text-xs text-fg-subtle">{res?.lastScanAt ? `scanned ${relativeTime(res.lastScanAt)}` : "never scanned"}{res?.pendingReboot ? " · reboot pending" : ""}</span>
      <span className="ml-auto flex items-center gap-1.5">
        {can("patches.manage") && selected.length > 0 && <Button size="sm" onClick={() => setConfirm({ all: false, ids: selected })} leftIcon={<Download className="h-3.5 w-3.5" />}>Install {selected.length}</Button>}
        {can("patches.manage") && outstanding.length > 0 && <Button size="sm" variant="secondary" onClick={() => setConfirm({ all: true, ids: [] })}>Install all</Button>}
        <Button size="sm" variant="secondary" onClick={scan} loading={scanning} disabled={d.status !== "online"} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>Scan now</Button>
      </span>
    </>}>
      {security > 0 && <div className="mb-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"><ShieldAlert className="h-4 w-4" />{security} security update{security === 1 ? "" : "s"} outstanding.</div>}
      {!isLoading && !res?.items.length ? <EmptyState icon={<Download />} title={res?.lastScanAt ? "Fully patched" : "Not scanned yet"} description={res?.lastScanAt ? "The last scan found nothing outstanding." : "Run a scan to list missing OS updates (Windows Update, apt/dnf, softwareupdate)."} action={<Button onClick={scan} loading={scanning} disabled={d.status !== "online"} leftIcon={<RefreshCw className="h-4 w-4" />}>Scan now</Button>} />
        : <DataTable columns={columns} data={items} loading={isLoading} dense selectable={can("patches.manage") && view !== "installed"} rowSelection={selection} onRowSelectionChange={setSelection} getRowId={(p) => p.externalId} emptyMessage="Nothing in this view." />}
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.all ? `Install all ${outstanding.length} outstanding updates?` : `Install ${confirm?.ids.length} update(s)?`} description={`Runs as a tracked job on ${d.name}. ${(confirm?.all ? outstanding : outstanding.filter((p) => confirm?.ids.includes(p.externalId))).some((p) => p.rebootRequired) ? "At least one update needs a reboot afterwards - the device will be flagged, not rebooted automatically." : "No reboot is expected."}`} confirmLabel="Install" tone="primary" onConfirm={async () => { if (confirm) await install(confirm); }} />
    </TabFrame>
  );
}

/* ------------------------------------------------------------------ Registry (Windows) */
interface RegValue { name: string; type: string; value: unknown }

export function DeviceRegistry() {
  const { data, can } = useDevice();
  const d = data.device;
  const rpc = useRpc(d.id);
  const [hive, setHive] = React.useState("HKLM");
  const [path, setPath] = React.useState("SOFTWARE");
  const [pathInput, setPathInput] = React.useState("SOFTWARE");
  const [listing, setListing] = React.useState<{ subkeys: string[]; values: RegValue[] } | null>(null);
  const [edit, setEdit] = React.useState<null | { name: string; type: string; value: string; isNew: boolean }>(null);
  const [del, setDel] = React.useState<RegValue | null>(null);
  const online = d.status === "online";
  const load = React.useCallback(async (h: string, p: string) => {
    try { const r = await rpc.call<{ subkeys: string[]; values: RegValue[] }>("registry_list", { hive: h, path: p }); setListing(r.data); setHive(h); setPath(p); setPathInput(p); } catch { setListing({ subkeys: [], values: [] }); }
  }, [rpc]);
  React.useEffect(() => { if (online && d.platform === "windows") void load(hive, path); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  if (d.platform !== "windows") return <EmptyState icon={<Braces />} title="Registry is a Windows feature" description={`${d.name} runs ${d.platform}. Configuration on this platform lives in files - use the file browser or the terminal.`} />;
  if (!can("remote.tools")) return <p className="text-sm text-fg-muted">You need the &quot;remote.tools&quot; permission to use the registry editor.</p>;
  if (!online) return <DeviceOfflineNotice what="The registry editor" />;
  const crumbs = path.split("\\").filter(Boolean);
  async function save() {
    if (!edit) return;
    let value: unknown = edit.value;
    if (edit.type === "dword" || edit.type === "qword") value = Number(edit.value.startsWith("0x") ? parseInt(edit.value, 16) : edit.value);
    if (edit.type === "multi") value = edit.value.split("\n");
    try { await rpc.call("registry_set", { hive, path, name: edit.name, type: edit.type, value }); toast.success(`${edit.name} saved`); setEdit(null); void load(hive, path); } catch (err) { toast.error((err as Error).message); }
  }
  const show = (v: RegValue) => Array.isArray(v.value) ? (v.value as unknown[]).join(", ") : v.type === "dword" || v.type === "qword" ? `${v.value} (0x${Number(v.value).toString(16)})` : String(v.value ?? "");
  return (
    <TabFrame icon={Braces} title="Registry" toolbar={<>
      <Select value={hive} onChange={(e) => load(e.target.value, "")} className="h-8 w-auto text-xs">{["HKLM", "HKCU", "HKCR", "HKU", "HKCC"].map((h) => <option key={h} value={h}>{h}</option>)}</Select>
      <form onSubmit={(e) => { e.preventDefault(); void load(hive, pathInput); }} className="flex-1"><Input value={pathInput} onChange={(e) => setPathInput(e.target.value)} className="mono h-8 text-xs" placeholder="SOFTWARE\Microsoft\Windows\CurrentVersion" /></form>
      <Button size="sm" variant="secondary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEdit({ name: "", type: "string", value: "", isNew: true })}>New value</Button>
    </>}>
      <p className="mb-3 text-xs text-fg-subtle">Note: HKCU is the agent&apos;s (SYSTEM) hive. Per-user settings live under HKU\&lt;SID&gt;. Every write and delete is audited.</p>
      <nav className="mb-2 flex flex-wrap items-center gap-0.5 text-xs">
        <button type="button" className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg" onClick={() => load(hive, "")}>{hive}</button>
        {crumbs.map((c, i) => <React.Fragment key={i}><ChevronRight className="h-3 w-3 text-fg-subtle" /><button type="button" className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg" onClick={() => load(hive, crumbs.slice(0, i + 1).join("\\"))}>{c}</button></React.Fragment>)}
      </nav>
      {rpc.error && <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{rpc.error}</div>}
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="card max-h-[60vh] overflow-auto">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-fg-muted">Keys {listing ? `(${listing.subkeys.length})` : ""}</div>
          {!listing ? <div className="space-y-2 p-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4" />)}</div> : (
            <ul>{listing.subkeys.map((k) => <li key={k}><button type="button" onClick={() => load(hive, path ? `${path}\\${k}` : k)} className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm hover:bg-surface-hover focus-ring"><ChevronRight className="h-3 w-3 shrink-0 text-fg-subtle" /><span className="truncate">{k}</span></button></li>)}{listing.subkeys.length === 0 && <li className="px-3 py-4 text-xs text-fg-subtle">No subkeys</li>}</ul>
          )}
        </div>
        <div className="card max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2/90 text-left text-xs text-fg-muted backdrop-blur"><tr><th className="h-8 px-3 font-medium">Name</th><th className="h-8 w-20 px-3 font-medium">Type</th><th className="h-8 px-3 font-medium">Data</th><th className="h-8 w-20" /></tr></thead>
            <tbody>
              {(listing?.values ?? []).map((v) => (
                <tr key={v.name || "(Default)"} className="border-t border-border/60">
                  <td className="mono px-3 py-1.5 text-xs">{v.name || "(Default)"}</td>
                  <td className="px-3 py-1.5 text-[11px] uppercase text-fg-subtle">{v.type}</td>
                  <td className="mono max-w-0 truncate px-3 py-1.5 text-xs text-fg-muted" title={show(v)}>{show(v)}</td>
                  <td className="px-2 py-1 text-right"><Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEdit({ name: v.name, type: v.type, value: Array.isArray(v.value) ? (v.value as string[]).join("\n") : String(v.value ?? ""), isNew: false })}><Pencil className="h-3.5 w-3.5" /></Button><Button size="icon-sm" variant="ghost" className="text-fg-subtle hover:text-danger" aria-label="Delete" onClick={() => setDel(v)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                </tr>
              ))}
              {listing && listing.values.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-fg-subtle">No values in this key.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.isNew ? "New value" : `Edit ${edit?.name || "(Default)"}`} description={`${hive}\\${path}`} size="sm" footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={rpc.busy === "registry_set"}>Save</Button></>}>
        {edit && <div className="space-y-3">
          <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="mono" disabled={!edit.isNew} /></Field>
          <Field label="Type"><Select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })} disabled={!edit.isNew}>{[["string", "REG_SZ"], ["expand", "REG_EXPAND_SZ"], ["dword", "REG_DWORD"], ["qword", "REG_QWORD"], ["multi", "REG_MULTI_SZ"], ["binary", "REG_BINARY (base64)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Data" hint={edit.type === "multi" ? "one per line" : edit.type === "dword" ? "decimal or 0x hex" : undefined}>{edit.type === "multi" ? <Textarea value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} className="mono" /> : <Input value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} className="mono" />}</Field>
        </div>}
      </Dialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete value "${del?.name || "(Default)"}"?`} description="Registry changes take effect immediately and may need a sign-out or reboot to be picked up by applications." confirmLabel="Delete" onConfirm={async () => { if (!del) return; await rpc.call("registry_delete", { hive, path, name: del.name }); toast.success("Deleted"); void load(hive, path); }} />
    </TabFrame>
  );
}

