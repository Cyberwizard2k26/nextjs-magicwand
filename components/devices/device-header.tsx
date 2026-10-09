"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Activity, Cast, ChevronDown, ChevronRight, FolderOpen, Gauge, History, KeyRound, ListTree, Network, Package, Pencil, Play, Radar, RotateCw, Settings2, ShieldCheck, SquareTerminal, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Menu, MenuItem, MenuSeparator, Tooltip } from "@/components/ui/menu";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, platformLabel, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { useDevice } from "./device-context";
import { DeviceStatusBadge, DeviceTypeIcon, HealthScore, PlatformChip, TagList } from "./device-bits";
import { QuickJobDialog, QUICK_ACTIONS, type QuickAction } from "@/components/jobs/quick-job-dialog";

const TABS = [
  { href: "", label: "Overview", icon: Gauge, permission: "devices.view" },
  { href: "/software", label: "Software", icon: Package, permission: "software.view" },
  { href: "/services", label: "Services", icon: Settings2, permission: "devices.view" },
  { href: "/users", label: "Users", icon: Users, permission: "devices.view" },
  { href: "/security", label: "Security", icon: ShieldCheck, permission: "security.view" },
  { href: "/timeline", label: "Timeline", icon: History, permission: "devices.view" },
  { href: "/jobs", label: "Jobs", icon: Play, permission: "jobs.view" },
];
const TOOLS = [
  { href: "/console", label: "Console", icon: SquareTerminal, permission: "scripts.run", capability: "scripts" },
  { href: "/files", label: "Files", icon: FolderOpen, permission: "remote.files", capability: "files" },
  { href: "/processes", label: "Processes", icon: ListTree, permission: "remote.tools", capability: "processes" },
  { href: "/network", label: "Network", icon: Radar, permission: "remote.tools", capability: "processes" },
  { href: "/desktop", label: "Desktop", icon: Cast, permission: "remote.desktop", capability: "desktop" },
];

