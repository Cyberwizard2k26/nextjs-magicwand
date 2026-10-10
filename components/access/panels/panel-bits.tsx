"use client";
import * as React from "react";
import { cn } from "@/lib/util/cn";
import type { DeviceDetail } from "@/components/devices/device-context";
import type { DeviceActions, LiveSample } from "../access-model";

export type PanelId = "general" | "timeline" | "notes" | "messages" | "commands" | "toolbox" | "jobs" | "alerts" | "ai";

export interface PanelProps {
  detail: DeviceDetail;
  can: (p: string) => boolean;
  actions: DeviceActions;
  newestAgentVersion: string | null;
  live?: LiveSample;
  now: number;
  goTo: (panel: PanelId) => void;
}

export function Section({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("mb-4 last:mb-0", className)}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Key / value row for the General panel; wraps to two columns when the detail pane is wide enough. */
export function KV({ label, children, mono, className }: { label: string; children: React.ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 py-1.5", className)}>
      <dt className="text-[11px] text-fg-subtle">{label}</dt>
      <dd className={cn("min-w-0 truncate text-[13px] text-fg", mono && "mono text-xs")}>{children ?? <span className="text-fg-subtle">—</span>}</dd>
    </div>
  );
}

export function PanelEmpty({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong/70 px-4 py-8 text-center">
      {icon && <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-hover [&>svg]:h-4.5 [&>svg]:w-4.5">{icon}</div>}
      <div className="text-sm font-medium text-fg">{title}</div>
      {description && <p className="mt-1 max-w-xs text-xs text-fg-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function PanelSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="space-y-2" aria-busy>{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-9" />)}</div>;
}

/** Strip ANSI colour codes from agent output for display in a plain <pre>. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
