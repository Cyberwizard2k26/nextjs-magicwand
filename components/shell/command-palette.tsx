"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Monitor, Sparkles, ArrowRight, Terminal, Cast, Play, Search, Download, Ticket, Radar } from "lucide-react";
import { Dialog as RDialog } from "radix-ui";
import { allowed, visibleNav, type ShellUser } from "./sidebar";
import { Kbd } from "@/components/ui/misc";
import { api } from "@/lib/client/api";
import { StatusDot } from "@/components/ui/misc";
import { platformLabel } from "@/lib/client/format";

const ACTIONS = [
  { label: "Run a script on devices", href: "/jobs/new", icon: Play, permission: "scripts.run" },
  { label: "Create an enrollment token / download installer", href: "/deploy", icon: Download, permission: "devices.enroll" },
  { label: "New ticket", href: "/tickets/new", icon: Ticket, permission: "tickets.manage" },
  { label: "Scan network", href: "/network?scan=1", icon: Radar, permission: "network.manage" },
];

interface DeviceHit { id: string; name: string; hostname: string | null; platform: string; status: string; loggedInUser: string | null }

export function CommandPalette({ open, onOpenChange, user }: { open: boolean; onOpenChange: (o: boolean) => void; user: ShellUser }) {
  const navItems = React.useMemo(() => visibleNav(user).flatMap((g) => g.items), [user]);
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [devices, setDevices] = React.useState<DeviceHit[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) { setQuery(""); setDevices([]); }
  }, [open]);

  React.useEffect(() => {
    if (!open || query.trim().length < 2) { setDevices([]); return; }
    const h = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get<{ items: DeviceHit[] }>("devices", { q: query, pageSize: 8 });
        setDevices(r.items ?? []);
      } catch { setDevices([]); } finally { setLoading(false); }
    }, 180);
    return () => clearTimeout(h);
  }, [query, open]);

  const go = (href: string) => { onOpenChange(false); router.push(href); };
  const isQuestion = query.trim().length > 12 && /\s/.test(query) && !devices.length;

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <RDialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl animate-in focus:outline-none">
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <Command shouldFilter={false} loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="h-4 w-4 text-fg-subtle" />
              <Command.Input value={query} onValueChange={setQuery} placeholder="Search devices, jump to a page, or ask the copilot…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle" />
              {loading ? <span className="text-xs text-fg-subtle">Searching…</span> : <Kbd>esc</Kbd>}
            </div>
            <Command.List className="max-h-[60vh] overflow-auto p-2">
              <Command.Empty className="px-3 py-10 text-center text-sm text-fg-subtle">No matches for “{query}”.</Command.Empty>
              {devices.length > 0 && (
                <Command.Group heading={<Heading>Devices</Heading>}>
                  {devices.map((d) => (
                    <Item key={d.id} onSelect={() => go(`/devices/${d.id}`)}>
                      <StatusDot status={d.status} />
                      <Monitor className="h-4 w-4 text-fg-subtle" />
                      <span className="flex-1 truncate">{d.name}</span>
                      <span className="text-xs text-fg-subtle">{d.loggedInUser || d.hostname} · {platformLabel[d.platform] ?? d.platform}</span>
                      <span className="ml-2 flex items-center gap-1 text-[10px] text-fg-subtle">
                        <button type="button" onClick={(e) => { e.stopPropagation(); go(`/devices/${d.id}/desktop`); }} className="rounded p-1 hover:bg-surface-3" title="Remote desktop"><Cast className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); go(`/devices/${d.id}/terminal`); }} className="rounded p-1 hover:bg-surface-3" title="Terminal"><Terminal className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); go(`/jobs/new?device=${d.id}`); }} className="rounded p-1 hover:bg-surface-3" title="Run script"><Play className="h-3.5 w-3.5" /></button>
                      </span>
                    </Item>
                  ))}
                </Command.Group>
              )}
              {isQuestion && (
                <Command.Group heading={<Heading>AI Copilot</Heading>}>
                  <Item onSelect={() => go(`/copilot?q=${encodeURIComponent(query)}`)}>
                    <Sparkles className="h-4 w-4 text-accent-hover" />
                    <span className="flex-1 truncate">Ask: “{query}”</span>
                    <ArrowRight className="h-3.5 w-3.5 text-fg-subtle" />
                  </Item>
                </Command.Group>
              )}
              <Command.Group heading={<Heading>Go to</Heading>}>
                {navItems
                  .filter((i) => !query || i.label.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, query ? 6 : 8)
                  .map((i) => (
                    <Item key={i.href} onSelect={() => go(i.href)}>
                      <i.icon className="h-4 w-4 text-fg-subtle" />
                      <span className="flex-1">{i.label}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-fg-subtle" />
                    </Item>
                  ))}
              </Command.Group>
              <Command.Group heading={<Heading>Actions</Heading>}>
                {ACTIONS
                  .filter((a) => allowed(user.permissions, a.permission, false, user.isSuperAdmin))
                  .filter((a) => !query || a.label.toLowerCase().includes(query.toLowerCase()))
                  .map((a) => (
                    <Item key={a.href} onSelect={() => go(a.href)}>
                      <a.icon className="h-4 w-4 text-fg-subtle" />
                      <span className="flex-1">{a.label}</span>
                    </Item>
                  ))}
              </Command.Group>
            </Command.List>
            <div className="flex items-center gap-4 border-t border-border bg-surface-2/60 px-4 py-2 text-[11px] text-fg-subtle">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
              <span className="ml-auto hidden sm:inline">Type 2+ characters to search devices</span>
            </div>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">{children}</div>;
}
function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item onSelect={onSelect} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg data-[selected=true]:bg-surface-hover">
      {children}
    </Command.Item>
  );
}
