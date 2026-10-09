import { and, eq } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Revoke a token. */
export const DELETE = api({ permission: "devices.enroll" }, async ({ orgId, params, audit }) => {
  const db = await getDb();
  const [row] = await db.update(schema.enrollmentTokens).set({ revokedAt: new Date() }).where(and(eq(schema.enrollmentTokens.id, params.id), eq(schema.enrollmentTokens.orgId, orgId))).returning({ id: schema.enrollmentTokens.id, name: schema.enrollmentTokens.name });
  if (!row) throw errors.notFound();
  await audit("enrollment_token.revoked", { type: "enrollment_token", id: row.id, name: row.name });
  return { ok: true };
});
