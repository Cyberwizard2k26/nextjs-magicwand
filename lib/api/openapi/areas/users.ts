import { z } from "zod";
import { endpoint, type EndpointDoc } from "../registry";
import { MemberListResponse, MemberPatch, MemberSchema, UserListQuery } from "../../contracts/users";

const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/users", operationId: "listMembers", tag: "Users", permission: "users.view", risk: "read",
    summary: "List organization members",
    description: "Members of the active organization joined with their user account and role: status, MFA state, site/group scope and last sign-in. Includes headline counts (active, suspended, administrators, MFA-enabled).",
    query: UserListQuery, response: MemberListResponse,
    notes: ["Paginated (`page`, `pageSize` <= 500).", "`q` searches name, email and role name.", "`status=suspended` maps to user accounts that are disabled."],
    aiHint: "Use to find a technician or end user by name/email, check who is an administrator, or see who still lacks MFA before changing roles or scopes.",
  }),
  endpoint({
    method: "GET", path: "/api/v1/users/{id}", operationId: "getMember", tag: "Users", permission: "users.view", risk: "read",
    summary: "Get one member", params: { id: "User id" }, response: MemberSchema,
    aiHint: "Use to inspect a member's role, permissions and site scope before editing them.",
  }),
  endpoint({
    method: "PATCH", path: "/api/v1/users/{id}", operationId: "updateMember", tag: "Users", permission: "users.manage", risk: "dangerous",
    summary: "Change a member's role, scope, name or status", params: { id: "User id" }, body: MemberPatch, response: MemberSchema,
    bodyExample: { roleId: "<roleId>", siteIds: ["<siteId>"], status: "active" },
    notes: ["`status: suspended` disables sign-in for the account everywhere and revokes its sessions; `active` re-enables it and clears lockouts.", "Refused (409 `last_admin`) when the change would leave the organization without a member holding users.manage.", "You cannot suspend yourself or drop your own administrator role (409 `self_change`).", "Emits `user.updated`."],
    aiHint: "Use to promote/demote a technician, restrict them to specific sites, or suspend a departed employee. Confirm with the operator before suspending.",
  }),
  endpoint({
    method: "DELETE", path: "/api/v1/users/{id}", operationId: "removeMember", tag: "Users", permission: "users.manage", risk: "dangerous",
    summary: "Remove a member from the organization", params: { id: "User id" }, response: z.object({ ok: z.literal(true), removed: z.string() }),
    notes: ["The user account is kept (it may belong to other organizations); only the membership is deleted.", "Same last-admin and self-removal guards as PATCH.", "Emits `user.removed`."],
    aiHint: "Use for offboarding when the person should lose access to this organization entirely; prefer suspending if access may need to be restored.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/users/{id}/reset-mfa", operationId: "resetMemberMfa", tag: "Users", permission: "users.manage", risk: "dangerous",
    summary: "Reset a member's two-factor authentication", params: { id: "User id" }, response: z.object({ ok: z.literal(true), totpEnabled: z.literal(false) }),
    notes: ["Clears the authenticator secret and recovery codes and revokes the member's sessions; they sign in with their password and can re-enrol under Account.", "Emits `user.mfa_reset`."],
    aiHint: "Use when a member lost their phone and cannot complete MFA; verify their identity out of band first.",
  }),
];
export default area;
