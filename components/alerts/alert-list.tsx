"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Bell, BellOff, Check, CheckCheck, ChevronDown, Clock, Search, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, severityTone } from "@/components/ui/badge";
import { EmptyState, PageHeader, Pill } from "@/components/ui/misc";
import { Menu, MenuItem } from "@/components/ui/menu";
import { usePaginated, useUrlState } from "@/lib/client/hooks";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { PlatformChip, StatusDotLive } from "@/components/devices/device-bits";

export interface AlertRow { id: string; deviceId: string | null; severity: string; status: string; title: string; message: string | null; category: string; source: string; occurrences: number; openedAt: string; lastSeenAt: string; acknowledgedAt: string | null; snoozedUntil: string | null; resolvedAt: string | null; ticketId: string | null; deviceName: string | null; devicePlatform: string | null; deviceStatus: string | null }
type Filters = { status: string; severity: string; category: string; deviceId: string; q: string };
const DEFAULTS: Filters = { status: "open,acknowledged", severity: "", category: "", deviceId: "", q: "" };
const STATUS_PILLS = [["open,acknowledged", "Active"], ["open", "Open"], ["acknowledged", "Acknowledged"], ["snoozed", "Snoozed"], ["resolved", "Resolved"], ["", "All"]] as const;
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const SNOOZE = [["30 minutes", 30], ["2 hours", 120], ["Until tomorrow", 60 * 18], ["1 week", 60 * 24 * 7]] as const;

export const ALERT_STATUS_TONE: Record<string, "danger" | "warning" | "info" | "success" | "neutral"> = { open: "danger", acknowledged: "warning", snoozed: "info", resolved: "success", suppressed: "neutral" };

