"use client";
import * as React from "react";
import { cn } from "@/lib/util/cn";

export const inputClass = "h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-fg-subtle focus-ring focus:border-accent/60 disabled:opacity-50 transition-colors";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { leftIcon?: React.ReactNode }>(function Input({ className, leftIcon, ...props }, ref) {
  if (leftIcon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle [&>svg]:h-4 [&>svg]:w-4">{leftIcon}</span>
        <input ref={ref} className={cn(inputClass, "pl-9", className)} {...props} />
      </div>
    );
  }
  return <input ref={ref} className={cn(inputClass, className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(inputClass, "h-auto min-h-[96px] py-2 leading-relaxed", className)} {...props} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(inputClass, "appearance-none pr-8 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2398a1b5%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat", className)} {...props}>
      {children}
    </select>
  );
});

export function Label({ className, children, hint, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: string }) {
  return (
    <label className={cn("block text-xs font-medium text-fg-muted mb-1.5", className)} {...props}>
      {children}
      {hint && <span className="ml-1 text-fg-subtle font-normal">({hint})</span>}
    </label>
  );
}

export function Field({ label, hint, error, children, className }: { label?: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-0", className)}>
      {label && <Label hint={hint}>{label}</Label>}
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Switch({ checked, onCheckedChange, disabled, label, className }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; label?: string; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn("inline-flex items-center gap-2 focus-ring rounded-full disabled:opacity-50", className)}
    >
      <span className={cn("relative inline-block h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-surface-3 border border-border-strong")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "left-0.5 translate-x-4" : "left-0.5")} />
      </span>
      {label && <span className="text-sm text-fg">{label}</span>}
    </button>
  );
}

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={cn("h-4 w-4 rounded border-border-strong bg-surface-2 accent-[var(--accent)] focus-ring", className)} {...props} />;
}
