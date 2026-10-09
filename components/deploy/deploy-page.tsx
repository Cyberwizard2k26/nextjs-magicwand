"use client";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Copy, Download, KeyRound, Plus, ShieldCheck, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Code, EmptyState, PageHeader, Pill } from "@/components/ui/misc";
import { api, ApiClientError } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";

interface Token { id: string; name: string; prefix: string; siteId: string | null; groupId: string | null; maxUses: number | null; uses: number; expiresAt: string | null; revokedAt: string | null; requireApproval: boolean; tags: string[]; createdAt: string }
interface Created { token: Token; secret: string; serverUrl: string; install: { windows: string; linux: string; macos: string } }

export function DeployPage({ permissions }: { permissions: string[] }) {
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const { data, mutate, isLoading } = useSWR<{ items: Token[] }>("enrollment-tokens");
  const { data: sites } = useSWR<{ items: { id: string; name: string }[] }>("sites");
  const { data: groups } = useSWR<{ items: { id: string; name: string }[] }>("groups");
  const [open, setOpen] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);
  const [revoke, setRevoke] = React.useState<Token | null>(null);
  const [form, setForm] = React.useState({ name: "", siteId: "", groupId: "", maxUses: "", expiresInHours: "168", requireApproval: false, tags: "" });
  const [busy, setBusy] = React.useState(false);
  const tokens = (data?.items ?? []).filter((t) => !t.revokedAt);
  const revoked = (data?.items ?? []).filter((t) => t.revokedAt).length;

  async function create() {
    if (!form.name.trim()) { toast.error("Name the token (e.g. the site or the campaign)"); return; }
    setBusy(true);
    try {
      const r = await api.post<Created>("enrollment-tokens", { name: form.name.trim(), siteId: form.siteId || null, groupId: form.groupId || null, maxUses: form.maxUses ? Number(form.maxUses) : null, expiresInHours: form.expiresInHours ? Number(form.expiresInHours) : null, requireApproval: form.requireApproval, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean) });
      setCreated(r);
      setOpen(false);
      setForm({ name: "", siteId: "", groupId: "", maxUses: "", expiresInHours: "168", requireApproval: false, tags: "" });
      mutate();
    } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not create token"); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Deploy agent" description="Enrollment tokens tie new devices to a site, a group and tags. The secret is shown once." actions={can("devices.enroll") && <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New enrollment token</Button>} />

      {created && <InstallPanel created={created} onDismiss={() => setCreated(null)} />}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="lg:col-span-2">
          {!isLoading && tokens.length === 0 ? (
            <EmptyState icon={<KeyRound />} title="No active enrollment tokens" description="Create a token, then run the one-line installer on any Windows, macOS or Linux machine. The device appears in the console within seconds." action={can("devices.enroll") ? <Button onClick={() => setOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>New enrollment token</Button> : undefined} />
          ) : (
            <Card>
              <CardHeader title="Active tokens" description={`${tokens.length} active${revoked ? ` · ${revoked} revoked` : ""}`} />
              <CardBody className="px-0 pb-0">
                <ul className="divide-y divide-border/70">
                  {tokens.map((t) => {
                    const expired = t.expiresAt && new Date(t.expiresAt) < new Date();
                    const exhausted = t.maxUses !== null && t.uses >= t.maxUses;
                    return (
                      <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                        <KeyRound className="h-4 w-4 shrink-0 text-fg-subtle" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.name}</span><span className="mono text-xs text-fg-subtle">{t.prefix}…</span>{t.requireApproval && <Badge tone="warning" size="xs"><ShieldCheck className="mr-1 h-3 w-3" />approval</Badge>}{(expired || exhausted) && <Badge tone="neutral" size="xs">{expired ? "expired" : "exhausted"}</Badge>}</div>
                          <div className="mt-0.5 text-xs text-fg-muted">{[sites?.items.find((s) => s.id === t.siteId)?.name, groups?.items.find((g) => g.id === t.groupId)?.name, t.tags.length ? `tags: ${t.tags.join(", ")}` : null].filter(Boolean).join(" · ") || "No site, group or tags"}</div>
                        </div>
                        <div className="text-right text-xs text-fg-muted"><div className="tabular">{t.uses}{t.maxUses !== null ? ` / ${t.maxUses}` : ""} used</div><div>{t.expiresAt ? `expires ${relativeTime(t.expiresAt)}` : "never expires"}</div></div>
                        {can("devices.enroll") && <Button size="icon-sm" variant="ghost" className="text-fg-subtle hover:text-danger" aria-label="Revoke" onClick={() => setRevoke(t)}><Trash2 className="h-4 w-4" /></Button>}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="How enrollment works" />
          <CardBody>
            <ol className="space-y-3 text-sm text-fg-muted">
              {["Create a token scoped to a site/group (optionally require approval for devices it enrolls).", "Run the installer line on the device as administrator/root; it installs a service and connects over WebSocket.", "The agent proves its identity with an Ed25519 key; the token is consumed and never reused by a re-install.", "Inventory, telemetry and health begin within a minute. Approve the device if the token required it."].map((s, i) => <li key={i} className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-hover">{i + 1}</span><span>{s}</span></li>)}
            </ol>
            <p className="mt-4 rounded-lg border border-border bg-surface-2/60 p-3 text-xs text-fg-muted">Build agent binaries with <Code>npm run agent:build</Code> and place them in <Code>AGENT_BIN_DIR</Code>; the installer lines below reference the server&apos;s public URL.</p>
          </CardBody>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen} title="New enrollment token" description="Scope and limits are baked into every device enrolled with it." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create} loading={busy}>Create token</Button></>}>
        <div className="space-y-4">
          <Field label="Name"><Input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Acme HQ workstations" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Site"><Select value={form.siteId} onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value }))}><option value="">No site</option>{sites?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Group"><Select value={form.groupId} onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}><option value="">No group</option>{groups?.items.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
            <Field label="Max uses" hint="empty = unlimited"><Input type="number" min={1} value={form.maxUses} onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} /></Field>
            <Field label="Expires in"><Select value={form.expiresInHours} onChange={(e) => setForm((f) => ({ ...f, expiresInHours: e.target.value }))}><option value="1">1 hour</option><option value="24">1 day</option><option value="168">1 week</option><option value="720">30 days</option><option value="">Never</option></Select></Field>
          </div>
          <Field label="Tags" hint="comma separated, applied to every enrolled device"><Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="hq, workstation" /></Field>
          <Switch checked={form.requireApproval} onCheckedChange={(v) => setForm((f) => ({ ...f, requireApproval: v }))} label="Devices need approval before they are managed" />
        </div>
      </Dialog>
      <ConfirmDialog open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)} title={`Revoke "${revoke?.name}"?`} description="Installers using this token stop enrolling immediately. Devices already enrolled are not affected." confirmLabel="Revoke" onConfirm={async () => { if (!revoke) return; await api.delete(`enrollment-tokens/${revoke.id}`); toast.success("Token revoked"); mutate(); }} />
    </>
  );
}

