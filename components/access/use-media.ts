"use client";
import * as React from "react";

/** SSR-safe media query hook (false on the server and during hydration). */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback((cb: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }, [query]);
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** A clock that ticks every `ms` (0 on the server and during hydration) so durations never read Date.now() during render. */
export function useNow(ms = 1000): number {
  const subscribe = React.useCallback((cb: () => void) => {
    const h = setInterval(cb, ms);
    return () => clearInterval(h);
  }, [ms]);
  return React.useSyncExternalStore(subscribe, () => Math.floor(Date.now() / ms) * ms, () => 0);
}
