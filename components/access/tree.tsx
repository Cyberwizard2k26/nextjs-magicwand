"use client";
import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/util/cn";

export type TreeDot = "success" | "warning" | "danger" | "info";
const DOT: Record<TreeDot, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info" };

/** One selectable row of the session-group tree: label, "online / total" count and an optional attention dot. */
export function TreeRow({ label, icon, total, online, active, onClick, dot, depth = 0, hint, className, trailing }: { label: React.ReactNode; icon?: React.ReactNode; total?: number; online?: number; active?: boolean; onClick?: () => void; dot?: TreeDot | null; depth?: number; hint?: string; className?: string; trailing?: React.ReactNode }) {
  return (
    <button
      type="button"
      data-tree-select
      title={hint}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[13px] transition-colors focus-ring",
        active ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
        className,
      )}
      style={{ paddingLeft: 10 + depth * 14 }}
    >
      {icon && <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5", active ? "text-accent-hover" : "text-fg-subtle group-hover:text-fg-muted")}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[dot])} aria-hidden />}
      {trailing}
      {total !== undefined && (
        <span className={cn("tabular shrink-0 text-[11px]", active ? "text-fg" : "text-fg-subtle")}>
          {online !== undefined && online > 0 && <span className="text-success">{online}</span>}
          {online !== undefined && online > 0 && <span className="px-0.5 text-fg-subtle">/</span>}
          {total}
        </span>
      )}
    </button>
  );
}

/** Expandable section header. Clicking the label selects the section itself; the chevron toggles the children. */
export function TreeSection({ label, icon, total, online, expanded, onToggle, active, onSelect, dot, children, emptyHint }: { label: string; icon?: React.ReactNode; total?: number; online?: number; expanded: boolean; onToggle: () => void; active?: boolean; onSelect?: () => void; dot?: TreeDot | null; children?: React.ReactNode; emptyHint?: string }) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <div className="mb-0.5">
      <div className={cn("flex h-8 items-center rounded-md pr-2 text-[13px] transition-colors", active ? "bg-accent-soft text-fg" : "text-fg hover:bg-surface-hover")}>
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`} className="flex h-8 w-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:text-fg focus-ring">
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
        <button type="button" data-tree-select onClick={onSelect ?? onToggle} aria-current={active ? "true" : undefined} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded text-left font-medium focus-ring">
          {icon && <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5", active ? "text-accent-hover" : "text-fg-subtle")}>{icon}</span>}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[dot])} aria-hidden />}
          {total !== undefined && (
            <span className={cn("tabular shrink-0 text-[11px] font-normal", active ? "text-fg" : "text-fg-subtle")}>
              {online !== undefined && online > 0 && <><span className="text-success">{online}</span><span className="px-0.5">/</span></>}
              {total}
            </span>
          )}
        </button>
      </div>
      {expanded && (hasChildren ? <div className="mt-0.5 space-y-px">{children}</div> : emptyHint ? <div className="px-9 py-1.5 text-xs text-fg-subtle">{emptyHint}</div> : null)}
    </div>
  );
}

export function TreeGroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 mt-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle first:mt-0">{children}</div>;
}

export function TreeSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1.5 px-3 py-2" aria-busy>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-6" style={{ width: `${70 - (i % 3) * 12}%` }} />)}
    </div>
  );
}
