import { api, ApiError, errors } from "@/lib/api/route";
import { CustomFieldPatch } from "@/lib/api/contracts/org";
import { deleteCustomField, updateCustomField } from "@/lib/services/custom-fields";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

export const PATCH = api({ permission: "org.manage", body: CustomFieldPatch }, async ({ orgId, params, body, audit }) => {
  const row = await updateCustomField(orgId, params.id, body).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  if (!row) throw errors.notFound("Custom field not found");
  await audit("custom_field.updated", { type: "custom_field", id: row.id, name: `${row.entity}.${row.key}` }, { changed: Object.keys(body) });
  return row;
});

export const DELETE = api({ permission: "org.manage" }, async ({ orgId, params, audit }) => {
  const row = await deleteCustomField(orgId, params.id);
  if (!row) throw errors.notFound("Custom field not found");
  await audit("custom_field.deleted", { type: "custom_field", id: row.id, name: `${row.entity}.${row.key}` });
  return { ok: true };
});
