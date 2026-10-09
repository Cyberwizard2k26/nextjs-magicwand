"use client";
import * as React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-danger-soft text-danger">
        <AlertTriangle className="h-6 w-6" />
      </span>
      <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-1.5 text-sm text-fg-muted">This page hit an unexpected error. Try again, and if it keeps happening share the reference below with your administrator.</p>
      {error.digest && <code className="mono mt-3 rounded bg-surface-3 px-2 py-1 text-xs text-fg-muted">ref {error.digest}</code>}
      <Button className="mt-6" onClick={reset} leftIcon={<RotateCw className="h-4 w-4" />}>Try again</Button>
    </div>
  );
}
