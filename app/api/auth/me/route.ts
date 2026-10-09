import { api } from "@/lib/api/route";
import { principalPermissions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const GET = api({ orgOptional: true, allowPendingMfa: true }, async ({ principal, orgId }) => ({
  user: principal.user ? { id: principal.user.id, email: principal.user.email, name: principal.user.name, isSuperAdmin: principal.isSuperAdmin, totpEnabled: principal.user.totpEnabled, preferences: principal.user.preferences } : null,
  kind: principal.kind,
  activeOrgId: orgId || null,
  memberships: principal.memberships.map((m) => ({ orgId: m.orgId, role: m.roleName })),
  permissions: principalPermissions(principal, orgId || null),
  mfaPending: principal.kind === "user" && !!principal.user?.totpEnabled && !principal.session?.mfaVerified,
}));
