import { api, ApiError } from "@/lib/api/route";
import { CustomFieldCreate, CustomFieldListQuery } from "@/lib/api/contracts/org";
import { createCustomField, listCustomFields } from "@/lib/services/custom-fields";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

/** Custom field definitions (device, site, organization, ticket, contact). */
export const GET = api({ permission: "org.view", query: CustomFieldListQuery }, async ({ orgId, query }) => ({ items: await listCustomFields(orgId, query.entity) }));

export const POST = api({ permission: "org.manage", body: CustomFieldCreate }, async ({ orgId, body, audit }) => {
  const row = await createCustomField(orgId, body).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  await audit("custom_field.created", { type: "custom_field", id: row.id, name: `${row.entity}.${row.key}` }, { type: row.type, required: row.required });
  return row;
});
