import { api, ApiError } from "@/lib/api/route";
import { IpAllowlistCreate } from "@/lib/api/contracts/org";
import { addIpAllowlist, listIpAllowlist, ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

/** IP ranges allowed to sign in / call the API when `security.ipAllowlistEnabled` is on. */
export const GET = api({ permission: "org.view" }, async ({ orgId }) => ({ items: await listIpAllowlist(orgId) }));

export const POST = api({ permission: "org.manage", body: IpAllowlistCreate }, async ({ orgId, body, audit }) => {
  const row = await addIpAllowlist(orgId, body).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  await audit("org.ip_allowlist.added", { type: "ip_allowlist", id: row.id, name: row.cidr }, { appliesTo: row.appliesTo, note: row.note });
  return row;
});
