/** Session helpers for Server Components and Server Actions (App Router). */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolvePrincipal, requiresMfa, type Principal } from "./session";
import { boot } from "../boot";

export async function getPrincipal(): Promise<Principal | null> {
  await boot({ withServices: false });
  const c = await cookies();
  const h = await headers();
  const cookieHeader = c.getAll().map((x) => `${x.name}=${encodeURIComponent(x.value)}`).join("; ");
  return resolvePrincipal({ cookieHeader, authorization: h.get("authorization"), orgHeader: h.get("x-org-id"), ip: h.get("x-forwarded-for")?.split(",")[0].trim() || "", userAgent: h.get("user-agent") || "", touch: false });
}

/** Require a signed-in user; redirects to /login (or the MFA step) otherwise. */
export async function requireUser(next?: string): Promise<Principal & { user: NonNullable<Principal["user"]> }> {
  const p = await getPrincipal();
  if (!p || !p.user) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  if (requiresMfa(p)) redirect(`/login/mfa${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return p as Principal & { user: NonNullable<Principal["user"]> };
}
