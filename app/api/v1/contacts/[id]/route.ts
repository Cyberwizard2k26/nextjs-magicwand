import { api, errors } from "@/lib/api/route";
import { ContactUpdate } from "@/lib/api/contracts/contacts";
import { deleteContact, getContact, updateContact } from "@/lib/services/contacts";
import { siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "../../tickets/_shared";

export const dynamic = "force-dynamic";

/** Contact detail with linked devices, recent tickets and satisfaction stats. */
export const GET = api({ permission: "tickets.view" }, async ({ orgId, params, principal }) => {
  const detail = await getContact(params.id, orgId, siteScope(principal, orgId));
  if (!detail) throw errors.notFound("Contact not found");
  return detail;
});

/** Edit a contact. */
export const PATCH = api({ permission: "contacts.manage", body: ContactUpdate }, async ({ orgId, params, body, principal, audit }) => {
  if (!(await getContact(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Contact not found");
  const contact = await desk(() => updateContact(orgId, params.id, body, actorOf(principal)));
  await audit("contact.update", { type: "contact", id: contact.id, name: contact.name }, { fields: Object.keys(body) });
  return { contact };
});

/** Delete a contact (tickets keep their history, the contact link is cleared). */
export const DELETE = api({ permission: "contacts.manage" }, async ({ orgId, params, principal, audit }) => {
  if (!(await getContact(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Contact not found");
  const contact = await desk(() => deleteContact(orgId, params.id, actorOf(principal)));
  await audit("contact.delete", { type: "contact", id: contact.id, name: contact.name });
  return { ok: true };
});
