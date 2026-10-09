"use client";
import * as React from "react";
import { Dialog as RDialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/util/cn";

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", className }: { open: boolean; onOpenChange: (o: boolean) => void; title?: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" | "xl" | "full"; className?: string }) {
  const w = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl", full: "max-w-[96vw] h-[92vh]" }[size];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in" />
        <RDialog.Content className={cn("fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-strong bg-surface shadow-2xl focus:outline-none data-[state=open]:animate-in flex flex-col max-h-[90vh]", w, className)}>
          {(title || description) && (
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                {title && <RDialog.Title className="text-base font-semibold text-fg">{title}</RDialog.Title>}
                {description && <RDialog.Description className="mt-0.5 text-sm text-fg-muted">{description}</RDialog.Description>}
              </div>
              <RDialog.Close className="rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg focus-ring" aria-label="Close">
                <X className="h-4 w-4" />
              </RDialog.Close>
            </div>
          )}
          {!title && <RDialog.Title className="sr-only">Dialog</RDialog.Title>}
          <div className="flex-1 overflow-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/50 px-5 py-3 rounded-b-xl">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Sheet({ open, onOpenChange, title, description, children, footer, side = "right", className, width = "max-w-xl" }: { open: boolean; onOpenChange: (o: boolean) => void; title?: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; side?: "right" | "left"; className?: string; width?: string }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <RDialog.Content className={cn("fixed top-0 z-50 flex h-full w-full flex-col border-border-strong bg-surface shadow-2xl focus:outline-none", side === "right" ? "right-0 border-l" : "left-0 border-r", width, className)}>
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <RDialog.Title className="text-base font-semibold text-fg">{title ?? ""}</RDialog.Title>
              {description && <RDialog.Description className="mt-0.5 text-sm text-fg-muted">{description}</RDialog.Description>}
            </div>
            <RDialog.Close className="rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg focus-ring" aria-label="Close">
              <X className="h-4 w-4" />
            </RDialog.Close>
          </div>
          <div className="flex-1 overflow-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/50 px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", tone = "danger", onConfirm, loading }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; confirmLabel?: string; tone?: "danger" | "primary"; onConfirm: () => void | Promise<void>; loading?: boolean }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <button type="button" className="h-9 rounded-lg px-4 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg" onClick={() => onOpenChange(false)}>Cancel</button>
          <button
            type="button"
            disabled={busy || loading}
            className={cn("h-9 rounded-lg px-4 text-sm font-medium text-white disabled:opacity-50", tone === "danger" ? "bg-danger hover:bg-danger/90" : "bg-accent hover:bg-accent-hover")}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); onOpenChange(false); } finally { setBusy(false); }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    />
  );
}
