import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";
import { PageHeader } from "@/components/ui/misc";
import { NAV } from "./nav";

/** Temporary page body used while a module's UI is being built out. */
export function ModulePlaceholder({ title, description }: { title: string; description?: string }) {
  const item = NAV.flatMap((g) => g.items).find((i) => i.label === title);
  const group = NAV.find((g) => g.items.some((i) => i.label === title))?.label;
  const Icon = item?.icon ?? Construction;
  return (
    <>
      <PageHeader title={title} description={description} breadcrumbs={group ? [{ label: group }, { label: title }] : undefined} />
      <section className="card relative overflow-hidden px-6 py-16 text-center md:py-20">
        <div aria-hidden className="auth-grid pointer-events-none absolute inset-0 opacity-60" />
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[80px]" />
        <div className="relative mx-auto flex max-w-md flex-col items-center">
          <span className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border-strong bg-surface-2 text-accent-hover shadow-glow">
            <Icon className="h-6 w-6" />
          </span>
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-warning/25 bg-warning-soft px-2.5 py-0.5 text-[11px] font-medium text-warning">
            <Construction className="h-3 w-3" /> In development
          </span>
          <h2 className="text-lg font-semibold tracking-tight">{title} is on its way</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
            The API for this module is registered; its screens are being built. Press <kbd className="rounded border border-border-strong bg-surface-3 px-1 font-mono text-[10px]">/</kbd> to jump somewhere else.
          </p>
          <Link href="/" className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface-3 px-3.5 text-sm font-medium transition-colors hover:bg-surface-hover focus-ring">
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
        </div>
      </section>
    </>
  );
}
