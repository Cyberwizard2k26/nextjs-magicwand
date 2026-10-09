"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Bell, CheckCircle2, CircleX, Clock, Copy, Download, History, KeyRound, Loader2, LockOpen, MoreHorizontal, Package, Play, RefreshCw, RotateCw, Search, ShieldAlert, ShieldCheck, ShieldMinus, ShieldPlus, Square, Trash2, UserCheck, UserPlus, UserX, Users, Wand2, Wrench, XCircle, type LucideIcon } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { Badge, severityTone, statusTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Tooltip } from "@/components/ui/menu";
import { EmptyState, Pill, Progress, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useRealtime } from "@/components/shell/realtime-provider";
import { useRpc } from "@/components/remote/use-rpc";
import { api, ApiClientError } from "@/lib/client/api";
import { useDebounce } from "@/lib/client/hooks";
import { formatBytes, formatDateTime, formatMs, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { useDevice } from "./device-context";

const errMsg = (err: unknown, fallback = "Request failed") => (err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : fallback);

/** Row-level "⋯" trigger shared by the inventory tables. Forwards the ref and props Radix's menu trigger injects. */
const RowMenuButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; label: string }>(function RowMenuButton({ busy, label, className, onClick, ...props }, ref) {
  return (
    <button ref={ref} type="button" aria-label={label} {...props} className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-40 focus-ring", className)} onClick={(e) => { e.stopPropagation(); onClick?.(e); }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
    </button>
  );
});

function generatePassword(len = 18) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_=+";
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function PasswordField({ value, onChange, label = "New password", hint }: { value: string; onChange: (v: string) => void; label?: string; hint?: string }) {
  const [show, setShow] = React.useState(false);
  return (
    <Field label={label} hint={hint ?? "At least 8 characters. It is sent to the device once and never stored or logged."}>
      <div className="flex gap-2">
        <Input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" className="mono" />
        <Tooltip content="Generate a strong password"><Button type="button" variant="secondary" size="icon" aria-label="Generate" onClick={() => { onChange(generatePassword()); setShow(true); }}><Wand2 className="h-4 w-4" /></Button></Tooltip>
        <Tooltip content="Copy"><Button type="button" variant="secondary" size="icon" aria-label="Copy" disabled={!value} onClick={() => { void navigator.clipboard.writeText(value); toast.success("Copied - share it with the user securely"); }}><Copy className="h-4 w-4" /></Button></Tooltip>
      </div>
      <label className="mt-1.5 flex items-center gap-2 text-xs text-fg-muted"><Checkbox checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password</label>
    </Field>
  );
}

/* ------------------------------------------------------------------ Software */
interface SoftwareRow { id: string; name: string; version: string | null; publisher: string | null; installDate: string | null; source: string; sizeBytes: number | null; isSystemComponent: boolean; firstSeenAt: string; uninstallString: string | null; installLocation: string | null }
const PKG_MANAGERS = new Set(["winget", "choco", "apt", "dnf", "rpm", "snap", "flatpak", "brew"]);
const INSTALL_MANAGERS: Record<string, { id: string; label: string; needsUrl?: boolean; hasVersion?: boolean }[]> = {
  windows: [{ id: "winget", label: "winget", hasVersion: true }, { id: "choco", label: "Chocolatey", hasVersion: true }, { id: "msi", label: "MSI from URL", needsUrl: true }, { id: "exe", label: "EXE installer from URL", needsUrl: true }],
  linux: [{ id: "apt", label: "apt (Debian/Ubuntu)", hasVersion: true }, { id: "dnf", label: "dnf (Fedora/RHEL)", hasVersion: true }, { id: "snap", label: "snap" }, { id: "flatpak", label: "Flatpak" }, { id: "url", label: "Package from URL (.deb/.rpm)", needsUrl: true }],
  darwin: [{ id: "brew", label: "Homebrew formula", hasVersion: true }, { id: "brew_cask", label: "Homebrew cask" }, { id: "pkg", label: ".pkg from URL", needsUrl: true }, { id: "url", label: "Download & run installer", needsUrl: true }],
};

