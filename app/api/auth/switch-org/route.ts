import { z } from "zod";
import { eq } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export const POST = api({ orgOptional: true, body: z.object({ orgId: z.string() }) }, async ({ principal, body }) => {
  if (!principal.session) throw errors.badRequest("API keys are bound to one organization");
  if (!principal.isSuperAdmin && !principal.memberships.some((m) => m.orgId === body.orgId)) throw errors.forbidden();
  const db = await getDb();
  await db.update(schema.sessions).set({ activeOrgId: body.orgId }).where(eq(schema.sessions.id, principal.session.id));
  return { ok: true };
});
