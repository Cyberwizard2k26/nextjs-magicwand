"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, Download, Laptop, Loader2, RefreshCw, RotateCcw, Search, ShieldAlert, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge, severityTone, type BadgeTone } from "@/components/ui/badge";
import { Input, Switch } from "@/components/ui/input";
import { ConfirmDialog, Sheet } from "@/components/ui/dialog";
import { EmptyState, PageHeader, Pill, Stat } from "@/components/ui/misc";
import { usePaginated, useUrlState } from "@/lib/client/hooks";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import { PlatformChip, StatusDotLive } from "@/components/devices/device-bits";

interface Row { externalId: string; title: string; source: string; category: string; severity: string; kb: string | null; version: string | null; devices: number; failed: number; rebootRequired: boolean; firstSeenAt: string }
interface Summary { devices: number; scanned: number; pendingReboot: number; missingAny: number; missingSecurity: number; failed: number; compliant: number; outstanding: number; outstandingSecurity: number }
interface MissingDevice { deviceId: string; status: string; lastError: string | null; deviceName: string | null; platform: string | null; deviceStatus: string | null }
type Filters = { status: string; severity: string; category: string; q: string };
const DEFAULTS: Filters = { status: "outstanding", severity: "", category: "", q: "" };
const STATUS_SETS: Record<string, string[] | undefined> = { outstanding: undefined, failed: ["failed"], reboot: ["pending_reboot"], approved: ["approved"] };
const sevTone = (s: string) => severityTone(s === "important" ? "high" : s === "moderate" ? "medium" : s);
const errMsg = (err: unknown) => (err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : "Request failed");

