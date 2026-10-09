"use client";
import * as React from "react";
import useSWR from "swr";
import { Check, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/lib/client/hooks";
import { cn } from "@/lib/util/cn";
import { PlatformChip, StatusDotLive, type DeviceRow } from "./device-bits";

/** Searchable multi-select of devices. `value` holds ids; names are cached so chips stay readable. */
export function DevicePicker({ value, onChange, className }: { value: string[]; onChange: (ids: string[]) => void; className?: string }) {
  const [q, setQ] = React.useState("");
  const dq = useDebounce(q, 200);
  const { data, isLoading } = useSWR<{ items: DeviceRow[] }>(["devices", { q: dq || undefined, pageSize: 30 }]);
  const [names, setNames] = React.useState<Record<string, DeviceRow>>({});
  React.useEffect(() => { if (data?.items) setNames((n) => { const next = { ...n }; for (const d of data.items) next[d.id] = d; return next; }); }, [data]);
  // Resolve names for ids we were given but have not listed yet (deep links).
  const unknown = value.filter((id) => !names[id]);
  const { data: resolved } = useSWR<{ device: DeviceRow }[]>(unknown.length ? ["device-names", ...unknown] : null, async () => Promise.all(unknown.map((id) => import("@/lib/client/api").then(({ api }) => api.get<{ device: DeviceRow }>(`devices/${id}`)))));
  React.useEffect(() => { if (resolved) setNames((n) => { const next = { ...n }; for (const r of resolved) next[r.device.id] = r.device; return next; }); }, [resolved]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const items = data?.items ?? [];
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      <div className="border-b border-border p-2"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search devices by name, user, IP, tag…" leftIcon={<Search />} className="h-8" /></div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border bg-surface-2/60 p-2">
          {value.map((id) => <button key={id} type="button" onClick={() => toggle(id)} className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-xs text-fg hover:border-danger/50 focus-ring"><StatusDotLive status={names[id]?.status ?? "offline"} />{names[id]?.name ?? id.slice(0, 8)}<X className="h-3 w-3 text-fg-subtle" /></button>)}
          <button type="button" onClick={() => onChange([])} className="ml-auto text-xs text-fg-muted hover:text-fg">Clear all</button>
        </div>
      )}
      <ul className="max-h-64 overflow-auto">
        {isLoading && !items.length && <li className="px-3 py-6 text-center text-xs text-fg-subtle">Searching…</li>}
        {items.map((d) => {
          const on = value.includes(d.id);
          return (
            <li key={d.id}>
              <button type="button" onClick={() => toggle(d.id)} className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-surface-hover focus-ring", on && "bg-accent-soft/40")}>
                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-accent bg-accent text-accent-fg" : "border-border-strong")}>{on && <Check className="h-3 w-3" />}</span>
                <StatusDotLive status={d.status} />
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <span className="truncate text-xs text-fg-subtle">{d.loggedInUser ?? d.siteName ?? ""}</span>
                <PlatformChip platform={d.platform} />
              </button>
            </li>
          );
        })}
        {!isLoading && !items.length && <li className="px-3 py-6 text-center text-xs text-fg-subtle">No devices found.</li>}
      </ul>
      {!!items.length && <div className="border-t border-border px-3 py-1.5 text-[11px] text-fg-subtle"><button type="button" className="hover:text-fg" onClick={() => onChange([...new Set([...value, ...items.map((d) => d.id)])])}>Select all {items.length} shown</button></div>}
    </div>
  );
}