function InstallPanel({ created, onDismiss }: { created: Created; onDismiss: () => void }) {
  const [os, setOs] = React.useState<"windows" | "linux" | "macos">("windows");
  const [copied, setCopied] = React.useState<string | null>(null);
  const copy = (k: string, v: string) => navigator.clipboard.writeText(v).then(() => { setCopied(k); setTimeout(() => setCopied(null), 1500); });
  const line = created.install[os];
  return (
    <Card className="mb-4 border-accent/40 shadow-glow animate-in">
      <CardHeader title={<span className="flex items-center gap-2"><Download className="h-4 w-4 text-accent-hover" />Token “{created.token.name}” created - install the agent</span>} description="The secret below is shown only once. Copy the installer line now." actions={<Button variant="ghost" size="sm" onClick={onDismiss}>Done</Button>} />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2">
          <Code className="flex-1 truncate">{created.secret}</Code>
          <Button size="sm" variant="secondary" leftIcon={copied === "secret" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} onClick={() => copy("secret", created.secret)}>{copied === "secret" ? "Copied" : "Copy token"}</Button>
        </div>
        <div className="flex flex-wrap gap-1.5">{(["windows", "linux", "macos"] as const).map((o) => <Pill key={o} active={os === o} onClick={() => setOs(o)} className="capitalize">{o === "macos" ? "macOS" : o}</Pill>)}</div>
        <div className={cn("relative rounded-lg border border-border bg-[#0b0d12] p-3 pr-24 font-mono text-[12px] leading-relaxed text-zinc-200")} style={{ colorScheme: "dark" }}>
          <Terminal className="absolute left-3 top-3 h-3.5 w-3.5 text-zinc-500" />
          <pre className="whitespace-pre-wrap break-all pl-6">{line}</pre>
          <Button size="xs" variant="secondary" className="absolute right-2 top-2" leftIcon={copied === os ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />} onClick={() => copy(os, line)}>{copied === os ? "Copied" : "Copy"}</Button>
        </div>
        <p className="text-xs text-fg-muted">{os === "windows" ? "Run in an elevated PowerShell or Command Prompt. The installer registers the “MagicWand Agent” service and starts it." : "Run as root (sudo). The script downloads the binary for the host's architecture, installs a systemd/launchd service and starts it."} Server: <span className="mono">{created.serverUrl}</span></p>
      </CardBody>
    </Card>
  );
}
