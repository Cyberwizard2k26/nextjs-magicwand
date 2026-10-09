import * as React from "react";
import { cn } from "@/lib/util/cn";

export function Card({ className, children, hover, ...props }: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div className={cn("card", hover && "card-hover", className)} {...props}>
      {children}
    </div>
  );
}
export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg leading-5">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
export function CardBody({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props}>{children}</div>;
}
export function CardFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("border-t border-border px-5 py-3 flex items-center justify-end gap-2 bg-surface-2/50 rounded-b-[var(--radius)]", className)}>{children}</div>;
}
