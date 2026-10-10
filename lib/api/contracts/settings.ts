import { z } from "zod";
import { OrgBrandingSchema, OrgGeneral, OrgSecurity } from "./org";

/** Org-scoped settings keys served by GET/PUT /api/v1/settings/{key}. (`ai` is served by /api/v1/settings/ai.) */
export const SETTING_KEYS = ["general", "notifications", "branding", "security", "maintenance"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export const SettingKeyParam = z.enum(SETTING_KEYS);

export const NotificationSettings = z.object({
  /** Email alert digests to members holding alerts.manage. */
  emailAlerts: z.boolean().default(true),
  /** Minimum alert severity that triggers an immediate email. */
  emailMinSeverity: z.enum(["info", "low", "medium", "high", "critical"]).default("high"),
  /** Hour (0-23, org timezone) when the daily digest is sent; null disables the digest. */
  digestHour: z.number().int().min(0).max(23).nullable().default(8),
  notifyOnDeviceOffline: z.boolean().default(true),
  offlineGraceMinutes: z.number().int().min(1).max(1440).default(15),
  notifyOnJobFailure: z.boolean().default(true),
  notifyOnNewDevice: z.boolean().default(true),
  notifyOnPatchFailure: z.boolean().default(true),
  notifyOnTicket: z.boolean().default(true),
  /** Extra recipients (distribution lists) that receive every notification email. */
  extraRecipients: z.array(z.email()).max(20).default([]),
  /** Quiet hours in the org timezone: no non-critical emails between start and end (HH:MM). */
  quietHours: z.object({ enabled: z.boolean().default(false), start: z.string().regex(/^\d{2}:\d{2}$/).default("22:00"), end: z.string().regex(/^\d{2}:\d{2}$/).default("07:00") }).default({ enabled: false, start: "22:00", end: "07:00" }),
});

export const MaintenanceSettings = z.object({
  /** Default window used when a technician schedules maintenance without picking times. */
  defaultWindow: z.object({ dayOfWeek: z.number().int().min(0).max(6).default(0), start: z.string().regex(/^\d{2}:\d{2}$/).default("02:00"), durationMinutes: z.number().int().min(15).max(1440).default(180) }).default({ dayOfWeek: 0, start: "02:00", durationMinutes: 180 }),
  suppressAlertsDuringMaintenance: z.boolean().default(true),
  autoRebootAfterPatching: z.boolean().default(false),
  rebootPromptMinutes: z.number().int().min(0).max(1440).default(15),
  /** Banner shown to every member of the organization (e.g. "Change freeze until Monday"). */
  banner: z.object({ enabled: z.boolean().default(false), text: z.string().max(300).default(""), tone: z.enum(["info", "warning", "danger"]).default("info") }).default({ enabled: false, text: "", tone: "info" }),
});

export const SETTING_SCHEMAS: Record<SettingKey, z.ZodType> = {
  general: OrgGeneral,
  branding: OrgBrandingSchema,
  security: OrgSecurity,
  notifications: NotificationSettings,
  maintenance: MaintenanceSettings,
};

export const SettingResponse = z.object({ key: SettingKeyParam, value: z.record(z.string(), z.unknown()), updatedAt: z.string().nullable(), source: z.enum(["organization", "settings"]) });
