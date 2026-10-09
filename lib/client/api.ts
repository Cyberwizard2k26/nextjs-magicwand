/** Browser-side API client. Adds the active org header, parses errors into ApiClientError, supports SWR. */
export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiClientError";
  }
}

let activeOrgId: string | null = null;
export function setActiveOrg(id: string | null) {
  activeOrgId = id;
  try {
    if (id) localStorage.setItem("mw.activeOrg", id);
    else localStorage.removeItem("mw.activeOrg");
  } catch { /* ignore */ }
}
export function getActiveOrg(): string | null {
  if (activeOrgId) return activeOrgId;
  try { activeOrgId = localStorage.getItem("mw.activeOrg"); } catch { /* ignore */ }
  return activeOrgId;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit & { json?: unknown; query?: Record<string, string | number | boolean | undefined | null> } = {}): Promise<T> {
  const { json, query, headers, ...rest } = init;
  let url = path.startsWith("/") ? path : `/api/v1/${path}`;
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    const qs = sp.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  const h = new Headers(headers);
  const org = getActiveOrg();
  if (org) h.set("x-org-id", org);
  if (json !== undefined) h.set("content-type", "application/json");
  const res = await fetch(url, { credentials: "same-origin", ...rest, headers: h, body: json !== undefined ? JSON.stringify(json) : rest.body });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string; details?: unknown };
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
      const code = d.error;
      if (code === "mfa_required") location.href = `/login/mfa?next=${encodeURIComponent(location.pathname)}`;
      else location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    throw new ApiClientError(res.status, d.error || "error", d.message || res.statusText, d.details);
  }
  return data as T;
}

export const api = {
  get: <T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined | null>) => apiFetch<T>(path, { method: "GET", query }),
  post: <T = unknown>(path: string, json?: unknown) => apiFetch<T>(path, { method: "POST", json }),
  put: <T = unknown>(path: string, json?: unknown) => apiFetch<T>(path, { method: "PUT", json }),
  patch: <T = unknown>(path: string, json?: unknown) => apiFetch<T>(path, { method: "PATCH", json }),
  delete: <T = unknown>(path: string, json?: unknown) => apiFetch<T>(path, { method: "DELETE", json }),
};

/** SWR fetcher: useSWR(["devices", { page: 1 }], swrFetcher) or useSWR("devices", swrFetcher). */
export const swrFetcher = <T = unknown>(key: string | [string, Record<string, string | number | boolean | undefined | null>?]) =>
  Array.isArray(key) ? api.get<T>(key[0], key[1]) : api.get<T>(key);

export interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number; pages: number }
