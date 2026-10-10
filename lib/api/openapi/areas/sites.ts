import { z } from "zod";
import { endpoint, type EndpointDoc } from "../registry";
import { SiteCreate, SiteDeleteQuery, SiteListQuery, SitePatch, SiteSchema } from "../../contracts/sites";

const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/sites", operationId: "listSites", tag: "Sites", permission: "devices.view", risk: "read",
    summary: "List sites", query: SiteListQuery, response: z.object({ items: z.array(SiteSchema) }),
    notes: ["Site-scoped memberships only see their own sites.", "Each site carries device, online, group and scoped-member counts."],
    aiHint: "Use to resolve a site name to its id (for device targeting, invites or group scoping) and to see how many devices each location has.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/sites", operationId: "createSite", tag: "Sites", permission: "sites.manage", risk: "write",
    summary: "Create a site", body: SiteCreate, response: SiteSchema,
    bodyExample: { name: "Rotterdam office", address: "Weena 1, Rotterdam", timezone: "Europe/Amsterdam", contactName: "Office manager", contactEmail: "office@acme.com", networks: ["10.20.0.0/24"] },
    notes: ["Names are unique per organization.", "`networks` (CIDR) seed network discovery scans for the site.", "Emits `site.created`."],
    aiHint: "Use when a client opens a new location; afterwards point enrollment tokens and technicians at the new site id.",
  }),
  endpoint({ method: "GET", path: "/api/v1/sites/{id}", operationId: "getSite", tag: "Sites", permission: "devices.view", risk: "read", summary: "Get a site with its groups, scoped members and platform breakdown", params: { id: "Site id" }, response: SiteSchema.extend({ groups: z.array(z.object({ id: z.string(), name: z.string(), isDynamic: z.boolean() })), members: z.array(z.object({ userId: z.string(), name: z.string(), email: z.string(), roleName: z.string() })), platforms: z.record(z.string(), z.number()) }), aiHint: "Use to answer questions about one location: contacts, how many Windows/Linux/macOS devices, which technicians are scoped to it." }),
  endpoint({ method: "PATCH", path: "/api/v1/sites/{id}", operationId: "updateSite", tag: "Sites", permission: "sites.manage", risk: "write", summary: "Edit a site", params: { id: "Site id" }, body: SitePatch, response: SiteSchema, notes: ["`settings` and `customFields` are merged; other fields replace.", "Emits `site.updated`."], aiHint: "Use to correct an address, timezone, contact or discovery networks." }),
  endpoint({
    method: "DELETE", path: "/api/v1/sites/{id}", operationId: "deleteSite", tag: "Sites", permission: "sites.manage", risk: "dangerous",
    summary: "Delete a site (move its devices first)", params: { id: "Site id" }, query: SiteDeleteQuery, response: z.object({ ok: z.literal(true), devicesMoved: z.number(), movedTo: z.object({ id: z.string(), name: z.string() }).nullable() }),
    notes: ["409 `site_in_use` while devices are assigned unless `?reassignTo=<siteId>` moves devices, groups and enrollment tokens there.", "The last site of an organization cannot be deleted (409 `last_site`).", "Memberships scoped to the site are re-scoped to the target (or become org-wide).", "Emits `site.deleted`."],
    aiHint: "Use when a location closes; always pass reassignTo so devices keep a site. Confirm with the operator first.",
  }),
];
export default area;
