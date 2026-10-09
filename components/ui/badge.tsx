import * as React from "react";
import { cn } from "@/lib/util/cn";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "critical" | "outline";
const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-3 text-fg-muted border-border",
  accent: "bg-accent-soft text-accent-hover border-accent/30",
  success: "bg-success-soft text-success border-success/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  critical: "bg-danger-soft text-critical border-critical/40",
  info: "bg-info-soft text-info border-info/30",
  outline: "bg-transparent text-fg-muted border-border-strong",
};

export function Badge({ tone = "neutral", className, children, dot, size = "sm", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean; size?: "xs" | "sm" | "md" }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border font-medium whitespace-nowrap", size === "xs" ? "px-1.5 h-5 text-[11px]" : size === "md" ? "px-2.5 h-7 text-sm" : "px-2 h-6 text-xs", tones[tone], className)} {...props}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function severityTone(s: string | null | undefined): BadgeTone {
  switch (s) {
    case "critical": return "critical";
    case "high": case "error": case "danger": return "danger";
    case "medium": case "warning": case "warn": return "warning";
    case "low": case "info": return "info";
    default: return "neutral";
  }
}

export function statusTone(s: string | null | undefined): BadgeTone {
  switch (s) {
    case "online": case "ok": case "succeeded": case "completed": case "installed": case "compliant": case "resolved": case "active": case "approved": case "delivered": case "sent": return "success";
    case "offline": case "failed": case "critical": case "noncompliant": case "error": case "denied": case "timeout": return "danger";
    case "pending": case "running": case "queued": case "warning": case "acknowledged": case "awaiting_approval": case "pending_reboot": case "installing": case "open": return "warning";
    case "maintenance": case "snoozed": case "deferred": case "paused": return "info";
    default: return "neutral";
  }
}
