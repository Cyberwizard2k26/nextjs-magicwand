import { z } from "zod";
import { endpoint, type EndpointDoc } from "../registry";
import { SettingResponse, SETTING_KEYS } from "../../contracts/settings";
import { MePatch, MeResponse, MfaDisable, MfaEnable, MfaEnableResponse, MfaSetupResponse, PasswordChange, SessionSchema } from "../../contracts/account";

const KeyParam = { key: `Settings document: ${SETTING_KEYS.join(" | ")}` };

const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/settings/{key}", operationId: "getSettings", tag: "Settings", permission: "org.view", risk: "read",
    summary: "Read an organization settings document", params: KeyParam, response: SettingResponse,
    notes: ["`general`, `branding` and `security` are views over the organization record (same data as GET /org).", "`notifications` and `maintenance` are stored as documents; defaults are filled in when nothing was saved yet.", "The `ai` document is served by /api/v1/settings/ai."],
    aiHint: "Use to read notification rules (who gets emailed for which severity, quiet hours) or maintenance defaults before scheduling work or explaining why an email was or was not sent.",
  }),
  endpoint({
    method: "PUT", path: "/api/v1/settings/{key}", operationId: "putSettings", tag: "Settings", permission: "org.manage", risk: "write",
    summary: "Replace an organization settings document", params: KeyParam, body: z.record(z.string(), z.unknown()), response: SettingResponse,
    bodyExample: { emailAlerts: true, emailMinSeverity: "high", digestHour: 8, notifyOnDeviceOffline: true, offlineGraceMinutes: 15, quietHours: { enabled: true, start: "22:00", end: "07:00" } },
    notes: ["The body is validated against the key's schema (400 lists the offending fields).", "Replace semantics for `notifications`/`maintenance`; merge semantics for the organization-backed keys.", "Emits `org.settings.updated` / `org.updated`."],
    aiHint: "Use to change notification routing, quiet hours, the maintenance banner or default maintenance window.",
  }),
  /* ---- Account (self-service, any authenticated user) ---- */
  endpoint({ method: "GET", path: "/api/v1/me", operationId: "getMyAccount", tag: "Account", risk: "read", summary: "Get my profile and security state", response: MeResponse, notes: ["Works without an active organization.", "API keys cannot call account endpoints (403)."], aiHint: "Use to show the operator their own profile, MFA status, passkeys and organization memberships." }),
  endpoint({ method: "PATCH", path: "/api/v1/me", operationId: "updateMyAccount", tag: "Account", risk: "write", summary: "Update my profile or preferences", body: MePatch, response: MeResponse, notes: ["`preferences` is merged into the existing object (theme, density, landing page...)."], aiHint: "Use to change the operator's display name, phone, timezone or saved UI preferences." }),
  endpoint({ method: "POST", path: "/api/v1/me/password", operationId: "changeMyPassword", tag: "Account", risk: "dangerous", summary: "Change my password", body: PasswordChange, response: z.object({ ok: z.literal(true), revokedSessions: z.number() }), notes: ["Requires the current password; new password >= 12 characters.", "Every other session is signed out.", "Rate limited."], aiHint: "Only on the operator's explicit request; never store or echo the passwords." }),
  endpoint({ method: "GET", path: "/api/v1/me/sessions", operationId: "listMySessions", tag: "Account", risk: "read", summary: "List my active sessions", response: z.object({ items: z.array(SessionSchema) }), notes: ["`current: true` marks the session making the request; `browser`/`os` are derived from the user agent."], aiHint: "Use to review where the operator is signed in and spot unknown devices." }),
  endpoint({ method: "DELETE", path: "/api/v1/me/sessions", operationId: "revokeMyOtherSessions", tag: "Account", risk: "dangerous", summary: "Sign out everywhere except here", response: z.object({ ok: z.literal(true), revoked: z.number() }), aiHint: "Use after a suspected credential leak to end every other session." }),
  endpoint({ method: "DELETE", path: "/api/v1/me/sessions/{id}", operationId: "revokeMySession", tag: "Account", risk: "write", summary: "Sign out one other session", params: { id: "Session id" }, response: z.object({ ok: z.literal(true) }), notes: ["The current session cannot be revoked here (409 `current_session`); use sign-out."], aiHint: "Use to end a specific stale or unknown session." }),
  endpoint({ method: "POST", path: "/api/v1/me/mfa", operationId: "beginMfaSetup", tag: "Account", risk: "write", summary: "Start authenticator (TOTP) enrolment", response: MfaSetupResponse, notes: ["Returns the secret, otpauth URL and a QR code data URL. MFA is not enforced until PUT confirms a code.", "409 `already_enabled` when MFA is on."], aiHint: "Use when the operator wants to enable two-factor authentication; show them the QR code, then confirm with PUT." }),
  endpoint({ method: "PUT", path: "/api/v1/me/mfa", operationId: "enableMfa", tag: "Account", risk: "dangerous", summary: "Confirm the first code and enable MFA", body: MfaEnable, response: MfaEnableResponse, notes: ["Returns eight recovery codes exactly once; other sessions must complete MFA before continuing.", "Rate limited; 400 `invalid_code` on a wrong code."], aiHint: "Use right after beginMfaSetup with the 6-digit code from the operator's authenticator; tell them to store the recovery codes." }),
  endpoint({ method: "DELETE", path: "/api/v1/me/mfa", operationId: "disableMfa", tag: "Account", risk: "dangerous", summary: "Disable MFA (password required)", body: MfaDisable, response: z.object({ enabled: z.literal(false) }), notes: ["Refused when the organization requires MFA? No: policy enforcement happens at sign-in, so the account can still be asked to re-enrol."], aiHint: "Only on explicit request; prefer regenerating recovery codes when the operator merely lost them." }),
  endpoint({ method: "POST", path: "/api/v1/me/mfa/recovery-codes", operationId: "regenerateRecoveryCodes", tag: "Account", risk: "dangerous", summary: "Replace my recovery codes (password required)", body: MfaDisable, response: z.object({ recoveryCodes: z.array(z.string()) }), notes: ["The previous codes stop working; the new set is shown once."], aiHint: "Use when the operator used up or lost their recovery codes." }),
];
export default area;
