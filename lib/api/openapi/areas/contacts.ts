import { z } from "zod";
import { endpoint, type EndpointDoc } from "../registry";
import { ContactCreate, ContactDetail, ContactDeviceLink, ContactDeviceUnlink, ContactListQuery, ContactListResponse, ContactRow, ContactUpdate } from "../../contracts/contacts";

const TAG = "Contacts";
const idParam = { id: "Contact id (uuid)" };
const ContactBare = ContactRow.omit({ siteName: true, deviceCount: true, openTickets: true, primaryDeviceId: true, primaryDeviceName: true });

/** End users (requesters) and the devices they use. */
const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/contacts", operationId: "listContacts", tag: TAG, permission: "tickets.view", risk: "read",
    summary: "List contacts", description: "End users of the organization with site, device count, open tickets and primary device. `q` matches name, email, phone, department and title.",
    query: ContactListQuery, response: ContactListResponse,
    notes: ["`deviceId` returns the people linked to one machine (who to call about it)."],
    aiHint: "Find the requester for a ticket by name or email, or find who uses a device before contacting them.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/contacts", operationId: "createContact", tag: TAG, permission: "contacts.manage", risk: "write",
    summary: "Create a contact", body: ContactCreate, response: z.object({ contact: ContactBare }),
    bodyExample: { name: "Dana Whitfield", email: "dana@acme.com", phone: "+1 555 0100", deviceIds: ["<device-id>"], isVip: false },
    notes: ["Email must be unique within the organization (409 otherwise).", "`deviceIds` links devices; the first (or `primaryDeviceId`) becomes primary and its site is inherited when `siteId` is omitted.", "Audit: `contact.create`. Event: `contact.created`."],
    aiHint: "Create the requester when a new person reports an issue and no contact matches their name or email.",
  }),
  endpoint({
    method: "GET", path: "/api/v1/contacts/{id}", operationId: "getContact", tag: TAG, permission: "tickets.view", risk: "read",
    summary: "Get a contact", description: "Contact with linked devices (live status), their 25 most recent tickets and satisfaction stats.", params: idParam, response: ContactDetail,
    aiHint: "Read to see which machine a user works on and their ticket history before helping them.",
  }),
  endpoint({
    method: "PATCH", path: "/api/v1/contacts/{id}", operationId: "updateContact", tag: TAG, permission: "contacts.manage", risk: "write",
    summary: "Update a contact", params: idParam, body: ContactUpdate, response: z.object({ contact: ContactBare }), notes: ["Audit: `contact.update`. Event: `contact.updated`."], aiHint: "Fix contact details, flag a VIP or enable portal access.",
  }),
  endpoint({
    method: "DELETE", path: "/api/v1/contacts/{id}", operationId: "deleteContact", tag: TAG, permission: "contacts.manage", risk: "dangerous",
    summary: "Delete a contact", params: idParam, response: z.object({ ok: z.boolean() }), notes: ["Tickets keep their history; their contact link is cleared.", "Audit: `contact.delete`. Event: `contact.deleted`."], aiHint: "Only on explicit operator request.",
  }),
  endpoint({
    method: "GET", path: "/api/v1/contacts/{id}/devices", operationId: "listContactDevices", tag: TAG, permission: "tickets.view", risk: "read",
    summary: "Devices of a contact", params: idParam, response: z.object({ items: ContactDetail.shape.devices, total: z.number().int() }), aiHint: "Resolve which device to open a terminal or toolbox on for a given user.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/contacts/{id}/devices", operationId: "linkContactDevice", tag: TAG, permission: "contacts.manage", risk: "write",
    summary: "Link a device to a contact", params: idParam, body: ContactDeviceLink, response: z.object({ link: z.object({ contactId: z.string(), deviceId: z.string(), isPrimary: z.boolean(), deviceName: z.string() }) }),
    notes: ["The first linked device becomes primary automatically.", "Audit: `contact.device.link`. Event: `contact.device.linked`."], aiHint: "Record which machine a user works on once you have identified it (e.g. from the logged-in user).",
  }),
  endpoint({
    method: "DELETE", path: "/api/v1/contacts/{id}/devices", operationId: "unlinkContactDevice", tag: TAG, permission: "contacts.manage", risk: "write",
    summary: "Unlink a device from a contact", params: idParam, body: ContactDeviceUnlink, response: z.object({ ok: z.boolean() }), notes: ["Another linked device is promoted to primary when needed."], aiHint: "Use when a user moves to a different machine.",
  }),
];
export default area;
