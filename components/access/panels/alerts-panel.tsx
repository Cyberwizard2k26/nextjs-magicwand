"use client";
import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import { Bell, BellOff, Check, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, severityTone } from "@/components/ui/badge";
import { Pill } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/menu";
import { useRealtime } from "@/components/shell/realtime-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { PanelEmpty, PanelSkeleton, Section, type PanelProps } from "./panel-bits";

interface AlertRow { id: string; severity: string; status: string; title: string; message: string | null; category: string; occurrences: number; openedAt: string; lastSeenAt: string; snoozedUntil: string | null }
const TONE: Record<string, "danger" | "warning" | "info" | "success" | "neutral"> = { open: "danger", acknowledged: "warning", snoozed: "info", resolved: "success" };
const SCOPES = [["open,acknowledged,snoozed", "Active"], ["resolved", "Resolved"], ["", "All"]] as const;

export function AlertsPanel({ detail, can }: PanelProps) {
  const id = detail.device.id;
  const [scope, setScope] = React.useState<string>(SCOPES[0][0]);
  const { data, isLoading, mutate } = useSWR<{ items: AlertRow[]; total: number }>(["alerts", { deviceId: id, status: scope || undefined, pageSize: 50 }]);
  useRealtime(["alert.*"], (ev) => { if (ev.deviceId === id) mutate(); }, [`device:${id}`]);
  const items = data?.items ?? [];
  async function act(action: "acknowledge" | "resolve", ids: string[]) {
    try { const r = await api.post<{ updated: number }>("alerts/bulk", { action, ids }); toast.success(`${r.updated} alert${r.updated === 1 ? "" : "s"} ${action === "acknowledge" ? "acknowledged" : "resolved"}`); mutate(); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Failed"); }
  }
  const actionable = items.filter((a) => a.status !== "resolved").map((a) => a.id);

  return (
    <Section title={<>Alerts{data && scope === SCOPES[0][0] && data.total > 0 && <Badge tone="danger" size="xs" className="ml-2">{data.total} active</Badge>}</>} action={can("alerts.manage") && actionable.length > 1 && <Button size="xs" variant="ghost" leftIcon={<CheckCheck className="h-3 w-3" />} onClick={() => act("resolve", actionable)}>Resolve all</Button>}>
      <div className="mb-2 flex flex-wrap gap-1">{SCOPES.map(([v, l]) => <Pill key={v} active={scope === v} onClick={() => setScope(v)} className="h-6 px-2 text-[11px]">{l}</Pill>)}</div>
      {isLoading ? <PanelSkeleton rows={4} /> : items.length === 0 ? (
        <PanelEmpty icon={<BellOff />} title={scope === SCOPES[0][0] ? "No active alerts" : "No alerts"} description="Monitors and posture checks raise alerts here; acknowledging and resolving are audited." />
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <li key={a.id} className={cn("rounded-lg border px-2.5 py-2", a.severity === "critical" && a.status === "open" ? "border-danger/40 bg-danger-soft/20" : "border-border bg-surface")}>
              <div className="flex items-start gap-2">
                <Badge tone={severityTone(a.severity)} size="xs" className="mt-px w-[58px] shrink-0 justify-center capitalize">{a.severity}</Badge>
                <div className="min-w-0 flex-1">
                  <Link href={`/alerts/${a.id}`} className="block truncate text-[13px] font-medium text-fg hover:text-accent-hover focus-ring rounded">{a.title}</Link>
                  {a.message && <div className="truncate text-[11px] text-fg-muted">{a.message}</div>}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-fg-subtle">
                    <Badge tone={TONE[a.status] ?? "neutral"} size="xs" dot className="capitalize">{a.status}{a.status === "snoozed" && a.snoozedUntil ? ` · ${relativeTime(a.snoozedUntil)}` : ""}</Badge>
                    <span className="capitalize">{a.category}</span>
                    {a.occurrences > 1 && <span className="text-warning">{a.occurrences}×</span>}
                    <Tooltip content={formatDateTime(a.openedAt)}><span>opened {relativeTime(a.openedAt)}</span></Tooltip>
                  </div>
                </div>
                {can("alerts.manage") && a.status !== "resolved" && (
                  <span className="flex shrink-0 gap-0.5">
                    {a.status === "open" && <Tooltip content="Acknowledge"><Button size="icon-sm" variant="ghost" aria-label="Acknowledge" onClick={() => act("acknowledge", [a.id])}><Check className="h-3.5 w-3.5" /></Button></Tooltip>}
                    <Tooltip content="Resolve"><Button size="icon-sm" variant="ghost" aria-label="Resolve" onClick={() => act("resolve", [a.id])}><CheckCheck className="h-3.5 w-3.5" /></Button></Tooltip>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Bell className="hidden" />
    </Section>
  );
}
