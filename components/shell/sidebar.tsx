"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { BrandMark } from "@/components/shell/brand-mark";
import { cn } from "@/lib/util/cn";
import { NAV, type NavItem } from "./nav";
import { Tooltip } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/misc";

export interface ShellUser { id: string; name: string; email: string; isSuperAdmin: boolean; permissions: string[] }
export type ShellCounts = { alerts?: number; tickets?: number; pending?: number };

export function allowed(perms: string[], permission?: string, superAdmin?: boolean, isSuper?: boolean) {
  if (superAdmin) return !!isSuper;
  if (!permission) return true;
  if (perms.includes("*")) return true;
  if (perms.includes(permission)) return true;
  return perms.includes(permission.split(".")[0] + ".*");
}

/** Nav items the user may see, grouped as in NAV (empty groups dropped). */
export function visibleNav(user: ShellUser) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => allowed(user.permissions, i.permission, i.superAdmin, user.isSuperAdmin)) })).filter((g) => g.items.length > 0);
}

/** Longest-prefix match so /settings/users highlights "Users & roles", not "Settings". */
export function useActiveHref(): string | null {
  const pathname = usePathname();
  return React.useMemo(() => {
    let best: string | null = null;
    for (const item of NAV.flatMap((g) => g.items)) {
      const hit = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
      if (hit && (!best || item.href.length > best.length)) best = item.href;
    }
    return best;
  }, [pathname]);
}

export function NavLinks({ user, counts, collapsed = false, onNavigate }: { user: ShellUser; counts?: ShellCounts; collapsed?: boolean; onNavigate?: () => void }) {
  const activeHref = useActiveHref();
  return (
    <>
      {visibleNav(user).map((group, gi) => (
        <div key={gi} className={cn(gi > 0 && "mt-4")}>
          {group.label && !collapsed && <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{group.label}</div>}
          {group.label && collapsed && <div className="mx-auto mb-2 h-px w-6 bg-border" />}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={item.href === activeHref} count={item.badge ? counts?.[item.badge] : undefined} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function NavLink({ item, active, count, collapsed, onNavigate }: { item: NavItem; active: boolean; count?: number; collapsed: boolean; onNavigate?: () => void }) {
  const urgent = item.badge === "alerts";
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors focus-ring",
        active ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      {active && <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_12px_var(--accent-glow)]" />}
      <item.icon className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-accent-hover" : "text-fg-subtle group-hover:text-fg-muted")} />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && !!count && (
        <span className={cn("min-w-5 rounded-full px-1.5 py-px text-center text-[10px] font-semibold tabular", urgent ? "bg-danger text-white" : "bg-surface-3 text-fg-muted")}>
          {count > 99 ? "99+" : count}
        </span>
      )}
      {collapsed && !!count && <span className={cn("absolute right-2 top-1.5 h-2 w-2 rounded-full ring-2 ring-bg-elevated", urgent ? "bg-danger" : "bg-accent")} />}
    </Link>
  );
  return collapsed ? <Tooltip content={count ? `${item.label} · ${count}` : item.label} side="right">{link}</Tooltip> : link;
}

export function Sidebar({ user, counts, productName, collapsed, onToggle }: { user: ShellUser; counts?: ShellCounts; productName?: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className="glass fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-bg-elevated/80 transition-[width] duration-200 md:flex"
      style={{ width: collapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-width)" }}
      aria-label="Primary"
    >
      <Link href="/" className={cn("flex h-[var(--topbar-height)] shrink-0 items-center border-b border-border px-4 focus-ring", collapsed && "justify-center px-0")} aria-label="Dashboard">
        <BrandMark compact iconOnly={collapsed} label={productName} />
      </Link>
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
        <NavLinks user={user} counts={counts} collapsed={collapsed} />
      </nav>
      <div className="border-t border-border p-2">
        <Tooltip content={collapsed ? <span className="flex items-center gap-2">Expand sidebar <Kbd>[</Kbd></span> : null} side="right">
          <button type="button" onClick={onToggle} className={cn("flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-xs text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-ring", collapsed && "justify-center px-0")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /><span className="flex-1 text-left">Collapse</span><Kbd>[</Kbd></>}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
