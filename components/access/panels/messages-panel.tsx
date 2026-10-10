"use client";
import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, statusTone } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import { PanelEmpty, PanelSkeleton, Section, type PanelProps } from "./panel-bits";

interface RunRow { id: string; jobId: string; status: string; createdAt: string; finishedAt: string | null; jobType: string; jobName: string; createdByName: string | null; payload: Record<string, unknown> | null }
const TEMPLATES = [
  { label: "Connecting", body: "IT is connecting to your computer now to help with your request. You can keep working." },
  { label: "Save work", body: "Please save your work. IT will restart this computer in 10 minutes to finish updates." },
  { label: "Resolved", body: "Your issue has been resolved. Reply to the ticket if anything else comes up." },
  { label: "Leave on", body: "Please leave this computer switched on tonight so maintenance can run." },
];

/** Send a dialog to the signed-in user (job-backed, queued when offline) and review what was sent before. */
export function MessagesPanel({ detail, can }: PanelProps) {
  const id = detail.device.id;
  const online = detail.device.status === "online";
  const [title, setTitle] = React.useState("Message from IT");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const { data, isLoading, mutate } = useSWR<{ items: RunRow[] }>([`devices/${id}/jobs`, { limit: 100 }]);
  useRealtime(["job.run.updated", "job.created"], (ev) => { if (ev.deviceId === id) mutate(); }, [`device:${id}`]);
  const history = (data?.items ?? []).filter((r) => r.jobType === "message_user");

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`devices/${id}/actions`, { action: "message_user", payload: { title: title.trim() || "Message from IT", body: body.trim() } });
      toast.success(online ? `Message shown on ${detail.device.name}` : "Message queued until the device reconnects");
      setBody("");
      mutate();
    } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not send the message"); } finally { setBusy(false); }
  }

  return (
    <>
      {can("remote.tools") ? (
        <Section title="Send a message" className="rounded-lg border border-border bg-surface-2/50 p-2.5">
          <div className="space-y-2">
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 bg-surface text-[13px]" /></Field>
            <Field label="Message"><Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={detail.device.loggedInUser ? `Shown as a dialog to ${detail.device.loggedInUser}…` : "Shown as a dialog on the user's screen…"} className="min-h-[72px] bg-surface text-[13px]" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send(); }} /></Field>
            <div className="flex flex-wrap gap-1">{TEMPLATES.map((t) => <button key={t.label} type="button" onClick={() => setBody(t.body)} className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-muted hover:border-border-strong hover:text-fg focus-ring">{t.label}</button>)}</div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-fg-subtle">{online ? detail.device.loggedInUser ? `${detail.device.loggedInUser} is signed in` : "Nobody is signed in - the dialog shows at the next sign-in" : "Offline - queued for up to 7 days"}</span>
              <Button size="sm" onClick={send} loading={busy} disabled={!body.trim()} leftIcon={<Send className="h-3.5 w-3.5" />}>Send</Button>
            </div>
          </div>
        </Section>
      ) : null}
      <Section title="Sent messages">
        {isLoading ? <PanelSkeleton rows={3} /> : history.length === 0 ? (
          <PanelEmpty icon={<MessageSquare />} title="No messages sent yet" description="Messages are delivered as a dialog on the user's desktop and recorded as jobs." />
        ) : (
          <ul className="space-y-1.5">
            {history.map((r) => (
              <li key={r.id} className="rounded-lg border border-border bg-surface px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium text-fg">{String(r.payload?.title ?? "Message")}</span>
                  <Badge tone={statusTone(r.status)} size="xs" className="ml-auto shrink-0 capitalize">{r.status.replace("_", " ")}</Badge>
                </div>
                {typeof r.payload?.body === "string" && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[12px] text-fg-muted">{r.payload.body}</p>}
                <div className="mt-1 flex items-center gap-2 text-[10px] text-fg-subtle"><span title={formatDateTime(r.createdAt)}>{relativeTime(r.createdAt)}</span>{r.createdByName && <span>· {r.createdByName}</span>}<Link href={`/jobs/${r.jobId}?run=${r.id}`} className="ml-auto text-accent-hover hover:underline">Job</Link></div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
