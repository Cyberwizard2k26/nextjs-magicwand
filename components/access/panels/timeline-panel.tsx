"use client";
import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { Bell, History, Package, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/misc";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { PanelEmpty, PanelSkeleton, type PanelProps } from "./panel-bits";

interface Entry { id: string; ts: string; kind: "event" | "software" | "job" | "alert"; severity: "info" | "warning" | "error" | "critical"; title: string; detail?: string | null; href?: string }
const KIND_ICON = { event: Zap, software: Package, job: Play, alert: Bell } as const;
const SEV = { info: "border-border bg-surface-2 text-fg-muted", warning: "border-warning/40 bg-warning-soft text-warning", error: "border-danger/40 bg-danger-soft text-danger", critical: "border-critical/50 bg-danger-soft text-critical" } as const;
const KINDS: { k: Entry["kind"]; label: string }[] = [{ k: "event", label: "Events" }, { k: "software", label: "Software" }, { k: "job", label: "Jobs" }, { k: "alert", label: "Alerts" }];

export function TimelinePanel({ detail }: PanelProps) {
  const id = detail.device.id;
  const [kinds, setKinds] = React.useState<Set<Entry["kind"]>>(new Set(["event", "software", "job", "alert"]));
  const [older, setOlder] = React.useState<Entry[]>([]);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const { data, isLoading, mutate } = useSWR<{ items: Entry[] }>([`devices/${id}/timeline`, { limit: 40 }]);
  useRealtime(["device.event", "job.run.updated", "alert.*", "session.*", "device.online", "device.offline", "software.*"], (ev) => { if (ev.deviceId === id) mutate(); }, [`device:${id}`]);
  const all = [...(data?.items ?? []), ...older];
  const items = all.filter((e) => kinds.has(e.kind));
  const toggle = (k: Entry["kind"]) => setKinds((s) => { const n = new Set(s); if (n.has(k)) { if (n.size > 1) n.delete(k); } else n.add(k); return n; });
  async function more() {
    const last = all[all.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try { const r = await api.get<{ items: Entry[] }>(`devices/${id}/timeline`, { limit: 40, before: last.ts }); setOlder((o) => [...o, ...r.items]); } finally { setLoadingMore(false); }
  }
  let lastDay = "";
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1">{KINDS.map(({ k, label }) => <Pill key={k} active={kinds.has(k)} onClick={() => toggle(k)} className="h-6 px-2 text-[11px]">{label}</Pill>)}</div>
      {isLoading ? <PanelSkeleton rows={8} /> : items.length === 0 ? (
        <PanelEmpty icon={<History />} title="Nothing recorded yet" description="Boots, sign-ins, software changes, jobs and alerts appear here as they happen." />
      ) : (
        <ol className="relative ml-2.5 border-l border-border pl-5">
          {items.map((e) => {
            const Icon = KIND_ICON[e.kind];
            const day = new Date(e.ts).toDateString();
            const showDay = day !== lastDay;
            lastDay = day;
            const body = (
              <div className="min-w-0">
                <div className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate text-[13px] text-fg">{e.title}</span><span className="shrink-0 text-[10px] text-fg-subtle" title={formatDateTime(e.ts)}>{new Date(e.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span></div>
                {e.detail && <div className="truncate text-[11px] text-fg-muted">{e.detail}</div>}
              </div>
            );
            return (
              <React.Fragment key={e.id}>
                {showDay && <li className="relative -ml-5 mb-1.5 mt-3 pl-5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle first:mt-0">{new Date(e.ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</li>}
                <li className="relative mb-2">
                  <span className={cn("absolute -left-[29px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border [&>svg]:h-2.5 [&>svg]:w-2.5", SEV[e.severity])}><Icon /></span>
                  {e.href ? <Link href={e.href} className="-mx-1.5 block rounded-md px-1.5 py-0.5 hover:bg-surface-hover/70 focus-ring">{body}</Link> : <div className="py-0.5">{body}</div>}
                </li>
              </React.Fragment>
            );
          })}
        </ol>
      )}
      {all.length >= 40 && <div className="mt-2 flex justify-center"><Button variant="ghost" size="xs" onClick={more} loading={loadingMore}>Load older</Button></div>}
    </>
  );
}
