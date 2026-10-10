import { api } from "@/lib/api/route";
import { ContactCreate, ContactListQuery } from "@/lib/api/contracts/contacts";
import { createContact, listContacts } from "@/lib/services/contacts";
import { siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "../tickets/_shared";

export const dynamic = "force-dynamic";

/** Contacts (end users) of the organization with their device and open-ticket counts. */
export const GET = api({ permission: "tickets.view", query: ContactListQuery }, async ({ orgId, query, principal }) => listContacts({ ...query, orgId, siteIds: siteScope(principal, orgId) }));

/** Create a contact, optionally linking devices. */
export const POST = api({ permission: "contacts.manage", body: ContactCreate }, async ({ orgId, body, principal, audit }) => {
  const contact = await desk(() => createContact(orgId, body, actorOf(principal)));
  await audit("contact.create", { type: "contact", id: contact.id, name: contact.name }, { email: contact.email, siteId: contact.siteId, devices: body.deviceIds?.length ?? 0 });
  return { contact };
});
