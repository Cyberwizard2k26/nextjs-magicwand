"use client";
import * as React from "react";
import { toast } from "sonner";
import { BookmarkPlus, ChevronDown, Lock, MessageSquareReply, Paperclip, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Tabs } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/misc";
import { useLocalStorage } from "@/lib/client/hooks";
import { api, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/util/cn";

interface Canned { id: string; title: string; body: string }
const DEFAULT_CANNED: Canned[] = [
  { id: "ack", title: "Acknowledge", body: "Hi {name}, thanks for reaching out. I am looking into this now and will update you shortly." },
  { id: "more-info", title: "Need more information", body: "Hi {name}, could you tell me when this started and whether anyone else is affected? A screenshot of the error helps too." },
  { id: "remote", title: "Remote session request", body: "Hi {name}, I would like to connect to your computer to take a closer look. Please leave it on and signed in; you will see a prompt when I connect." },
  { id: "resolved", title: "Resolved - please confirm", body: "Hi {name}, this should be fixed now. Could you confirm everything works on your side? If I do not hear back within two business days I will close the ticket." },
];

export function TicketReply({ ticketId, status, requesterName, onPosted }: { ticketId: string; status: string; requesterName: string | null; onPosted: () => void }) {
  const [mode, setMode] = React.useState<"public" | "internal">("public");
  const [body, setBody] = React.useState("");
  const [thenStatus, setThenStatus] = React.useState("");
  const [attachments, setAttachments] = React.useState<{ id: string; name: string; size: number }[]>([]);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [attachName, setAttachName] = React.useState("");
  const [attachUrl, setAttachUrl] = React.useState("");
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveTitle, setSaveTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [canned, setCanned] = useLocalStorage<Canned[]>("mw.tickets.canned", DEFAULT_CANNED);
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const firstName = requesterName?.split(/\s+/)[0] ?? "there";
  function insert(c: Canned) {
    const text = c.body.replace(/\{name\}/g, firstName);
    setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${text}` : text));
    ref.current?.focus();
  }
  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`tickets/${ticketId}/comments`, { body: body.trim(), isInternal: mode === "internal", attachments });
      if (thenStatus && thenStatus !== status) await api.patch(`tickets/${ticketId}`, { status: thenStatus });
      toast.success(mode === "internal" ? "Internal note added" : "Reply sent");
      setBody(""); setAttachments([]); setThenStatus("");
      onPosted();
    } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not post"); } finally { setBusy(false); }
  }
  const closed = status === "resolved" || status === "closed";

  return (
    <div className={cn("rounded-xl border p-3 print:hidden", mode === "internal" ? "border-warning/30 bg-warning-soft/10" : "border-border bg-surface-2/40")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Tabs variant="pills" value={mode} onValueChange={(v) => setMode(v as "public" | "internal")} tabs={[{ value: "public", label: "Reply to user", icon: <MessageSquareReply /> }, { value: "internal", label: "Internal note", icon: <Lock /> }]} />
        <Menu trigger={<Button size="sm" variant="ghost" rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>Canned responses</Button>} align="end">
          <MenuLabel>Insert</MenuLabel>
          {canned.map((c) => <MenuItem key={c.id} onSelect={() => insert(c)}>{c.title}</MenuItem>)}
          {!canned.length && <MenuItem disabled>No saved responses</MenuItem>}
          <MenuSeparator />
          <MenuItem icon={<BookmarkPlus />} disabled={!body.trim()} onSelect={() => { setSaveTitle(""); setSaveOpen(true); }}>Save current text as canned…</MenuItem>
          {canned.length > 0 && <MenuItem icon={<Trash2 />} danger onSelect={() => setCanned([])}>Clear saved responses</MenuItem>}
        </Menu>
      </div>
      <Textarea ref={ref} value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder={mode === "internal" ? "Notes for the team - the requester never sees these." : `Write to ${requesterName ?? "the requester"}… Markdown is supported.`}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }} aria-label={mode === "internal" ? "Internal note" : "Reply"} />
      {attachments.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">{attachments.map((a) => <li key={a.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs"><Paperclip className="h-3 w-3 text-fg-subtle" />{a.name}<button type="button" onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))} aria-label={`Remove ${a.name}`} className="rounded text-fg-muted hover:text-fg"><X className="h-3 w-3" /></button></li>)}</ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" leftIcon={<Paperclip className="h-3.5 w-3.5" />} onClick={() => { setAttachName(""); setAttachUrl(""); setAttachOpen(true); }}>Attach reference</Button>
        <Select value={thenStatus} onChange={(e) => setThenStatus(e.target.value)} className="h-8 w-auto text-xs" aria-label="Status after posting">
          <option value="">Keep status</option>
          {!closed && <option value="pending">then wait on user</option>}
          {!closed && <option value="resolved">then mark resolved</option>}
          {status === "resolved" && <option value="closed">then close</option>}
          {closed && <option value="open">then reopen</option>}
        </Select>
        <span className="ml-auto hidden text-[11px] text-fg-subtle sm:inline"><Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> to send</span>
        <Button size="sm" onClick={submit} loading={busy} disabled={!body.trim()} leftIcon={<Send className="h-3.5 w-3.5" />} variant={mode === "internal" ? "secondary" : "primary"}>{mode === "internal" ? "Add note" : "Send reply"}</Button>
      </div>
      <Dialog open={attachOpen} onOpenChange={setAttachOpen} title="Attach a reference" description="Link a file, knowledge-base article or screenshot by URL. Binary uploads are kept out of the ticket store." size="sm"
        footer={<><Button variant="ghost" onClick={() => setAttachOpen(false)}>Cancel</Button><Button disabled={!attachName.trim()} onClick={() => { setAttachments((a) => [...a, { id: attachUrl.trim() || crypto.randomUUID(), name: attachName.trim(), size: 0 }]); setAttachOpen(false); }}>Attach</Button></>}>
        <div className="space-y-3">
          <Field label="Name"><Input autoFocus value={attachName} onChange={(e) => setAttachName(e.target.value)} placeholder="screenshot-outlook.png" /></Field>
          <Field label="URL" hint="optional"><Input value={attachUrl} onChange={(e) => setAttachUrl(e.target.value)} placeholder="https://" /></Field>
        </div>
      </Dialog>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen} title="Save canned response" description="Stored in this browser. Use {name} for the requester's first name." size="sm"
        footer={<><Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button><Button disabled={!saveTitle.trim()} onClick={() => { setCanned((c) => [...c, { id: crypto.randomUUID(), title: saveTitle.trim(), body }]); setSaveOpen(false); toast.success("Saved"); }}>Save</Button></>}>
        <Field label="Title"><Input autoFocus value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} placeholder="Password reset instructions" /></Field>
      </Dialog>
    </div>
  );
}
