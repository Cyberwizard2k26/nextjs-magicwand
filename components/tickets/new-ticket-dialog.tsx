"use client";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Eye, PenLine } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/util/cn";
import { ContactPicker, type ContactLite } from "./contact-picker";
import { DeviceSelect } from "./device-select";
import { PRIORITIES, TYPES, type Assignee, type TicketRow } from "./ticket-bits";

export interface NewTicketInitial { title?: string; deviceId?: string | null; contactId?: string | null; alertId?: string | null; description?: string }

export function NewTicketDialog({ open, onOpenChange, onCreated, initial, canCreateContacts }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (t: TicketRow) => void; initial?: NewTicketInitial; canCreateContacts: boolean }) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [preview, setPreview] = React.useState(false);
  const [priority, setPriority] = React.useState("normal");
  const [type, setType] = React.useState<string>("incident");
  const [category, setCategory] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [siteId, setSiteId] = React.useState("");
  const [deviceId, setDeviceId] = React.useState<string | null>(null);
  const [contact, setContact] = React.useState<ContactLite | null>(null);
  const [tags, setTags] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { data: assignees } = useSWR<{ items: Assignee[] }>(open ? "tickets/assignees" : null);
  const { data: sites } = useSWR<{ items: { id: string; name: string }[] }>(open ? "sites" : null);
  const { data: initialContact } = useSWR<{ contact: ContactLite }>(open && initial?.contactId ? `contacts/${initial.contactId}` : null);

  // Reset the form each time the dialog opens, seeding it from deep-link parameters.
  React.useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? ""); setDescription(initial?.description ?? ""); setPreview(false); setPriority("normal"); setType(initial?.alertId ? "alert" : "incident"); setCategory(""); setAssigneeId(""); setSiteId("");
    setDeviceId(initial?.deviceId ?? null); setContact(null); setTags(""); setDueAt(""); setError(null); setBusy(false);
  }, [open, initial?.title, initial?.description, initial?.alertId, initial?.deviceId, initial?.contactId]);
  React.useEffect(() => { if (open && initialContact?.contact) setContact(initialContact.contact); }, [open, initialContact]);

  async function submit() {
    if (!title.trim()) { setError("A title is required"); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ ticket: TicketRow }>("tickets", {
        title: title.trim(), description: description.trim() || undefined, priority, type, category: category.trim() || undefined, assigneeId: assigneeId || undefined, siteId: siteId || undefined,
        deviceId: deviceId ?? undefined, contactId: contact?.id ?? undefined, alertId: initial?.alertId ?? undefined,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean), dueAt: dueAt ? new Date(dueAt).toISOString() : undefined, source: "manual",
      });
      toast.success(`Ticket #${r.ticket.number} created`);
      onOpenChange(false);
      onCreated?.(r.ticket);
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Could not create the ticket"); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New ticket" description={initial?.alertId ? "This ticket will be linked to the alert it was opened from." : "Capture who is affected, which machine and how urgent it is."} size="lg"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!title.trim()}>Create ticket</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Title" error={error ?? undefined}><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary of the problem or request" maxLength={200} /></Field>
        <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <Field label="Requester" hint="contact"><ContactPicker value={contact} onChange={setContact} deviceId={deviceId} canCreate={canCreateContacts} /></Field>
          <Field label="Device" hint="optional"><DeviceSelect value={deviceId} onChange={(id) => setDeviceId(id)} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4 [&>*]:min-w-0">
          <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t} value={t} className="capitalize">{t[0].toUpperCase() + t.slice(1)}</option>)}</Select></Field>
          <Field label="Assignee"><Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}><option value="">Unassigned</option>{assignees?.items.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.openTickets} open)</option>)}</Select></Field>
          <Field label="Site"><Select value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">From device / contact</option>{sites?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 [&>*]:min-w-0">
          <Field label="Category" hint="optional"><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="email, printing, access…" list="ticket-categories" /><datalist id="ticket-categories">{["email", "printing", "access", "hardware", "software", "network", "security", "onboarding"].map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Tags" hint="comma separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, outlook" /></Field>
          <Field label="Due" hint="optional"><Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></Field>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-medium text-fg-muted">Description <span className="font-normal text-fg-subtle">(Markdown)</span></span><button type="button" onClick={() => setPreview((p) => !p)} className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg focus-ring rounded">{preview ? <><PenLine className="h-3 w-3" /> Edit</> : <><Eye className="h-3 w-3" /> Preview</>}</button></div>
          {preview ? <div className={cn("prose-mw min-h-[96px] rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm", !description && "text-fg-subtle")}>{description ? <ReactMarkdown>{description}</ReactMarkdown> : "Nothing to preview."}</div> : <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened, when it started, what has been tried…" rows={5} />}
        </div>
      </form>
    </Dialog>
  );
}