export function FleetPatches({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const canDeploy = can("patches.manage") && can("jobs.manage");
  const [f, setF] = useUrlState(DEFAULTS);
  const params = React.useMemo(() => ({ summary: true, status: STATUS_SETS[f.status]?.join(","), severity: f.severity || undefined, category: f.category || undefined, q: f.q || undefined }), [f.status, f.severity, f.category, f.q]);
  const list = usePaginated<Row>("patches", params, { pageSize: 50, refreshInterval: 60_000 });
  const summary = (list.data as (typeof list.data & { summary?: Summary }) | undefined)?.summary;
  useRealtime(["patches.*", "job.run.updated", "device.inventory"], () => list.mutate());
  const [drill, setDrill] = React.useState<Row | null>(null);
  const [confirm, setConfirm] = React.useState<null | { kind: "scan_all" } | { kind: "install_all" } | { kind: "install_one"; row: Row; devices: MissingDevice[] }>(null);
  const [canary, setCanary] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  async function createJob(body: Record<string, unknown>, label: string) {
    setBusy(true);
    try {
      const r = await api.post<{ job: { id: string }; runs: unknown[]; rollout?: { id: string } | null }>("jobs", body);
      toast.success(`${label} queued for ${r.runs.length} device${r.runs.length === 1 ? "" : "s"}${r.rollout ? " (canary first)" : ""}`, { action: { label: "View job", onClick: () => router.push(`/jobs/${r.job.id}`) } });
      setConfirm(null);
      setDrill(null);
      list.mutate();
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  }
  const canaryFor = (count: number) => (canary && count >= 5 ? { count: Math.max(1, Math.min(5, Math.floor(count * 0.1) || 1)), autoPromote: true } : undefined);

  const maxDevices = Math.max(1, ...list.items.map((r) => r.devices));
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: "severity", header: "Severity", size: 100, cell: ({ getValue }) => <Badge tone={sevTone(getValue() as string)} size="xs" className="w-[72px] justify-center capitalize">{getValue() as string}</Badge> },
    { accessorKey: "title", header: "Update", cell: ({ row }) => <div className="min-w-0 max-w-[44vw]"><div className="truncate font-medium text-fg" title={row.original.title}>{row.original.title}</div><div className="truncate text-[11px] text-fg-subtle">{[row.original.kb, row.original.category, row.original.source.replace(/_/g, " "), row.original.version].filter(Boolean).join(" · ")}</div></div> },
    { accessorKey: "devices", header: "Devices missing", size: 190, cell: ({ row }) => <div className="flex items-center gap-2"><span className="w-7 text-right tabular text-sm text-fg">{row.original.devices}</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-accent/70" style={{ width: `${Math.max(4, (row.original.devices / maxDevices) * 100)}%` }} /></span></div> },
    { accessorKey: "failed", header: "Failed", size: 80, cell: ({ getValue }) => (getValue() as number) > 0 ? <Badge tone="danger" size="xs">{getValue() as number}</Badge> : <span className="text-xs text-fg-subtle">—</span> },
    { accessorKey: "rebootRequired", header: "Reboot", size: 80, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{getValue() ? "needed" : "no"}</span> },
    { accessorKey: "firstSeenAt", header: "First seen", size: 110, cell: ({ getValue }) => <span className="whitespace-nowrap text-xs text-fg-muted" title={formatDateTime(getValue() as string)}>{relativeTime(getValue() as string)}</span> },
    ...(canDeploy ? [{ id: "actions", header: "", size: 110, enableSorting: false, cell: ({ row }) => <Button size="xs" variant="secondary" leftIcon={<Download className="h-3 w-3" />} onClick={async (e) => { e.stopPropagation(); try { const r = await api.get<{ items: MissingDevice[] }>("patches", { externalId: row.original.externalId }); setConfirm({ kind: "install_one", row: row.original, devices: r.items }); } catch (err) { toast.error(errMsg(err)); } }}>Install</Button> } satisfies ColumnDef<Row, unknown>] : []),
  ];
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

  return (
    <>
      <PageHeader title="Patching" description="Missing OS updates across the fleet, grouped by update. Windows Update, apt/dnf/zypper and macOS softwareupdate are all normalised here."
        actions={canDeploy ? <div className="flex flex-wrap gap-2"><Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => setConfirm({ kind: "scan_all" })}>Scan all devices</Button><Button leftIcon={<Download className="h-4 w-4" />} onClick={() => setConfirm({ kind: "install_all" })} disabled={!summary?.outstanding}>Install all outstanding</Button></div> : undefined} />
      {summary && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5 [&>*]:min-w-0">
          <Stat label="Compliant devices" value={`${pct(summary.compliant, summary.scanned)}%`} hint={`${summary.compliant} of ${summary.scanned} scanned${summary.devices > summary.scanned ? ` · ${summary.devices - summary.scanned} never scanned` : ""}`} icon={<CheckCircle2 />} tone={pct(summary.compliant, summary.scanned) >= 90 ? "success" : pct(summary.compliant, summary.scanned) >= 70 ? "warning" : "danger"} />
          <Stat label="Missing security updates" value={summary.missingSecurity} hint={`${summary.outstandingSecurity} update${summary.outstandingSecurity === 1 ? "" : "s"} in total`} icon={<ShieldAlert />} tone={summary.missingSecurity ? "danger" : "success"} />
          <Stat label="Outstanding updates" value={summary.outstanding} hint={`on ${summary.missingAny} device${summary.missingAny === 1 ? "" : "s"}`} icon={<Download />} tone="accent" />
          <Stat label="Failed installs" value={summary.failed} hint="devices with at least one failure" icon={<AlertTriangle />} tone={summary.failed ? "danger" : "success"} />
          <Stat label="Reboot pending" value={summary.pendingReboot} hint="updates applied, restart outstanding" icon={<RotateCcw />} tone={summary.pendingReboot ? "warning" : "success"} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Input value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Search title, KB or id…" leftIcon={<Search />} className="sm:w-64" />
        {([["outstanding", "Outstanding"], ["failed", "Failed"], ["reboot", "Reboot pending"], ["approved", "Approved"]] as const).map(([v, l]) => <Pill key={v} active={f.status === v} onClick={() => setF({ status: v })}>{l}</Pill>)}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        {(["critical", "important", "moderate", "low"] as const).map((s) => <Pill key={s} active={f.severity === s} onClick={() => setF({ severity: f.severity === s ? "" : s })} className="capitalize">{s}</Pill>)}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        {(["security", "feature", "driver", "definition", "application"] as const).map((c) => <Pill key={c} active={f.category === c} onClick={() => setF({ category: f.category === c ? "" : c })} className="capitalize">{c}</Pill>)}
        {(f.severity || f.category || f.q || f.status !== "outstanding") && <Pill onClick={() => setF(DEFAULTS)}>Reset <X className="ml-1 inline h-3 w-3" /></Pill>}
      </div>
      {!list.isLoading && list.total === 0 ? (
        <EmptyState icon={summary?.scanned ? <CheckCircle2 /> : <Download />} title={summary?.scanned ? (f.status === "outstanding" && !f.q && !f.severity && !f.category ? "Fleet is fully patched" : "Nothing matches") : "No patch scans yet"} description={summary?.scanned ? "Every scanned device reports no outstanding updates in this view." : "Run a scan to see missing updates. Agents also scan on their own schedule once patching is enabled."} action={canDeploy && !summary?.scanned ? <Button leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => setConfirm({ kind: "scan_all" })}>Scan all devices</Button> : undefined} />
      ) : (
        <DataTable columns={columns} data={list.items} loading={list.isLoading} dense onRowClick={(r) => setDrill(r)} emptyMessage="Nothing matches." pagination={{ page: list.page, pages: list.pages, total: list.total, pageSize: list.pageSize, onPageChange: list.setPage }} />
      )}

      <DrillSheet row={drill} onClose={() => setDrill(null)} canDeploy={canDeploy} onInstall={(row, devices) => setConfirm({ kind: "install_one", row, devices })} />

      <ConfirmDialog open={confirm?.kind === "scan_all"} onOpenChange={(o) => !o && setConfirm(null)} title="Scan every device for updates?" description="Queues a patch scan job for all devices in your scope. Offline devices scan when they next connect. Scans are read-only." confirmLabel="Scan all" tone="primary" loading={busy} onConfirm={() => createJob({ type: "patch_scan", targetType: "org", targetIds: [], payload: {}, runWhenOnline: true, concurrency: 50 }, "Patch scan")} />
      <ConfirmDialog open={confirm?.kind === "install_all"} onOpenChange={(o) => !o && setConfirm(null)} title="Install all outstanding updates everywhere?" confirmLabel="Install all" tone="primary" loading={busy}
        description={<div className="space-y-3"><p>Every device installs everything it is missing, as one tracked job. Devices that need a reboot are flagged, not rebooted.</p><Switch checked={canary} onCheckedChange={setCanary} label="Canary first: a small wave runs first and the rest wait for a clean result" /></div>}
        onConfirm={() => createJob({ type: "patch_install", targetType: "org", targetIds: [], payload: { all: true }, runWhenOnline: true, concurrency: 20, canary: canaryFor(summary?.missingAny ?? 0) }, "Install all updates")} />
      <ConfirmDialog open={confirm?.kind === "install_one"} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.kind === "install_one" ? `Install on ${confirm.devices.length} device${confirm.devices.length === 1 ? "" : "s"}?` : ""} confirmLabel="Install" tone="primary" loading={busy}
        description={confirm?.kind === "install_one" ? <div className="space-y-3"><p className="truncate font-medium text-fg" title={confirm.row.title}>{confirm.row.title}</p><p>Targets only the devices still missing this update. Offline devices install when they reconnect.{confirm.row.rebootRequired ? " A reboot is needed afterwards; devices are flagged, not rebooted." : ""}</p>{confirm.devices.length >= 5 && <Switch checked={canary} onCheckedChange={setCanary} label="Canary first" />}</div> : undefined}
        onConfirm={async () => { if (confirm?.kind === "install_one") await createJob({ type: "patch_install", targetType: "device", targetIds: confirm.devices.map((d) => d.deviceId), payload: { externalIds: [confirm.row.externalId] }, runWhenOnline: true, canary: canaryFor(confirm.devices.length) }, `Install ${confirm.row.kb ?? confirm.row.title.slice(0, 40)}`); }} />
    </>
  );
}

