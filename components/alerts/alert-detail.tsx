"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Activity, Check, CheckCheck, ChevronDown, Clock, MessageSquare, Play, RotateCcw, Send, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, severityTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Code, PageHeader, Skeleton } from "@/components/ui/misc";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import { DeviceStatusBadge, PlatformChip } from "@/components/devices/device-bits";
import { FactList } from "@/components/devices/device-overview";
import { ALERT_STATUS_TONE } from "./alert-list";

interface Detail {
  alert: { id: string; deviceId: string | null; severity: string; status: string; title: string; message: string | null; category: string; source: string; occurrences: number; openedAt: string; lastSeenAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null; snoozedUntil: string | null; resolvedAt: string | null; resolvedBy: string | null; resolution: string | null; ticketId: string | null; escalationLevel: number; data: Record<string, unknown>; aiTriage: { summary: string; likelyCause?: string; suggestedActions?: string[]; confidence?: number } | null; fingerprint: string };
  device: { id: string; name: string; platform: string; status: string; loggedInUser: string | null } | null;
  comments: { id: string; authorName: string | null; body: string; createdAt: string }[];
  monitor: { id: string; name: string; type: string; thresholds: Record<string, unknown> } | null;
}
const SNOOZE = [["30 minutes", 30], ["2 hours", 120], ["Until tomorrow", 60 * 18], ["1 week", 60 * 24 * 7]] as const;

