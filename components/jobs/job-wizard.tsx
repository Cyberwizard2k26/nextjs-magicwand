"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Building2, CalendarClock, Eraser, FlaskConical, FileCode2, Globe, Layers, Lock, LogOut, MessageSquare, Monitor, Power, RefreshCw, Rocket, RotateCw, SlidersHorizontal, SquareTerminal, Tag, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, Pill } from "@/components/ui/misc";
import { api, ApiClientError } from "@/lib/client/api";
import { useDebounce } from "@/lib/client/hooks";
import { assessCommand } from "@/lib/client/command-risk";
import { platformLabel } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { DevicePicker } from "@/components/devices/device-picker";
import { RiskNotice } from "./quick-job-dialog";

type JobType = "command" | "script" | "reboot" | "shutdown" | "lock_screen" | "logoff_user" | "inventory" | "clear_cache" | "message_user" | "agent_update";
const TYPES: { id: JobType; label: string; icon: LucideIcon; description: string; permission: string }[] = [
  { id: "script", label: "Run a script", icon: FileCode2, description: "From the library, with parameters", permission: "scripts.run" },
  { id: "command", label: "Run a command", icon: SquareTerminal, description: "One-off shell command", permission: "scripts.run" },
  { id: "inventory", label: "Refresh inventory", icon: RefreshCw, description: "Hardware, software, services, users", permission: "devices.manage" },
  { id: "clear_cache", label: "Clear temp files", icon: Eraser, description: "Temp folders, caches, recycle bin", permission: "scripts.run" },
  { id: "message_user", label: "Message users", icon: MessageSquare, description: "Dialog on the user's screen", permission: "remote.tools" },
  { id: "lock_screen", label: "Lock screens", icon: Lock, description: "Lock interactive sessions", permission: "devices.power" },
  { id: "logoff_user", label: "Log off users", icon: LogOut, description: "End interactive sessions", permission: "devices.power" },
  { id: "reboot", label: "Reboot", icon: RotateCw, description: "With delay and user message", permission: "devices.power" },
  { id: "shutdown", label: "Shut down", icon: Power, description: "Power off", permission: "devices.power" },
  { id: "agent_update", label: "Update agent", icon: Rocket, description: "To the current release", permission: "devices.manage" },
];
type TargetMode = "device" | "group" | "site" | "org" | "filter";
interface Script { id: string; name: string; description: string | null; language: string; platforms: string[]; parameters: { name: string; label?: string; type: string; required?: boolean; default?: string | number | boolean; options?: string[]; description?: string }[]; risk: string; requiresApproval: boolean; category: string | null; timeoutSeconds: number }

