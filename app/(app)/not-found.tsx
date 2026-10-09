import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent-hover">
        <Compass className="h-6 w-6" />
      </span>
      <div className="mono text-xs text-fg-subtle">404</div>
      <h1 className="mt-1 text-lg font-semibold tracking-tight">Page not found</h1>
      <p className="mt-1.5 text-sm text-fg-muted">The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
      <Link href="/" className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface-3 px-3.5 text-sm font-medium transition-colors hover:bg-surface-hover focus-ring">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>
    </div>
  );
}
