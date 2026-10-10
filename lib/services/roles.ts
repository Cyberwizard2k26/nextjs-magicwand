/**
 * Roles: system roles (shared, read-only) and per-organization custom roles with a validated permission list.
 * Pure helpers (catalog, validation, last-admin maths) are exported for the UI and unit tests.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { ALL_PERMISSIONS, PERMISSIONS, hasPermission, type Permission } from "../rbac/permissions";
import type { RoleCreateT, RolePatchT } from "../api/contracts/roles";
import { ServiceError } from "./org";

export type Role = typeof schema.roles.$inferSelect;

export const PERMISSION_AREAS: { area: string; label: string }[] = [
  { area: "org", label: "Organization" }, { area: "sites", label: "Sites" }, { area: "users", label: "Users & roles" }, { area: "audit", label: "Audit log" }, { area: "apikeys", label: "API keys" }, { area: "integrations", label: "Integrations & webhooks" }, { area: "sso", label: "Single sign-on" },
  { area: "devices", label: "Devices" }, { area: "groups", label: "Device groups" }, { area: "remote", label: "Remote access" },
  { area: "scripts", label: "Scripts" }, { area: "jobs", label: "Jobs" }, { area: "schedules", label: "Schedules" }, { area: "automations", label: "Automations" }, { area: "policies", label: "Policies" },
  { area: "monitors", label: "Monitoring" }, { area: "alerts", label: "Alerts" }, { area: "maintenance", label: "Maintenance windows" },
  { area: "patches", label: "Patching" }, { area: "software", label: "Software" }, { area: "vulnerabilities", label: "Vulnerabilities" },
  { area: "security", label: "Security posture" }, { area: "vault", label: "Vault" },
  { area: "tickets", label: "Tickets" }, { area: "contacts", label: "Contacts" }, { area: "docs", label: "Documentation" }, { area: "reports", label: "Reports" }, { area: "network", label: "Network" },
  { area: "ai", label: "AI" }, { area: "platform", label: "Platform" },
];

/** Permissions grouped by area, in a stable display order. */
export function permissionCatalog(): { area: string; label: string; permissions: { key: Permission; label: string }[] }[] {
  const byArea = new Map<string, { key: Permission; label: string }[]>();
  for (const key of ALL_PERMISSIONS) {
    const area = key.split(".")[0];
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area)!.push({ key, label: PERMISSIONS[key] });
  }
  const ordered = PERMISSION_AREAS.filter((a) => byArea.has(a.area)).map((a) => ({ ...a, permissions: byArea.get(a.area)! }));
  for (const [area, permissions] of byArea) if (!PERMISSION_AREAS.some((a) => a.area === area)) ordered.push({ area, label: area, permissions });
  return ordered;
}

/** Expand `*` and `resource.*` wildcards into the concrete permission keys they grant (stable order, deduplicated). */
export function expandPermissions(perms: readonly string[]): Permission[] {
  if (perms.includes("*")) return [...ALL_PERMISSIONS];
  const out = new Set<string>();
  for (const p of perms) {
    if (p.endsWith(".*")) {
      const area = p.slice(0, -2);
      for (const k of ALL_PERMISSIONS) if (k.startsWith(area + ".")) out.add(k);
    } else if ((ALL_PERMISSIONS as readonly string[]).includes(p)) out.add(p);
  }
  return ALL_PERMISSIONS.filter((k) => out.has(k));
}

/** Custom roles may only hold concrete permission keys (no wildcards). Returns the unknown entries and the normalised list. */
export function validatePermissions(perms: readonly string[]): { ok: boolean; unknown: string[]; permissions: Permission[] } {
  const unknown = [...new Set(perms.filter((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p)))];
  const permissions = ALL_PERMISSIONS.filter((k) => perms.includes(k));
  return { ok: unknown.length === 0, unknown, permissions };
}

/** Does this permission set let its holder manage users? That is the "administrator" test used by last-admin guards. */
export function grantsUserAdmin(perms: readonly string[]): boolean {
  return hasPermission(perms, "users.manage");
}

/**
 * Last-admin maths: `adminIds` are the members who currently administer users. Changing `targetId` so that it no longer
 * administers (`targetStaysAdmin === false`) is refused when nobody else would be left.
 */
export function wouldRemoveLastAdmin(adminIds: readonly string[], targetId: string, targetStaysAdmin: boolean): boolean {
  if (targetStaysAdmin) return false;
  if (!adminIds.includes(targetId)) return false;
  return adminIds.filter((id) => id !== targetId).length === 0;
}

export function diffPermissions(before: readonly string[], after: readonly string[]): { added: string[]; removed: string[] } {
  const b = new Set(expandPermissions(before));
  const a = new Set(expandPermissions(after));
  return { added: [...a].filter((x) => !b.has(x)), removed: [...b].filter((x) => !a.has(x)) };
}

