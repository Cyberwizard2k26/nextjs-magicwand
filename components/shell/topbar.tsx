"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, ChevronsUpDown, LogOut, Moon, Search, Sun, User, Wifi, WifiOff, Building2, Menu as MenuIcon } from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Tooltip } from "@/components/ui/menu";
import { Avatar, Kbd, StatusDot } from "@/components/ui/misc";
import { api, setActiveOrg } from "@/lib/client/api";
import { useRealtimeStatus } from "./realtime-provider";
import { cn } from "@/lib/util/cn";
import type { ShellUser } from "./sidebar";
import useSWR from "swr";
import Link from "next/link";
import { relativeTime } from "@/lib/client/format";

export interface ShellOrg { id: string; name: string; kind: string }

export function Topbar({ user, orgs, activeOrgId, onOpenPalette, onOpenMobileNav }: { user: ShellUser; orgs: ShellOrg[]; activeOrgId: string | null; onOpenPalette: () => void; onOpenMobileNav: () => void }) {
  const router = useRouter();
  const status = useRealtimeStatus();
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  React.useEffect(() => {
    setTheme((document.documentElement.getAttribute("data-theme") as "light" | "dark") || "dark");
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("mw.theme", next); } catch { /* ignore */ }
  };
  const active = orgs.find((o) => o.id === activeOrgId);
  const { data: inbox, mutate } = useSWR<{ items: { id: string; title: string; body?: string; link?: string; severity: string; readAt: string | null; createdAt: string }[]; unread: number }>("me/inbox", { refreshInterval: 30000 });

  async function switchOrg(id: string) {
    setActiveOrg(id);
    await api.post("/api/auth/switch-org", { orgId: id });
    router.refresh();
  }
  async function logout() {
    await api.post("/api/auth/logout");
    setActiveOrg(null);
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex h-[var(--topbar-height)] items-center gap-3 border-b border-border bg-bg-elevated/70 px-4 glass">
      <button type="button" onClick={onOpenMobileNav} className="rounded-md p-2 text-fg-muted hover:bg-surface-hover md:hidden" aria-label="Menu">
        <MenuIcon className="h-5 w-5" />
      </button>
      {orgs.length > 0 && (
        <Menu
          align="start"
          trigger={
            <button type="button" className="flex h-9 max-w-[240px] items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-sm hover:border-border-strong focus-ring">
              <Building2 className="h-4 w-4 text-fg-subtle" />
              <span className="truncate font-medium">{active?.name ?? "Select organization"}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-fg-subtle" />
            </button>
          }
        >
          <MenuLabel>Organizations</MenuLabel>
          {orgs.map((o) => (
            <MenuItem key={o.id} onSelect={() => switchOrg(o.id)} icon={o.id === activeOrgId ? <Check className="text-accent-hover" /> : <span className="w-4" />}>
              <span className="flex-1 truncate">{o.name}</span>
              <span className="ml-2 text-[10px] uppercase text-fg-subtle">{o.kind}</span>
            </MenuItem>
          ))}
          {(user.isSuperAdmin || user.permissions.includes("*")) && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={() => router.push("/platform/organizations")}>Manage organizations…</MenuItem>
            </>
          )}
        </Menu>
      )}

      <button type="button" onClick={onOpenPalette} className="hidden h-9 flex-1 max-w-xl items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg-subtle hover:border-border-strong focus-ring md:flex">
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search devices, run actions, ask anything…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="flex-1 md:hidden" />

      <div className="ml-auto flex items-center gap-1">
        <Tooltip content={status === "open" ? "Live updates connected" : status === "connecting" ? "Connecting…" : "Live updates disconnected"}>
          <span className={cn("hidden h-9 items-center gap-1.5 rounded-lg px-2 text-xs md:flex", status === "open" ? "text-success" : "text-warning")}>
            {status === "open" ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            <StatusDot status={status === "open" ? "online" : "warning"} pulse />
          </span>
        </Tooltip>
        <Tooltip content={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
          <button type="button" onClick={toggleTheme} className="rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg focus-ring" aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </Tooltip>
        <Menu
          trigger={
            <button type="button" className="relative rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg focus-ring" aria-label="Notifications">
              <Bell className="h-4 w-4" />
              {!!inbox?.unread && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">{inbox.unread}</span>}
            </button>
          }
        >
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-xs font-semibold">Notifications</span>
            {!!inbox?.unread && <button type="button" className="text-[11px] text-accent-hover hover:underline" onClick={async () => { await api.post("me/inbox/read-all"); mutate(); }}>Mark all read</button>}
          </div>
          <MenuSeparator />
          <div className="max-h-80 w-80 overflow-auto">
            {!inbox?.items?.length && <div className="px-3 py-6 text-center text-xs text-fg-subtle">You&apos;re all caught up.</div>}
            {inbox?.items?.map((n) => (
              <Link key={n.id} href={n.link || "#"} className={cn("block px-3 py-2 text-xs hover:bg-surface-hover", !n.readAt && "bg-accent-soft/30")}>
                <div className="flex items-center gap-2">
                  <StatusDot status={n.severity === "critical" || n.severity === "high" ? "danger" : n.severity === "medium" ? "warning" : "info"} />
                  <span className="flex-1 truncate font-medium text-fg">{n.title}</span>
                  <span className="text-[10px] text-fg-subtle">{relativeTime(n.createdAt)}</span>
                </div>
                {n.body && <div className="mt-0.5 line-clamp-2 text-fg-muted">{n.body}</div>}
              </Link>
            ))}
          </div>
        </Menu>
        <Menu
          trigger={
            <button type="button" className="ml-1 flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-surface-hover focus-ring">
              <Avatar name={user.name || user.email} size="sm" />
              <span className="hidden max-w-[120px] truncate text-sm md:inline">{user.name || user.email}</span>
            </button>
          }
        >
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-fg-subtle">{user.email}</div>
          </div>
          <MenuSeparator />
          <MenuItem icon={<User />} onSelect={() => router.push("/settings/account")}>My account</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<LogOut />} onSelect={logout} danger>Sign out</MenuItem>
        </Menu>
      </div>
    </header>
  );
}
