import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { api } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/util/crypto";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/** List enrollment tokens for the active org (never returns the secret). */
export const GET = api({ permission: "devices.enroll" }, async ({ orgId }) => {
  const db = await getDb();
  const items = await db.select().from(schema.enrollmentTokens).where(eq(schema.enrollmentTokens.orgId, orgId)).orderBy(desc(schema.enrollmentTokens.createdAt));
  return { items: items.map(({ tokenHash: _h, ...t }) => { void _h; return t; }) };
});

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  siteId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  maxUses: z.number().int().positive().optional().nullable(),
  expiresInHours: z.number().positive().max(24 * 365).optional().nullable(),
  requireApproval: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  agentConfig: z.record(z.string(), z.unknown()).optional(),
});

/** Create a token. The raw secret is returned exactly once. */
export const POST = api({ permission: "devices.enroll", body: CreateBody }, async ({ orgId, body, principal, audit }) => {
  const db = await getDb();
  const raw = "mwe_" + randomToken(24);
  const [row] = await db
    .insert(schema.enrollmentTokens)
    .values({
      orgId,
      siteId: body.siteId ?? null,
      groupId: body.groupId ?? null,
      name: body.name,
      prefix: raw.slice(0, 12),
      tokenHash: hashToken(raw),
      maxUses: body.maxUses ?? null,
      expiresAt: body.expiresInHours ? new Date(Date.now() + body.expiresInHours * 3600_000) : null,
      requireApproval: body.requireApproval ?? false,
      tags: body.tags ?? [],
      agentConfig: body.agentConfig ?? {},
      createdBy: principal.user?.id ?? null,
    })
    .returning();
  await audit("enrollment_token.created", { type: "enrollment_token", id: row.id, name: row.name });
  const { tokenHash: _h, ...token } = row;
  void _h;
  return {
    token,
    secret: raw,
    serverUrl: config.publicUrl,
    install: {
      windows: `magicwand-agent.exe install --server ${config.publicUrl} --token ${raw}`,
      linux: `curl -fsSL ${config.publicUrl}/install/linux.sh | sudo bash -s -- --server ${config.publicUrl} --token ${raw}`,
      macos: `curl -fsSL ${config.publicUrl}/install/macos.sh | sudo bash -s -- --server ${config.publicUrl} --token ${raw}`,
    },
  };
});
