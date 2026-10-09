"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eraser, FlaskConical, Lock, LogOut, MessageSquare, Power, RefreshCw, RotateCw, SquareTerminal, TriangleAlert } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api, ApiClientError } from "@/lib/client/api";
import { assessCommand } from "@/lib/client/command-risk";
import { cn } from "@/lib/util/cn";

export type QuickAction = "command" | "reboot" | "shutdown" | "lock_screen" | "logoff_user" | "inventory" | "clear_cache" | "message_user";

export const QUICK_ACTIONS: { id: QuickAction; label: string; icon: React.ReactNode; permission: string; description: string; tone?: "danger" }[] = [
  { id: "command", label: "Run command", icon: <SquareTerminal />, permission: "scripts.run", description: "One-off shell command with streamed output" },
  { id: "inventory", label: "Refresh inventory", icon: <RefreshCw />, permission: "devices.manage", description: "Re-collect hardware, software, services and users" },
  { id: "clear_cache", label: "Clear temporary files", icon: <Eraser />, permission: "scripts.run", description: "Temp folders, package caches, recycle bin" },
  { id: "message_user", label: "Message user", icon: <MessageSquare />, permission: "remote.tools", description: "Show a dialog on the user's screen" },
  { id: "lock_screen", label: "Lock screen", icon: <Lock />, permission: "devices.power", description: "Lock the interactive session" },
  { id: "logoff_user", label: "Log off user", icon: <LogOut />, permission: "devices.power", description: "End the interactive session", tone: "danger" },
  { id: "reboot", label: "Reboot", icon: <RotateCw />, permission: "devices.power", description: "Restart with an optional delay and message", tone: "danger" },
  { id: "shutdown", label: "Shut down", icon: <Power />, permission: "devices.power", description: "Power off (needs Wake-on-LAN or hands to come back)", tone: "danger" },
];

export interface QuickJobTarget { type: "device" | "group" | "site" | "org"; ids: string[]; label: string; count?: number }

