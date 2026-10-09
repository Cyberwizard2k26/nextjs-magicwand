"use client";
import Link from "next/link";
import { Cast, FolderOpen, ListTree, SquareTerminal } from "lucide-react";
import { useDevice } from "@/components/devices/device-context";
import { Badge } from "@/components/ui/badge";

/**
 * Remote desktop needs screen capture + input injection in the agent and a stream relay on the server.
 * Until that agent build ships, this page says so plainly and points at the tools that work today.
 */
export function DesktopGate() {
  const { data } = useDevice();
  const d = data.device;
  const supported = d.capabilities.includes("desktop");
  return (
    <div className="card relative overflow-hidden px-6 py-14 text-center">
      <div aria-hidden className="auth-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative mx-auto max-w-lg">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border-strong bg-surface-2 text-accent-hover"><Cast className="h-6 w-6" /></span>
        <Badge tone={supported ? "info" : "warning"} size="xs" className="mb-3">{supported ? "Agent capable · relay pending" : `Not available on agent ${d.agentVersion ?? ""}`}</Badge>
        <h2 className="text-lg font-semibold tracking-tight">Remote desktop is not wired up yet</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
          {supported ? "This agent advertises screen capture, but the server-side session relay (consent, recording, multi-viewer) is still being built." : "The agent on this device does not include screen capture. Everything below works right now without interrupting the user."}
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          {[
            { href: "console", icon: SquareTerminal, label: "Console", body: "Streamed commands, tracked as jobs" },
            { href: "files", icon: FolderOpen, label: "Files", body: "Browse, preview, upload, download" },
            { href: "processes", icon: ListTree, label: "Processes", body: "Live list, end runaway processes" },
          ].map((t) => (
            <Link key={t.href} href={`/devices/${d.id}/${t.href}`} className="rounded-xl border border-border bg-surface-2/60 p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus-ring">
              <t.icon className="mb-2 h-5 w-5 text-accent-hover" />
              <div className="text-sm font-medium">{t.label}</div>
              <div className="mt-0.5 text-xs text-fg-muted">{t.body}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
