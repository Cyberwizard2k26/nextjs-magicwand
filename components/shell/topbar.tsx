"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Check, ChevronsUpDown, LogOut, Moon, Search, Sun, User, Building2, Menu as MenuIcon, Keyboard, ShieldCheck } from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Tooltip } from "@/components/ui/menu";
import { Avatar, Kbd } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { api, setActiveOrg } from "@/lib/client/api";
import { useRealtimeStatus } from "./realtime-provider";
import { cn } from "@/lib/util/cn";
import { NAV } from "./nav";
import { useActiveHref, type ShellUser } from "./sidebar";
import useSWR from "swr";
import { relativeTime } from "@/lib/client/format";

export interface ShellOrg { id: string; name: string; kind: string }
type InboxItem = { id: string; title: string; body?: string; link?: string; severity: string; readAt: string | null; createdAt: string };

/** "⌘" on Apple platforms, "Ctrl" elsewhere (resolved after mount to avoid hydration mismatch). */
export function useModKey() {
  const [mod, setMod] = React.useState("⌘");
  React.useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setMod("Ctrl");
  }, []);
  return mod;
}

function useTheme() {
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  React.useEffect(() => {
    setTheme((document.documentElement.getAttribute("data-theme") as "light" | "dark") || "dark");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("mw.theme", next); } catch { /* ignore */ }
  };
  return { theme, toggle };
}

const iconBtn = "relative flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-ring";

export function Topbar({ user, orgs, activeOrgId, onOpenPalette, onOpenMobileNav }: { user: ShellUser; orgs: ShellOrg[]; activeOrgId: string | null; onOpenPalette: () => void; onOpenMobileNav: () => void }) {
  const router = useRouter();
  const status = useRealtimeStatus();
  const { theme, toggle: toggleTheme } = useTheme();
  const mod = useModKey();
  const [shortcuts, setShortcuts] = React.useState(false);
  const activeHref = useActiveHref();
  const current = NAV.flatMap((g) => g.items).find((i) => i.href === activeHref);
  const active = orgs.find((o) => o.id === activeOrgId);
  const { data: inbox, mutate } = useSWR<{ items: InboxItem[]; unread: number }>("me/inbox", { refreshInterval: 30000 });

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

  const live = status === "open";

  return (
    <header className="glass sticky top-0 z-20 flex h-[var(--topbar-height)] items-center gap-2 border-b border-border bg-bg-elevated/70 px-3 md:gap-3 md:px-4">
      <button type="button" onClick={onOpenMobileNav} className={cn(iconBtn, "md:hidden")} aria-label="Open menu">
        <MenuIcon className="h-5 w-5" />
      </button>

      {orgs.length > 0 && (
        <Menu
          align="start"
          trigger={
            <button type="button" className="flex h-9 min-w-0 max-w-[200px] items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-sm transition-colors hover:border-border-strong focus-ring md:max-w-[240px]">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent-soft text-[10px] font-bold text-accent-hover">{(active?.name ?? "?").slice(0, 1).toUpperCase()}</span>
              <span className="truncate font-medium">{active?.name ?? "Select organization"}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            </button>
          }
        >
          <MenuLabel>Switch organization</MenuLabel>
          <div className="max-h-72 overflow-y-auto">
            {orgs.map((o) => (
              <MenuItem key={o.id} onSelect={() => o.id !== activeOrgId && switchOrg(o.id)} icon={o.id === activeOrgId ? <Check className="!text-accent-hover" /> : <span className="w-4" />}>
                <span className="flex items-center gap-2">
                  <span className="truncate">{o.name}</span>
                  <span className="ml-auto rounded bg-surface-3 px-1.5 py-px text-[10px] uppercase tracking-wide text-fg-subtle">{o.kind}</span>
                </span>
              </MenuItem>
            ))}
          </div>
          {(user.isSuperAdmin || user.permissions.includes("*")) && (
            <>
              <MenuSeparator />
              <MenuItem icon={<Building2 />} onSelect={() => router.push("/platform/organizations")}>Manage organizations…</MenuItem>
            </>
          )}
        </Menu>
      )}

      {current && (
        <div className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
          <span className="text-fg-subtle">/</span>
          <span className="truncate font-medium text-fg">{current.label}</span>
        </div>
      )}

      <button type="button" onClick={onOpenPalette} className="ml-auto hidden h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg-subtle transition-colors hover:border-border-strong hover:text-fg-muted focus-ring md:flex">
        <Search className="h-4 w-4" />
        <span className="flex-1 truncate text-left">Search devices, pages and actions…</span>
        <Kbd>{mod} K</Kbd>
      </button>

      <div className="ml-auto flex items-center gap-0.5 md:ml-0">
        <button type="button" onClick={onOpenPalette} className={cn(iconBtn, "md:hidden")} aria-label="Search">
          <Search className="h-4 w-4" />
        </button>

        <Tooltip content={live ? "Live updates connected" : status === "connecting" ? "Connecting to live updates…" : "Live updates disconnected — data may be stale"}>
          <span className={cn("hidden h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium sm:flex", live ? "border-success/25 bg-success-soft text-success" : "border-warning/25 bg-warning-soft text-warning")} role="status">
            <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-success pulse-dot" : "bg-warning animate-pulse")} />
            {live ? "Live" : status === "connecting" ? "Connecting" : "Offline"}
          </span>
        </Tooltip>

        <Tooltip content={theme === "dark" ? "Light theme" : "Dark theme"}>
          <button type="button" onClick={toggleTheme} className={iconBtn} aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </Tooltip>

        <Menu
          trigger={
            <button type="button" className={iconBtn} aria-label={inbox?.unread ? `Notifications (${inbox.unread} unread)` : "Notifications"}>
              <Bell className="h-4 w-4" />
              {!!inbox?.unread && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white ring-2 ring-bg-elevated">{inbox.unread > 9 ? "9+" : inbox.unread}</span>}
            </button>
          }
        >
          <div className="flex w-[min(22rem,calc(100vw-2rem))] items-center justify-between px-2.5 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {!!inbox?.unread && <button type="button" className="rounded px-1 text-xs text-accent-hover hover:underline focus-ring" onClick={async () => { await api.post("me/inbox/read-all"); mutate(); }}>Mark all read</button>}
          </div>
          <MenuSeparator />
          <div className="max-h-96 overflow-auto">
            {!inbox?.items?.length && (
              <div className="flex flex-col items-center px-4 py-10 text-center">
                <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 text-fg-subtle"><BellOff className="h-4 w-4" /></span>
                <div className="text-sm font-medium">You&apos;re all caught up</div>
                <div className="mt-0.5 text-xs text-fg-subtle">New alerts and mentions will show up here.</div>
              </div>
            )}
            {inbox?.items?.map((n) => <InboxRow key={n.id} n={n} />)}
          </div>
        </Menu>

        <Menu
          trigger={
            <button type="button" className="ml-1 flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-surface-hover focus-ring md:pr-2" aria-label="Account menu">
              <Avatar name={user.name || user.email} size="sm" />
              <span className="hidden max-w-[140px] truncate text-sm font-medium xl:inline">{user.name || user.email}</span>
            </button>
          }
        >
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <Avatar name={user.name || user.email} size="md" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{user.name || user.email}</div>
              <div className="truncate text-xs text-fg-subtle">{user.email}</div>
              {user.isSuperAdmin && <div className="mt-1 inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-px text-[10px] font-medium text-accent-hover"><ShieldCheck className="h-3 w-3" /> Platform admin</div>}
            </div>
          </div>
          <MenuSeparator />
          <MenuItem icon={<User />} onSelect={() => router.push("/settings/account")}>My account</MenuItem>
          <MenuItem icon={theme === "dark" ? <Sun /> : <Moon />} onSelect={toggleTheme}>{theme === "dark" ? "Light theme" : "Dark theme"}</MenuItem>
          <MenuItem icon={<Keyboard />} onSelect={() => setShortcuts(true)} shortcut="?">Keyboard shortcuts</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<LogOut />} onSelect={logout} danger>Sign out</MenuItem>
        </Menu>
      </div>
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} mod={mod} />
    </header>
  );
}

