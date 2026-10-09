"use client";
import * as React from "react";
import useSWR from "swr";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, type Paginated } from "./api";

export function useDebounce<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

/** Paginated list hook: const { data, page, setPage, q, setQ, mutate } = usePaginated<Device>("devices", { status: "online" }) */
export function usePaginated<T>(path: string, params: Record<string, string | number | boolean | undefined | null> = {}, opts: { pageSize?: number; refreshInterval?: number } = {}) {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(opts.pageSize ?? 50);
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const dq = useDebounce(q, 250);
  const paramsKey = JSON.stringify(params);
  const key = React.useMemo(() => [path, { ...(JSON.parse(paramsKey) as typeof params), page, pageSize, q: dq || undefined, sort: sort?.field, dir: sort?.dir }] as const, [path, paramsKey, page, pageSize, dq, sort?.field, sort?.dir]);
  const swr = useSWR<Paginated<T>>(key as unknown as [string, Record<string, string>], ([p, query]: [string, Record<string, string>]) => api.get<Paginated<T>>(p, query), { keepPreviousData: true, refreshInterval: opts.refreshInterval });
  React.useEffect(() => { setPage(1); }, [dq, paramsKey]);
  return { ...swr, page, setPage, pageSize, setPageSize, q, setQ, sort, setSort, items: swr.data?.items ?? [], total: swr.data?.total ?? 0, pages: swr.data?.pages ?? 1 };
}

export function useLocalStorage<T>(key: string, initial: T) {
  const [v, setV] = React.useState<T>(initial);
  React.useEffect(() => {
    try { const raw = localStorage.getItem(key); if (raw !== null) setV(JSON.parse(raw)); } catch { /* ignore */ }
  }, [key]);
  const set = React.useCallback((next: T | ((prev: T) => T)) => {
    setV((prev) => {
      const val = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
      return val;
    });
  }, [key]);
  return [v, set] as const;
}

/** Filter state mirrored into the URL query string so views are shareable and survive refresh. */
export function useUrlState<T extends Record<string, string | undefined>>(defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = React.useMemo(() => {
    const out = { ...defaults } as T;
    for (const k of Object.keys(defaults)) {
      const v = params.get(k);
      if (v !== null) (out as Record<string, string | undefined>)[k] = v;
    }
    return out;
  }, [params, defaults]);
  const set = React.useCallback((patch: Partial<T>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "" || v === defaults[k]) sp.delete(k);
      else sp.set(k, String(v));
    }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router, defaults]);
  return [state, set] as const;
}
