"use client";
import * as React from "react";
import { SWRConfig } from "swr";
import { Toaster } from "sonner";
import { swrFetcher } from "@/lib/client/api";
import { TooltipProvider } from "@/components/ui/menu";

function useDocumentTheme() {
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  React.useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const theme = useDocumentTheme();
  return (
    <SWRConfig value={{ fetcher: swrFetcher, revalidateOnFocus: false, dedupingInterval: 2000, errorRetryCount: 2 }}>
      <TooltipProvider>
        {children}
        <Toaster theme={theme} position="bottom-right" richColors closeButton toastOptions={{ className: "!bg-surface-3 !border-border-strong !text-fg" }} />
      </TooltipProvider>
    </SWRConfig>
  );
}