export function AlertList({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const [f, setF] = useUrlState(DEFAULTS);
  const params = React.useMemo(() => ({ status: f.status || undefined, severity: f.severity || undefined, category: f.category || undefined, deviceId: f.deviceId || undefined, counts: true }), [f.status, f.severity, f.category, f.deviceId]);
  const list = usePaginated<AlertRow>("alerts", params, { pageSize: 50 });
  const counts = (list.data as unknown as { counts?: { byStatus: Record<string, number>; openBySeverity: Record<string, number> } } | undefined)?.counts;
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  React.useEffect(() => { list.setQ(f.q); }, [f.q]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime(["alert.*"], () => list.mutate());
  const ids = Object.keys(selection).filter((k) => selection[k]);

  async function bulk(action: "acknowledge" | "resolve" | "snooze" | "reopen", targetIds: string[], minutes?: number) {
    try {
      const r = await api.post<{ updated: number }>("alerts/bulk", { action, ids: targetIds, minutes });
      toast.success(`${r.updated} alert${r.updated === 1 ? "" : "s"} ${action === "acknowledge" ? "acknowledged" : action === "resolve" ? "resolved" : action === "snooze" ? "snoozed" : "reopened"}`);
      setSelection({});
      list.mutate();
    } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Failed"); }
  }

  const columns: ColumnDef<AlertRow, unknown>[] = [
    { accessorKey: "severity", header: "Severity", size: 100, cell: ({ getValue }) => <Badge tone={severityTone(getValue() as string)} size="xs" className="w-[64px] justify-center capitalize">{getValue() as string}</Badge> },
    { accessorKey: "title", header: "Alert", cell: ({ row }) => <div className="min-w-0"><Link href={`/alerts/${row.original.id}`} className="block truncate font-medium text-fg hover:text-accent-hover" onClick={(e) => e.stopPropagation()}>{row.original.title}</Link>{row.original.message && <div className="truncate text-xs text-fg-muted">{row.original.message}</div>}</div> },
    { accessorKey: "deviceName", header: "Device", size: 200, cell: ({ row }) => row.original.deviceId ? <Link href={`/devices/${row.original.deviceId}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-2 hover:text-accent-hover"><StatusDotLive status={row.original.deviceStatus ?? "offline"} /><span className="truncate text-sm">{row.original.deviceName ?? "—"}</span>{row.original.devicePlatform && <PlatformChip platform={row.original.devicePlatform} />}</Link> : <span className="text-xs text-fg-subtle">organization</span> },
    { accessorKey: "status", header: "Status", size: 130, cell: ({ row }) => <Badge tone={ALERT_STATUS_TONE[row.original.status] ?? "neutral"} size="xs" dot className="capitalize">{row.original.status}{row.original.status === "snoozed" && row.original.snoozedUntil ? ` · ${relativeTime(row.original.snoozedUntil)}` : ""}</Badge> },
    { accessorKey: "category", header: "Category", size: 110, cell: ({ getValue }) => <span className="text-xs capitalize text-fg-muted">{getValue() as string}</span> },
    { accessorKey: "occurrences", header: "Count", size: 70, cell: ({ getValue }) => <span className={cn("tabular text-xs", (getValue() as number) > 1 ? "font-medium text-warning" : "text-fg-muted")}>{(getValue() as number) > 1 ? `${getValue()}×` : "1"}</span> },
    { accessorKey: "openedAt", header: "Opened", size: 110, cell: ({ row }) => <span className="whitespace-nowrap text-xs text-fg-muted" title={formatDateTime(row.original.openedAt)}>{relativeTime(row.original.openedAt)}</span> },
    { accessorKey: "lastSeenAt", header: "Last seen", size: 110, cell: ({ getValue }) => <span className="whitespace-nowrap text-xs text-fg-muted" title={formatDateTime(getValue() as string)}>{relativeTime(getValue() as string)}</span> },
    { id: "actions", header: "", size: 90, enableSorting: false, cell: ({ row }) => can("alerts.manage") && ["open", "acknowledged", "snoozed"].includes(row.original.status) ? <span className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>{row.original.status === "open" && <Button size="icon-sm" variant="ghost" aria-label="Acknowledge" onClick={() => bulk("acknowledge", [row.original.id])}><Check className="h-4 w-4" /></Button>}<Button size="icon-sm" variant="ghost" aria-label="Resolve" onClick={() => bulk("resolve", [row.original.id])}><CheckCheck className="h-4 w-4" /></Button></span> : null },
  ];
  const sevCount = (s: string) => counts?.openBySeverity[s] ?? 0;
  const hasFilters = f.status !== DEFAULTS.status || !!(f.severity || f.category || f.deviceId || f.q);

  return (
    <>
      <PageHeader title="Alerts" description={counts ? `${(counts.byStatus.open ?? 0) + (counts.byStatus.acknowledged ?? 0)} active · ${counts.byStatus.snoozed ?? 0} snoozed · ${counts.byStatus.resolved ?? 0} resolved` : "Loading…"} actions={can("monitors.manage") && <Button variant="secondary" onClick={() => router.push("/monitoring")}>Monitors</Button>} />
      <div className="stagger-in mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5 [&>*]:min-w-0">
        {SEVERITIES.map((s) => (
          <button key={s} type="button" onClick={() => setF({ severity: f.severity === s ? "" : s, status: f.status || "open,acknowledged" })} className={cn("card card-hover flex items-center justify-between px-4 py-3 text-left focus-ring", f.severity === s && "border-accent")}>
            <span className="flex items-center gap-2"><Badge tone={severityTone(s)} size="xs" className="capitalize">{s}</Badge></span>
            <span className={cn("text-xl font-semibold tabular", sevCount(s) > 0 && (s === "critical" || s === "high") ? "text-danger" : sevCount(s) > 0 ? "text-fg" : "text-fg-subtle")}>{counts ? sevCount(s) : "…"}</span>
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Search alerts and devices…" leftIcon={<Search />} className="sm:w-72" />
          <Select value={f.category} onChange={(e) => setF({ category: e.target.value })} className="w-auto min-w-[140px]" aria-label="Category"><option value="">All categories</option>{["performance", "availability", "security", "patching", "hardware", "software", "backup", "agent", "network", "other"].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
          {f.deviceId && <Pill active onClick={() => setF({ deviceId: "" })}>device filter <X className="ml-1 inline h-3 w-3" /></Pill>}
          {hasFilters && <Button variant="ghost" size="sm" onClick={() => setF({ ...DEFAULTS })}>Reset</Button>}
        </div>
        <div className="flex flex-wrap gap-1.5">{STATUS_PILLS.map(([v, l]) => <Pill key={v} active={f.status === v} onClick={() => setF({ status: v })}>{l}</Pill>)}</div>
      </div>
      {ids.length > 0 && can("alerts.manage") && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2 text-sm animate-in">
          <span className="font-medium">{ids.length} selected</span>
          <span className="mx-1 h-4 w-px bg-border-strong" />
          <Button size="sm" variant="secondary" leftIcon={<Check className="h-3.5 w-3.5" />} onClick={() => bulk("acknowledge", ids)}>Acknowledge</Button>
          <Button size="sm" variant="secondary" leftIcon={<CheckCheck className="h-3.5 w-3.5" />} onClick={() => bulk("resolve", ids)}>Resolve</Button>
          <Menu trigger={<Button size="sm" variant="secondary" leftIcon={<Clock className="h-3.5 w-3.5" />} rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>Snooze</Button>} align="start">{SNOOZE.map(([l, m]) => <MenuItem key={m} onSelect={() => bulk("snooze", ids, m)}>{l}</MenuItem>)}</Menu>
          <Button size="sm" variant="ghost" onClick={() => bulk("reopen", ids)}>Reopen</Button>
          <button type="button" className="ml-auto rounded p-1 text-fg-muted hover:text-fg focus-ring" onClick={() => setSelection({})} aria-label="Clear selection"><X className="h-4 w-4" /></button>
        </div>
      )}
      {!list.isLoading && list.total === 0 && !hasFilters ? (
        <EmptyState icon={<BellOff />} title="No active alerts" description="Monitors open alerts here when thresholds are crossed; acknowledging, snoozing and resolving all leave an audit trail." />
      ) : (
        <DataTable columns={columns} data={list.items} loading={list.isLoading} selectable rowSelection={selection} onRowSelectionChange={setSelection} getRowId={(a) => a.id} onRowClick={(a) => router.push(`/alerts/${a.id}`)} rowClassName={(a) => cn(a.severity === "critical" && a.status === "open" && "bg-danger-soft/20")} emptyMessage="No alerts match." pagination={{ page: list.page, pages: list.pages, total: list.total, pageSize: list.pageSize, onPageChange: list.setPage }} />
      )}
      <Bell className="hidden" />
    </>
  );
}
