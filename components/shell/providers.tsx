"use client";
import * as React from "react";
import { SWRConfig } from "swr";
import { Toaster } from "sonner";
import { swrFetcher } from "@/lib/client/api";
import { TooltipProvider } from "@/components/ui/menu";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher: swrFetcher, revalidateOnFocus: false, dedupingInterval: 2000, errorRetryCount: 2 }}>
      <TooltipProvider>
        {children}
        <Toaster theme="dark" position="bottom-right" richColors closeButton toastOptions={{ className: "!bg-surface-3 !border-border-strong !text-fg" }} />
      </TooltipProvider>
    </SWRConfig>
  );
}
