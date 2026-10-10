/**
 * Shared zod contracts for the Access console: device notes and the device tree / virtual groups.
 * Imported by the routes (validation) and by lib/api/openapi/areas/device-notes.ts (documentation), so the two never drift.
 * Must stay free of Next.js imports (the OpenAPI registry is loaded outside a request context).
 */
import { z } from "zod";

/* ------------------------------------------------------------------ notes */

export const NoteCreateBody = z.object({
  body: z.string().trim().min(1, "A note needs some text").max(8000),
  pinned: z.boolean().optional().default(false),
});
export type NoteCreateBody = z.infer<typeof NoteCreateBody>;

export const NotePatchBody = z
  .object({
    body: z.string().trim().min(1).max(8000).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => v.body !== undefined || v.pinned !== undefined, { message: "Provide body and/or pinned" });
export type NotePatchBody = z.infer<typeof NotePatchBody>;

export const NotesQuery = z.object({
  pinned: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type NotesQuery = z.infer<typeof NotesQuery>;

export const DeviceNote = z.object({
  id: z.string(),
  deviceId: z.string(),
  authorId: z.string().nullable(),
  authorName: z.string().nullable(),
  body: z.string(),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DeviceNote = z.infer<typeof DeviceNote>;

export const NotesListResponse = z.object({ items: z.array(DeviceNote), total: z.number().int(), pinned: z.number().int() });
export const NoteResponse = z.object({ note: DeviceNote });

/* ------------------------------------------------------------------ tree */

/** Virtual groups that cannot be expressed with the filters of GET /api/v1/devices. */
export const VIRTUAL_GROUPS = ["outdated", "host_connected", "recent", "attention", "unassigned"] as const;
export type VirtualGroup = (typeof VIRTUAL_GROUPS)[number];

const list = z.array(z.string()).or(z.string().transform((s) => s.split(",").filter(Boolean)));

export const DeviceTreeQuery = z.object({
  /** When set, returns a paginated device list for that virtual group instead of the aggregate tree. */
  list: z.enum(VIRTUAL_GROUPS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().max(200).optional(),
  sort: z.enum(["name", "lastSeenAt", "healthScore", "status", "loggedInUser", "osName"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  status: list.optional(),
  platform: list.optional(),
});
export type DeviceTreeQuery = z.infer<typeof DeviceTreeQuery>;

const Counted = z.object({ total: z.number().int(), online: z.number().int() });

export const DeviceTreeResponse = z.object({
  totals: z.object({ all: z.number().int(), online: z.number().int(), offline: z.number().int(), pending: z.number().int(), maintenance: z.number().int() }),
  sites: z.array(Counted.extend({ id: z.string(), name: z.string(), openAlerts: z.number().int() })),
  unassigned: Counted,
  platforms: z.array(Counted.extend({ platform: z.string() })),
  deviceTypes: z.array(Counted.extend({ type: z.string() })),
  groups: z.array(Counted.extend({ id: z.string(), name: z.string(), color: z.string().nullable(), isDynamic: z.boolean() })),
  tags: z.array(Counted.extend({ tag: z.string() })),
  outdated: z.object({ total: z.number().int(), newestAgentVersion: z.string().nullable(), versions: z.array(z.object({ version: z.string(), count: z.number().int() })) }),
  hostConnected: z.object({ total: z.number().int(), deviceIds: z.array(z.string()) }),
  recent: z.object({ total: z.number().int() }),
  attention: z.object({ total: z.number().int(), openAlerts: z.number().int(), pendingReboot: z.number().int() }),
  live: z.record(z.string(), z.object({ cpuPercent: z.number().nullable(), memPercent: z.number().nullable(), ts: z.string() })),
  generatedAt: z.string(),
});
export type DeviceTreeResponse = z.infer<typeof DeviceTreeResponse>;

export const DeviceTreeListResponse = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), platform: z.string() }).catchall(z.unknown())),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pages: z.number().int(),
  list: z.enum(VIRTUAL_GROUPS),
});
