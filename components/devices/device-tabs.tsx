"use client";
import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import type { ColumnDef } from "@tanstack/react-table";
import { Bell, CheckCircle2, CircleX, History, Package, Play, Search, ShieldAlert, ShieldCheck, Users, Wrench, XCircle, type LucideIcon } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Badge, severityTone, statusTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Pill, Progress, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useRealtime } from "@/components/shell/realtime-provider";
import { useDebounce } from "@/lib/client/hooks";
import { formatBytes, formatDateTime, formatMs, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { useDevice } from "./device-context";

/* ------------------------------------------------------------------ Software */
interface SoftwareRow { id: string; name: string; version: string | null; publisher: string | null; installDate: string | null; source: string; sizeBytes: number | null; isSystemComponent: boolean; firstSeenAt: string }

export function DeviceSoftware() {
  const { data } = useDevice();
  const [q, setQ] = React.useState("");
  const [system, setSystem] = React.useState(false);
  const dq = useDebounce(q, 200);
  const { data: sw, isLoading } = useSWR<{ items: SoftwareRow[] }>([`devices/${data.device.id}/software`, { q: dq || undefined }]);
  const items = (sw?.items ?? []).filter((s) => system || !s.isSystemComponent);
  const columns: ColumnDef<SoftwareRow, unknown>[] = [
    { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium text-fg">{row.original.name}</span> },
    { accessorKey: "version", header: "Version", size: 140, cell: ({ getValue }) => <span className="mono text-xs text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "publisher", header: "Publisher", size: 200, cell: ({ getValue }) => <span className="truncate text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "installDate", header: "Installed", size: 120, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "source", header: "Source", size: 90, cell: ({ getValue }) => <Badge tone="outline" size="xs">{getValue() as string}</Badge> },
    { accessorKey: "sizeBytes", header: "Size", size: 90, cell: ({ getValue }) => <span className="tabular text-xs text-fg-muted">{getValue() ? formatBytes(getValue() as number, 0) : "—"}</span> },
    { accessorKey: "firstSeenAt", header: "First seen", size: 110, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{relativeTime(getValue() as string)}</span> },
  ];
  return (
    <TabFrame icon={Package} title="Installed software" count={items.length} toolbar={<><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or publisher…" leftIcon={<Search />} className="sm:w-72" /><Pill active={system} onClick={() => setSystem((s) => !s)}>Show system components</Pill></>}>
      <DataTable columns={columns} data={items} loading={isLoading} dense emptyMessage={data.device.lastInventoryAt ? "No software matches." : "Software inventory has not been collected yet."} />
    </TabFrame>
  );
}

/* ------------------------------------------------------------------ Services */
interface ServiceRow { id: string; name: string; displayName: string | null; status: string; startType: string; account: string | null; pid: number | null; path: string | null; description: string | null }

export function DeviceServices() {
  const { data } = useDevice();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "running" | "stopped" | "auto_stopped">("all");
  const { data: res, isLoading } = useSWR<{ items: ServiceRow[] }>(`devices/${data.device.id}/services`);
  const items = (res?.items ?? []).filter((s) => {
    if (filter === "running" && s.status !== "running") return false;
    if (filter === "stopped" && s.status === "running") return false;
    if (filter === "auto_stopped" && !(s.startType === "auto" && s.status !== "running")) return false;
    if (q && !`${s.displayName ?? ""} ${s.name} ${s.description ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const autoStopped = (res?.items ?? []).filter((s) => s.startType === "auto" && s.status !== "running").length;
  const columns: ColumnDef<ServiceRow, unknown>[] = [
    { accessorKey: "displayName", header: "Service", cell: ({ row }) => <div className="min-w-0"><div className="truncate font-medium text-fg">{row.original.displayName || row.original.name}</div>{row.original.displayName && <div className="mono truncate text-[11px] text-fg-subtle">{row.original.name}</div>}</div> },
    { accessorKey: "status", header: "Status", size: 110, cell: ({ getValue }) => <Badge tone={statusTone(getValue() as string) === "success" ? "success" : (getValue() as string) === "stopped" ? "neutral" : "warning"} size="xs" dot>{getValue() as string}</Badge> },
    { accessorKey: "startType", header: "Start", size: 90, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{getValue() as string}</span> },
    { accessorKey: "account", header: "Account", size: 160, cell: ({ getValue }) => <span className="truncate text-xs text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "pid", header: "PID", size: 70, cell: ({ getValue }) => <span className="mono text-xs text-fg-muted">{(getValue() as number) || "—"}</span> },
    { accessorKey: "path", header: "Path", size: 320, cell: ({ getValue }) => <span className="mono block truncate text-[11px] text-fg-subtle" title={getValue() as string}>{(getValue() as string) || "—"}</span> },
  ];
  return (
    <TabFrame icon={Wrench} title="Services" count={items.length} toolbar={<>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services…" leftIcon={<Search />} className="sm:w-72" />
      {([["all", "All"], ["running", "Running"], ["stopped", "Stopped"], ["auto_stopped", `Automatic but stopped${autoStopped ? ` (${autoStopped})` : ""}`]] as const).map(([v, l]) => <Pill key={v} active={filter === v} onClick={() => setFilter(v)}>{l}</Pill>)}
    </>}>
      {autoStopped > 0 && filter === "all" && <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning"><ShieldAlert className="h-4 w-4" />{autoStopped} service{autoStopped === 1 ? " is" : "s are"} set to start automatically but not running. <button type="button" className="underline" onClick={() => setFilter("auto_stopped")}>Show</button></div>}
      <DataTable columns={columns} data={items} loading={isLoading} dense emptyMessage="No services reported." />
    </TabFrame>
  );
}

/* ------------------------------------------------------------------ Users */
interface UserRow { id: string; username: string; fullName: string | null; isAdmin: boolean; enabled: boolean; passwordExpires: boolean; lastLogonAt: string | null; uid: string | null; managed: boolean }

export function DeviceUsers() {
  const { data } = useDevice();
  const { data: res, isLoading } = useSWR<{ items: UserRow[] }>(`devices/${data.device.id}/users`);
  const items = res?.items ?? [];
  const columns: ColumnDef<UserRow, unknown>[] = [
    { accessorKey: "username", header: "Account", cell: ({ row }) => <div className="flex items-center gap-2"><span className="font-medium text-fg">{row.original.username}</span>{row.original.isAdmin && <Badge tone="warning" size="xs">admin</Badge>}{row.original.managed && <Badge tone="accent" size="xs">rotated</Badge>}{data.device.loggedInUsers?.some((u) => u.user.toLowerCase().endsWith(row.original.username.toLowerCase())) && <Badge tone="success" size="xs" dot>signed in</Badge>}</div> },
    { accessorKey: "fullName", header: "Full name", size: 200, cell: ({ getValue }) => <span className="text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "enabled", header: "Enabled", size: 90, cell: ({ getValue }) => (getValue() ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-fg-subtle" />) },
    { accessorKey: "passwordExpires", header: "Password expires", size: 140, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{getValue() ? "yes" : "never"}</span> },
    { accessorKey: "lastLogonAt", header: "Last logon", size: 140, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{getValue() ? relativeTime(getValue() as string) : "—"}</span> },
  ];
  return (
    <TabFrame icon={Users} title="Local users" count={items.length}>
      <DataTable columns={columns} data={items} loading={isLoading} dense emptyMessage="No local accounts reported." />
    </TabFrame>
  );
}

/* ------------------------------------------------------------------ Security */
export function DeviceSecurity() {
  const { data } = useDevice();
  const sec = data.security;
  const p = (sec?.posture ?? {}) as Record<string, unknown> & { antivirus?: { name: string; enabled: boolean; upToDate: boolean; realtime?: boolean; lastScanAt?: string }[]; firewall?: { enabled: boolean; profiles?: Record<string, boolean> }; diskEncryption?: { volume: string; encrypted: boolean; method?: string; percent?: number }[]; localAdmins?: string[]; openPorts?: { port: number; proto: string; process?: string }[]; edr?: { name: string; status: string }[] };
  if (!sec) return <EmptyState icon={<ShieldCheck />} title="No security posture yet" description="The agent reports antivirus, firewall, encryption and hardening state with its inventory. Refresh the inventory from the Actions menu to collect it now." />;
  type State = "good" | "bad" | "unknown";
  const bool = (v: unknown): State => (v === true ? "good" : v === false ? "bad" : "unknown");
  const tri = (v: unknown, badWhenTrue: boolean): State => (v === undefined || v === null ? "unknown" : (v === true) === badWhenTrue ? "bad" : "good");
  const checks: { label: string; state: State; detail?: string }[] = ([
    { label: "Antivirus", state: p.antivirus?.length ? (p.antivirus.some((a) => a.enabled) ? "good" : "bad") : "unknown", detail: p.antivirus?.map((a) => `${a.name}${a.upToDate ? "" : " (definitions outdated)"}`).join(", ") },
    { label: "Firewall", state: bool(p.firewall?.enabled), detail: p.firewall?.profiles ? Object.entries(p.firewall.profiles).map(([k, v]) => `${k}: ${v ? "on" : "off"}`).join(" · ") : undefined },
    { label: "Disk encryption", state: p.diskEncryption?.length ? (p.diskEncryption.every((v) => v.encrypted) ? "good" : "bad") : "unknown", detail: p.diskEncryption?.map((v) => `${v.volume} ${v.encrypted ? `encrypted${v.method ? ` (${v.method})` : ""}` : "not encrypted"}`).join(" · ") },
    { label: "Secure Boot", state: bool(p.secureBoot) },
    { label: "TPM", state: bool(p.tpmEnabled) },
    { label: "UAC", state: bool(p.uacEnabled) },
    { label: "Automatic updates", state: bool(p.autoUpdateEnabled) },
    { label: "Screen lock", state: p.screenLockMinutes === undefined || p.screenLockMinutes === null ? "unknown" : p.screenLockMinutes ? "good" : "bad", detail: p.screenLockMinutes ? `after ${p.screenLockMinutes} min` : undefined },
    { label: "Remote Desktop", state: tri(p.remoteDesktopEnabled, true), detail: p.remoteDesktopEnabled ? "enabled - exposure" : "disabled" },
    { label: "SMBv1", state: tri(p.smbV1Enabled, true), detail: p.smbV1Enabled ? "enabled - legacy protocol" : "disabled" },
    { label: "Guest account", state: tri(p.guestAccountEnabled, true) },
    { label: "Gatekeeper", state: bool(p.gatekeeper) },
    { label: "System Integrity Protection", state: bool(p.sip) },
    { label: "SSH root login", state: tri(p.sshRootLogin, true) },
    { label: "OS supported", state: bool(p.osSupported) },
  ] as { label: string; state: State; detail?: string }[]).filter((c) => c.state !== "unknown");
  const good = checks.filter((c) => c.state === "good").length;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader title="Posture checks" description={`${good} of ${checks.length} passing · updated ${relativeTime(sec.updatedAt)}`} actions={sec.score !== null ? <Badge tone={sec.score >= 80 ? "success" : sec.score >= 60 ? "warning" : "danger"} size="md">{sec.score} / 100</Badge> : undefined} />
          <CardBody>
            <Progress value={checks.length ? (good / checks.length) * 100 : 0} tone={good === checks.length ? "success" : "warning"} className="mb-4" />
            <ul className="grid gap-2 sm:grid-cols-2">
              {checks.map((c) => (
                <li key={c.label} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2", c.state === "good" ? "border-border bg-surface-2/50" : "border-danger/30 bg-danger-soft/40")}>
                  {c.state === "good" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
                  <div className="min-w-0"><div className="text-sm font-medium text-fg">{c.label}</div>{c.detail && <div className="truncate text-xs text-fg-muted" title={c.detail}>{c.detail}</div>}</div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Findings" description={sec.findings.length ? `${sec.findings.length} open` : "None"} />
            <CardBody className="px-0 pb-2">
              {!sec.findings.length ? <p className="px-5 pb-3 text-sm text-fg-muted">No findings. Nice.</p> : (
                <ul className="divide-y divide-border/70">{sec.findings.map((f) => <li key={f.id} className="flex items-start gap-3 px-5 py-2.5"><Badge tone={severityTone(f.severity)} size="xs" className="mt-0.5 w-[60px] justify-center capitalize">{f.severity}</Badge><div className="min-w-0"><div className="text-sm text-fg">{f.title}</div>{f.detail && <div className="text-xs text-fg-muted">{f.detail}</div>}</div></li>)}</ul>
              )}
            </CardBody>
          </Card>
          {!!p.localAdmins?.length && <Card><CardHeader title="Local administrators" description={`${p.localAdmins.length} accounts`} /><CardBody><ul className="flex flex-wrap gap-1.5">{p.localAdmins.map((a) => <li key={a} className="mono rounded bg-surface-3 px-2 py-0.5 text-xs">{a}</li>)}</ul></CardBody></Card>}
          {!!p.openPorts?.length && <Card><CardHeader title="Listening ports" description={`${p.openPorts.length} open`} /><CardBody className="px-0 pb-2"><table className="w-full text-xs"><tbody>{p.openPorts.slice(0, 20).map((o, i) => <tr key={i} className="border-t border-border/60 first:border-0"><td className="mono px-5 py-1.5 text-fg">{o.proto}/{o.port}</td><td className="truncate px-5 py-1.5 text-right text-fg-muted">{o.process ?? ""}</td></tr>)}</tbody></table></CardBody></Card>}
          {!!p.edr?.length && <Card><CardHeader title="EDR" /><CardBody><ul className="space-y-1 text-sm">{p.edr.map((e) => <li key={e.name} className="flex justify-between"><span>{e.name}</span><span className="text-fg-muted">{e.status}</span></li>)}</ul></CardBody></Card>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Timeline */
interface TimelineEntry { id: string; ts: string; kind: "event" | "software" | "job" | "alert"; severity: "info" | "warning" | "error" | "critical"; title: string; detail?: string | null; href?: string; data?: Record<string, unknown> }
const KIND_ICON: Record<TimelineEntry["kind"], LucideIcon> = { event: History, software: Package, job: Play, alert: Bell };
const SEV_CLS: Record<TimelineEntry["severity"], string> = { info: "border-border bg-surface-2 text-fg-muted", warning: "border-warning/40 bg-warning-soft text-warning", error: "border-danger/40 bg-danger-soft text-danger", critical: "border-critical/50 bg-danger-soft text-critical" };

export function DeviceTimeline() {
  const { data } = useDevice();
  const [kinds, setKinds] = React.useState<Set<TimelineEntry["kind"]>>(new Set(["event", "software", "job", "alert"]));
  const [pages, setPages] = React.useState<TimelineEntry[][]>([]);
  const { data: first, isLoading, mutate } = useSWR<{ items: TimelineEntry[] }>([`devices/${data.device.id}/timeline`, { limit: 60 }]);
  useRealtime(["device.event", "job.run.updated", "alert.*", "software.*", "device.online", "device.offline"], (ev) => { if (ev.deviceId === data.device.id) mutate(); }, [`device:${data.device.id}`]);
  const all = [...(first?.items ?? []), ...pages.flat()];
  const items = all.filter((e) => kinds.has(e.kind));
  const [loadingMore, setLoadingMore] = React.useState(false);
  async function more() {
    const last = all[all.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const { api } = await import("@/lib/client/api");
      const r = await api.get<{ items: TimelineEntry[] }>(`devices/${data.device.id}/timeline`, { limit: 60, before: last.ts });
      setPages((p) => [...p, r.items]);
    } finally { setLoadingMore(false); }
  }
  const toggle = (k: TimelineEntry["kind"]) => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  let lastDay = "";
  return (
    <TabFrame icon={History} title="Timeline" count={items.length} toolbar={(["event", "software", "job", "alert"] as const).map((k) => <Pill key={k} active={kinds.has(k)} onClick={() => toggle(k)} className="capitalize">{k === "event" ? "Events" : k === "software" ? "Software changes" : k === "job" ? "Jobs" : "Alerts"}</Pill>)}>
      {isLoading ? <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div> : !items.length ? <EmptyState icon={<History />} title="Nothing recorded yet" description="Boots, sign-ins, software changes, jobs and alerts will appear here as they happen." /> : (
        <ol className="relative ml-3 border-l border-border pl-6">
          {items.map((e) => {
            const Icon = KIND_ICON[e.kind];
            const day = new Date(e.ts).toDateString();
            const showDay = day !== lastDay;
            lastDay = day;
            const body = (
              <div className="flex items-start gap-3">
                <span className={cn("absolute -left-[37px] mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border [&>svg]:h-3 [&>svg]:w-3", SEV_CLS[e.severity])}><Icon /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2"><span className="truncate text-sm text-fg">{e.title}</span><span className="ml-auto shrink-0 text-[11px] text-fg-subtle" title={formatDateTime(e.ts)}>{new Date(e.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span></div>
                  {e.detail && <div className="truncate text-xs text-fg-muted">{e.detail}</div>}
                </div>
              </div>
            );
            return (
              <React.Fragment key={e.id}>
                {showDay && <li className="relative -ml-6 mb-2 mt-4 pl-6 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle first:mt-0">{new Date(e.ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</li>}
                <li className="relative mb-3">{e.href ? <Link href={e.href} className="-mx-2 block rounded-lg px-2 py-1 hover:bg-surface-hover/60 focus-ring">{body}</Link> : <div className="py-1">{body}</div>}</li>
              </React.Fragment>
            );
          })}
        </ol>
      )}
      {all.length >= 60 && <div className="mt-2 flex justify-center"><Button variant="ghost" size="sm" onClick={more} loading={loadingMore}>Load older</Button></div>}
    </TabFrame>
  );
}

/* ------------------------------------------------------------------ Jobs */
interface RunRow { id: string; jobId: string; status: string; createdAt: string; finishedAt: string | null; exitCode: number | null; error: string | null; durationMs: number | null; jobName: string; jobType: string; createdByName: string | null }

export function DeviceJobs() {
  const { data } = useDevice();
  const { data: res, isLoading, mutate } = useSWR<{ items: RunRow[] }>([`devices/${data.device.id}/jobs`, { limit: 100 }]);
  useRealtime(["job.run.updated", "job.created"], (ev) => { if (ev.deviceId === data.device.id || !ev.deviceId) mutate(); }, [`device:${data.device.id}`]);
  const items = res?.items ?? [];
  const columns: ColumnDef<RunRow, unknown>[] = [
    { accessorKey: "jobName", header: "Job", cell: ({ row }) => <Link href={`/jobs/${row.original.jobId}?run=${row.original.id}`} className="font-medium text-fg hover:text-accent-hover" onClick={(e) => e.stopPropagation()}>{row.original.jobName}</Link> },
    { accessorKey: "jobType", header: "Type", size: 120, cell: ({ getValue }) => <Badge tone="outline" size="xs">{(getValue() as string).replace(/_/g, " ")}</Badge> },
    { accessorKey: "status", header: "Status", size: 130, cell: ({ row }) => <Badge tone={statusTone(row.original.status)} size="xs" dot>{row.original.status.replace(/_/g, " ")}</Badge> },
    { accessorKey: "exitCode", header: "Exit", size: 70, cell: ({ getValue }) => <span className="mono text-xs text-fg-muted">{getValue() === null || getValue() === undefined ? "—" : String(getValue())}</span> },
    { accessorKey: "durationMs", header: "Duration", size: 100, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{getValue() ? formatMs(getValue() as number) : "—"}</span> },
    { accessorKey: "createdByName", header: "By", size: 160, cell: ({ getValue }) => <span className="truncate text-xs text-fg-muted">{(getValue() as string) || "system"}</span> },
    { accessorKey: "createdAt", header: "When", size: 120, cell: ({ getValue }) => <span className="text-xs text-fg-muted" title={formatDateTime(getValue() as string)}>{relativeTime(getValue() as string)}</span> },
  ];
  return (
    <TabFrame icon={Play} title="Job history" count={items.length} toolbar={<Link href={`/jobs/new?device=${data.device.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover focus-ring"><Play className="h-3.5 w-3.5" /> New job</Link>}>
      <DataTable columns={columns} data={items} loading={isLoading} dense emptyMessage="No jobs have run on this device." rowHref={(r) => `/jobs/${r.jobId}?run=${r.id}`} onRowClick={(r) => { location.href = `/jobs/${r.jobId}?run=${r.id}`; }} />
    </TabFrame>
  );
}

/* ------------------------------------------------------------------ frame */
function TabFrame({ icon: Icon, title, count, toolbar, children }: { icon: LucideIcon; title: string; count?: number; toolbar?: React.ReactNode; children: React.ReactNode }) {
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

