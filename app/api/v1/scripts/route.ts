import { z } from "zod";
import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { api } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export const ScriptBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  language: z.enum(["powershell", "bash", "zsh", "python", "cmd", "node", "applescript", "sh"]),
  content: z.string().max(512_000),
  parameters: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(64), label: z.string().max(120).optional(), type: z.enum(["string", "number", "boolean", "select", "secret", "device_field"]), required: z.boolean().optional(), default: z.union([z.string(), z.number(), z.boolean()]).optional(), options: z.array(z.string()).optional(), description: z.string().max(500).optional() })).max(50).default([]),
  platforms: z.array(z.enum(["windows", "linux", "macos", "freebsd"])).default([]),
  category: z.string().max(80).nullable().optional(),
  tags: z.array(z.string().max(40)).max(30).default([]),
  timeoutSeconds: z.number().int().positive().max(24 * 3600).default(300),
  runAs: z.enum(["system", "user", "elevated_user"]).default("system"),
  successCodes: z.array(z.number().int()).default([0]),
  outputJson: z.boolean().default(false),
  risk: z.enum(["low", "medium", "high"]).default("low"),
  requiresApproval: z.boolean().default(false),
  isFavorite: z.boolean().optional(),
});

const Query = z.object({ q: z.string().max(200).optional(), language: z.string().optional(), category: z.string().optional(), platform: z.string().optional() });

/** Script library: the org's scripts plus global (built-in) ones. Content included - the library is small. */
export const GET = api({ permission: "scripts.view", query: Query }, async ({ orgId, query }) => {
  const db = await getDb();
  const where = [or(eq(schema.scripts.orgId, orgId), isNull(schema.scripts.orgId))!];
  if (query.q) {
    const like = `%${query.q.replace(/[%_]/g, "\\$&")}%`;
    where.push(or(ilike(schema.scripts.name, like), ilike(schema.scripts.description, like), ilike(schema.scripts.category, like))!);
  }
  if (query.language) where.push(eq(schema.scripts.language, query.language as typeof schema.scripts.$inferSelect.language));
  if (query.category) where.push(eq(schema.scripts.category, query.category));
  const items = await db.select().from(schema.scripts).where(and(...where)).orderBy(desc(schema.scripts.isFavorite), asc(schema.scripts.name)).limit(1000);
  return { items: query.platform ? items.filter((s) => !s.platforms.length || s.platforms.includes(query.platform!)) : items };
});

export const POST = api({ permission: "scripts.manage", body: ScriptBody }, async ({ orgId, body, principal, audit }) => {
  const db = await getDb();
  const [script] = await db.insert(schema.scripts).values({ ...body, orgId, createdBy: principal.user?.id ?? null, updatedBy: principal.user?.id ?? null }).returning();
  await db.insert(schema.scriptVersions).values({ scriptId: script.id, version: 1, content: script.content, parameters: script.parameters, changelog: "Created", createdBy: principal.user?.id ?? null });
  await audit("script.created", { type: "script", id: script.id, name: script.name }, { language: script.language, risk: script.risk });
  return { script };
});