export function QuickJobDialog({ open, onOpenChange, action, target, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; action: QuickAction; target: QuickJobTarget; onCreated?: (jobId: string) => void }) {
  const router = useRouter();
  const spec = QUICK_ACTIONS.find((a) => a.id === action)!;
  const count = target.count ?? target.ids.length;
  const fleet = count > 1 || target.type !== "device";
  const [command, setCommand] = React.useState("");
  const [shell, setShell] = React.useState("auto");
  const [runAs, setRunAs] = React.useState<"system" | "user">("system");
  const [delay, setDelay] = React.useState(60);
  const [force, setForce] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [title, setTitle] = React.useState("Message from IT");
  const [canary, setCanary] = React.useState(fleet && count >= 5);
  const [canaryCount, setCanaryCount] = React.useState(Math.max(1, Math.min(5, Math.floor(count * 0.1) || 1)));
  const [abortPct, setAbortPct] = React.useState(25);
  const [busy, setBusy] = React.useState(false);
  const [confirmRisk, setConfirmRisk] = React.useState(false);
  const risk = action === "command" ? assessCommand(command) : null;

  React.useEffect(() => { if (open) { setConfirmRisk(false); setBusy(false); } }, [open]);

  async function submit() {
    if (risk?.level === "destructive" && !confirmRisk) { setConfirmRisk(true); return; }
    setBusy(true);
    try {
      const payload: Record<string, unknown> =
        action === "command" ? { command, shell: shell === "auto" ? undefined : shell, runAs }
        : action === "reboot" || action === "shutdown" ? { delaySeconds: delay, message: message || undefined, force }
        : action === "message_user" ? { title, body: message }
        : {};
      const r = await api.post<{ job: { id: string; name: string }; runs: unknown[]; rollout?: { id: string } }>("jobs", {
        type: action,
        targetType: target.type,
        targetIds: target.ids,
        payload,
        canary: canary && fleet ? { count: canaryCount, autoPromote: true } : undefined,
        abortOnFailurePercent: fleet ? abortPct : undefined,
      });
      toast.success(`${spec.label} queued for ${r.runs.length} device${r.runs.length === 1 ? "" : "s"}${r.rollout ? " (canary first)" : ""}`, { action: { label: "View job", onClick: () => router.push(`/jobs/${r.job.id}`) } });
      onCreated?.(r.job.id);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not create job");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = action === "command" ? command.trim().length > 0 : action === "message_user" ? message.trim().length > 0 : true;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={<span className="flex items-center gap-2 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-accent-hover">{spec.icon}{spec.label}</span>}
      description={<>{spec.description} · <span className="text-fg">{target.label}</span></>}
      size={action === "command" ? "lg" : "md"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant={spec.tone === "danger" || confirmRisk ? "danger" : "primary"} onClick={submit} loading={busy} disabled={!canSubmit}>
            {confirmRisk ? "Yes, run it anyway" : fleet ? `Run on ${count} devices` : "Run"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {action === "command" && (
          <>
            <Field label="Command">
              <Textarea autoFocus value={command} onChange={(e) => { setCommand(e.target.value); setConfirmRisk(false); }} placeholder={"Get-Service | Where-Object Status -eq 'Stopped'\n# or: df -h && uptime"} className="mono min-h-[120px] text-[13px]" spellCheck={false} />
            </Field>
            <RiskNotice risk={risk!} confirm={confirmRisk} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Shell">
                <Select value={shell} onChange={(e) => setShell(e.target.value)}>
                  <option value="auto">Auto (PowerShell on Windows, bash elsewhere)</option>
                  <option value="pwsh">PowerShell 7</option>
                  <option value="cmd">cmd.exe</option>
                  <option value="bash">bash</option>
                  <option value="sh">sh</option>
                  <option value="zsh">zsh</option>
                </Select>
              </Field>
              <Field label="Run as">
                <Select value={runAs} onChange={(e) => setRunAs(e.target.value as "system" | "user")}>
                  <option value="system">SYSTEM / root</option>
                  <option value="user">Logged-in user</option>
                </Select>
              </Field>
            </div>
          </>
        )}
        {(action === "reboot" || action === "shutdown") && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Delay (seconds)" hint="gives the user time to save">
                <Input type="number" min={0} max={3600} value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
              </Field>
              <Field label="Force" hint="close apps without asking">
                <div className="flex h-9 items-center"><Switch checked={force} onCheckedChange={setForce} label={force ? "Yes" : "No"} /></div>
              </Field>
            </div>
            <Field label="Message shown to the user" hint="optional">
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="IT maintenance: this computer will restart shortly. Please save your work." />
            </Field>
          </>
        )}
        {action === "message_user" && (
          <>
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Message"><Textarea autoFocus value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We'll be installing updates at 6 pm. Please leave your computer on." /></Field>
          </>
        )}
        {action === "logoff_user" && <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">Unsaved work in the user&apos;s session will be lost.</p>}
        {(action === "inventory" || action === "clear_cache" || action === "lock_screen") && <p className="text-sm text-fg-muted">This runs immediately on online devices and is queued for offline ones (expires after 7 days).</p>}

        {fleet && (
          <div className="rounded-lg border border-border bg-surface-2/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle"><FlaskConical className="h-3.5 w-3.5" /> Rollout safety</div>
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Switch checked={canary} onCheckedChange={setCanary} label="Canary first" />
                  <p className="mt-1 text-xs text-fg-muted">Run on a few devices first; the rest waits and is promoted automatically only if every canary succeeds.</p>
                </div>
                {canary && <Input type="number" min={1} max={Math.max(1, count - 1)} value={canaryCount} onChange={(e) => setCanaryCount(Number(e.target.value))} className="w-24" aria-label="Canary device count" />}
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm">Stop the job if failures exceed</div>
                  <p className="mt-0.5 text-xs text-fg-muted">Blast-radius guard: evaluated after the first few results.</p>
                </div>
                <div className="flex items-center gap-1.5"><Input type="number" min={1} max={100} value={abortPct} onChange={(e) => setAbortPct(Number(e.target.value))} className="w-20" aria-label="Abort threshold" /><span className="text-sm text-fg-muted">%</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function RiskNotice({ risk, confirm, compact }: { risk: ReturnType<typeof assessCommand>; confirm?: boolean; compact?: boolean }) {
  if (risk.level === "safe") return null;
  const destructive = risk.level === "destructive";
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", destructive ? "border-danger/40 bg-danger-soft text-danger" : "border-warning/30 bg-warning-soft text-warning", compact && "py-1.5 text-xs")} role="alert">
      <TriangleAlert className={cn("mt-0.5 shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
      <div className="min-w-0">
        <div className="font-medium">{destructive ? (confirm ? "Confirm: this command is destructive" : "Destructive command") : "This command changes system state"}</div>
        <div className={cn("mt-0.5", destructive ? "text-danger/90" : "text-warning/90")}>{risk.reasons.join(" · ")}</div>
      </div>
      <Badge tone={destructive ? "critical" : "warning"} size="xs" className="ml-auto shrink-0 capitalize">{risk.level}</Badge>
    </div>
  );
}
