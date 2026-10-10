import { api } from "@/lib/api/route";
import { SlaPolicyUpdate } from "@/lib/api/contracts/tickets";
import { deleteSlaPolicy, updateSlaPolicy } from "@/lib/services/tickets";
import { desk } from "../../_shared";

export const dynamic = "force-dynamic";

/** Edit targets, business hours, name or default flag of an SLA policy. */
export const PATCH = api({ permission: "tickets.manage", body: SlaPolicyUpdate }, async ({ orgId, params, body, audit }) => {
  const policy = await desk(() => updateSlaPolicy(orgId, params.policyId, body));
  await audit("ticket.sla_policy.update", { type: "sla_policy", id: policy.id, name: policy.name }, { fields: Object.keys(body) });
  return { policy };
});

/** Delete a non-default SLA policy. */
export const DELETE = api({ permission: "tickets.manage" }, async ({ orgId, params, audit }) => {
  const policy = await desk(() => deleteSlaPolicy(orgId, params.policyId));
  await audit("ticket.sla_policy.delete", { type: "sla_policy", id: policy.id, name: policy.name });
  return { ok: true };
});
