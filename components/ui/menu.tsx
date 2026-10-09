"use client";
import * as React from "react";
import { DropdownMenu as RDM, Tooltip as RT, Tabs as RTabs, Popover as RPop } from "radix-ui";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/util/cn";

const contentClass = "z-50 min-w-[180px] overflow-hidden rounded-lg border border-border-strong bg-surface p-1 shadow-2xl data-[state=open]:animate-in";
const itemClass = "flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-fg-muted";

export function Menu({ trigger, children, align = "end", side }: { trigger: React.ReactNode; children: React.ReactNode; align?: "start" | "center" | "end"; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RDM.Root>
      <RDM.Trigger asChild>{trigger}</RDM.Trigger>
      <RDM.Portal>
        <RDM.Content align={align} side={side} sideOffset={6} className={contentClass}>
          {children}
        </RDM.Content>
      </RDM.Portal>
    </RDM.Root>
  );
}
export function MenuItem({ children, onSelect, icon, danger, disabled, shortcut }: { children: React.ReactNode; onSelect?: () => void; icon?: React.ReactNode; danger?: boolean; disabled?: boolean; shortcut?: string }) {
  return (
    <RDM.Item disabled={disabled} onSelect={onSelect} className={cn(itemClass, danger && "text-danger [&>svg]:text-danger")}>
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="ml-4 text-[10px] text-fg-subtle">{shortcut}</span>}
    </RDM.Item>
  );
}
export function MenuCheckItem({ children, checked, onCheckedChange }: { children: React.ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <RDM.CheckboxItem checked={checked} onCheckedChange={onCheckedChange} className={itemClass}>
      <span className="flex h-4 w-4 items-center justify-center">{checked && <Check className="h-3.5 w-3.5 text-accent-hover" />}</span>
      {children}
    </RDM.CheckboxItem>
  );
}
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <RDM.Label className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{children}</RDM.Label>;
}
export function MenuSeparator() {
  return <RDM.Separator className="my-1 h-px bg-border" />;
}
export function MenuSub({ label, icon, children }: { label: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <RDM.Sub>
      <RDM.SubTrigger className={itemClass}>
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronRight className="h-3.5 w-3.5" />
      </RDM.SubTrigger>
      <RDM.Portal>
        <RDM.SubContent sideOffset={4} className={contentClass}>{children}</RDM.SubContent>
      </RDM.Portal>
    </RDM.Sub>
  );
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <RT.Provider delayDuration={300}>{children}</RT.Provider>;
}
export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  if (!content) return <>{children}</>;
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md border border-border-strong bg-surface-3 px-2.5 py-1.5 text-xs text-fg shadow-xl animate-in">
          {content}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}

export function Tabs({ value, onValueChange, tabs, className, children, variant = "underline" }: { value: string; onValueChange: (v: string) => void; tabs: { value: string; label: React.ReactNode; icon?: React.ReactNode; count?: number }[]; className?: string; children?: React.ReactNode; variant?: "underline" | "pills" }) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <RTabs.List className={cn("flex items-center gap-1 overflow-x-auto", variant === "underline" ? "border-b border-border" : "rounded-lg bg-surface-2 p-1 w-fit")}>
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors focus-ring [&>svg]:h-4 [&>svg]:w-4",
              variant === "underline"
                ? "-mb-px border-b-2 border-transparent px-3 py-2.5 text-fg-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
                : "rounded-md px-3 py-1.5 text-fg-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow",
            )}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && <span className="ml-1 rounded-full bg-surface-3 px-1.5 text-[10px] text-fg-muted">{t.count}</span>}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}
export const TabPanel = RTabs.Content;

export function Popover({ trigger, children, align = "start", className }: { trigger: React.ReactNode; children: React.ReactNode; align?: "start" | "center" | "end"; className?: string }) {
  return (
    <RPop.Root>
      <RPop.Trigger asChild>{trigger}</RPop.Trigger>
      <RPop.Portal>
        <RPop.Content align={align} sideOffset={6} className={cn("z-50 rounded-lg border border-border-strong bg-surface p-3 shadow-2xl animate-in", className)}>{children}</RPop.Content>
      </RPop.Portal>
    </RPop.Root>
  );
}
