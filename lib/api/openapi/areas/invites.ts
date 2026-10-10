import { z } from "zod";
import { endpoint, type EndpointDoc } from "../registry";
import { InviteAccept, InviteCreate, InviteCreateResponse, InviteListQuery, InviteLookupQuery, InviteLookupResponse, InviteSchema } from "../../contracts/invites";

const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/invites", operationId: "listInvites", tag: "Invites", permission: "users.view", risk: "read",
    summary: "List invitations", query: InviteListQuery, response: z.object({ items: z.array(InviteSchema) }),
    notes: ["`status` defaults to `pending`; use `all`, `accepted` or `expired` for history."],
    aiHint: "Use to check whether someone was already invited and whether their link is still valid.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/invites", operationId: "createInvite", tag: "Invites", permission: "users.manage", risk: "write",
    summary: "Invite a person by email", body: InviteCreate, response: InviteCreateResponse,
    bodyExample: { email: "tech@client.com", roleId: "<roleId>", siteIds: [], message: "Welcome aboard!", expiresInDays: 7 },
    notes: ["The person receives an email with a one-time link when SMTP is configured; otherwise `inviteUrl` is returned once so you can share it securely.", "An outstanding invitation for the same address is replaced.", "Refused (409 `already_member`) when the email already belongs to a member.", "Emits `invite.created`."],
    aiHint: "Use to onboard a new technician or client contact; pick the role id from GET /roles and restrict `siteIds` for site-scoped staff.",
  }),
  endpoint({ method: "GET", path: "/api/v1/invites/{id}", operationId: "getInvite", tag: "Invites", permission: "users.view", risk: "read", summary: "Get one invitation", params: { id: "Invite id" }, response: InviteSchema, aiHint: "Use to read an invitation's role, scope and expiry." }),
  endpoint({
    method: "DELETE", path: "/api/v1/invites/{id}", operationId: "revokeInvite", tag: "Invites", permission: "users.manage", risk: "write",
    summary: "Revoke an invitation", params: { id: "Invite id" }, response: z.object({ ok: z.literal(true) }),
    notes: ["The link stops working immediately. Emits `invite.revoked`."],
    aiHint: "Use when an invitation was sent to the wrong address or is no longer wanted.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/invites/{id}/resend", operationId: "resendInvite", tag: "Invites", permission: "users.manage", risk: "write",
    summary: "Re-issue and resend an invitation", params: { id: "Invite id" }, response: InviteCreateResponse,
    notes: ["Generates a fresh 7-day link (the previous one stops working) and sends the email again."],
    aiHint: "Use when the person says they never received or lost the invitation email.",
  }),
  endpoint({
    method: "GET", path: "/api/auth/invite", operationId: "lookupInvite", tag: "Invites", public: true, risk: "read",
    summary: "Public: describe an invitation link", query: InviteLookupQuery, response: InviteLookupResponse,
    notes: ["Rate limited per IP.", "Returns `valid: false` with a `reason` for expired, used or unknown tokens; never leaks whether an email exists beyond `existingUser` for a valid token."],
    aiHint: "Only the invitation page uses this; an operator does not normally call it.",
  }),
  endpoint({
    method: "POST", path: "/api/auth/invite", operationId: "acceptInvite", tag: "Invites", public: true, risk: "write",
    summary: "Public: accept an invitation", body: InviteAccept, response: z.object({ ok: z.literal(true), createdAccount: z.boolean(), mfaRequired: z.boolean(), orgId: z.string() }),
    notes: ["New emails create an account (name + password >= 12 chars); existing users confirm their current password.", "Signs the person in (session cookie) and audits `invite.accepted`.", "410 `expired`, 409 `accepted`, 401 `invalid_credentials`."],
    aiHint: "Only the invitation page uses this; an operator does not normally call it.",
  }),
];
export default area;
