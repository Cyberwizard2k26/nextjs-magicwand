export const dynamic = "force-dynamic";

import { Activity, Cast, ShieldCheck, Workflow } from "lucide-react";
import { BrandMark } from "@/components/shell/brand-mark";
import { PRODUCT_NAME, SERVER_VERSION } from "@/lib/version";

const FEATURES = [
  { icon: Activity, title: "Real-time fleet health", body: "Live telemetry, health scores and alerts from every endpoint." },
  { icon: Cast, title: "Instant remote access", body: "Desktop, terminal and file transfer without a VPN." },
  { icon: Workflow, title: "Automation that scales", body: "Scripts, policies and patch windows across every client." },
  { icon: ShieldCheck, title: "Secure by default", body: "MFA, passkeys, scoped roles and a full audit trail." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden border-r border-border bg-bg-elevated lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div aria-hidden className="auth-grid pointer-events-none absolute inset-0" />
        <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full bg-accent/25 blur-[120px]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 right-[-10%] h-[460px] w-[460px] rounded-full bg-info/15 blur-[120px]" />

        <BrandMark className="relative" />

        <div className="relative max-w-lg">
          <h2 className="text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl">
            Every endpoint.
            <br />
            <span className="text-gradient">One console.</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-fg-muted">
            Monitor, patch, automate and support your entire fleet from a single, fast, keyboard-first workspace.
          </p>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-surface/70 text-accent-hover">
                  <f.icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-medium text-fg">{f.title}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-fg-muted">{f.body}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-fg-subtle">
          <span>© {new Date().getFullYear()} {PRODUCT_NAME}</span>
          <span className="h-3 w-px bg-border-strong" />
          <span className="mono">v{SERVER_VERSION}</span>
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px] animate-in">
          <BrandMark className="mb-8 justify-center lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