/* ---- Database ---- */

const visibleTo = (orgId: string) => or(isNull(schema.roles.orgId), eq(schema.roles.orgId, orgId))!;

export async function listRoles(orgId: string) {
  const db = await getDb();
  const rows = await db
    .select({ role: schema.roles, memberCount: sql<number>`(select count(*)::int from ${schema.memberships} m where m.role_id = ${schema.roles.id} and m.org_id = ${orgId})` })
    .from(schema.roles)
    .where(visibleTo(orgId))
    .orderBy(sql`${schema.roles.isSystem} desc`, schema.roles.name);
  return rows.map(({ role, memberCount }) => ({ ...role, memberCount }));
}

export async function getRole(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ role: schema.roles, memberCount: sql<number>`(select count(*)::int from ${schema.memberships} m where m.role_id = ${schema.roles.id} and m.org_id = ${orgId})` })
    .from(schema.roles)
    .where(and(eq(schema.roles.id, id), visibleTo(orgId)));
  return row ? { ...row.role, memberCount: row.memberCount } : null;
}

async function assertNameFree(orgId: string, name: string, exceptId?: string) {
  const db = await getDb();
  const rows = await db.select({ id: schema.roles.id }).from(schema.roles).where(and(visibleTo(orgId), sql`lower(${schema.roles.name}) = lower(${name})`));
  if (rows.some((r) => r.id !== exceptId)) throw new ServiceError(409, `A role named "${name}" already exists`, "conflict");
}

export async function createRole(orgId: string, input: RoleCreateT) {
  const db = await getDb();
  let perms: readonly string[] = input.permissions;
  if (input.cloneFrom && !perms.length) {
    const src = await getRole(orgId, input.cloneFrom);
    if (!src) throw new ServiceError(404, "Role to clone from was not found", "not_found");
    perms = expandPermissions(src.permissions);
  }
  const v = validatePermissions(perms);
  if (!v.ok) throw new ServiceError(400, `Unknown permissions: ${v.unknown.join(", ")}`, "bad_request");
  if (!v.permissions.length) throw new ServiceError(400, "A role needs at least one permission", "bad_request");
  await assertNameFree(orgId, input.name);
  const [row] = await db.insert(schema.roles).values({ orgId, name: input.name.trim(), description: input.description ?? null, permissions: v.permissions, isSystem: false }).returning();
  bus.publish("role.created", { id: row.id, name: row.name, permissions: row.permissions.length }, { orgId });
  return { ...row, memberCount: 0 };
}

export async function updateRole(orgId: string, id: string, patch: RolePatchT) {
  const db = await getDb();
  const role = await getRole(orgId, id);
  if (!role) return null;
  if (role.isSystem || role.orgId !== orgId) throw new ServiceError(409, "System roles are read-only. Clone the role to customise it.", "system_role");
  let permissions = role.permissions;
  if (patch.permissions) {
    const v = validatePermissions(patch.permissions);
    if (!v.ok) throw new ServiceError(400, `Unknown permissions: ${v.unknown.join(", ")}`, "bad_request");
    if (!v.permissions.length) throw new ServiceError(400, "A role needs at least one permission", "bad_request");
    permissions = v.permissions;
  }
  if (patch.name && patch.name !== role.name) await assertNameFree(orgId, patch.name, id);
  const [row] = await db.update(schema.roles).set({ name: patch.name?.trim() ?? role.name, description: patch.description === undefined ? role.description : patch.description, permissions, updatedAt: new Date() }).where(eq(schema.roles.id, id)).returning();
  bus.publish("role.updated", { id, name: row.name, ...diffPermissions(role.permissions, permissions) }, { orgId });
  return { ...row, memberCount: role.memberCount, diff: diffPermissions(role.permissions, permissions) };
}

export async function deleteRole(orgId: string, id: string, reassignTo?: string) {
  const db = await getDb();
  const role = await getRole(orgId, id);
  if (!role) return null;
  if (role.isSystem || role.orgId !== orgId) throw new ServiceError(409, "System roles cannot be deleted", "system_role");
  if (role.memberCount > 0) {
    if (!reassignTo) throw new ServiceError(409, `${role.memberCount} member${role.memberCount === 1 ? " is" : "s are"} assigned to this role. Pass reassignTo to move them first.`, "role_in_use");
    const target = await getRole(orgId, reassignTo);
    if (!target || target.id === id) throw new ServiceError(400, "reassignTo must be another role visible to this organization", "bad_request");
    await db.update(schema.memberships).set({ roleId: target.id }).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.roleId, id)));
  }
  await db.delete(schema.roles).where(eq(schema.roles.id, id));
  bus.publish("role.deleted", { id, name: role.name, reassignedTo: reassignTo ?? null }, { orgId });
  return role;
}
