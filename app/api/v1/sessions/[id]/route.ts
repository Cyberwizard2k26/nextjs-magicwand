import { and, eq } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { endSession, liveSessions } from "@/lib/services/remote-sessions";

export const dynamic = "force-dynamic";

export const GET = api({ permission: "remote.terminal" }, async ({ orgId, params }) => {
  const db = await getDb();
  const [s] = await db.select().from(schema.remoteSessions).where(and(eq(schema.remoteSessions.id, params.id), eq(schema.remoteSessions.orgId, orgId)));
  if (!s) throw errors.notFound("Session not found");
  const live = liveSessions.get(s.id);
  return { session: s, live: !!live, viewers: live?.viewers.size ?? 0 };
});

/** End a session (the owner, or anyone with remote.jit_approve, e.g. an admin cutting a session short). */
export const DELETE = api({ permission: "remote.terminal" }, async ({ orgId, params, principal, audit }) => {
  const db = await getDb();
  const [s] = await db.select().from(schema.remoteSessions).where(and(eq(schema.remoteSessions.id, params.id), eq(schema.remoteSessions.orgId, orgId)));
  if (!s) throw errors.notFound("Session not found");
  if (s.userId !== principal.user?.id && !principal.isSuperAdmin && !principal.memberships.some((m) => m.orgId === orgId && (m.permissions.includes("*") || m.permissions.includes("remote.jit_approve")))) throw errors.forbidden("Only the session owner or an administrator can end it");
  const ended = await endSession(s.id, `ended by ${principal.user?.name ?? principal.user?.email ?? "api"}`);
  await audit("session.ended", { type: "device", id: s.deviceId }, { sessionId: s.id, wasLive: ended });
  return { ok: true, ended };
});