export function DeviceHeader() {
  const { data, mutate, can } = useDevice();
  const d = data.device;
  const pathname = usePathname();
  const router = useRouter();
  const base = `/devices/${d.id}`;
  const rel = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const [quick, setQuick] = React.useState<QuickAction | null>(null);
  const [edit, setEdit] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  const online = d.status === "online";

  async function approve() {
    setApproving(true);
    try { await api.post(`devices/${d.id}/approve`); toast.success(`${d.name} approved`); mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Approval failed"); } finally { setApproving(false); }
  }

  return (
    <div className="-mt-2 mb-6">
      <nav className="mb-3 flex items-center gap-1 text-xs text-fg-subtle">
        <Link href="/devices" className="hover:text-fg">Devices</Link>
        {data.site && <><ChevronRight className="h-3 w-3" /><Link href={`/devices?siteId=${data.site.id}`} className="hover:text-fg">{data.site.name}</Link></>}
        <ChevronRight className="h-3 w-3" /><span className="text-fg-muted">{d.name}</span>
      </nav>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border bg-surface-2 [&>svg]:h-6 [&>svg]:w-6", online ? "border-success/30 text-success shadow-[0_0_0_4px_var(--success-soft)]" : "border-border text-fg-subtle")}>
            <DeviceTypeIcon type={d.deviceType} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{d.name}</h1>
              <DeviceStatusBadge status={d.status} size="sm" />
              {d.pendingReboot && <Badge tone="warning" size="xs" dot>Pending reboot</Badge>}
              {d.isProbe && <Badge tone="info" size="xs">Network probe</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
              <span className="flex items-center gap-1.5"><PlatformChip platform={d.platform} />{d.osName ? `${d.osName} ${d.osVersion ?? ""}`.trim() : platformLabel[d.platform]}</span>
              {d.loggedInUser ? <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5 text-fg-subtle" />{d.loggedInUser}</span> : <span className="text-fg-subtle">nobody signed in</span>}
              {(d.localIps?.[0] || d.publicIp) && <span className="mono text-xs">{d.localIps?.[0] ?? d.publicIp}{d.publicIp && d.localIps?.[0] && d.publicIp !== d.localIps[0] ? ` · ${d.publicIp}` : ""}</span>}
              {(data.site || data.group) && <span>{[data.site?.name, data.group?.name].filter(Boolean).join(" · ")}</span>}
              <Tooltip content={d.lastSeenAt ? formatDateTime(d.lastSeenAt) : "never"}><span className="flex items-center gap-1"><Activity className="h-3.5 w-3.5 text-fg-subtle" />{online ? "connected" : `last seen ${relativeTime(d.lastSeenAt)}`}</span></Tooltip>
              {d.healthScore !== null && <HealthScore score={d.healthScore} />}
            </div>
            {d.tags?.length > 0 && <TagList tags={d.tags} max={8} className="mt-1.5" />}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {d.status === "pending" && can("devices.approve") && <Button variant="success" leftIcon={<UserCheck className="h-4 w-4" />} loading={approving} onClick={approve}>Approve device</Button>}
          {can("scripts.run") && <Button variant="secondary" leftIcon={<SquareTerminal className="h-4 w-4" />} onClick={() => router.push(`${base}/console`)} disabled={!online}>Console</Button>}
          {can("devices.manage") && <Button variant="secondary" size="icon" aria-label="Edit device" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /></Button>}
          <Menu trigger={<Button rightIcon={<ChevronDown className="h-4 w-4" />}>Actions</Button>}>
            {QUICK_ACTIONS.filter((a) => can(a.permission)).map((a) => <MenuItem key={a.id} icon={a.icon} danger={a.tone === "danger"} onSelect={() => setQuick(a.id)}>{a.label}</MenuItem>)}
            <MenuSeparator />
            {can("scripts.run") && <MenuItem icon={<Play />} onSelect={() => router.push(`/jobs/new?device=${d.id}`)}>Run a script…</MenuItem>}
            {can("devices.manage") && <MenuItem icon={<RotateCw />} onSelect={async () => { try { await api.post(`devices/${d.id}/rpc`, { cmd: "agent_restart", args: {} }); toast.success("Agent restarting"); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Failed"); } }} disabled={!online}>Restart agent</MenuItem>}
            {can("vault.view") && <MenuItem icon={<KeyRound />} onSelect={() => router.push(`/vault?device=${d.id}`)}>Credentials</MenuItem>}
          </Menu>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-2 border-b border-border">
        <nav className="-mb-px flex items-center gap-1 overflow-x-auto" aria-label="Device sections">
          {TABS.filter((t) => can(t.permission)).map((t) => {
            const active = t.href === "" ? rel === "" : rel.startsWith(t.href);
            return <Link key={t.href} href={`${base}${t.href}`} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-ring", active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}><t.icon className="h-4 w-4" />{t.label}</Link>;
          })}
        </nav>
        <nav className="-mb-px flex items-center gap-1 overflow-x-auto" aria-label="Remote tools">
          <span className="mr-1 hidden text-[10px] font-semibold uppercase tracking-wider text-fg-subtle sm:inline">Tools</span>
          {TOOLS.filter((t) => can(t.permission)).map((t) => {
            const active = rel.startsWith(t.href);
            const available = online && (t.capability === "scripts" || t.capability === "processes" || d.capabilities.includes(t.capability));
            return (
              <Tooltip key={t.href} content={!online ? "Device is offline" : !available ? "Not supported by this agent" : null}>
                <Link href={`${base}${t.href}`} aria-disabled={!available} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-ring", active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg", !available && "opacity-50")}><t.icon className="h-4 w-4" />{t.label}</Link>
              </Tooltip>
            );
          })}
        </nav>
      </div>

      {quick && <QuickJobDialog open onOpenChange={(o) => !o && setQuick(null)} action={quick} target={{ type: "device", ids: [d.id], label: d.name }} onCreated={(jobId) => { if (quick === "command") router.push(`${base}/console?job=${jobId}`); }} />}
      {edit && <EditDeviceDialog open onOpenChange={setEdit} />}
    </div>
  );
}

function EditDeviceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, mutate } = useDevice();
  const d = data.device;
  const [form, setForm] = React.useState({ displayName: d.displayName ?? "", description: d.description ?? "", deviceType: d.deviceType, tags: d.tags.join(", "), notes: d.notes ?? "", siteId: d.siteId ?? "", groupId: d.groupId ?? "" });
  const [busy, setBusy] = React.useState(false);
  const [sites, setSites] = React.useState<{ id: string; name: string }[]>([]);
  const [groups, setGroups] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => {
    api.get<{ items: { id: string; name: string }[] }>("sites").then((r) => setSites(r.items)).catch(() => {});
    api.get<{ items: { id: string; name: string }[] }>("groups").then((r) => setGroups(r.items)).catch(() => {});
  }, []);
  async function save() {
    setBusy(true);
    try {
      await api.patch(`devices/${d.id}`, { displayName: form.displayName || null, description: form.description || null, deviceType: form.deviceType, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean), notes: form.notes || null, siteId: form.siteId || null, groupId: form.groupId || null });
      toast.success("Device updated");
      mutate();
      onOpenChange(false);
    } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Save failed"); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Edit device" description={d.hostname ?? d.name} footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Display name" hint={`hostname: ${d.hostname ?? "unknown"}`}><Input value={form.displayName} onChange={set("displayName")} placeholder={d.hostname ?? ""} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={form.deviceType} onChange={set("deviceType")}>{["workstation", "laptop", "server", "vm", "network", "printer", "mobile", "iot", "other"].map((t) => <option key={t} value={t}>{t}</option>)}</Select>
          </Field>
          <Field label="Tags" hint="comma separated"><Input value={form.tags} onChange={set("tags")} placeholder="finance, laptop, vip" /></Field>
          <Field label="Site"><Select value={form.siteId} onChange={set("siteId")}><option value="">No site</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Group"><Select value={form.groupId} onChange={set("groupId")}><option value="">No group</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
        </div>
        <Field label="Description"><Input value={form.description} onChange={set("description")} placeholder="Reception desk PC, 2nd floor" /></Field>
        <Field label="Notes" hint="visible to all technicians"><Textarea value={form.notes} onChange={set("notes")} placeholder="Known quirks, warranty details, who to call…" /></Field>
      </div>
    </Dialog>
  );
}

export function DeviceOfflineNotice({ what }: { what: string }) {
  const { data } = useDevice();
  const d = data.device;
  return (
    <div className="rounded-xl border border-dashed border-border-strong/70 px-6 py-14 text-center">
      <Network className="mx-auto mb-3 h-8 w-8 text-fg-subtle" />
      <h3 className="text-sm font-semibold">{d.name} is offline</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">{what} needs a live agent connection. Last seen {relativeTime(d.lastSeenAt)}. Commands you queue from the Actions menu will run when it reconnects.</p>
    </div>
  );
}
