import { z } from "zod";

export const MePatch = z
  .object({
    name: z.string().min(1).max(120).optional(),
    phone: z.string().max(40).nullable().optional(),
    timezone: z.string().max(64).nullable().optional(),
    avatarUrl: z.string().max(2048).nullable().optional(),
    /** Free-form UI preferences (theme, density, landing page...). Merged into the existing object. */
    preferences: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type MePatchT = z.infer<typeof MePatch>;

export const PasswordChange = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) });
export type PasswordChangeT = z.infer<typeof PasswordChange>;

export const MfaEnable = z.object({ code: z.string().min(6).max(8) });
export const MfaDisable = z.object({ password: z.string().min(1).max(256) });

export const MeResponse = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  timezone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isSuperAdmin: z.boolean(),
  status: z.string(),
  totpEnabled: z.boolean(),
  recoveryCodesRemaining: z.number().int(),
  passkeys: z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.string(), lastUsedAt: z.string().nullable() })),
  preferences: z.record(z.string(), z.unknown()),
  lastLoginAt: z.string().nullable(),
  lastLoginIp: z.string().nullable(),
  createdAt: z.string(),
  memberships: z.array(z.object({ orgId: z.string(), orgName: z.string(), roleName: z.string(), siteIds: z.array(z.string()), isDefault: z.boolean() })),
  activeOrgId: z.string().nullable(),
});

export const SessionSchema = z.object({ id: z.string(), ip: z.string().nullable(), userAgent: z.string().nullable(), browser: z.string(), os: z.string(), mfaVerified: z.boolean(), activeOrgId: z.string().nullable(), current: z.boolean(), createdAt: z.string(), lastSeenAt: z.string().nullable(), expiresAt: z.string() });

export const MfaSetupResponse = z.object({ secret: z.string(), otpauthUrl: z.string(), qrDataUrl: z.string() });
export const MfaEnableResponse = z.object({ enabled: z.literal(true), recoveryCodes: z.array(z.string()) });
