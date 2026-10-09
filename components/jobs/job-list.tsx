"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Play, Plus, Search, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Pill } from "@/components/ui/misc";
import { usePaginated, useUrlState } from "@/lib/client/hooks";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, formatDuration, relativeTime } from "@/lib/client/format";
import { JobProgress, JobStatusBadge, jobTypeLabel, JOB_TYPE_LABEL, type JobRow } from "./job-bits";

type Filters = { status: string; type: string; q: string };
const DEFAULTS: Filters = { status: "", type: "", q: "" };
const STATUS_PILLS = [["", "All"], ["running,queued", "Active"], ["awaiting_approval", "Awaiting approval"], ["completed", "Completed"], ["partial,failed", "Problems"], ["cancelled", "Cancelled"]] as const;

export function JobList({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const [f, setF] = useUrlState(DEFAULTS);
  const params = React.useMemo(() => ({ status: f.status || undefined, type: f.type || undefined }), [f.status, f.type]);
  const list = usePaginated<JobRow>("jobs", params, { pageSize: 50 });
  React.useEffect(() => { list.setQ(f.q); }, [f.q]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime(["job.*"], () => list.mutate());

  async function act(job: JobRow, action: "approve" | "cancel") {
    try { await api.post(`jobs/${job.id}/${action}`); toast.success(action === "approve" ? "Job approved" : "Job cancelled"); list.mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Failed"); }
  }

  const columns: ColumnDef<JobRow, unknown>[] = [
    { accessorKey: "name", header: "Job", cell: ({ row }) => <div className="min-w-0"><Link href={`/jobs/${row.original.id}`} className="block truncate font-medium text-fg hover:text-accent-hover" onClick={(e) => e.stopPropagation()}>{row.original.name}</Link><div className="flex items-center gap-1.5 text-[11px] text-fg-subtle"><span>{jobTypeLabel(row.original.type)}</span><span>·</span><span>{row.original.targetType === "device" ? `${row.original.stats.total} device${row.original.stats.total === 1 ? "" : "s"}` : `${row.original.targetType}${row.original.targetIds.length ? ` · ${row.original.stats.total} devices` : ""}`}</span>{row.original.source !== "manual" && <><span>·</span><span>{row.original.source}</span></>}</div></div> },
    { accessorKey: "status", header: "Status", size: 160, cell: ({ row }) => <JobStatusBadge status={row.original.status} /> },
    { id: "progress", header: "Progress", size: 220, enableSorting: false, cell: ({ row }) => <JobProgress stats={row.original.stats} /> },
    { accessorKey: "createdByName", header: "By", size: 150, cell: ({ getValue }) => <span className="truncate text-xs text-fg-muted">{(getValue() as string) || "system"}</span> },
    { accessorKey: "createdAt", header: "Created", size: 120, cell: ({ row }) => <span className="text-xs text-fg-muted" title={formatDateTime(row.original.createdAt)}>{row.original.scheduledAt && new Date(row.original.scheduledAt) > new Date() ? `scheduled ${relativeTime(row.original.scheduledAt)}` : relativeTime(row.original.createdAt)}</span> },
    { id: "duration", header: "Duration", size: 90, enableSorting: false, cell: ({ row }) => { const j = row.original; const end = j.completedAt ? new Date(j.completedAt).getTime() : null; const start = j.startedAt ? new Date(j.startedAt).getTime() : null; return <span className="text-xs text-fg-muted">{start && end ? formatDuration((end - start) / 1000) : start ? "running" : "—"}</span>; } },
    { id: "actions", header: "", size: 120, enableSorting: false, cell: ({ row }) => { const j = row.original; if (!can("jobs.manage")) return null; return <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>{j.status === "awaiting_approval" && <Button size="xs" variant="success" leftIcon={<Check className="h-3 w-3" />} onClick={() => act(j, "approve")}>Approve</Button>}{["queued", "running", "awaiting_approval"].includes(j.status) && <Button size="xs" variant="ghost" leftIcon={<X className="h-3 w-3" />} onClick={() => act(j, "cancel")}>Cancel</Button>}</span>; } },
  ];
  const hasFilters = !!(f.status || f.type || f.q);

  return (
    <>
      <PageHeader title="Jobs" description="Every command, script and action - durable, offline-capable and auditable." actions={can("jobs.manage") && <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => router.push("/jobs/new")}>New job</Button>} />
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Search jobs…" leftIcon={<Search />} className="sm:w-72" />
          <Select value={f.type} onChange={(e) => setF({ type: e.target.value })} className="w-auto min-w-[150px]" aria-label="Type"><option value="">All types</option>{Object.entries(JOB_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          {hasFilters && <Button variant="ghost" size="sm" onClick={() => setF({ ...DEFAULTS })}>Clear</Button>}
        </div>
        <div className="flex flex-wrap gap-1.5">{STATUS_PILLS.map(([v, l]) => <Pill key={v} active={f.status === v} onClick={() => setF({ status: v })}>{l}</Pill>)}</div>
      </div>
      {!list.isLoading && list.total === 0 && !hasFilters ? (
        <EmptyState icon={<Play />} title="No jobs yet" description="Run a command, a script or a reboot on one device or your whole fleet. Jobs queue for offline devices and keep their output forever." action={can("jobs.manage") ? <Button onClick={() => router.push("/jobs/new")} leftIcon={<Plus className="h-4 w-4" />}>Create the first job</Button> : undefined} />
      ) : (
        <DataTable columns={columns} data={list.items} loading={list.isLoading} onRowClick={(j) => router.push(`/jobs/${j.id}`)} emptyMessage="No jobs match." pagination={{ page: list.page, pages: list.pages, total: list.total, pageSize: list.pageSize, onPageChange: list.setPage }} />
      )}
      <Badge className="hidden" />
    </>
  );
}
