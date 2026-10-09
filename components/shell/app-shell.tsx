"use client";
import * as React from "react";
import { Dialog as RDialog } from "radix-ui";
import { X } from "lucide-react";
import { Sidebar, NavLinks, type ShellUser, type ShellCounts } from "./sidebar";
import { Topbar, type ShellOrg } from "./topbar";
import { CommandPalette } from "./command-palette";
import { BrandMark } from "./brand-mark";
import { RealtimeProvider, useRealtime } from "./realtime-provider";
import { setActiveOrg } from "@/lib/client/api";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import useSWR from "swr";

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export function AppShell({ user, orgs, activeOrgId, productName, children }: { user: ShellUser; orgs: ShellOrg[]; activeOrgId: string | null; productName?: string; children: React.ReactNode }) {
  const [palette, setPalette] = React.useState(false);
  const [mobileNav, setMobileNav] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try { setCollapsed(localStorage.getItem("mw.sidebar") === "collapsed"); } catch { /* ignore */ }
  }, []);
  React.useEffect(() => {
    setActiveOrg(activeOrgId);
  }, [activeOrgId]);
  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      try { localStorage.setItem("mw.sidebar", !c ? "collapsed" : "expanded"); } catch { /* ignore */ }
      return !c;
    });
  }, []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); setPalette(true); }
      else if (e.key === "[") toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  return (
    <RealtimeProvider orgId={activeOrgId}>
      <ShellInner user={user} orgs={orgs} activeOrgId={activeOrgId} productName={productName} collapsed={collapsed} toggle={toggle} palette={palette} setPalette={setPalette} mobileNav={mobileNav} setMobileNav={setMobileNav}>
        {children}
      </ShellInner>
    </RealtimeProvider>
  );
}

function ShellInner({ user, orgs, activeOrgId, productName, collapsed, toggle, palette, setPalette, mobileNav, setMobileNav, children }: { user: ShellUser; orgs: ShellOrg[]; activeOrgId: string | null; productName?: string; collapsed: boolean; toggle: () => void; palette: boolean; setPalette: (b: boolean) => void; mobileNav: boolean; setMobileNav: (b: boolean) => void; children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: counts, mutate } = useSWR<ShellCounts>(activeOrgId ? "me/counts" : null, { refreshInterval: 60000 });
  React.useEffect(() => { setMobileNav(false); }, [pathname, setMobileNav]);
  useRealtime(["alert.*", "ticket.*", "device.enrolled"], (ev) => {
    mutate();
    if (ev.name === "alert.opened") {
      const p = ev.payload as { title?: string; severity?: string; deviceName?: string; id?: string };
      if (p.severity === "critical" || p.severity === "high") toast.error(p.title || "New alert", { description: p.deviceName, action: p.id ? { label: "Open", onClick: () => (location.href = `/alerts/${p.id}`) } : undefined });
    }
    if (ev.name === "device.enrolled") {
      const p = ev.payload as { name?: string; deviceId?: string };
      toast.success(`New device enrolled: ${p.name}`, { action: p.deviceId ? { label: "View", onClick: () => (location.href = `/devices/${p.deviceId}`) } : undefined });
    }
  });
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-fg">
        Skip to content
      </a>
      <Sidebar user={user} counts={counts} productName={productName} collapsed={collapsed} onToggle={toggle} />
      <div className="shell-content transition-[padding] duration-200" data-collapsed={collapsed}>
        <Topbar user={user} orgs={orgs} activeOrgId={activeOrgId} onOpenPalette={() => setPalette(true)} onOpenMobileNav={() => setMobileNav(true)} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1600px] px-4 py-6 outline-none animate-in md:px-6 md:py-8 lg:px-8">{children}</main>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} user={user} />
      <RDialog.Root open={mobileNav} onOpenChange={setMobileNav}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" />
          <RDialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-border bg-bg-elevated shadow-2xl animate-in focus:outline-none md:hidden">
            <div className="flex h-[var(--topbar-height)] shrink-0 items-center justify-between border-b border-border px-4">
              <RDialog.Title asChild><div><BrandMark compact label={productName} /></div></RDialog.Title>
              <RDialog.Close className="rounded-md p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus-ring" aria-label="Close menu">
                <X className="h-4 w-4" />
              </RDialog.Close>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
              <NavLinks user={user} counts={counts} onNavigate={() => setMobileNav(false)} />
            </nav>
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
    </div>
  );
}
