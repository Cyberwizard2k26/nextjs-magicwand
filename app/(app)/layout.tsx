import { requireUser } from "@/lib/auth/server";
import { AppShell } from "@/components/shell/app-shell";
import { principalPermissions } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { hasAnyUser } from "@/lib/boot";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await hasAnyUser())) redirect("/setup");
  const p = await requireUser();
  const db = await getDb();
  const orgRows = p.isSuperAdmin
    ? await db.select({ id: schema.organizations.id, name: schema.organizations.name, kind: schema.organizations.kind, branding: schema.organizations.branding }).from(schema.organizations).where(eq(schema.organizations.status, "active"))
    : p.memberships.length
      ? await db.select({ id: schema.organizations.id, name: schema.organizations.name, kind: schema.organizations.kind, branding: schema.organizations.branding }).from(schema.organizations).where(inArray(schema.organizations.id, p.memberships.map((m) => m.orgId)))
      : [];
  const activeOrgId = p.activeOrgId ?? orgRows[0]?.id ?? null;
  const active = orgRows.find((o) => o.id === activeOrgId);
  const user = { id: p.user.id, name: p.user.name, email: p.user.email, isSuperAdmin: p.isSuperAdmin, permissions: principalPermissions(p, activeOrgId) };
  return (
    <AppShell user={user} orgs={orgRows.map(({ id, name, kind }) => ({ id, name, kind }))} activeOrgId={activeOrgId} productName={active?.branding?.productName}>
      {children}
    </AppShell>
  );
}
