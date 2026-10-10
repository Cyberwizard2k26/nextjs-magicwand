"use client";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Crown, Plus, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { useDebounce } from "@/lib/client/hooks";
import { api, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/util/cn";
import type { ContactRow } from "./ticket-bits";

export interface ContactLite { id: string; name: string; email: string | null; phone?: string | null; isVip?: boolean }

/** Search-and-select a contact; typing an unknown name offers inline creation. */
export function ContactPicker({ value, onChange, deviceId, canCreate, className, autoFocus }: { value: ContactLite | null; onChange: (c: ContactLite | null) => void; deviceId?: string | null; canCreate: boolean; className?: string; autoFocus?: boolean }) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const dq = useDebounce(q, 200);
  const { data, isLoading } = useSWR<{ items: ContactRow[] }>(open ? ["contacts", { q: dq || undefined, pageSize: 8 }] : null);
  const { data: forDevice } = useSWR<{ items: ContactRow[] }>(deviceId && !value ? ["contacts", { deviceId, pageSize: 5 }] : null);
  const items = data?.items ?? [];
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setCreating(false); } };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function create() {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ contact: ContactLite }>("contacts", { name: q.trim(), email: email.trim() || null, phone: phone.trim() || null, deviceIds: deviceId ? [deviceId] : undefined });
      toast.success(`Contact ${r.contact.name} created`);
      onChange(r.contact);
      setOpen(false); setCreating(false); setQ(""); setEmail(""); setPhone("");
    } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Could not create contact"); } finally { setBusy(false); }
  }

  if (value) {
    return (
      <div className={cn("flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-sm", className)}>
        <Avatar name={value.name} size="xs" />
        <span className="min-w-0 flex-1 truncate">{value.name}{value.isVip && <Crown className="ml-1 inline h-3 w-3 text-warning" aria-label="VIP" />}</span>
        {value.email && <span className="hidden truncate text-xs text-fg-subtle sm:inline">{value.email}</span>}
        <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 text-fg-muted hover:text-fg focus-ring" aria-label="Clear contact"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  }
  const exact = items.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());
  const suggestions = !q && forDevice?.items?.length ? forDevice.items : [];
  return (
    <div ref={ref} className={cn("relative", className)}>
      <Input value={q} autoFocus={autoFocus} onChange={(e) => { setQ(e.target.value); setOpen(true); setCreating(false); }} onFocus={() => setOpen(true)} placeholder="Search people by name, email or phone…" leftIcon={<Search />} aria-expanded={open} aria-haspopup="listbox" />
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border-strong bg-surface shadow-2xl animate-in">
          {!creating ? (
            <ul role="listbox" className="max-h-60 overflow-auto p-1">
              {suggestions.length > 0 && <li className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Uses this device</li>}
              {(suggestions.length ? suggestions : items).map((c) => (
                <li key={c.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => { onChange(c); setOpen(false); setQ(""); }} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-hover focus-ring">
                    <Avatar name={c.name} size="xs" />
                    <span className="min-w-0 flex-1 truncate">{c.name}{c.isVip && <Crown className="ml-1 inline h-3 w-3 text-warning" aria-label="VIP" />}</span>
                    <span className="truncate text-xs text-fg-subtle">{c.email ?? c.phone ?? c.siteName ?? ""}</span>
                  </button>
                </li>
              ))}
              {isLoading && !items.length && <li className="px-3 py-3 text-center text-xs text-fg-subtle">Searching…</li>}
              {!isLoading && !items.length && !suggestions.length && <li className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-fg-subtle"><UserRound className="h-3.5 w-3.5" /> {q ? "No contact matches." : "Type to search contacts."}</li>}
              {canCreate && q.trim() && !exact && (
                <li className="border-t border-border p-1">
                  <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-accent-hover hover:bg-surface-hover focus-ring"><Plus className="h-4 w-4" /> Create contact “{q.trim()}”</button>
                </li>
              )}
            </ul>
          ) : (
            <form className="space-y-2 p-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
              <div className="text-xs font-medium text-fg">New contact: <span className="text-fg-muted">{q.trim()}</span></div>
              <Field label="Email" hint="optional"><Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></Field>
              <Field label="Phone" hint="optional"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" /></Field>
              <div className="flex justify-end gap-2 pt-1"><Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Back</Button><Button size="sm" type="submit" loading={busy}>Create and select</Button></div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
