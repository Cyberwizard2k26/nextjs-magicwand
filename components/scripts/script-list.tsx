"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { ColumnDef } from "@tanstack/react-table";
import { FileCode2, Play, Plus, Search, Star } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Pill } from "@/components/ui/misc";
import { PlatformChip } from "@/components/devices/device-bits";
import { relativeTime } from "@/lib/client/format";

export interface ScriptRow { id: string; orgId: string | null; name: string; description: string | null; language: string; platforms: string[]; category: string | null; tags: string[]; risk: string; requiresApproval: boolean; version: number; isBuiltin: boolean; isFavorite: boolean; updatedAt: string; parameters: unknown[] }
export const LANGUAGES = ["powershell", "bash", "sh", "zsh", "python", "cmd", "node", "applescript"];

export function ScriptList({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const [q, setQ] = React.useState("");
  const [language, setLanguage] = React.useState("");
  const [category, setCategory] = React.useState("");
  const { data, isLoading } = useSWR<{ items: ScriptRow[] }>("scripts");
  const items = (data?.items ?? []).filter((s) => (!q || `${s.name} ${s.description ?? ""} ${s.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())) && (!language || s.language === language) && (!category || s.category === category));
  const categories = [...new Set((data?.items ?? []).map((s) => s.category).filter(Boolean))] as string[];
  const columns: ColumnDef<ScriptRow, unknown>[] = [
    { accessorKey: "name", header: "Script", cell: ({ row }) => <div className="flex min-w-0 items-center gap-2.5"><FileCode2 className="h-4 w-4 shrink-0 text-fg-subtle" /><div className="min-w-0"><div className="flex items-center gap-1.5"><span className="truncate font-medium text-fg">{row.original.name}</span>{row.original.isFavorite && <Star className="h-3 w-3 fill-warning text-warning" />}{row.original.isBuiltin && <Badge tone="outline" size="xs">built-in</Badge>}</div>{row.original.description && <div className="truncate text-xs text-fg-muted">{row.original.description}</div>}</div></div> },
    { accessorKey: "language", header: "Language", size: 110, cell: ({ getValue }) => <Badge tone="accent" size="xs">{getValue() as string}</Badge> },
    { accessorKey: "platforms", header: "Platforms", size: 130, enableSorting: false, cell: ({ getValue }) => { const p = getValue() as string[]; return p.length ? <span className="flex gap-1">{p.map((x) => <PlatformChip key={x} platform={x} />)}</span> : <span className="text-xs text-fg-subtle">any</span>; } },
    { accessorKey: "risk", header: "Risk", size: 90, cell: ({ row }) => <Badge tone={row.original.risk === "high" ? "danger" : row.original.risk === "medium" ? "warning" : "success"} size="xs" className="capitalize">{row.original.risk}{row.original.requiresApproval ? " · approval" : ""}</Badge> },
    { accessorKey: "category", header: "Category", size: 130, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{(getValue() as string) || "—"}</span> },
    { id: "params", header: "Params", size: 70, enableSorting: false, cell: ({ row }) => <span className="tabular text-xs text-fg-muted">{row.original.parameters.length || "—"}</span> },
    { accessorKey: "version", header: "Ver", size: 60, cell: ({ getValue }) => <span className="mono text-xs text-fg-muted">v{getValue() as number}</span> },
    { accessorKey: "updatedAt", header: "Updated", size: 110, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{relativeTime(getValue() as string)}</span> },
    { id: "run", header: "", size: 80, enableSorting: false, cell: ({ row }) => can("scripts.run") ? <Button size="xs" variant="secondary" leftIcon={<Play className="h-3 w-3" />} onClick={(e) => { e.stopPropagation(); router.push(`/jobs/new?script=${row.original.id}`); }}>Run</Button> : null },
  ];
  return (
    <>
      <PageHeader title="Scripts" description="Versioned, parameterized, risk-classified. Run from here, from a device, or from automations." actions={can("scripts.manage") && <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => router.push("/scripts/new")}>New script</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scripts…" leftIcon={<Search />} className="sm:w-72" />
        <Select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-auto min-w-[130px]" aria-label="Language"><option value="">All languages</option>{LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}</Select>
        {categories.length > 0 && <div className="flex flex-wrap gap-1">{categories.map((c) => <Pill key={c} active={category === c} onClick={() => setCategory(category === c ? "" : c)}>{c}</Pill>)}</div>}
      </div>
      {!isLoading && !data?.items.length ? (
        <EmptyState icon={<FileCode2 />} title="Your library is empty" description="Add your first PowerShell or bash script. Parameters become form fields, versions are kept, and every run is a tracked job." action={can("scripts.manage") ? <Button onClick={() => router.push("/scripts/new")} leftIcon={<Plus className="h-4 w-4" />}>New script</Button> : undefined} />
      ) : (
        <DataTable columns={columns} data={items} loading={isLoading} onRowClick={(s) => router.push(`/scripts/${s.id}`)} emptyMessage="No scripts match." />
      )}
    </>
  );
}
