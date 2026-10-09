import { pgTable, text, boolean, integer, jsonb, timestamp, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { id, createdAt, updatedAt, tsNullable } from "./_common";

/* ---------------------------------------------------------------------------------------------
 * Multi-tenancy: Organization (MSP client / company) -> Site (location) -> Device Group -> Device
 * ------------------------------------------------------------------------------------------- */

export interface OrgBranding {
  productName?: string;
  logoUrl?: string;
  accentColor?: string;
  supportEmail?: string;
  supportPhone?: string;
  supportUrl?: string;
  trayMessage?: string;
  /** Custom domain for the client portal, e.g. support.acme.com */
  portalDomain?: string;
}

export interface OrgSettings {
  timezone?: string;
  locale?: string;
  requireMfa?: boolean;
  sessionConsent?: "never" | "notify" | "ask" | "ask_if_user_present";
  sessionRecording?: "off" | "desktop" | "all";
  jitAccess?: boolean;
  agentUpdateChannel?: "stable" | "beta";
  agentAutoUpdate?: boolean;
  dataRetentionDays?: number;
  defaultPatchPolicyId?: string | null;
  allowedIpRanges?: string[];
  healthScoreWeights?: Record<string, number>;
}

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** MSP parent organization (null for the root MSP / standalone org). */
    parentId: text("parent_id"),
    kind: text("kind").$type<"msp" | "client" | "internal">().notNull().default("client"),
    status: text("status").$type<"active" | "suspended" | "archived">().notNull().default("active"),
    settings: jsonb("settings").$type<OrgSettings>().notNull().default({}),
    branding: jsonb("branding").$type<OrgBranding>().notNull().default({}),
    /** Free-form key/value custom fields (defined by customFieldDefinitions). */
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug), index("organizations_parent_idx").on(t.parentId)],
);

export const sites = pgTable(
  "sites",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    timezone: text("timezone").default("UTC"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    /** Default network ranges for discovery scans at this site. */
    networks: jsonb("networks").$type<string[]>().notNull().default([]),
    location: jsonb("location").$type<{ lat: number; lng: number } | null>(),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sites_org_idx").on(t.orgId)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    avatarUrl: text("avatar_url"),
    /** Platform super administrator (can manage every organization). */
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    status: text("status").$type<"active" | "invited" | "disabled" | "locked">().notNull().default("active"),
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    recoveryCodesHash: jsonb("recovery_codes_hash").$type<string[]>().notNull().default([]),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: tsNullable("locked_until"),
    lastLoginAt: tsNullable("last_login_at"),
    lastLoginIp: text("last_login_ip"),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
    /** Hash of the password reset / email verification token currently outstanding. */
    actionTokenHash: text("action_token_hash"),
    actionTokenExpiresAt: tsNullable("action_token_expires_at"),
    phone: text("phone"),
    timezone: text("timezone"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    /** null = built-in system role available in every org. */
    orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Permission strings, see lib/rbac/permissions.ts. "*" = everything. */
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("roles_org_idx").on(t.orgId)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull().references(() => roles.id),
    /** Restrict the membership to specific sites / device groups. Empty = whole org. */
    siteIds: jsonb("site_ids").$type<string[]>().notNull().default([]),
    groupIds: jsonb("group_ids").$type<string[]>().notNull().default([]),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_org_idx").on(t.userId, t.orgId), index("memberships_org_idx").on(t.orgId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    /** Organization the UI is currently scoped to. */
    activeOrgId: text("active_org_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    lastSeenAt: tsNullable("last_seen_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    allowedIps: jsonb("allowed_ips").$type<string[]>().notNull().default([]),
    lastUsedAt: tsNullable("last_used_at"),
    expiresAt: tsNullable("expires_at"),
    revokedAt: tsNullable("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash), index("api_keys_org_idx").on(t.orgId)],
);

export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(), // base64url
    counter: integer("counter").notNull().default(0),
    transports: jsonb("transports").$type<string[]>().notNull().default([]),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    name: text("name").notNull().default("Passkey"),
    lastUsedAt: tsNullable("last_used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("webauthn_credential_id_idx").on(t.credentialId), index("webauthn_user_idx").on(t.userId)],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roleId: text("role_id").notNull().references(() => roles.id),
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    acceptedAt: tsNullable("accepted_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invites_token_idx").on(t.tokenHash), index("invites_org_idx").on(t.orgId)],
);

export const ssoProviders = pgTable(
  "sso_providers",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").$type<"oidc" | "saml" | "ldap">().notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    issuer: text("issuer"),
    clientId: text("client_id"),
    clientSecretEnc: text("client_secret_enc"),
    /** Extra configuration (scopes, attribute mapping, allowed domains, auto-provision role...). */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    emailDomains: jsonb("email_domains").$type<string[]>().notNull().default([]),
    defaultRoleId: text("default_role_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sso_providers_org_idx").on(t.orgId)],
);

export const ipAllowlist = pgTable(
  "ip_allowlist",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    cidr: text("cidr").notNull(),
    note: text("note"),
    appliesTo: text("applies_to").$type<"users" | "api" | "all">().notNull().default("all"),
    createdAt: createdAt(),
  },
  (t) => [index("ip_allowlist_org_idx").on(t.orgId)],
);

export type AuditActorType = "user" | "agent" | "system" | "apikey" | "automation" | "contact";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: text("org_id"),
    actorType: text("actor_type").$type<AuditActorType>().notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetName: text("target_name"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_org_created_idx").on(t.orgId, t.createdAt), index("audit_logs_target_idx").on(t.targetType, t.targetId)],
);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    entity: text("entity").$type<"device" | "site" | "organization" | "ticket" | "contact">().notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").$type<"text" | "number" | "boolean" | "date" | "select" | "multiselect" | "url" | "secret">().notNull(),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    required: boolean("required").notNull().default(false),
    /** Script output or inventory path to auto-populate this field (e.g. "hardware.bios.version"). */
    sourcePath: text("source_path"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_field_org_entity_key_idx").on(t.orgId, t.entity, t.key)],
);

export const userOrgPreferences = pgTable(
  "user_org_preferences",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  sites: many(sites),
  memberships: many(memberships),
  parent: one(organizations, { fields: [organizations.parentId], references: [organizations.id] }),
}));
export const sitesRelations = relations(sites, ({ one }) => ({
  org: one(organizations, { fields: [sites.orgId], references: [organizations.id] }),
}));
export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  sessions: many(sessions),
  webauthnCredentials: many(webauthnCredentials),
}));
export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  org: one(organizations, { fields: [memberships.orgId], references: [organizations.id] }),
  role: one(roles, { fields: [memberships.roleId], references: [roles.id] }),
}));
