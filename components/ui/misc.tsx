"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/util/cn";
import { initials } from "@/lib/client/format";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-fg-muted", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4 w-full", className)} />;
}

export function StatusDot({ status, className, pulse }: { status: "online" | "offline" | "warning" | "danger" | "neutral" | "info" | string; className?: string; pulse?: boolean }) {
  const color = status === "online" || status === "ok" || status === "success" ? "bg-success" : status === "offline" || status === "danger" || status === "critical" || status === "failed" ? "bg-danger" : status === "warning" || status === "pending" ? "bg-warning" : status === "info" || status === "maintenance" ? "bg-info" : "bg-fg-subtle";
  return <span className={cn("inline-block h-2 w-2 rounded-full", color, pulse && status === "online" && "pulse-dot", className)} />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 items-center rounded border border-border-strong bg-surface-3 px-1.5 font-mono text-[10px] text-fg-muted", className)}>{children}</kbd>;
}

export function Avatar({ name, src, size = "md", className }: { name?: string | null; src?: string | null; size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  const sz = { xs: "h-5 w-5 text-[9px]", sm: "h-7 w-7 text-[11px]", md: "h-9 w-9 text-xs", lg: "h-14 w-14 text-base" }[size];
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img src={src} alt={name ?? ""} className={cn("rounded-full object-cover", sz, className)} />;
  return <span className={cn("inline-flex items-center justify-center rounded-full bg-accent-soft text-accent-hover font-semibold", sz, className)}>{initials(name)}</span>;
}

export function Progress({ value, max = 100, tone, className, thin }: { value: number; max?: number; tone?: "accent" | "success" | "warning" | "danger" | "auto"; className?: string; thin?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const t = tone === "auto" || !tone ? (pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warning" : "bg-accent") : { accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-surface-3", thin ? "h-1" : "h-1.5", className)}>
      <div className={cn("h-full rounded-full transition-[width]", t)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong/70 px-6 py-14 text-center", className)}>
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent-hover [&>svg]:h-6 [&>svg]:w-6">{icon}</div>}
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs, className, badge }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; breadcrumbs?: { label: string; href?: string }[]; className?: string; badge?: React.ReactNode }) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="mb-1.5 flex items-center gap-1 text-xs text-fg-subtle">
            {breadcrumbs.map((b, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight className="h-3 w-3" />}
                {b.href ? <Link href={b.href} className="hover:text-fg transition-colors">{b.label}</Link> : <span className="text-fg-muted">{b.label}</span>}
              </React.Fragment>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone, trend, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: "accent" | "success" | "warning" | "danger" | "info"; trend?: { value: number; label?: string }; className?: string }) {
  const toneCls = { accent: "text-accent-hover bg-accent-soft", success: "text-success bg-success-soft", warning: "text-warning bg-warning-soft", danger: "text-danger bg-danger-soft", info: "text-info bg-info-soft" }[tone ?? "accent"];
  return (
    <div className={cn("card p-4 flex items-start gap-3", className)}>
      {icon && <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4.5 [&>svg]:w-4.5", toneCls)}>{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-fg-muted">{label}</div>
        <div className="mt-0.5 text-2xl font-semibold tabular tracking-tight text-fg">{value}</div>
        {(hint || trend) && (
          <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle">
            {trend && <span className={cn("font-medium", trend.value > 0 ? "text-success" : trend.value < 0 ? "text-danger" : "text-fg-muted")}>{trend.value > 0 ? "+" : ""}{trend.value}{trend.label ? ` ${trend.label}` : "%"}</span>}
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div className={cn(vertical ? "w-px self-stretch bg-border" : "h-px w-full bg-border", className)} />;
}

export function Code({ children, className, block }: { children: React.ReactNode; className?: string; block?: boolean }) {
  if (block) return <pre className={cn("mono overflow-auto rounded-lg border border-border bg-surface-2 p-3 text-xs leading-relaxed text-fg", className)}>{children}</pre>;
  return <code className={cn("mono rounded bg-surface-3 px-1.5 py-0.5 text-[12px] text-fg", className)}>{children}</code>;
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-4 flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function Pill({ active, children, onClick, className }: { active?: boolean; children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-8 rounded-full border px-3 text-xs font-medium transition-colors focus-ring", active ? "border-accent/50 bg-accent-soft text-accent-hover" : "border-border bg-surface-2 text-fg-muted hover:text-fg hover:border-border-strong", className)}>
      {children}
    </button>
  );
}
