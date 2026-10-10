"use client";
import * as React from "react";
import { AlertTriangle, CalendarClock, CheckCheck, ChevronDown, Inbox, Tag, Trash2, UserPlus, UserX, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/util/cn";
import { PRIORITIES, STATUSES, type Assignee, type TicketSummary } from "./ticket-bits";

export type TileKey = "open" | "unassigned" | "due" | "breached" | "resolved";

const TILES: { key: TileKey; label: string; icon: React.ReactNode; pick: (s: TicketSummary) => number; tone: (n: number) => "neutral" | "warning" | "danger" | "success" | "accent" }[] = [
  { key: "open", label: "Open", icon: <Inbox />, pick: (s) => s.open, tone: () => "accent" },
  { key: "unassigned", label: "Unassigned", icon: <UserX />, pick: (s) => s.unassigned, tone: (n) => (n > 0 ? "warning" : "neutral") },
  { key: "due", label: "Due today", icon: <CalendarClock />, pick: (s) => s.dueToday, tone: (n) => (n > 0 ? "warning" : "neutral") },
  { key: "breached", label: "SLA breached", icon: <AlertTriangle />, pick: (s) => s.breached, tone: (n) => (n > 0 ? "danger" : "neutral") },
  { key: "resolved", label: "Resolved this week", icon: <CheckCheck />, pick: (s) => s.resolvedThisWeek, tone: (n) => (n > 0 ? "success" : "neutral") },
];
const TONE_TEXT = { neutral: "text-fg-subtle", warning: "text-warning", danger: "text-danger", success: "text-success", accent: "text-fg" } as const;
const TONE_ICON = { neutral: "bg-surface-3 text-fg-muted", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", success: "bg-success-soft text-success", accent: "bg-accent-soft text-accent-hover" } as const;

export function SummaryTiles({ summary, active, onSelect }: { summary: TicketSummary | undefined; active: TileKey | null; onSelect: (k: TileKey) => void }) {
  return (
    <div className="stagger-in mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0">
      {TILES.map((t) => {
        const n = summary ? t.pick(summary) : null;
        const tone = n === null ? "neutral" : t.tone(n);
        return (
          <button key={t.key} type="button" onClick={() => onSelect(t.key)} aria-pressed={active === t.key} className={cn("card card-hover flex items-center gap-3 px-4 py-3 text-left focus-ring", active === t.key && "border-accent")}>
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4", TONE_ICON[tone])}>{t.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-fg-muted">{t.label}</span>
              <span className={cn("block text-xl font-semibold tabular leading-6", n !== null && n > 0 ? TONE_TEXT[tone] : "text-fg-subtle")}>{n === null ? "…" : n}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function BulkBar({ count, assignees, meId, onAssign, onStatus, onPriority, onTag, onDelete, onClear, busy }: { count: number; assignees: Assignee[]; meId: string | null; onAssign: (id: string | null) => void; onStatus: (s: string) => void; onPriority: (p: string) => void; onTag: (tag: string, remove: boolean) => void; onDelete: () => void; onClear: () => void; busy?: boolean }) {
  const [tagOpen, setTagOpen] = React.useState(false);
  const [tag, setTag] = React.useState("");
  const [remove, setRemove] = React.useState(false);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2 text-sm animate-in" role="toolbar" aria-label="Bulk actions">
      <span className="font-medium">{count} selected</span>
      <span className="mx-1 hidden h-4 w-px bg-border-strong sm:block" />
      <Menu trigger={<Button size="sm" variant="secondary" disabled={busy} leftIcon={<UserPlus className="h-3.5 w-3.5" />} rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>Assign</Button>} align="start">
        {meId && <MenuItem onSelect={() => onAssign(meId)}>Assign to me</MenuItem>}
        <MenuItem onSelect={() => onAssign(null)}>Unassign</MenuItem>
        <MenuSeparator />
        <MenuLabel>Technicians</MenuLabel>
        {assignees.map((a) => <MenuItem key={a.id} onSelect={() => onAssign(a.id)}>{a.name} <span className="ml-1 text-[10px] text-fg-subtle">{a.openTickets} open</span></MenuItem>)}
      </Menu>
      <Menu trigger={<Button size="sm" variant="secondary" disabled={busy} rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>Status</Button>} align="start">
        {STATUSES.map((s) => <MenuItem key={s.value} onSelect={() => onStatus(s.value)}>{s.label}</MenuItem>)}
      </Menu>
      <Menu trigger={<Button size="sm" variant="secondary" disabled={busy} rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>Priority</Button>} align="start">
        {PRIORITIES.map((p) => <MenuItem key={p.value} onSelect={() => onPriority(p.value)}>{p.label}</MenuItem>)}
      </Menu>
      <Button size="sm" variant="secondary" disabled={busy} leftIcon={<Tag className="h-3.5 w-3.5" />} onClick={() => { setTag(""); setRemove(false); setTagOpen(true); }}>Tag</Button>
      <Button size="sm" variant="ghost" disabled={busy} className="text-danger hover:text-danger" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete}>Delete</Button>
      <button type="button" className="ml-auto rounded p-1 text-fg-muted hover:text-fg focus-ring" onClick={onClear} aria-label="Clear selection"><X className="h-4 w-4" /></button>
      <Dialog open={tagOpen} onOpenChange={setTagOpen} title={remove ? "Remove a tag" : "Add a tag"} description={`Applies to ${count} ticket${count === 1 ? "" : "s"}.`} size="sm"
        footer={<><Button variant="ghost" onClick={() => setTagOpen(false)}>Cancel</Button><Button disabled={!tag.trim()} onClick={() => { onTag(tag.trim(), remove); setTagOpen(false); }}>{remove ? "Remove tag" : "Add tag"}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (tag.trim()) { onTag(tag.trim(), remove); setTagOpen(false); } }} className="space-y-3">
          <Field label="Tag"><Input autoFocus value={tag} onChange={(e) => setTag(e.target.value)} placeholder="vip" maxLength={40} /></Field>
          <label className="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} className="h-4 w-4 rounded border-border-strong bg-surface-2 accent-[var(--accent)]" /> Remove this tag instead of adding it</label>
        </form>
      </Dialog>
    </div>
  );
}

export function ViewPills({ views, active, onSelect }: { views: { v: string; label: string; icon?: React.ReactNode }[]; active: string; onSelect: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Saved views">
      {views.map((x) => (
        <button key={x.v} type="button" role="tab" aria-selected={active === x.v} onClick={() => onSelect(x.v)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-ring", active === x.v ? "border-accent/50 bg-accent-soft text-accent-hover" : "border-border bg-surface-2 text-fg-muted hover:border-border-strong hover:text-fg")}>
          {x.icon}{x.label}
        </button>
      ))}
      <Users className="hidden" />
    </div>
  );
}
