"use client";
import * as React from "react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { Bot, Lock, MoreHorizontal, Paperclip, UserRound, Wrench } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Menu, MenuItem } from "@/components/ui/menu";
import { api, ApiClientError } from "@/lib/client/api";
import { formatBytes, formatDateTime, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import type { Comment } from "./ticket-bits";

export function TicketTimeline({ ticketId, comments, userId, canManage, onChanged }: { ticketId: string; comments: Comment[]; userId: string | null; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = React.useState<Comment | null>(null);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try { await api.patch(`tickets/${ticketId}/comments/${editing.id}`, { body: draft.trim() }); toast.success("Comment updated"); setEditing(null); onChanged(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not update"); } finally { setBusy(false); }
  }
  async function remove(c: Comment) {
    try { await api.delete(`tickets/${ticketId}/comments/${c.id}`); toast.success("Comment deleted"); onChanged(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not delete"); }
  }
  async function toggleInternal(c: Comment) {
    try { await api.patch(`tickets/${ticketId}/comments/${c.id}`, { isInternal: !c.isInternal }); toast.success(c.isInternal ? "Now visible to the requester" : "Now an internal note"); onChanged(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not update"); }
  }

  if (!comments.length) return <p className="rounded-lg border border-dashed border-border-strong/70 px-4 py-8 text-center text-sm text-fg-muted">No conversation yet. Reply to the requester or leave an internal note below.</p>;
  return (
    <ol className="space-y-3">
      {comments.map((c) => {
        if (c.authorType === "system") return (
          <li key={c.id} className="flex items-start gap-2.5 px-1 text-xs text-fg-muted">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-fg-subtle" aria-hidden />
            <span className="min-w-0 flex-1">{c.body}{c.authorName && <span className="text-fg-subtle"> · {c.authorName}</span>}</span>
            <time className="shrink-0 text-fg-subtle" title={formatDateTime(c.createdAt)}>{relativeTime(c.createdAt)}</time>
          </li>
        );
        const mine = !!userId && c.authorId === userId;
        const kind = c.authorType === "contact" ? "contact" : c.authorType === "ai" ? "ai" : c.isInternal ? "internal" : "public";
        const frame = { public: "border-border bg-surface-2/70", internal: "border-warning/25 bg-warning-soft/20", contact: "border-accent/25 bg-accent-soft/15", ai: "border-accent/30 bg-accent-soft/20" }[kind];
        const label = { public: "Reply to requester", internal: "Internal note", contact: "Requester", ai: "AI copilot" }[kind];
        const icon = { public: <UserRound className="h-3 w-3" />, internal: <Lock className="h-3 w-3" />, contact: <UserRound className="h-3 w-3" />, ai: <Bot className="h-3 w-3" /> }[kind];
        return (
          <li key={c.id} className={cn("group rounded-xl border px-4 py-3 text-sm print:break-inside-avoid", frame)}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
              {kind === "ai" ? <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-accent-hover"><Bot className="h-3.5 w-3.5" /></span> : <Avatar name={c.authorName} src={c.authorAvatarUrl} size="xs" />}
              <span className="font-medium text-fg">{c.authorName ?? (kind === "ai" ? "AI copilot" : "Someone")}</span>
              <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide", kind === "internal" ? "border-warning/30 text-warning" : kind === "public" ? "border-border-strong text-fg-muted" : "border-accent/30 text-accent-hover")}>{icon}{label}</span>
              <time className="text-fg-subtle" title={formatDateTime(c.createdAt)}>{relativeTime(c.createdAt)}{c.updatedAt !== c.createdAt && " · edited"}</time>
              {(mine || canManage) && (
                <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 print:hidden">
                  <Menu trigger={<Button size="icon-sm" variant="ghost" aria-label="Comment actions"><MoreHorizontal className="h-4 w-4" /></Button>}>
                    {c.authorType !== "contact" && <MenuItem onSelect={() => { setEditing(c); setDraft(c.body); }}>Edit</MenuItem>}
                    {c.authorType !== "contact" && <MenuItem onSelect={() => toggleInternal(c)}>{c.isInternal ? "Make visible to requester" : "Make internal"}</MenuItem>}
                    <MenuItem danger onSelect={() => remove(c)}>Delete</MenuItem>
                  </Menu>
                </span>
              )}
            </div>
            <div className="prose-mw text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"><ReactMarkdown>{c.body}</ReactMarkdown></div>
            {c.attachments.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {c.attachments.map((a) => { const href = /^https?:\/\//i.test(a.id) ? a.id : undefined; const chip = <><Paperclip className="h-3 w-3" />{a.name}{a.size > 0 && <span className="text-fg-subtle">{formatBytes(a.size)}</span>}</>; return <li key={a.id}>{href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-accent-hover hover:underline">{chip}</a> : <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-fg-muted">{chip}</span>}</li>; })}
              </ul>
            )}
          </li>
        );
      })}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Edit comment" size="md" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={busy} disabled={!draft.trim()}>Save</Button></>}>
        <Textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} />
      </Dialog>
      <Wrench className="hidden" />
    </ol>
  );
}