export function DeviceSoftware() {
  const { data, can } = useDevice();
  const d = data.device;
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [system, setSystem] = React.useState(false);
  const [uninstall, setUninstall] = React.useState<SoftwareRow | null>(null);
  const [installOpen, setInstallOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const dq = useDebounce(q, 200);
  const { data: sw, isLoading, mutate } = useSWR<{ items: SoftwareRow[] }>([`devices/${d.id}/software`, { q: dq || undefined }]);
  useRealtime(["software.*", "device.inventory"], (ev) => { if (ev.deviceId === d.id) mutate(); }, [`device:${d.id}`]);
  const items = (sw?.items ?? []).filter((s) => system || !s.isSystemComponent);
  const canManage = can("software.manage") && d.capabilities.includes("software");

  async function runUninstall(s: SoftwareRow) {
    setBusyId(s.id);
    try {
      const manager = PKG_MANAGERS.has(s.source) ? (s.source === "rpm" ? "dnf" : s.source) : undefined;
      const r = await api.post<{ job: { id: string } }>(`devices/${d.id}/actions`, { action: "software_uninstall", payload: { name: s.name, manager, package: s.name, uninstallString: s.uninstallString ?? undefined, installLocation: s.installLocation ?? undefined } });
      toast.success(`Uninstalling ${s.name}`, { description: d.status === "online" ? "Runs now; the inventory updates when it finishes." : "Queued until the device comes online.", action: { label: "Job", onClick: () => router.push(`/jobs/${r.job.id}`) } });
    } catch (err) { toast.error(errMsg(err)); } finally { setBusyId(null); setUninstall(null); }
  }

  const columns: ColumnDef<SoftwareRow, unknown>[] = [
    { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium text-fg">{row.original.name}</span> },
    { accessorKey: "version", header: "Version", size: 140, cell: ({ getValue }) => <span className="mono text-xs text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "publisher", header: "Publisher", size: 200, cell: ({ getValue }) => <span className="truncate text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "installDate", header: "Installed", size: 120, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "source", header: "Source", size: 90, cell: ({ getValue }) => <Badge tone="outline" size="xs">{getValue() as string}</Badge> },
    { accessorKey: "sizeBytes", header: "Size", size: 90, cell: ({ getValue }) => <span className="tabular text-xs text-fg-muted">{getValue() ? formatBytes(getValue() as number, 0) : "—"}</span> },
    { accessorKey: "firstSeenAt", header: "First seen", size: 110, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{relativeTime(getValue() as string)}</span> },
    ...(canManage ? [{ id: "actions", header: "", size: 48, enableSorting: false, cell: ({ row }) => {
      const s = row.original;
      const removable = !s.isSystemComponent && (s.uninstallString || PKG_MANAGERS.has(s.source) || d.platform === "darwin");
      return (
        <Menu trigger={<RowMenuButton label={`Actions for ${s.name}`} busy={busyId === s.id} />}>
          <MenuLabel>{s.name}</MenuLabel>
          <MenuItem icon={<Trash2 className="h-4 w-4" />} danger disabled={!removable} onSelect={() => setUninstall(s)}>Uninstall…</MenuItem>
          {!removable && <p className="max-w-[220px] px-2 pb-1.5 text-[11px] text-fg-subtle">No uninstaller is recorded for this entry.</p>}
        </Menu>
      );
    } } satisfies ColumnDef<SoftwareRow, unknown>] : []),
  ];
  return (
    <TabFrame icon={Package} title="Installed software" count={items.length} toolbar={<>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or publisher…" leftIcon={<Search />} className="sm:w-72" />
      <Pill active={system} onClick={() => setSystem((s) => !s)}>Show system components</Pill>
      {canManage && <Button size="sm" className="ml-auto" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => setInstallOpen(true)}>Install package</Button>}
    </>}>
      <DataTable columns={columns} data={items} loading={isLoading} dense emptyMessage={d.lastInventoryAt ? "No software matches." : "Software inventory has not been collected yet."} />
      <ConfirmDialog open={!!uninstall} onOpenChange={(o) => !o && setUninstall(null)} title={`Uninstall ${uninstall?.name ?? ""}?`} description={<>The uninstaller runs silently as {d.platform === "windows" ? "SYSTEM" : "root"}; the user is not asked. {uninstall?.uninstallString && <span className="mono mt-2 block break-all rounded bg-surface-3 px-2 py-1 text-[11px]">{uninstall.uninstallString}</span>}</>} confirmLabel="Uninstall" onConfirm={async () => { if (uninstall) await runUninstall(uninstall); }} loading={!!busyId} />
      <InstallDialog open={installOpen} onOpenChange={setInstallOpen} />
    </TabFrame>
  );
}

function InstallDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data } = useDevice();
  const d = data.device;
  const router = useRouter();
  const managers = INSTALL_MANAGERS[d.platform] ?? INSTALL_MANAGERS.linux;
  const osHint = (d.osName ?? "").toLowerCase();
  const defaultManager = d.platform === "linux" && /fedora|red hat|rhel|centos|rocky|alma|suse/.test(osHint) ? "dnf" : managers[0].id;
  const [manager, setManager] = React.useState(defaultManager);
  const [pkg, setPkg] = React.useState("");
  const [version, setVersion] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [args, setArgs] = React.useState("");
  const [sha256, setSha] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const spec = managers.find((m) => m.id === manager) ?? managers[0];
  const valid = spec.needsUrl ? /^https?:\/\//.test(url) : pkg.trim().length > 0;
  async function submit() {
    setBusy(true);
    try {
      const payload = { manager, package: pkg.trim() || undefined, version: version.trim() || undefined, url: url.trim() || undefined, args: args.trim() || undefined, sha256: sha256.trim() || undefined };
      const r = await api.post<{ job: { id: string } }>(`devices/${d.id}/actions`, { action: "software_install", payload });
      toast.success(`Installing ${pkg || url}`, { action: { label: "Job", onClick: () => router.push(`/jobs/${r.job.id}`) } });
      onOpenChange(false);
      setPkg(""); setVersion(""); setUrl(""); setArgs(""); setSha("");
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Install software" description={`Silent install on ${d.name}. Runs as ${d.platform === "windows" ? "SYSTEM" : "root"}, queued if the device is offline, recorded as a job.`}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={!valid} loading={busy} leftIcon={<Download className="h-4 w-4" />}>Install</Button></>}>
      <div className="space-y-3">
        <Field label="Package manager"><Select value={manager} onChange={(e) => setManager(e.target.value)}>{managers.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
        {spec.needsUrl ? (
          <>
            <Field label="Download URL" hint="HTTPS only. The agent downloads it as SYSTEM/root and runs the silent installer."><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/setup.msi" autoFocus /></Field>
            <Field label="Expected SHA-256" hint="Optional but recommended: the install is refused if the download does not match."><Input value={sha256} onChange={(e) => setSha(e.target.value)} className="mono" placeholder="64 hex characters" /></Field>
            <Field label="Display name" hint="Used for the job name and the inventory diff."><Input value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder="Example Agent" /></Field>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label={manager === "winget" ? "Package id" : "Package"}><Input value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder={manager === "winget" ? "Mozilla.Firefox" : manager === "choco" ? "firefox" : manager.startsWith("brew") ? "firefox" : "curl"} autoFocus className="mono" /></Field>
            {spec.hasVersion && <Field label="Version" hint="optional"><Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="latest" className="mono" /></Field>}
          </div>
        )}
        <Field label="Extra installer arguments" hint="optional"><Input value={args} onChange={(e) => setArgs(e.target.value)} className="mono" placeholder={d.platform === "windows" ? "/qn ALLUSERS=1" : ""} /></Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Services */
interface ServiceRow { id: string; name: string; displayName: string | null; status: string; startType: string; account: string | null; pid: number | null; path: string | null; description: string | null }
type ServiceResult = { name: string; status?: string; startType?: string; output?: string };

export function DeviceServices() {
  const { data, can } = useDevice();
  const d = data.device;
  const rpc = useRpc(d.id);
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "running" | "stopped" | "auto_stopped">("all");
  const [pending, setPending] = React.useState<string | null>(null);
  const { data: res, isLoading, mutate } = useSWR<{ items: ServiceRow[] }>(`devices/${d.id}/services`);
  useRealtime(["device.inventory"], (ev) => { if (ev.deviceId === d.id) mutate(); }, [`device:${d.id}`]);
  const online = d.status === "online";
  const canAct = can("remote.tools") && d.capabilities.includes("services");
  const items = (res?.items ?? []).filter((s) => {
    if (filter === "running" && s.status !== "running") return false;
    if (filter === "stopped" && s.status === "running") return false;
    if (filter === "auto_stopped" && !(s.startType === "auto" && s.status !== "running")) return false;
    if (q && !`${s.displayName ?? ""} ${s.name} ${s.description ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const autoStopped = (res?.items ?? []).filter((s) => s.startType === "auto" && s.status !== "running").length;

  async function act(s: ServiceRow, action: "start" | "stop" | "restart" | "enable" | "disable", startType?: string) {
    setPending(s.name);
    try {
      let r = (await rpc.call<ServiceResult>("service_action", { name: s.name, action, startType })).data;
      if (!r?.status || r.status === "unknown") { try { r = { ...r, ...(await rpc.call<ServiceResult>("service_action", { name: s.name, action: "status" })).data }; } catch { /* keep what we have */ } }
      const next = { status: r?.status && r.status !== "unknown" ? r.status : action === "stop" || action === "disable" ? "stopped" : action === "start" || action === "restart" ? "running" : s.status, startType: r?.startType ?? (startType ?? (action === "enable" ? "auto" : action === "disable" ? "disabled" : s.startType)) };
      mutate((cur) => (cur ? { ...cur, items: cur.items.map((x) => (x.name === s.name ? { ...x, ...next } : x)) } : cur), { revalidate: false });
      const verb = { start: "started", stop: "stopped", restart: "restarted", enable: "set to start automatically", disable: "disabled" }[action];
      toast.success(`${s.displayName || s.name} ${startType && action !== "disable" && action !== "enable" ? `startup set to ${startType}` : verb}`);
    } catch (err) { toast.error(errMsg(err)); } finally { setPending(null); }
  }

  const startTypes: { id: string; label: string }[] = d.platform === "windows" ? [{ id: "auto", label: "Automatic" }, { id: "delayed", label: "Automatic (delayed)" }, { id: "manual", label: "Manual" }, { id: "disabled", label: "Disabled" }] : d.platform === "linux" ? [{ id: "auto", label: "Enabled at boot" }, { id: "disabled", label: "Disabled" }] : [];
  const columns: ColumnDef<ServiceRow, unknown>[] = [
    { accessorKey: "displayName", header: "Service", cell: ({ row }) => <div className="min-w-0"><div className="truncate font-medium text-fg">{row.original.displayName || row.original.name}</div>{row.original.displayName && <div className="mono truncate text-[11px] text-fg-subtle">{row.original.name}</div>}</div> },
    { accessorKey: "status", header: "Status", size: 110, cell: ({ getValue }) => <Badge tone={statusTone(getValue() as string) === "success" ? "success" : (getValue() as string) === "stopped" ? "neutral" : "warning"} size="xs" dot>{getValue() as string}</Badge> },
    { accessorKey: "startType", header: "Start", size: 90, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{getValue() as string}</span> },
    { accessorKey: "account", header: "Account", size: 160, cell: ({ getValue }) => <span className="truncate text-xs text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "pid", header: "PID", size: 70, cell: ({ getValue }) => <span className="mono text-xs text-fg-muted">{(getValue() as number) || "—"}</span> },
    { accessorKey: "path", header: "Path", size: 320, cell: ({ getValue }) => <span className="mono block truncate text-[11px] text-fg-subtle" title={getValue() as string}>{(getValue() as string) || "—"}</span> },
    ...(canAct ? [{ id: "actions", header: "", size: 48, enableSorting: false, cell: ({ row }) => {
      const s = row.original;
      const running = s.status === "running";
      return (
        <Menu trigger={<RowMenuButton label={`Actions for ${s.displayName || s.name}`} busy={pending === s.name} disabled={!online} />}>
          <MenuLabel>{s.displayName || s.name}</MenuLabel>
          <MenuItem icon={<Play className="h-4 w-4" />} disabled={running} onSelect={() => act(s, "start")}>Start</MenuItem>
          <MenuItem icon={<Square className="h-4 w-4" />} disabled={!running} onSelect={() => act(s, "stop")}>Stop</MenuItem>
          <MenuItem icon={<RotateCw className="h-4 w-4" />} onSelect={() => act(s, "restart")}>Restart</MenuItem>
          {startTypes.length > 0 && <><MenuSeparator /><MenuLabel>Startup type</MenuLabel>{startTypes.map((t) => <MenuItem key={t.id} disabled={s.startType === t.id} onSelect={() => act(s, t.id === "disabled" ? "disable" : t.id === "auto" && d.platform === "linux" ? "enable" : "enable", t.id)}>{t.label}{s.startType === t.id ? " ✓" : ""}</MenuItem>)}</>}
          {d.platform === "darwin" && <><MenuSeparator /><MenuItem icon={<CheckCircle2 className="h-4 w-4" />} onSelect={() => act(s, "enable")}>Enable (launchctl)</MenuItem><MenuItem icon={<XCircle className="h-4 w-4" />} onSelect={() => act(s, "disable")}>Disable (launchctl)</MenuItem></>}
        </Menu>
      );
    } } satisfies ColumnDef<ServiceRow, unknown>] : []),
  ];
  return (
    <TabFrame icon={Wrench} title="Services" count={items.length} toolbar={<>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services…" leftIcon={<Search />} className="sm:w-72" />
      {([["all", "All"], ["running", "Running"], ["stopped", "Stopped"], ["auto_stopped", `Automatic but stopped${autoStopped ? ` (${autoStopped})` : ""}`]] as const).map(([v, l]) => <Pill key={v} active={filter === v} onClick={() => setFilter(v)}>{l}</Pill>)}
      {canAct && <Tooltip content="Re-read services from the device"><Button size="sm" variant="ghost" className="ml-auto" leftIcon={<RefreshCw className={cn("h-3.5 w-3.5", rpc.busy && "animate-spin")} />} disabled={!online || !can("devices.manage")} onClick={async () => { try { await api.post(`devices/${d.id}/actions`, { action: "inventory", runWhenOnline: false }); toast.success("Inventory refresh requested"); } catch (err) { toast.error(errMsg(err)); } }}>Refresh</Button></Tooltip>}
    </>}>
      {autoStopped > 0 && filter === "all" && <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning"><ShieldAlert className="h-4 w-4" />{autoStopped} service{autoStopped === 1 ? " is" : "s are"} set to start automatically but not running. <button type="button" className="underline" onClick={() => setFilter("auto_stopped")}>Show</button></div>}
      {canAct && !online && <p className="mb-3 text-xs text-fg-subtle">The device is offline: start, stop and startup-type changes need a live agent connection.</p>}
      <DataTable columns={columns} data={items} loading={isLoading} dense emptyMessage="No services reported." />
    </TabFrame>
  );
}

/* ------------------------------------------------------------------ Users */
interface UserRow { id: string; username: string; fullName: string | null; isAdmin: boolean; enabled: boolean; passwordExpires: boolean; lastLogonAt: string | null; uid: string | null; managed: boolean }
type UserAction = "unlock" | "enable" | "disable" | "reset_password" | "expire_password" | "create" | "delete" | "add_admin" | "remove_admin";

export function DeviceUsers() {
  const { data, can } = useDevice();
  const d = data.device;
  const rpc = useRpc(d.id);
  const { data: res, isLoading, mutate } = useSWR<{ items: UserRow[] }>(`devices/${d.id}/users`);
  useRealtime(["device.inventory"], (ev) => { if (ev.deviceId === d.id) mutate(); }, [`device:${d.id}`]);
  const [pending, setPending] = React.useState<string | null>(null);
  const [reset, setReset] = React.useState<UserRow | null>(null);
  const [del, setDel] = React.useState<UserRow | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const online = d.status === "online";
  const canManage = can("security.manage") && d.capabilities.includes("local_users");
  const items = res?.items ?? [];

  /** Runs one account action, patches the cached row, then asks the agent to re-inventory users so the table is truthful. */
  async function act(username: string, action: UserAction, extra: Record<string, unknown> = {}, patch?: Partial<UserRow>) {
    setPending(username);
    try {
      await rpc.call("local_user_action", { username, action, ...extra });
      if (patch) mutate((cur) => (cur ? { ...cur, items: cur.items.map((u) => (u.username === username ? { ...u, ...patch } : u)) } : cur), { revalidate: false });
      if (action === "create" || action === "delete") mutate();
      if (can("devices.manage")) api.post(`devices/${d.id}/actions`, { action: "inventory", runWhenOnline: false }).catch(() => undefined);
      return true;
    } catch (err) { toast.error(errMsg(err)); return false; } finally { setPending(null); }
  }
  const signedIn = (u: UserRow) => d.loggedInUsers?.some((x) => x.user.toLowerCase().endsWith(u.username.toLowerCase()));

  const columns: ColumnDef<UserRow, unknown>[] = [
    { accessorKey: "username", header: "Account", cell: ({ row }) => <div className="flex items-center gap-2"><span className="font-medium text-fg">{row.original.username}</span>{row.original.isAdmin && <Badge tone="warning" size="xs">admin</Badge>}{row.original.managed && <Badge tone="accent" size="xs">rotated</Badge>}{signedIn(row.original) && <Badge tone="success" size="xs" dot>signed in</Badge>}</div> },
    { accessorKey: "fullName", header: "Full name", size: 200, cell: ({ getValue }) => <span className="text-fg-muted">{(getValue() as string) || "—"}</span> },
    { accessorKey: "enabled", header: "Enabled", size: 90, cell: ({ getValue }) => (getValue() ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-fg-subtle" />) },
    { accessorKey: "passwordExpires", header: "Password expires", size: 140, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{getValue() ? "yes" : "never"}</span> },
    { accessorKey: "lastLogonAt", header: "Last logon", size: 140, cell: ({ getValue }) => <span className="text-xs text-fg-muted">{getValue() ? relativeTime(getValue() as string) : "—"}</span> },
    ...(canManage ? [{ id: "actions", header: "", size: 48, enableSorting: false, cell: ({ row }) => {
      const u = row.original;
      return (
        <Menu trigger={<RowMenuButton label={`Actions for ${u.username}`} busy={pending === u.username} disabled={!online} />}>
          <MenuLabel>{u.username}</MenuLabel>
          <MenuItem icon={<LockOpen className="h-4 w-4" />} onSelect={async () => { if (await act(u.username, "unlock", {}, { enabled: true })) toast.success(`${u.username} unlocked`, { description: "Lockout cleared and the account enabled. The user can sign in again." }); }}>Unlock account</MenuItem>
          {u.enabled
            ? <MenuItem icon={<UserX className="h-4 w-4" />} disabled={signedIn(u)} onSelect={async () => { if (await act(u.username, "disable", {}, { enabled: false })) toast.success(`${u.username} disabled`); }}>Disable sign-in</MenuItem>
            : <MenuItem icon={<UserCheck className="h-4 w-4" />} onSelect={async () => { if (await act(u.username, "enable", {}, { enabled: true })) toast.success(`${u.username} enabled`); }}>Enable sign-in</MenuItem>}
          <MenuSeparator />
          <MenuItem icon={<KeyRound className="h-4 w-4" />} onSelect={() => setReset(u)}>Reset password…</MenuItem>
          <MenuItem icon={<Clock className="h-4 w-4" />} onSelect={async () => { if (await act(u.username, "expire_password", {}, { passwordExpires: true })) toast.success(`${u.username} must change their password at next sign-in`); }}>Require password change</MenuItem>
          <MenuSeparator />
          {u.isAdmin
            ? <MenuItem icon={<ShieldMinus className="h-4 w-4" />} onSelect={async () => { if (await act(u.username, "remove_admin", {}, { isAdmin: false })) toast.success(`${u.username} is no longer an administrator`); }}>Remove administrator rights</MenuItem>
            : <MenuItem icon={<ShieldPlus className="h-4 w-4" />} onSelect={async () => { if (await act(u.username, "add_admin", {}, { isAdmin: true })) toast.success(`${u.username} is now a local administrator`); }}>Make administrator</MenuItem>}
          <MenuSeparator />
          <MenuItem icon={<Trash2 className="h-4 w-4" />} danger disabled={signedIn(u)} onSelect={() => setDel(u)}>Delete account…</MenuItem>
        </Menu>
      );
    } } satisfies ColumnDef<UserRow, unknown>] : []),
  ];
  return (
    <TabFrame icon={Users} title="Local users" count={items.length} toolbar={canManage ? <Button size="sm" className="ml-auto" leftIcon={<UserPlus className="h-3.5 w-3.5" />} disabled={!online} onClick={() => setCreateOpen(true)}>Create account</Button> : undefined}>
      {canManage && !online && <p className="mb-3 text-xs text-fg-subtle">The device is offline: account changes need a live agent connection. Unlocking, resets and admin changes resume when it reconnects.</p>}
      <DataTable columns={columns} data={items} loading={isLoading} dense emptyMessage="No local accounts reported." />
      <ResetPasswordDialog user={reset} onClose={() => setReset(null)} onSubmit={async (password, mustChange) => { const ok = await act(reset!.username, "reset_password", { password }, mustChange ? { passwordExpires: true } : undefined); if (ok) { if (mustChange) await act(reset!.username, "expire_password", {}, { passwordExpires: true }); toast.success(`Password reset for ${reset!.username}`); setReset(null); } }} busy={!!pending} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete ${del?.username ?? ""}?`} description="The local account is removed from this device. The home folder is left in place for recovery; delete it with the file browser if you need to." confirmLabel="Delete account" loading={!!pending} onConfirm={async () => { if (del && (await act(del.username, "delete"))) { toast.success(`${del.username} deleted`); setDel(null); } }} />
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} busy={!!pending} onSubmit={async (f) => { if (await act(f.username, "create", { password: f.password, fullName: f.fullName || undefined, admin: f.admin })) { toast.success(`Account ${f.username} created`); setCreateOpen(false); } }} />
    </TabFrame>
  );
}

function ResetPasswordDialog({ user, onClose, onSubmit, busy }: { user: UserRow | null; onClose: () => void; onSubmit: (password: string, mustChange: boolean) => Promise<void>; busy: boolean }) {
  const [password, setPassword] = React.useState("");
  const [mustChange, setMustChange] = React.useState(true);
  const open = !!user;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setPassword(""); } }} title={`Reset password for ${user?.username ?? ""}`} description="Sets a new password on the device immediately. Any lockout is cleared as part of the reset."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={async () => { await onSubmit(password, mustChange); setPassword(""); }} disabled={password.length < 8} loading={busy} leftIcon={<KeyRound className="h-4 w-4" />}>Reset password</Button></>}>
      <div className="space-y-3">
        <PasswordField value={password} onChange={setPassword} />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} /> Require a new password at next sign-in</label>
      </div>
    </Dialog>
  );
}

function CreateUserDialog({ open, onOpenChange, onSubmit, busy }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (f: { username: string; fullName: string; password: string; admin: boolean }) => Promise<void>; busy: boolean }) {
  const [username, setUsername] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [admin, setAdmin] = React.useState(false);
  const valid = /^[A-Za-z0-9._-]{1,32}$/.test(username) && password.length >= 8;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Create local account" description="Creates a local user on this device only. Consider a directory-joined account for anything permanent."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={async () => { await onSubmit({ username, fullName, password, admin }); setUsername(""); setFullName(""); setPassword(""); setAdmin(false); }} disabled={!valid} loading={busy} leftIcon={<UserPlus className="h-4 w-4" />}>Create</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username" hint="letters, digits, . _ -"><Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus className="mono" autoComplete="off" /></Field>
          <Field label="Full name" hint="optional"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        </div>
        <PasswordField value={password} onChange={setPassword} label="Password" />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Local administrator</label>
      </div>
    </Dialog>
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

