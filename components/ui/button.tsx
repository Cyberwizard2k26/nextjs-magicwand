"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/util/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "success" | "link";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-[0_0_0_1px_var(--accent-strong),0_8px_24px_-10px_var(--accent-glow)]",
  secondary: "bg-surface-3 text-fg hover:bg-surface-hover border border-border-strong/60",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-hover",
  outline: "border border-border-strong text-fg hover:bg-surface-hover",
  danger: "bg-danger/90 text-white hover:bg-danger",
  success: "bg-success/90 text-black hover:bg-success",
  link: "text-accent-hover hover:underline underline-offset-4 px-0",
};
const sizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-xs rounded-md gap-1.5",
  sm: "h-8 px-3 text-sm rounded-md gap-1.5",
  md: "h-9 px-4 text-sm rounded-lg gap-2",
  lg: "h-11 px-5 text-base rounded-lg gap-2",
  icon: "h-9 w-9 rounded-lg",
  "icon-sm": "h-8 w-8 rounded-md",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "primary", size = "md", loading, leftIcon, rightIcon, children, disabled, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn("inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-colors focus-ring disabled:opacity-50 disabled:pointer-events-none", variants[variant], sizes[size], className)}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
