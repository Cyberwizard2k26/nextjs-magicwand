import { api } from "@/lib/api/route";
import { SlaPolicyCreate } from "@/lib/api/contracts/tickets";
import { createSlaPolicy, listSlaPolicies } from "@/lib/services/tickets";
import { desk } from "../_shared";

export const dynamic = "force-dynamic";

/** SLA policies of the organization (a "Standard" default is created on first use). */
export const GET = api({ permission: "tickets.view" }, async ({ orgId }) => {
  const items = await listSlaPolicies(orgId);
  return { items, total: items.length };
});

/** Create an SLA policy; `isDefault: true` makes it the policy applied to new tickets. */
export const POST = api({ permission: "tickets.manage", body: SlaPolicyCreate }, async ({ orgId, body, audit }) => {
  const policy = await desk(() => createSlaPolicy(orgId, body));
  await audit("ticket.sla_policy.create", { type: "sla_policy", id: policy.id, name: policy.name }, { isDefault: policy.isDefault });
  return { policy };
});
