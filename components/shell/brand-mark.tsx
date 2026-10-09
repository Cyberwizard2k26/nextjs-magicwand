import { Wand2 } from "lucide-react";
import { cn } from "@/lib/util/cn";

/** Product logo lockup. `compact` is the sidebar size; `iconOnly` drops the wordmark (collapsed sidebar). */
export function BrandMark({ className, compact, iconOnly, label }: { className?: string; compact?: boolean; iconOnly?: boolean; label?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center", compact ? "gap-2.5" : "gap-3", className)}>
      <span className={cn("relative flex shrink-0 items-center justify-center bg-gradient-to-br from-accent to-info text-white shadow-glow", compact ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl")}>
        <Wand2 className={compact ? "h-4 w-4" : "h-5 w-5"} />
        <span aria-hidden className={cn("absolute inset-0 ring-1 ring-inset ring-white/20", compact ? "rounded-lg" : "rounded-xl")} />
      </span>
      {!iconOnly && (
        <div className="min-w-0 leading-tight">
          <div className={cn("truncate font-semibold tracking-tight", compact ? "text-sm" : "text-base")}>{label || "MagicWand"}</div>
          <div className={cn("uppercase text-fg-subtle", compact ? "text-[10px] tracking-[0.2em]" : "text-[10px] tracking-[0.28em]")}>{compact ? "RMM" : "Remote Management"}</div>
        </div>
      )}
    </div>
  );
}
