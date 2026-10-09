"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Tooltip } from "@/components/ui/menu";
import { useRealtime } from "@/components/shell/realtime-provider";
import { cn } from "@/lib/util/cn";

/** Re-renders the server-rendered dashboard when fleet or alert state changes (debounced). */
export function LiveRefresh() {
  const router = useRouter();
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime(["device.*", "alert.*", "ticket.*"], () => {
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; router.refresh(); }, 2000);
  });
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return null;
}

export interface Segment { key: string; label: string; value: number; color: string; href?: string }

/** Part-to-whole meter for device state: status colours, 2px surface gaps, labelled legend + per-segment tooltip. */
export function StatusMeter({ segments, total }: { segments: Segment[]; total: number }) {
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-surface-3" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        {shown.map((s) => (
          <Tooltip key={s.key} content={<span className="tabular">{s.label}: {s.value.toLocaleString()} ({pct(s.value, total)})</span>}>
            <span className="h-full first:rounded-l-full last:rounded-r-full transition-opacity hover:opacity-80" style={{ width: `${(s.value / total) * 100}%`, minWidth: 4, background: s.color }} />
          </Tooltip>
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {segments.map((s) => {
          const body = (
            <>
              <span className="flex items-center gap-2 text-xs text-fg-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="mt-0.5 block text-lg font-semibold tabular text-fg">
                {s.value.toLocaleString()}
                <span className="ml-1.5 text-xs font-normal text-fg-subtle">{pct(s.value, total)}</span>
              </span>
            </>
          );
          return (
            <li key={s.key}>
              {s.href ? <Link href={s.href} className="block rounded-md p-1 -m-1 transition-colors hover:bg-surface-hover focus-ring">{body}</Link> : body}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Horizontal magnitude bars in a single hue; values in text ink. */
export function BarList({ items, max }: { items: { key: string; label: string; value: number; href?: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => {
        const row = (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="truncate text-fg-muted group-hover:text-fg">{i.label}</span>
              <span className="tabular font-medium text-fg">{i.value.toLocaleString()}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(2, (i.value / top) * 100)}%` }} />
            </div>
          </>
        );
        return <li key={i.key}>{i.href ? <Link href={i.href} className="group block rounded-md focus-ring">{row}</Link> : row}</li>;
      })}
    </ul>
  );
}

/** Circular score gauge (0-100) for a single headline value. */
export function ScoreRing({ value, size = 56, className }: { value: number | null; size?: number; className?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const color = value === null ? "var(--fg-subtle)" : v >= 80 ? "var(--success)" : v >= 60 ? "var(--warning)" : "var(--danger)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("-rotate-90", className)} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} className="transition-[stroke-dashoffset] duration-700" />
    </svg>
  );
}

export function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 rounded text-xs font-medium text-fg-muted transition-colors hover:text-fg focus-ring">
      {children}
      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function pct(v: number, total: number) {
  if (!total) return "0%";
  const p = (v / total) * 100;
  return `${p > 0 && p < 1 ? "<1" : Math.round(p)}%`;
}
