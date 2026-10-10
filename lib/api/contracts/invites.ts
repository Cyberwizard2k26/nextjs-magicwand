import { z } from "zod";

export const InviteListQuery = z.object({ status: z.enum(["pending", "accepted", "expired", "all"]).default("pending") });

export const InviteCreate = z.object({
  email: z.email().max(254),
  roleId: z.string().min(1),
  siteIds: z.array(z.string().min(1)).max(500).default([]),
  groupIds: z.array(z.string().min(1)).max(500).default([]),
  /** Optional personal note included in the invitation email. */
  message: z.string().max(1000).optional(),
  /** Validity in days (1-30). */
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
});
export type InviteCreateT = z.infer<typeof InviteCreate>;

export const InviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  roleId: z.string(),
  roleName: z.string().nullable(),
  siteIds: z.array(z.string()),
  groupIds: z.array(z.string()),
  invitedBy: z.string().nullable(),
  inviterName: z.string().nullable(),
  status: z.enum(["pending", "accepted", "expired"]),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const InviteCreateResponse = z.object({
  invite: InviteSchema,
  emailSent: z.boolean(),
  /** Present only when the email could not be sent (SMTP unconfigured): share it with the person out of band. */
  inviteUrl: z.string().optional(),
});

/** Public: look up an invitation by its token. */
export const InviteLookupQuery = z.object({ token: z.string().min(16).max(200) });
export const InviteLookupResponse = z.object({
  valid: z.boolean(),
  reason: z.enum(["expired", "accepted", "not_found"]).optional(),
  email: z.string().optional(),
  orgName: z.string().optional(),
  roleName: z.string().optional(),
  inviterName: z.string().nullable().optional(),
  expiresAt: z.string().optional(),
  /** True when an account with this email already exists: the person signs in with their existing password to accept. */
  existingUser: z.boolean().optional(),
  productName: z.string().optional(),
});

/** Public: accept an invitation. New users supply a name and password; existing users confirm their current password. */
export const InviteAccept = z.object({
  token: z.string().min(16).max(200),
  name: z.string().min(1).max(120).optional(),
  password: z.string().min(12).max(256),
});
export type InviteAcceptT = z.infer<typeof InviteAccept>;
