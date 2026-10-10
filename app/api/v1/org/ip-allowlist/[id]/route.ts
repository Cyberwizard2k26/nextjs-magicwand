import { api, errors } from "@/lib/api/route";
import { removeIpAllowlist } from "@/lib/services/org";

export const dynamic = "force-dynamic";

export const DELETE = api({ permission: "org.manage" }, async ({ orgId, params, audit }) => {
  const row = await removeIpAllowlist(orgId, params.id);
  if (!row) throw errors.notFound("Allowlist entry not found");
  await audit("org.ip_allowlist.removed", { type: "ip_allowlist", id: row.id, name: row.cidr });
  return { ok: true };
});
