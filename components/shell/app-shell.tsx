"use client";
import * as React from "react";
import { Dialog as RDialog } from "radix-ui";
import { Sidebar, type ShellUser } from "./sidebar";
import { Topbar, type ShellOrg } from "./topbar";
import { CommandPalette } from "./command-palette";
import { RealtimeProvider, useRealtime } from "./realtime-provider";
import { setActiveOrg } from "@/lib/client/api";
import { NAV } from "./nav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/util/cn";
import { toast } from "sonner";
import useSWR from "swr";

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
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("mw.sidebar", !c ? "collapsed" : "expanded"); } catch { /* ignore */ }
      return !c;
    });
  };
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
  const { data: counts, mutate } = useSWR<{ alerts: number; tickets: number; pending: number }>(activeOrgId ? "me/counts" : null, { refreshInterval: 60000 });
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
      <Sidebar user={user} counts={counts} productName={productName} collapsed={collapsed} onToggle={toggle} />
      <div className="transition-[padding] duration-200 md:pl-[var(--sidebar-width)]" style={{ paddingLeft: undefined }} data-collapsed={collapsed}>
        <style>{collapsed ? `@media (min-width:768px){[data-collapsed="true"]{padding-left:var(--sidebar-collapsed)!important}}` : ""}</style>
        <Topbar user={user} orgs={orgs} activeOrgId={activeOrgId} onOpenPalette={() => setPalette(true)} onOpenMobileNav={() => setMobileNav(true)} />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 lg:px-8 animate-in">{children}</main>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      <RDialog.Root open={mobileNav} onOpenChange={setMobileNav}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-40 bg-black/60 md:hidden" />
          <RDialog.Content className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r border-border bg-surface p-3 md:hidden">
            <RDialog.Title className="px-2 py-2 text-sm font-semibold">{productName || "MagicWand"}</RDialog.Title>
            {NAV.map((g, i) => (
              <div key={i} className="mb-3">
                {g.label && <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">{g.label}</div>}
                {g.items.filter((it) => !it.superAdmin || user.isSuperAdmin).map((it) => (
                  <Link key={it.href} href={it.href} onClick={() => setMobileNav(false)} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm", pathname === it.href ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-hover")}>
                    <it.icon className="h-4 w-4" /> {it.label}
                  </Link>
                ))}
              </div>
            ))}
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
    </div>
  );
}