function InboxRow({ n }: { n: InboxItem }) {
  const tone = n.severity === "critical" || n.severity === "high" ? "bg-danger" : n.severity === "medium" ? "bg-warning" : "bg-info";
  const body = (
    <div className="flex gap-2.5">
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone, n.readAt && "opacity-40")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("flex-1 truncate text-sm", n.readAt ? "text-fg-muted" : "font-medium text-fg")}>{n.title}</span>
          <span className="shrink-0 text-[10px] text-fg-subtle">{relativeTime(n.createdAt)}</span>
        </div>
        {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{n.body}</div>}
      </div>
    </div>
  );
  const cls = cn("block px-3 py-2.5 transition-colors", !n.readAt && "bg-accent-soft/30");
  return n.link ? <Link href={n.link} className={cn(cls, "hover:bg-surface-hover focus-ring")}>{body}</Link> : <div className={cls}>{body}</div>;
}

function ShortcutsDialog({ open, onOpenChange, mod }: { open: boolean; onOpenChange: (o: boolean) => void; mod: string }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.key === "?") { e.preventDefault(); onOpenChange(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);
  const rows: [string, React.ReactNode][] = [
    ["Open command palette", <><Kbd>{mod}</Kbd><Kbd>K</Kbd></>],
    ["Quick search", <Kbd key="s">/</Kbd>],
    ["Collapse / expand sidebar", <Kbd key="b">[</Kbd>],
    ["Show this help", <Kbd key="h">?</Kbd>],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" size="sm">
      <ul className="divide-y divide-border">
        {rows.map(([label, keys]) => (
          <li key={label} className="flex items-center justify-between py-2.5 text-sm">
            <span className="text-fg-muted">{label}</span>
            <span className="flex items-center gap-1">{keys}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
