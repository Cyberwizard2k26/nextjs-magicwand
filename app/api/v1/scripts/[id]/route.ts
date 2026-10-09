import { and, desc, eq, or, isNull, sql } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { ScriptBody } from "../route";

export const dynamic = "force-dynamic";

async function load(id: string, orgId: string) {
  const db = await getDb();
  const [script] = await db.select().from(schema.scripts).where(and(eq(schema.scripts.id, id), or(eq(schema.scripts.orgId, orgId), isNull(schema.scripts.orgId))));
  if (!script) throw errors.notFound("Script not found");
  return script;
}

export const GET = api({ permission: "scripts.view" }, async ({ orgId, params }) => {
  const script = await load(params.id, orgId);
  const db = await getDb();
  const versions = await db.select({ id: schema.scriptVersions.id, version: schema.scriptVersions.version, changelog: schema.scriptVersions.changelog, createdAt: schema.scriptVersions.createdAt, createdBy: schema.scriptVersions.createdBy }).from(schema.scriptVersions).where(eq(schema.scriptVersions.scriptId, script.id)).orderBy(desc(schema.scriptVersions.version)).limit(50);
  const recentRuns = await db
    .select({ jobId: schema.jobs.id, name: schema.jobs.name, status: schema.jobs.status, stats: schema.jobs.stats, createdAt: schema.jobs.createdAt, createdByName: schema.jobs.createdByName })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.orgId, orgId), eq(schema.jobs.type, "script"), sql`${schema.jobs.payload}->>'scriptId' = ${script.id}`))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(10);
  return { script, versions, recentRuns };
});

export const PATCH = api({ permission: "scripts.manage", body: ScriptBody.partial().extend({ changelog: ScriptBody.shape.description }) }, async ({ orgId, params, body, principal, audit }) => {
  const script = await load(params.id, orgId);
  if (!script.orgId) throw errors.forbidden("Built-in scripts are read-only; duplicate it into your library to change it");
  const db = await getDb();
  const { changelog, ...patch } = body;
  const contentChanged = (patch.content !== undefined && patch.content !== script.content) || (patch.parameters !== undefined && JSON.stringify(patch.parameters) !== JSON.stringify(script.parameters));
  const version = contentChanged ? script.version + 1 : script.version;
  const [updated] = await db.update(schema.scripts).set({ ...patch, version, updatedBy: principal.user?.id ?? null }).where(eq(schema.scripts.id, script.id)).returning();
  if (contentChanged) await db.insert(schema.scriptVersions).values({ scriptId: script.id, version, content: updated.content, parameters: updated.parameters, changelog: changelog ?? null, createdBy: principal.user?.id ?? null });
  await audit("script.updated", { type: "script", id: script.id, name: updated.name }, { version, fields: Object.keys(patch) });
  return { script: updated };
});

export const DELETE = api({ permission: "scripts.manage" }, async ({ orgId, params, audit }) => {
  const script = await load(params.id, orgId);
  if (!script.orgId) throw errors.forbidden("Built-in scripts cannot be deleted");
  const db = await getDb();
  await db.delete(schema.scripts).where(eq(schema.scripts.id, script.id));
  await audit("script.deleted", { type: "script", id: script.id, name: script.name });
  return { ok: true };
});
