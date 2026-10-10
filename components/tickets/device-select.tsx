"use client";
import * as React from "react";
import useSWR from "swr";
import { Monitor, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/lib/client/hooks";
import { cn } from "@/lib/util/cn";
import { PlatformChip, StatusDotLive, type DeviceRow } from "@/components/devices/device-bits";

/** Compact single-device picker (search as you type). `value` is a device id or null. */
export function DeviceSelect({ value, onChange, placeholder = "Search devices by name, user, IP…", className, autoFocus }: { value: string | null; onChange: (id: string | null, device?: DeviceRow) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const dq = useDebounce(q, 200);
  const { data, isLoading } = useSWR<{ items: DeviceRow[] }>(open ? ["devices", { q: dq || undefined, pageSize: 12 }] : null);
  const { data: selected } = useSWR<{ device: DeviceRow }>(value ? `devices/${value}` : null);
  const items = data?.items ?? [];
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (value) {
    const d = selected?.device;
    return (
      <div className={cn("flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-sm", className)}>
        <StatusDotLive status={d?.status ?? "offline"} />
        <span className="min-w-0 flex-1 truncate">{d?.name ?? "Loading…"}</span>
        {d?.loggedInUser && <span className="hidden truncate text-xs text-fg-subtle sm:inline">{d.loggedInUser}</span>}
        {d && <PlatformChip platform={d.platform} />}
        <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 text-fg-muted hover:text-fg focus-ring" aria-label="Clear device"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  }
  return (
    <div ref={ref} className={cn("relative", className)}>
      <Input value={q} autoFocus={autoFocus} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder} leftIcon={<Search />} aria-expanded={open} aria-haspopup="listbox" />
      {open && (
        <ul role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-lg border border-border-strong bg-surface p-1 shadow-2xl animate-in">
          {isLoading && !items.length && <li className="px-3 py-4 text-center text-xs text-fg-subtle">Searching…</li>}
          {items.map((d) => (
            <li key={d.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => { onChange(d.id, d); setOpen(false); setQ(""); }} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-hover focus-ring">
                <StatusDotLive status={d.status} />
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <span className="truncate text-xs text-fg-subtle">{d.loggedInUser ?? d.siteName ?? ""}</span>
                <PlatformChip platform={d.platform} />
              </button>
            </li>
          ))}
          {!isLoading && !items.length && <li className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-fg-subtle"><Monitor className="h-3.5 w-3.5" /> No devices match.</li>}
        </ul>
      )}
    </div>
  );
}
