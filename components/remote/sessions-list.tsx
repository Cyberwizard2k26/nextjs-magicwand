"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Cast, Power, SquareTerminal, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Pill } from "@/components/ui/misc";
import { usePaginated, useUrlState } from "@/lib/client/hooks";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatBytes, formatDateTime, formatDuration, relativeTime } from "@/lib/client/format";
import { PlatformChip, StatusDotLive } from "@/components/devices/device-bits";

interface Row { id: string; deviceId: string; userId: string | null; userName: string | null; type: string; status: string; options: { shell?: string; runAs?: string }; startedAt: string; connectedAt: string | null; endedAt: string | null; endReason: string | null; bytesIn: number; bytesOut: number; ip: string | null; deviceName: string | null; platform: string | null; deviceStatus: string | null; live: boolean; viewers: number }
type Filters = { scope: string; deviceId: string };
const DEFAULTS: Filters = { scope: "active", deviceId: "" };

export function SessionsList({ permissions, userId }: { permissions: string[]; userId: string }) {
  const router = useRouter();
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const [f, setF] = useUrlState(DEFAULTS);
  const params = React.useMemo(() => ({ active: f.scope === "active" ? true : undefined, mine: f.scope === "mine" ? true : undefined, deviceId: f.deviceId || undefined }), [f.scope, f.deviceId]);
  const list = usePaginated<Row>("sessions", params, { pageSize: 50, refreshInterval: 30_000 });
  useRealtime(["session.*"], () => list.mutate());

  async function end(row: Row) {
    try { await api.delete(`sessions/${row.id}`); toast.success("Session ended"); list.mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Failed"); }
  }
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: "type", header: "Type", size: 110, cell: ({ row }) => <span className="flex items-center gap-1.5 text-sm capitalize">{row.original.type === "terminal" ? <SquareTerminal className="h-4 w-4 text-fg-subtle" /> : <Cast className="h-4 w-4 text-fg-subtle" />}{row.original.type}</span> },
    { accessorKey: "deviceName", header: "Device", cell: ({ row }) => <Link href={`/devices/${row.original.deviceId}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-2 hover:text-accent-hover"><StatusDotLive status={row.original.deviceStatus ?? "offline"} /><span className="truncate font-medium">{row.original.deviceName ?? row.original.deviceId}</span>{row.original.platform && <PlatformChip platform={row.original.platform} />}</Link> },
    { accessorKey: "userName", header: "Technician", size: 170, cell: ({ row }) => <span className="truncate text-sm text-fg-muted">{row.original.userName ?? "—"}{row.original.userId === userId ? " (you)" : ""}</span> },
    { accessorKey: "status", header: "Status", size: 140, cell: ({ row }) => row.original.live ? <Badge tone="success" size="xs" dot className="[&>span]:animate-pulse">live{row.original.viewers > 1 ? ` · ${row.original.viewers} viewers` : ""}</Badge> : <Badge tone={row.original.status === "failed" ? "danger" : "neutral"} size="xs" dot className="capitalize">{row.original.status}</Badge> },
    { id: "details", header: "Details", size: 200, enableSorting: false, cell: ({ row }) => <span className="truncate text-xs text-fg-muted">{[row.original.options?.shell && row.original.options.shell !== "auto" ? row.original.options.shell : null, row.original.options?.runAs === "user" ? "as user" : "as system", row.original.ip].filter(Boolean).join(" · ")}{row.original.endReason ? ` · ${row.original.endReason}` : ""}</span> },
    { accessorKey: "startedAt", header: "Started", size: 120, cell: ({ getValue }) => <span className="whitespace-nowrap text-xs text-fg-muted" title={formatDateTime(getValue() as string)}>{relativeTime(getValue() as string)}</span> },
    { id: "duration", header: "Duration", size: 100, enableSorting: false, cell: ({ row }) => { const end = row.original.endedAt ? new Date(row.original.endedAt).getTime() : row.original.live ? Date.now() : null; return <span className="tabular text-xs text-fg-muted">{end ? formatDuration((end - new Date(row.original.startedAt).getTime()) / 1000) : "—"}</span>; } },
    { id: "bytes", header: "Traffic", size: 110, enableSorting: false, cell: ({ row }) => <span className="tabular text-xs text-fg-subtle">{formatBytes(row.original.bytesIn + row.original.bytesOut, 0)}</span> },
    { id: "actions", header: "", size: 90, enableSorting: false, cell: ({ row }) => row.original.live && (row.original.userId === userId || can("remote.jit_approve")) ? <Button size="xs" variant="ghost" className="text-danger" leftIcon={<X className="h-3 w-3" />} onClick={(e) => { e.stopPropagation(); end(row.original); }}>End</Button> : null },
  ];
  const liveCount = list.items.filter((i) => i.live).length;
  return (
    <>
      <PageHeader title="Remote sessions" description={f.scope === "active" ? `${liveCount} live session${liveCount === 1 ? "" : "s"}` : `${list.total.toLocaleString()} session${list.total === 1 ? "" : "s"}`} />
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {([["active", "Live now"], ["mine", "Mine"], ["all", "All history"]] as const).map(([v, l]) => <Pill key={v} active={f.scope === v} onClick={() => setF({ scope: v })}>{l}</Pill>)}
        {f.deviceId && <Pill active onClick={() => setF({ deviceId: "" })}>one device <X className="ml-1 inline h-3 w-3" /></Pill>}
      </div>
      {!list.isLoading && list.total === 0 ? (
        <EmptyState icon={<Power />} title={f.scope === "active" ? "No live sessions" : "No sessions yet"} description="Open a terminal from any device page; every session is recorded here with who, when, how long and how much data moved." />
      ) : (
        <DataTable columns={columns} data={list.items} loading={list.isLoading} dense onRowClick={(r) => router.push(`/devices/${r.deviceId}/terminal`)} emptyMessage="No sessions match." pagination={{ page: list.page, pages: list.pages, total: list.total, pageSize: list.pageSize, onPageChange: list.setPage }} />
      )}
    </>
  );
}
