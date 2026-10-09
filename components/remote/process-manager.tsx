"use client";
import * as React from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { ListTree, Loader2, RefreshCw, Search, Skull } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/misc";
import { formatBytes, relativeTime } from "@/lib/client/format";
import { useDevice } from "@/components/devices/device-context";
import { DeviceOfflineNotice } from "@/components/devices/device-header";
import { useRpc } from "./use-rpc";

interface Proc { pid: number; ppid: number; name: string; user?: string; cpu: number; memBytes: number; cmdline?: string; exe?: string; started?: string; status?: string }

export function ProcessManager() {
  const { data, can } = useDevice();
  const d = data.device;
  const rpc = useRpc(d.id);
  const [procs, setProcs] = React.useState<Proc[] | null>(null);
  const [q, setQ] = React.useState("");
  const [auto, setAuto] = React.useState(false);
  const [fetchedAt, setFetchedAt] = React.useState<string | null>(null);
  const [kill, setKill] = React.useState<Proc | null>(null);
  const online = d.status === "online";

  const refresh = React.useCallback(async () => {
    try { const r = await rpc.call<{ processes: Proc[] | null; count: number }>("process_list"); setProcs(r.data.processes ?? []); setFetchedAt(new Date().toISOString()); } catch { /* error shown via rpc.error */ }
  }, [rpc]);
  React.useEffect(() => { if (online) void refresh(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!auto || !online) return;
    const h = setInterval(() => void refresh(), 5000);
    return () => clearInterval(h);
  }, [auto, online, refresh]);

  if (!can("remote.tools")) return <p className="text-sm text-fg-muted">You need the &quot;remote.tools&quot; permission to manage processes.</p>;
  if (!online) return <DeviceOfflineNotice what="The process manager" />;

  const items = (procs ?? []).filter((p) => !q || `${p.name} ${p.user ?? ""} ${p.cmdline ?? ""} ${p.pid}`.toLowerCase().includes(q.toLowerCase()));
  const totalMem = (procs ?? []).reduce((s, p) => s + p.memBytes, 0);
  const columns: ColumnDef<Proc, unknown>[] = [
    { accessorKey: "name", header: "Process", cell: ({ row }) => <div className="min-w-0 max-w-[32vw]"><div className="truncate font-medium text-fg" title={row.original.name}>{row.original.name}</div>{row.original.cmdline && row.original.cmdline !== row.original.name && <div className="mono truncate text-[11px] text-fg-subtle" title={row.original.cmdline}>{row.original.cmdline}</div>}</div> },
    { accessorKey: "pid", header: "PID", size: 80, cell: ({ getValue }) => <span className="mono text-xs text-fg-muted">{getValue() as number}</span> },
    { accessorKey: "user", header: "User", size: 150, cell: ({ getValue }) => <span className="truncate text-xs text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "cpu", header: "CPU", size: 90, cell: ({ getValue }) => { const v = getValue() as number; return <span className={`tabular text-xs ${v >= 50 ? "font-medium text-warning" : "text-fg-muted"}`}>{v.toFixed(1)}%</span>; } },
    { accessorKey: "memBytes", header: "Memory", size: 100, cell: ({ getValue }) => <span className="tabular text-xs text-fg-muted">{formatBytes(getValue() as number, 0)}</span> },
    { accessorKey: "started", header: "Started", size: 110, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{getValue() ? relativeTime(getValue() as string) : "—"}</span> },
    { id: "actions", header: "", size: 60, enableSorting: false, cell: ({ row }) => <Button size="icon-sm" variant="ghost" className="text-fg-subtle hover:text-danger" aria-label={`End ${row.original.name}`} onClick={(e) => { e.stopPropagation(); setKill(row.original); }}><Skull className="h-4 w-4" /></Button> },
  ];

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 flex items-center gap-2 text-sm font-semibold"><ListTree className="h-4 w-4 text-fg-subtle" />Processes{procs && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-medium tabular text-fg-muted">{procs.length}</span>}</h2>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, user, PID…" leftIcon={<Search />} className="h-8 sm:w-64" />
        <Pill active={auto} onClick={() => setAuto((a) => !a)}>Auto-refresh 5s</Pill>
        <span className="text-xs text-fg-subtle">{fetchedAt ? `updated ${relativeTime(fetchedAt)}` : ""}{totalMem ? ` · ${formatBytes(totalMem, 1)} resident` : ""}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={refresh} leftIcon={rpc.busy === "process_list" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}>Refresh</Button>
      </div>
      {rpc.error && <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{rpc.error}</div>}
      <DataTable columns={columns} data={items} loading={procs === null} dense sorting={[{ id: "cpu", desc: true }]} onSortingChange={() => {}} emptyMessage="No processes match." />
      <ConfirmDialog open={!!kill} onOpenChange={(o) => !o && setKill(null)} title={`End ${kill?.name} (PID ${kill?.pid})?`} description="The process is terminated immediately; unsaved data in it is lost. This is logged in the audit trail." confirmLabel="End process" onConfirm={async () => { if (!kill) return; try { await rpc.call("process_kill", { pid: kill.pid, force: true }); toast.success(`Ended ${kill.name}`); await refresh(); } catch (err) { toast.error((err as Error).message); throw err; } }} />
    </section>
  );
}