export function JobWizard({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const allowed = TYPES.filter((t) => can(t.permission));
  const initialDevices = [sp.get("device"), ...(sp.get("devices")?.split(",") ?? [])].filter(Boolean) as string[];
  const [type, setType] = React.useState<JobType>(((sp.get("type") as JobType) || (sp.get("script") ? "script" : allowed[0]?.id)) ?? "command");
  const [mode, setMode] = React.useState<TargetMode>(initialDevices.length ? "device" : "device");
  const [deviceIds, setDeviceIds] = React.useState<string[]>(initialDevices);
  const [groupIds, setGroupIds] = React.useState<string[]>([]);
  const [siteIds, setSiteIds] = React.useState<string[]>([]);
  const [filter, setFilter] = React.useState<{ platforms: string[]; statuses: string[]; tag: string }>({ platforms: [], statuses: [], tag: "" });
  const [command, setCommand] = React.useState("");
  const [shell, setShell] = React.useState("auto");
  const [runAs, setRunAs] = React.useState("system");
  const [scriptId, setScriptId] = React.useState(sp.get("script") ?? "");
  const [scriptParams, setScriptParams] = React.useState<Record<string, string | number | boolean>>({});
  const [scriptQ, setScriptQ] = React.useState("");
  const [message, setMessage] = React.useState({ title: "Message from IT", body: "" });
  const [power, setPower] = React.useState({ delay: 60, force: false, message: "" });
  const [name, setName] = React.useState("");
  const [rollout, setRollout] = React.useState({ canary: false, canaryCount: 3, abortPct: 25, concurrency: 0, retries: 0, timeout: 600, runWhenOnline: true, approval: false, scheduledAt: "" });
  const [busy, setBusy] = React.useState(false);
  const [confirmRisk, setConfirmRisk] = React.useState(false);

  const { data: groups } = useSWR<{ items: { id: string; name: string; deviceCount: number; isDynamic: boolean }[] }>("groups");
  const { data: sites } = useSWR<{ items: { id: string; name: string; deviceCount: number }[] }>("sites");
  const { data: scripts } = useSWR<{ items: Script[] }>(type === "script" ? "scripts" : null);
  const script = scripts?.items.find((s) => s.id === scriptId) ?? null;
  const { data: clone } = useSWR<{ job: { type: string; payload: Record<string, unknown>; targetType: TargetMode; targetIds: string[]; name: string } }>(sp.get("clone") ? `jobs/${sp.get("clone")}` : null);
  React.useEffect(() => {
    if (!clone) return;
    const j = clone.job;
    if (j.type === "command") { setType("command"); setCommand(String(j.payload.command ?? "")); setShell(String(j.payload.shell ?? "auto")); setRunAs(String(j.payload.runAs ?? "system")); }
    if (j.type === "script") { setType("script"); setScriptId(String(j.payload.scriptId ?? "")); setScriptParams((j.payload.params as Record<string, string>) ?? {}); }
    if (j.targetType === "device") setDeviceIds(j.targetIds);
    setMode(j.targetType);
  }, [clone]);
  React.useEffect(() => {
    if (!script) return;
    setScriptParams((p) => { const next = { ...p }; for (const prm of script.parameters) if (next[prm.name] === undefined && prm.default !== undefined) next[prm.name] = prm.default; return next; });
    setRollout((r) => ({ ...r, timeout: script.timeoutSeconds, approval: r.approval || script.requiresApproval }));
  }, [script]);

  const targetBody = React.useMemo(() => {
    if (mode === "device") return { targetType: "device" as const, targetIds: deviceIds };
    if (mode === "group") return { targetType: "group" as const, targetIds: groupIds };
    if (mode === "site") return { targetType: "site" as const, targetIds: siteIds };
    if (mode === "org") return { targetType: "org" as const, targetIds: [] };
    const all: { field: string; op: string; value?: unknown }[] = [];
    if (filter.platforms.length) all.push({ field: "platform", op: "in", value: filter.platforms });
    if (filter.statuses.length) all.push({ field: "status", op: "in", value: filter.statuses });
    if (filter.tag) all.push({ field: "tags", op: "contains", value: filter.tag });
    return { targetType: "filter" as const, targetIds: [], targetFilter: { all } };
  }, [mode, deviceIds, groupIds, siteIds, filter]);
  const previewKey = useDebounce(JSON.stringify(targetBody), 300);
  const { data: preview } = useSWR<{ total: number; online: number; offline: number; sample: string[]; byPlatform: Record<string, number> }>(["jobs/preview", previewKey], () => api.post("jobs/preview", JSON.parse(previewKey)));
  const count = preview?.total ?? 0;
  const risk = type === "command" ? assessCommand(command) : null;

  const valid = count > 0 && (type !== "command" || command.trim()) && (type !== "script" || (script && script.parameters.every((p) => !p.required || (scriptParams[p.name] !== undefined && scriptParams[p.name] !== "")))) && (type !== "message_user" || message.body.trim());

  async function submit() {
    if (risk?.level === "destructive" && !confirmRisk) { setConfirmRisk(true); return; }
    setBusy(true);
    try {
      const payload: Record<string, unknown> =
        type === "command" ? { command, shell: shell === "auto" ? undefined : shell, runAs }
        : type === "script" ? { scriptId, params: scriptParams, runAs: runAs === "system" ? undefined : runAs }
        : type === "message_user" ? { title: message.title, body: message.body }
        : type === "reboot" || type === "shutdown" ? { delaySeconds: power.delay, force: power.force, message: power.message || undefined }
        : {};
      const r = await api.post<{ job: { id: string }; runs: unknown[]; rollout?: { id: string } }>("jobs", {
        type,
        name: name.trim() || undefined,
        ...targetBody,
        payload,
        concurrency: rollout.concurrency || undefined,
        maxRetries: rollout.retries || undefined,
        timeoutSeconds: rollout.timeout || undefined,
        runWhenOnline: rollout.runWhenOnline,
        abortOnFailurePercent: count > 1 ? rollout.abortPct : undefined,
        requiresApproval: rollout.approval || undefined,
        scheduledAt: rollout.scheduledAt ? new Date(rollout.scheduledAt).toISOString() : undefined,
        canary: rollout.canary && count > rollout.canaryCount ? { count: rollout.canaryCount, autoPromote: true } : undefined,
      });
      toast.success(`Job created for ${r.runs.length} device${r.runs.length === 1 ? "" : "s"}${r.rollout ? " - canary running first" : ""}`);
      router.push(`/jobs/${r.job.id}`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not create job");
      setBusy(false);
    }
  }

  const step = (n: number, title: string, hint?: string) => <div className="mb-3 flex items-baseline gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-hover">{n}</span><h2 className="text-base font-semibold">{title}</h2>{hint && <span className="text-xs text-fg-subtle">{hint}</span>}</div>;

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Jobs", href: "/jobs" }, { label: "New job" }]} title="New job" description="Pick what to run, where, and how carefully." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-8">
          <section>
            {step(1, "What to run")}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {allowed.map((t) => <button key={t.id} type="button" onClick={() => setType(t.id)} className={cn("flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors focus-ring", type === t.id ? "border-accent bg-accent-soft/50" : "border-border bg-surface hover:border-border-strong")}><t.icon className={cn("h-4 w-4", type === t.id ? "text-accent-hover" : "text-fg-subtle")} /><span className="text-sm font-medium">{t.label}</span><span className="text-[11px] leading-snug text-fg-muted">{t.description}</span></button>)}
            </div>
            <div className="mt-4 space-y-4">
              {type === "command" && (
                <>
                  <Field label="Command"><Textarea value={command} onChange={(e) => { setCommand(e.target.value); setConfirmRisk(false); }} className="mono min-h-[110px] text-[13px]" placeholder={"Get-Service | Where-Object Status -eq 'Stopped'\n# or: df -h"} spellCheck={false} /></Field>
                  {risk && <RiskNotice risk={risk} confirm={confirmRisk} />}
                  <div className="grid grid-cols-2 gap-3 sm:w-2/3">
                    <Field label="Shell"><Select value={shell} onChange={(e) => setShell(e.target.value)}><option value="auto">Auto per platform</option><option value="pwsh">PowerShell 7</option><option value="cmd">cmd.exe</option><option value="bash">bash</option><option value="sh">sh</option><option value="zsh">zsh</option></Select></Field>
                    <Field label="Run as"><Select value={runAs} onChange={(e) => setRunAs(e.target.value)}><option value="system">SYSTEM / root</option><option value="user">Logged-in user</option></Select></Field>
                  </div>
                </>
              )}
              {type === "script" && (
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="overflow-hidden rounded-lg border border-border">
                    <div className="border-b border-border p-2"><Input value={scriptQ} onChange={(e) => setScriptQ(e.target.value)} placeholder="Search the library…" className="h-8" /></div>
                    <ul className="max-h-72 overflow-auto">
                      {(scripts?.items ?? []).filter((s) => !scriptQ || `${s.name} ${s.description ?? ""} ${s.category ?? ""}`.toLowerCase().includes(scriptQ.toLowerCase())).map((s) => (
                        <li key={s.id}><button type="button" onClick={() => setScriptId(s.id)} className={cn("flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-hover focus-ring", scriptId === s.id && "bg-accent-soft/40")}><FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-medium">{s.name}</span><Badge tone="outline" size="xs">{s.language}</Badge>{s.risk !== "low" && <Badge tone={s.risk === "high" ? "danger" : "warning"} size="xs">{s.risk} risk</Badge>}</span>{s.description && <span className="block truncate text-xs text-fg-muted">{s.description}</span>}</span></button></li>
                      ))}
                      {scripts && !scripts.items.length && <li className="px-3 py-6 text-center text-xs text-fg-subtle">The library is empty. <button type="button" className="text-accent-hover hover:underline" onClick={() => router.push("/scripts/new")}>Create a script</button>.</li>}
                    </ul>
                  </div>
                  <div>
                    {!script ? <p className="text-sm text-fg-muted">Select a script to set its parameters.</p> : (
                      <div className="space-y-3">
                        <div><div className="font-medium">{script.name}</div><div className="text-xs text-fg-muted">{script.language}{script.platforms.length ? ` · ${script.platforms.map((p) => platformLabel[p] ?? p).join(", ")}` : " · all platforms"} · timeout {script.timeoutSeconds}s{script.requiresApproval ? " · requires approval" : ""}</div></div>
                        {script.parameters.length === 0 && <p className="text-xs text-fg-subtle">No parameters.</p>}
                        {script.parameters.map((p) => (
                          <Field key={p.name} label={`${p.label || p.name}${p.required ? " *" : ""}`} hint={p.description}>
                            {p.type === "boolean" ? <Switch checked={!!scriptParams[p.name]} onCheckedChange={(v) => setScriptParams((s) => ({ ...s, [p.name]: v }))} label={scriptParams[p.name] ? "Yes" : "No"} />
                              : p.type === "select" ? <Select value={String(scriptParams[p.name] ?? "")} onChange={(e) => setScriptParams((s) => ({ ...s, [p.name]: e.target.value }))}><option value="">Choose…</option>{p.options?.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                              : <Input type={p.type === "number" ? "number" : p.type === "secret" ? "password" : "text"} value={String(scriptParams[p.name] ?? "")} onChange={(e) => setScriptParams((s) => ({ ...s, [p.name]: p.type === "number" ? Number(e.target.value) : e.target.value }))} />}
                          </Field>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {type === "message_user" && <div className="grid gap-3 sm:w-2/3"><Field label="Title"><Input value={message.title} onChange={(e) => setMessage((m) => ({ ...m, title: e.target.value }))} /></Field><Field label="Message"><Textarea value={message.body} onChange={(e) => setMessage((m) => ({ ...m, body: e.target.value }))} /></Field></div>}
              {(type === "reboot" || type === "shutdown") && <div className="grid grid-cols-2 gap-3 sm:w-2/3"><Field label="Delay (seconds)"><Input type="number" min={0} value={power.delay} onChange={(e) => setPower((p) => ({ ...p, delay: Number(e.target.value) }))} /></Field><Field label="Force close apps"><div className="flex h-9 items-center"><Switch checked={power.force} onCheckedChange={(v) => setPower((p) => ({ ...p, force: v }))} label={power.force ? "Yes" : "No"} /></div></Field><Field label="Message to users" className="col-span-2"><Input value={power.message} onChange={(e) => setPower((p) => ({ ...p, message: e.target.value }))} placeholder="Please save your work; this computer restarts in 60 seconds." /></Field></div>}
            </div>
          </section>

          <section>
            {step(2, "Where", "devices are resolved when the job is created")}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {([["device", "Specific devices", Monitor], ["group", "Groups", Layers], ["site", "Sites", Building2], ["filter", "By attributes", SlidersHorizontal], ["org", "Entire organization", Globe]] as [TargetMode, string, LucideIcon][]).map(([m, l, Icon]) => <Pill key={m} active={mode === m} onClick={() => setMode(m)}><Icon className="mr-1.5 inline h-3.5 w-3.5" />{l}</Pill>)}
            </div>
            {mode === "device" && <DevicePicker value={deviceIds} onChange={setDeviceIds} />}
            {mode === "group" && <CheckList items={(groups?.items ?? []).map((g) => ({ id: g.id, label: g.name, hint: `${g.deviceCount} device${g.deviceCount === 1 ? "" : "s"}${g.isDynamic ? " · dynamic" : ""}` }))} value={groupIds} onChange={setGroupIds} empty="No groups yet - create them under Sites & groups." />}
            {mode === "site" && <CheckList items={(sites?.items ?? []).map((s) => ({ id: s.id, label: s.name, hint: `${s.deviceCount} device${s.deviceCount === 1 ? "" : "s"}` }))} value={siteIds} onChange={setSiteIds} empty="No sites yet." />}
            {mode === "filter" && (
              <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
                <div><div className="mb-1.5 text-xs font-medium text-fg-muted">Platform</div><div className="flex flex-wrap gap-1">{["windows", "linux", "macos"].map((p) => <Pill key={p} active={filter.platforms.includes(p)} onClick={() => setFilter((f) => ({ ...f, platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] }))}>{platformLabel[p]}</Pill>)}</div></div>
                <div><div className="mb-1.5 text-xs font-medium text-fg-muted">Status</div><div className="flex flex-wrap gap-1">{["online", "offline", "maintenance"].map((s) => <Pill key={s} active={filter.statuses.includes(s)} onClick={() => setFilter((f) => ({ ...f, statuses: f.statuses.includes(s) ? f.statuses.filter((x) => x !== s) : [...f.statuses, s] }))} className="capitalize">{s}</Pill>)}</div></div>
                <Field label="Has tag"><Input value={filter.tag} onChange={(e) => setFilter((f) => ({ ...f, tag: e.target.value }))} leftIcon={<Tag />} placeholder="finance" /></Field>
              </div>
            )}
            {mode === "org" && <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">Targets every managed device in the organization. A canary wave is strongly recommended.</p>}
          </section>

          <section>
            {step(3, "How carefully")}
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className={cn(count > 1 && "border-accent/30")}><CardHeader title={<span className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-accent-hover" />Canary rollout</span>} description="Run on a few devices first. The rest waits and is promoted automatically only if every canary device succeeds; otherwise it's held for you." /><CardBody className="flex items-center gap-3"><Switch checked={rollout.canary} onCheckedChange={(v) => setRollout((r) => ({ ...r, canary: v }))} label={rollout.canary ? "On" : "Off"} disabled={count < 2} />{rollout.canary && <><span className="text-sm text-fg-muted">first</span><Input type="number" min={1} max={Math.max(1, count - 1)} value={rollout.canaryCount} onChange={(e) => setRollout((r) => ({ ...r, canaryCount: Number(e.target.value) }))} className="w-20" /><span className="text-sm text-fg-muted">of {count}</span></>}</CardBody></Card>
              <Card><CardHeader title="Blast-radius guard" description="Stop the job automatically when the failure rate crosses a threshold." /><CardBody className="flex items-center gap-3"><Input type="number" min={1} max={100} value={rollout.abortPct} onChange={(e) => setRollout((r) => ({ ...r, abortPct: Number(e.target.value) }))} className="w-20" /><span className="text-sm text-fg-muted">% failures (checked after the first 3 results)</span></CardBody></Card>
              <Card><CardHeader title="Pace" description="Limit how many devices execute at once; retry transient failures." /><CardBody className="grid grid-cols-3 gap-3"><Field label="Concurrency" hint="0 = all"><Input type="number" min={0} value={rollout.concurrency} onChange={(e) => setRollout((r) => ({ ...r, concurrency: Number(e.target.value) }))} /></Field><Field label="Retries"><Input type="number" min={0} max={10} value={rollout.retries} onChange={(e) => setRollout((r) => ({ ...r, retries: Number(e.target.value) }))} /></Field><Field label="Timeout (s)"><Input type="number" min={10} value={rollout.timeout} onChange={(e) => setRollout((r) => ({ ...r, timeout: Number(e.target.value) }))} /></Field></CardBody></Card>
              <Card><CardHeader title="When" description="Run now, at a time, and whether offline devices catch up later." /><CardBody className="space-y-3"><Field label="Schedule" hint="leave empty to run now"><Input type="datetime-local" value={rollout.scheduledAt} onChange={(e) => setRollout((r) => ({ ...r, scheduledAt: e.target.value }))} leftIcon={<CalendarClock />} /></Field><Switch checked={rollout.runWhenOnline} onCheckedChange={(v) => setRollout((r) => ({ ...r, runWhenOnline: v }))} label="Queue for offline devices (7 days)" /><Switch checked={rollout.approval} onCheckedChange={(v) => setRollout((r) => ({ ...r, approval: v }))} label="Hold for approval before running" /></CardBody></Card>
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-[calc(var(--topbar-height)+1.5rem)] lg:self-start">
          <Card>
            <CardHeader title="Summary" />
            <CardBody className="space-y-4">
              <Field label="Job name" hint="optional"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={TYPES.find((t) => t.id === type)?.label} /></Field>
              <div className="rounded-lg bg-surface-2/70 p-3 text-sm">
                <div className="flex items-baseline justify-between"><span className="text-fg-muted">Targets</span><span className="text-2xl font-semibold tabular">{preview ? count : "…"}</span></div>
                {preview && count > 0 && <div className="mt-1 text-xs text-fg-subtle"><span className="text-success">{preview.online} online</span> · {preview.offline} offline{Object.keys(preview.byPlatform).length > 0 && <> · {Object.entries(preview.byPlatform).map(([k, v]) => `${v} ${platformLabel[k] ?? k}`).join(", ")}</>}</div>}
                {preview && count > 0 && <div className="mt-2 flex flex-wrap gap-1">{preview.sample.map((n) => <span key={n} className="rounded bg-surface-3 px-1.5 py-px text-[11px]">{n}</span>)}{count > preview.sample.length && <span className="text-[11px] text-fg-subtle">+{count - preview.sample.length} more</span>}</div>}
                {preview && count === 0 && <div className="mt-1 text-xs text-warning">Nothing matches yet - pick at least one device.</div>}
              </div>
              <ul className="space-y-1 text-xs text-fg-muted">
                <li>{TYPES.find((t) => t.id === type)?.label}{type === "script" && script ? `: ${script.name}` : ""}</li>
                {rollout.canary && count > rollout.canaryCount && <li>Canary: {rollout.canaryCount} first, then {count - rollout.canaryCount} automatically</li>}
                {count > 1 && <li>Abort above {rollout.abortPct}% failures{rollout.concurrency ? ` · ${rollout.concurrency} at a time` : ""}</li>}
                {rollout.scheduledAt && <li>Scheduled {new Date(rollout.scheduledAt).toLocaleString()}</li>}
                {rollout.approval && <li>Held for approval</li>}
                {!rollout.runWhenOnline && <li>Offline devices are skipped</li>}
              </ul>
              <Button className="w-full" size="lg" onClick={submit} loading={busy} disabled={!valid} variant={confirmRisk ? "danger" : "primary"} leftIcon={<Rocket className="h-4 w-4" />}>{confirmRisk ? "Run anyway" : rollout.approval ? "Create and hold" : rollout.scheduledAt ? "Schedule job" : `Run on ${count} device${count === 1 ? "" : "s"}`}</Button>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

function CheckList({ items, value, onChange, empty }: { items: { id: string; label: string; hint?: string }[]; value: string[]; onChange: (v: string[]) => void; empty: string }) {
  if (!items.length) return <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-fg-subtle">{empty}</p>;
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it) => {
        const on = value.includes(it.id);
        return <li key={it.id}><button type="button" onClick={() => onChange(on ? value.filter((x) => x !== it.id) : [...value, it.id])} className={cn("flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-ring", on ? "border-accent bg-accent-soft/50" : "border-border hover:border-border-strong")}><span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-accent bg-accent" : "border-border-strong")} /><span className="min-w-0 flex-1 truncate">{it.label}</span>{it.hint && <span className="text-xs text-fg-subtle">{it.hint}</span>}</button></li>;
      })}
    </ul>
  );
}