const DEV_STATUS_TONE: Record<string, BadgeTone> = { available: "warning", failed: "danger", pending_reboot: "info", approved: "info", installing: "info", scheduled: "info" };

function DrillSheet({ row, onClose, canDeploy, onInstall }: { row: Row | null; onClose: () => void; canDeploy: boolean; onInstall: (row: Row, devices: MissingDevice[]) => void }) {
  const [devices, setDevices] = React.useState<MissingDevice[] | null>(null);
  const externalId = row?.externalId ?? null;
  React.useEffect(() => {
    if (!externalId) return;
    let alive = true;
    setDevices(null);
    api.get<{ items: MissingDevice[] }>("patches", { externalId }).then((r) => { if (alive) setDevices(r.items); }).catch(() => { if (alive) setDevices([]); });
    return () => { alive = false; };
  }, [externalId]);
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()} title={row?.title} description={row ? [row.kb, row.category, row.source.replace(/_/g, " "), row.version, `first seen ${relativeTime(row.firstSeenAt)}`].filter(Boolean).join(" · ") : undefined}
      footer={canDeploy && row && devices?.length ? <Button leftIcon={<Download className="h-4 w-4" />} onClick={() => onInstall(row, devices)}>Install on {devices.length} device{devices.length === 1 ? "" : "s"}</Button> : undefined}>
      {!devices ? <div className="flex items-center gap-2 py-8 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading devices…</div> : !devices.length ? <EmptyState icon={<Laptop />} title="No devices missing this update" /> : (
        <ul className="divide-y divide-border/70 rounded-lg border border-border">
          {devices.map((d) => (
            <li key={d.deviceId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <StatusDotLive status={d.deviceStatus ?? "offline"} />
              <Link href={`/devices/${d.deviceId}/patches`} className="min-w-0 flex-1 truncate font-medium hover:text-accent-hover">{d.deviceName ?? d.deviceId}</Link>
              {d.platform && <PlatformChip platform={d.platform} />}
              <Badge tone={DEV_STATUS_TONE[d.status] ?? "neutral"} size="xs" dot title={d.lastError ?? undefined}>{d.status.replace(/_/g, " ")}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
