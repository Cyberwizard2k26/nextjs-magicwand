"use client";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Pin, PinOff, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch, Textarea } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Avatar } from "@/components/ui/misc";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import type { DeviceNote } from "@/lib/api/contracts/device-notes";
import { cn } from "@/lib/util/cn";
import { PanelEmpty, PanelSkeleton, type PanelProps } from "./panel-bits";

export function NotesPanel({ detail, can, now }: PanelProps) {
  const id = detail.device.id;
  const { data, isLoading, mutate } = useSWR<{ items: DeviceNote[]; total: number; pinned: number }>(`devices/${id}/notes`);
  useRealtime(["device.note.*"], (ev) => { if (ev.deviceId === id) mutate(); }, [`device:${id}`]);
  const [body, setBody] = React.useState("");
  const [pinned, setPinned] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; body: string } | null>(null);
  const [deleting, setDeleting] = React.useState<DeviceNote | null>(null);
  const write = can("devices.manage");

  async function add() {
    if (!body.trim()) return;
    setBusy(true);
    try { await api.post(`devices/${id}/notes`, { body: body.trim(), pinned }); setBody(""); setPinned(false); toast.success("Note added"); mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not add the note"); } finally { setBusy(false); }
  }
  async function patch(note: DeviceNote, p: { body?: string; pinned?: boolean }, ok: string) {
    try { await api.patch(`devices/${id}/notes/${note.id}`, p); toast.success(ok); setEditing(null); mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not update the note"); }
  }
  async function remove(note: DeviceNote) {
    try { await api.delete(`devices/${id}/notes/${note.id}`); toast.success("Note deleted"); mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not delete the note"); }
  }
  const items = data?.items ?? [];

  return (
    <>
      {write && (
        <div className="mb-4 rounded-lg border border-border bg-surface-2/50 p-2.5">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Add a note about ${detail.device.name}: quirks, warranty, who to call…`} className="min-h-[72px] bg-surface text-[13px]" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") add(); }} aria-label="New note" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <Switch checked={pinned} onCheckedChange={setPinned} label="Pin to top" className="[&_span:last-child]:text-xs" />
            <Button size="sm" onClick={add} loading={busy} disabled={!body.trim()} leftIcon={<StickyNote className="h-3.5 w-3.5" />}>Add note <span className="ml-1 hidden text-[10px] opacity-70 @sm/detail:inline">Ctrl+↵</span></Button>
          </div>
        </div>
      )}
      {isLoading ? <PanelSkeleton rows={4} /> : items.length === 0 ? (
        <PanelEmpty icon={<StickyNote />} title="No notes yet" description={write ? "Notes are shared with every technician and surface in the AI copilot's context for this machine." : "Nobody has left a note on this machine."} />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className={cn("group rounded-lg border p-2.5", n.pinned ? "border-warning/30 bg-warning-soft/20" : "border-border bg-surface")}>
              <div className="mb-1 flex items-center gap-2">
                <Avatar name={n.authorName} size="xs" />
                <span className="truncate text-xs font-medium text-fg">{n.authorName ?? "Unknown"}</span>
                {n.pinned && <Pin className="h-3 w-3 shrink-0 text-warning" aria-label="Pinned" />}
                <span className="ml-auto shrink-0 text-[10px] text-fg-subtle" title={formatDateTime(n.createdAt)}>{relativeTime(n.createdAt, now || undefined)}{n.updatedAt !== n.createdAt ? " · edited" : ""}</span>
                {write && (
                  <Menu trigger={<button type="button" className="rounded p-0.5 text-fg-subtle opacity-70 hover:bg-surface-hover hover:text-fg focus-ring group-hover:opacity-100" aria-label="Note actions"><MoreHorizontal className="h-3.5 w-3.5" /></button>}>
                    <MenuItem icon={n.pinned ? <PinOff /> : <Pin />} onSelect={() => patch(n, { pinned: !n.pinned }, n.pinned ? "Note unpinned" : "Note pinned")}>{n.pinned ? "Unpin" : "Pin to top"}</MenuItem>
                    <MenuItem icon={<Pencil />} onSelect={() => setEditing({ id: n.id, body: n.body })}>Edit</MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(n)}>Delete</MenuItem>
                  </Menu>
                )}
              </div>
              {editing?.id === n.id ? (
                <div>
                  <Textarea autoFocus value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} className="min-h-[64px] text-[13px]" aria-label="Edit note" />
                  <div className="mt-1.5 flex justify-end gap-1.5"><Button size="xs" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button size="xs" onClick={() => patch(n, { body: editing.body.trim() }, "Note updated")} disabled={!editing.body.trim()}>Save</Button></div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">{n.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleting && <ConfirmDialog open onOpenChange={(o) => !o && setDeleting(null)} title="Delete this note?" description={<span className="line-clamp-3 text-fg">“{deleting.body}”</span>} confirmLabel="Delete" onConfirm={() => remove(deleting)} />}
    </>
  );
}
