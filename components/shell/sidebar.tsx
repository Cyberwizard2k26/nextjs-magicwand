"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Wand2 } from "lucide-react";
import { cn } from "@/lib/util/cn";
import { NAV } from "./nav";
import { Tooltip } from "@/components/ui/menu";

export interface ShellUser { id: string; name: string; email: string; isSuperAdmin: boolean; permissions: string[] }

function allowed(perms: string[], permission?: string, superAdmin?: boolean, isSuper?: boolean) {
  if (superAdmin) return !!isSuper;
  if (!permission) return true;
  if (perms.includes("*")) return true;
  if (perms.includes(permission)) return true;
  return perms.includes(permission.split(".")[0] + ".*");
}

export function Sidebar({ user, counts, productName, collapsed, onToggle }: { user: ShellUser; counts?: { alerts?: number; tickets?: number; pending?: number }; productName?: string; collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  return (
    <aside
      className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-bg-elevated/80 glass md:flex transition-[width] duration-200")}
      style={{ width: collapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-width)" }}
    >
      <div className={cn("flex h-[var(--topbar-height)] items-center gap-2.5 border-b border-border px-4", collapsed && "justify-center px-0")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-info text-white shadow-glow">
          <Wand2 className="h-4 w-4" />
        </span>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold tracking-tight">{productName || "MagicWand"}</div>
            <div className="text-[10px] uppercase tracking-widest text-fg-subtle">RMM</div>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((group, gi) => {
          const items = group.items.filter((i) => allowed(user.permissions, i.permission, i.superAdmin, user.isSuperAdmin));
          if (!items.length) return null;
          return (
            <div key={gi} className="mb-3">
              {group.label && !collapsed && <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">{group.label}</div>}
              {group.label && collapsed && <div className="mx-auto my-2 h-px w-6 bg-border" />}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
                  const count = item.badge ? counts?.[item.badge] : undefined;
                  const link = (
                    <Link
                      href={item.href}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-ring",
                        active ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />}
                      <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-accent-hover" : "text-fg-subtle group-hover:text-fg-muted")} />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && !!count && <span className={cn("rounded-full px-1.5 text-[10px] font-semibold tabular", item.badge === "alerts" ? "bg-danger-soft text-danger" : "bg-surface-3 text-fg-muted")}>{count > 99 ? "99+" : count}</span>}
                      {collapsed && !!count && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger" />}
                    </Link>
                  );
                  return <li key={item.href}>{collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link}</li>;
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-border p-2">
        <button type="button" onClick={onToggle} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-fg-subtle hover:bg-surface-hover hover:text-fg focus-ring", collapsed && "justify-center px-0")}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
        </button>
      </div>
    </aside>
  );
}
