import { pgTable, text, boolean, integer, bigint, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { id, createdAt, ts, tsNullable } from "./_common";
import { organizations, users } from "./tenancy";
import { devices } from "./devices";

/* ---------------------------------------------------------------------------------------------
 * Remote access: sessions, recordings, just-in-time access, file transfers, guest shares, tunnels
 * ------------------------------------------------------------------------------------------- */

export type RemoteSessionType = "desktop" | "terminal" | "files" | "processes" | "services" | "registry" | "eventlog" | "chat" | "tunnel" | "command" | "backstage" | "webcam" | "cobrowse";
export type RemoteSessionStatus = "requested" | "pending_consent" | "active" | "ended" | "denied" | "failed" | "timeout";

export const remoteSessions = pgTable(
  "remote_sessions",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name"),
    /** Guest share token id when the session comes from a share link. */
    shareId: text("share_id"),
    type: text("type").$type<RemoteSessionType>().notNull(),
    status: text("status").$type<RemoteSessionStatus>().notNull().default("requested"),
    consentRequired: boolean("consent_required").notNull().default(false),
    consentResult: text("consent_result").$type<"granted" | "denied" | "timeout" | "not_required" | null>(),
    /** Session options: viewOnly, monitor index, quality, recording, privacy screen... */
    options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
    startedAt: ts("started_at"),
    connectedAt: tsNullable("connected_at"),
    endedAt: tsNullable("ended_at"),
    endReason: text("end_reason"),
    bytesIn: bigint("bytes_in", { mode: "number" }).notNull().default(0),
    bytesOut: bigint("bytes_out", { mode: "number" }).notNull().default(0),
    viewerCount: integer("viewer_count").notNull().default(1),
    recordingId: text("recording_id"),
    accessRequestId: text("access_request_id"),
    ip: text("ip"),
    notes: text("notes"),
    /** Technician-written summary (or AI summary) of what was done. */
    summary: text("summary"),
    ticketId: text("ticket_id"),
    createdAt: createdAt(),
  },
  (t) => [index("remote_sessions_org_idx").on(t.orgId, t.startedAt), index("remote_sessions_device_idx").on(t.deviceId, t.startedAt), index("remote_sessions_user_idx").on(t.userId)],
);

export const sessionRecordings = pgTable(
  "session_recordings",
  {
    id: id(),
    sessionId: text("session_id").notNull().references(() => remoteSessions.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    /** Relative path inside DATA_DIR/recordings or object-storage key. */
    path: text("path").notNull(),
    format: text("format").$type<"mwrec" | "webm" | "asciicast">().notNull().default("mwrec"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    durationSeconds: integer("duration_seconds"),
    sha256: text("sha256"),
    retainUntil: tsNullable("retain_until"),
    createdAt: createdAt(),
  },
  (t) => [index("session_recordings_session_idx").on(t.sessionId)],
);

/** Just-in-time access: technicians request elevated access that must be approved (by an admin or the end user). */
export const accessRequests = pgTable(
  "access_requests",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    requesterId: text("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").references(() => devices.id, { onDelete: "cascade" }),
    groupId: text("group_id"),
    reason: text("reason").notNull(),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    status: text("status").$type<"pending" | "approved" | "denied" | "expired" | "revoked">().notNull().default("pending"),
    approverId: text("approver_id"),
    approverNote: text("approver_note"),
    decidedAt: tsNullable("decided_at"),
    expiresAt: tsNullable("expires_at"),
    ticketId: text("ticket_id"),
    createdAt: createdAt(),
  },
  (t) => [index("access_requests_org_status_idx").on(t.orgId, t.status), index("access_requests_requester_idx").on(t.requesterId)],
);

export const fileTransfers = pgTable(
  "file_transfers",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    sessionId: text("session_id").references(() => remoteSessions.id, { onDelete: "set null" }),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    direction: text("direction").$type<"upload" | "download">().notNull(),
    path: text("path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256"),
    status: text("status").$type<"pending" | "active" | "completed" | "failed" | "cancelled">().notNull().default("pending"),
    error: text("error"),
    startedAt: ts("started_at"),
    finishedAt: tsNullable("finished_at"),
  },
  (t) => [index("file_transfers_device_idx").on(t.deviceId, t.startedAt)],
);

/** Guest share links: time-boxed access to one device (view-only desktop, terminal, files...) without an account. */
export const deviceShares = pgTable(
  "device_shares",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    name: text("name"),
    tokenHash: text("token_hash").notNull(),
    sessionTypes: jsonb("session_types").$type<RemoteSessionType[]>().notNull().default(["desktop"]),
    viewOnly: boolean("view_only").notNull().default(true),
    requireConsent: boolean("require_consent").notNull().default(true),
    startsAt: tsNullable("starts_at"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    /** Recurring daily window, e.g. { start: "09:00", end: "17:00", days: [1,2,3,4,5] } */
    window: jsonb("window").$type<{ start: string; end: string; days?: number[] } | null>(),
    createdBy: text("created_by"),
    revokedAt: tsNullable("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("device_shares_token_idx").on(t.tokenHash), index("device_shares_device_idx").on(t.deviceId)],
);

/** TCP/UDP tunnels through the agent: RDP/SSH/VNC/HTTP to the device or hosts on its LAN. */
export const tunnels = pgTable(
  "tunnels",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    protocol: text("protocol").$type<"tcp" | "udp" | "rdp" | "ssh" | "vnc" | "http" | "https" | "smb">().notNull(),
    remoteHost: text("remote_host").notNull().default("127.0.0.1"),
    remotePort: integer("remote_port").notNull(),
    name: text("name"),
    status: text("status").$type<"open" | "closed" | "error">().notNull().default("open"),
    bytesIn: bigint("bytes_in", { mode: "number" }).notNull().default(0),
    bytesOut: bigint("bytes_out", { mode: "number" }).notNull().default(0),
    openedAt: ts("opened_at"),
    closedAt: tsNullable("closed_at"),
  },
  (t) => [index("tunnels_device_idx").on(t.deviceId)],
);

/** Technician <-> end user chat transcripts (also used by the tray app "request help" flow). */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    ticketId: text("ticket_id"),
    sender: text("sender").$type<"technician" | "end_user" | "system" | "ai">().notNull(),
    senderId: text("sender_id"),
    senderName: text("sender_name"),
    body: text("body").notNull(),
    attachments: jsonb("attachments").$type<{ name: string; path: string; size: number }[]>().notNull().default([]),
    readAt: tsNullable("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_device_idx").on(t.deviceId, t.createdAt)],
);

export const remoteSessionsRelations = relations(remoteSessions, ({ one, many }) => ({
  device: one(devices, { fields: [remoteSessions.deviceId], references: [devices.id] }),
  user: one(users, { fields: [remoteSessions.userId], references: [users.id] }),
  recordings: many(sessionRecordings),
}));
export const sessionRecordingsRelations = relations(sessionRecordings, ({ one }) => ({ session: one(remoteSessions, { fields: [sessionRecordings.sessionId], references: [remoteSessions.id] }) }));