export function AlertDetail({ id, permissions }: { id: string; permissions: string[] }) {
  const router = useRouter();
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const { data, mutate, isLoading } = useSWR<Detail>(`alerts/${id}`);
  const [comment, setComment] = React.useState("");
  const [resolveOpen, setResolveOpen] = React.useState(false);
  const [resolution, setResolution] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  useRealtime(["alert.*"], (ev) => { if ((ev.payload as { id?: string })?.id === id) mutate(); });

  async function act(action: "acknowledge" | "resolve" | "snooze" | "reopen", minutes?: number) {
    setBusy(true);
    try { await api.post("alerts/bulk", { action, ids: [id], minutes, resolution: action === "resolve" ? resolution || undefined : undefined }); toast.success(`Alert ${action === "acknowledge" ? "acknowledged" : action === "snooze" ? "snoozed" : action + "d"}`); setResolveOpen(false); mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Failed"); } finally { setBusy(false); }
  }
  async function addComment() {
    if (!comment.trim()) return;
    try { await api.post(`alerts/${id}`, { body: comment.trim() }); setComment(""); mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Failed"); }
  }

  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-8 w-96" /><Skeleton className="h-40" /></div>;
  const { alert: a, device, comments, monitor } = data;
  const open = ["open", "acknowledged", "snoozed"].includes(a.status);
  const timeline = [
    { at: a.openedAt, label: "Opened", detail: `${a.source} · ${a.category}` },
    a.occurrences > 1 ? { at: a.lastSeenAt, label: `Re-occurred (${a.occurrences}× total)`, detail: "deduplicated by fingerprint" } : null,
    a.acknowledgedAt ? { at: a.acknowledgedAt, label: "Acknowledged", detail: a.acknowledgedBy ?? undefined } : null,
    a.snoozedUntil && a.status === "snoozed" ? { at: a.snoozedUntil, label: "Snoozed until", detail: formatDateTime(a.snoozedUntil) } : null,
    a.resolvedAt ? { at: a.resolvedAt, label: "Resolved", detail: a.resolution ?? undefined } : null,
  ].filter(Boolean) as { at: string; label: string; detail?: string }[];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Alerts", href: "/alerts" }, { label: a.category }]}
        title={a.title}
        badge={<span className="flex items-center gap-1.5"><Badge tone={severityTone(a.severity)} size="sm" className="capitalize">{a.severity}</Badge><Badge tone={ALERT_STATUS_TONE[a.status] ?? "neutral"} size="sm" dot className="capitalize">{a.status}</Badge></span>}
        description={<span>Opened {relativeTime(a.openedAt)}{a.occurrences > 1 && <> · seen {a.occurrences} times, last {relativeTime(a.lastSeenAt)}</>}{a.escalationLevel > 0 && <> · escalation level {a.escalationLevel}</>}</span>}
        actions={can("alerts.manage") && (
          <>
            {a.status === "open" && <Button variant="secondary" leftIcon={<Check className="h-4 w-4" />} onClick={() => act("acknowledge")} loading={busy}>Acknowledge</Button>}
            {open && <Menu trigger={<Button variant="secondary" leftIcon={<Clock className="h-4 w-4" />} rightIcon={<ChevronDown className="h-4 w-4" />}>Snooze</Button>}>{SNOOZE.map(([l, m]) => <MenuItem key={m} onSelect={() => act("snooze", m)}>{l}</MenuItem>)}</Menu>}
            {open && <Button variant="success" leftIcon={<CheckCheck className="h-4 w-4" />} onClick={() => setResolveOpen(true)}>Resolve</Button>}
            {!open && <Button variant="secondary" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={() => act("reopen")} loading={busy}>Reopen</Button>}
          </>
        )}
      />
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-3">
              {a.message && <p className="whitespace-pre-wrap text-sm text-fg">{a.message}</p>}
              {a.aiTriage && (
                <div className="rounded-lg border border-accent/30 bg-accent-soft/30 p-3 text-sm">
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent-hover">AI triage{a.aiTriage.confidence !== undefined && <span className="font-normal normal-case text-fg-subtle">· {Math.round(a.aiTriage.confidence * 100)}% confidence</span>}</div>
                  <p>{a.aiTriage.summary}</p>
                  {a.aiTriage.likelyCause && <p className="mt-1 text-fg-muted">Likely cause: {a.aiTriage.likelyCause}</p>}
                  {!!a.aiTriage.suggestedActions?.length && <ul className="mt-2 list-disc pl-5 text-fg-muted">{a.aiTriage.suggestedActions.map((s) => <li key={s}>{s}</li>)}</ul>}
                </div>
              )}
              {Object.keys(a.data).length > 0 && <Code block className="max-h-64">{JSON.stringify(a.data, null, 2)}</Code>}
              {monitor && <FactList items={[["Monitor", <Link key="m" href={`/monitoring?monitor=${monitor.id}`} className="text-accent-hover hover:underline">{monitor.name}</Link>], ["Type", monitor.type], ["Thresholds", Object.keys(monitor.thresholds).length ? JSON.stringify(monitor.thresholds) : null]]} />}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Notes" description={`${comments.length} comment${comments.length === 1 ? "" : "s"}`} actions={<MessageSquare className="h-4 w-4 text-fg-subtle" />} />
            <CardBody className="space-y-3">
              {comments.map((c) => <div key={c.id} className="rounded-lg bg-surface-2/70 px-3 py-2 text-sm"><div className="mb-0.5 flex items-center gap-2 text-xs text-fg-subtle"><span className="font-medium text-fg-muted">{c.authorName ?? "someone"}</span><span title={formatDateTime(c.createdAt)}>{relativeTime(c.createdAt)}</span></div><p className="whitespace-pre-wrap">{c.body}</p></div>)}
              <form onSubmit={(e) => { e.preventDefault(); void addComment(); }} className="flex gap-2"><Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note for the team…" className="flex-1" /><Button type="submit" variant="secondary" disabled={!comment.trim()} leftIcon={<Send className="h-4 w-4" />}>Post</Button></form>
            </CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Device" />
            <CardBody>
              {!device ? <p className="text-sm text-fg-muted">Organization-wide alert.</p> : (
                <>
                  <Link href={`/devices/${device.id}`} className="flex items-center gap-2 text-sm font-medium hover:text-accent-hover"><PlatformChip platform={device.platform} />{device.name}</Link>
                  <div className="mt-2 flex items-center gap-2"><DeviceStatusBadge status={device.status} />{device.loggedInUser && <span className="text-xs text-fg-muted">{device.loggedInUser}</span>}</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {can("scripts.run") && <Button size="sm" variant="secondary" leftIcon={<SquareTerminal className="h-3.5 w-3.5" />} onClick={() => router.push(`/devices/${device.id}/console`)}>Console</Button>}
                    {can("scripts.run") && <Button size="sm" variant="secondary" leftIcon={<Play className="h-3.5 w-3.5" />} onClick={() => router.push(`/jobs/new?device=${device.id}`)}>Run job</Button>}
                    <Button size="sm" variant="ghost" leftIcon={<Activity className="h-3.5 w-3.5" />} onClick={() => router.push(`/devices/${device.id}/timeline`)}>Timeline</Button>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <ol className="relative ml-2 space-y-3 border-l border-border pl-4 text-sm">{timeline.map((t, i) => <li key={i}><span className="absolute -left-[5px] mt-1.5 h-2 w-2 rounded-full bg-accent" /><div className="flex items-baseline justify-between gap-2"><span className="font-medium">{t.label}</span><span className="text-xs text-fg-subtle" title={formatDateTime(t.at)}>{relativeTime(t.at)}</span></div>{t.detail && <div className="text-xs text-fg-muted">{t.detail}</div>}</li>)}</ol>
            </CardBody>
          </Card>
        </div>
      </div>
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen} title="Resolve alert" description="What fixed it? This becomes part of the device timeline." size="sm" footer={<><Button variant="ghost" onClick={() => setResolveOpen(false)}>Cancel</Button><Button variant="success" onClick={() => act("resolve")} loading={busy}>Resolve</Button></>}>
        <Field label="Resolution" hint="optional"><Textarea autoFocus value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Cleared 12 GB of logs from C:\\; added a retention task." /></Field>
      </Dialog>
    </>
  );
}
