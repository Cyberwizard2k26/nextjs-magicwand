import { z } from "zod";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { api, paginationQuery } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { CreateJobBody, createJobFromRequest } from "@/lib/services/job-create";

export const dynamic = "force-dynamic";

const list = z.array(z.string()).or(z.string().transform((s) => s.split(",").filter(Boolean)));
const Query = paginationQuery.extend({ status: list.optional(), type: list.optional(), source: list.optional(), createdBy: z.string().optional() });

export const GET = api({ permission: "jobs.view", query: Query }, async ({ orgId, query }) => {
  const db = await getDb();
  const where = [eq(schema.jobs.orgId, orgId)];
  if (query.status?.length) where.push(inArray(schema.jobs.status, query.status as (typeof schema.jobs.$inferSelect.status)[]));
  if (query.type?.length) where.push(inArray(schema.jobs.type, query.type as (typeof schema.jobs.$inferSelect.type)[]));
  if (query.source?.length) where.push(inArray(schema.jobs.source, query.source as (typeof schema.jobs.$inferSelect.source)[]));
  if (query.createdBy) where.push(eq(schema.jobs.createdBy, query.createdBy));
  if (query.q) where.push(ilike(schema.jobs.name, `%${query.q.replace(/[%_]/g, "\\$&")}%`));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.jobs).where(and(...where));
  const items = await db.select().from(schema.jobs).where(and(...where)).orderBy(desc(schema.jobs.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  return { items, total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)) };
});

export const POST = api({ permission: "jobs.manage", body: CreateJobBody }, async ({ orgId, body, principal, audit }) => {
  const result = await createJobFromRequest(principal, orgId, body);
  await audit("job.created", { type: "job", id: result.job.id, name: result.job.name }, { type: body.type, targetType: body.targetType, targets: result.runs.length, canary: !!body.canary, rolloutJobId: result.rollout?.id });
  return result;
});
