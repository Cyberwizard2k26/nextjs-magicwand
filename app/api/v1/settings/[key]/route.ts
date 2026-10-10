import { z } from "zod";
import { api, ApiError, errors } from "@/lib/api/route";
import { SettingKeyParam, SETTING_KEYS } from "@/lib/api/contracts/settings";
import { getOrgSettingValue, ServiceError, setOrgSettingValue } from "@/lib/services/org";

export const dynamic = "force-dynamic";

function key(params: Record<string, string>) {
  const k = SettingKeyParam.safeParse(params.key);
  if (!k.success) throw errors.notFound(`Unknown settings key. Available: ${SETTING_KEYS.join(", ")}`);
  return k.data;
}

/** Read one org-scoped settings document (general, notifications, branding, security, maintenance). */
export const GET = api({ permission: "org.view" }, async ({ orgId, params }) => {
  const r = await getOrgSettingValue(orgId, key(params));
  if (!r) throw errors.notFound("Organization not found");
  return r;
});

/** Replace one settings document. The body is validated against the key's schema; unknown keys are 404. */
export const PUT = api({ permission: "org.manage", body: z.record(z.string(), z.unknown()) }, async ({ orgId, params, body, audit }) => {
  const k = key(params);
  const r = await setOrgSettingValue(orgId, k, body).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  if (!r) throw errors.notFound("Organization not found");
  await audit("settings.updated", { type: "settings", id: k, name: k }, { keys: Object.keys(body) });
  return r;
});
