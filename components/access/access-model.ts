/**
 * Pure helpers shared by the Access console components: group keys, how a group maps to an API query, labels,
 * permission maths. No React, no network.
 */
import type { DeviceRow } from "@/components/devices/device-bits";
import type { DeviceTreeResponse, VirtualGroup } from "@/lib/api/contracts/device-notes";
import { platformLabel } from "@/lib/client/format";
import { VIRTUAL_GROUPS } from "@/lib/api/contracts/device-notes";

export type TreeData = DeviceTreeResponse;

/** Row shape rendered by the machine list: GET /api/v1/devices rows, optionally enriched by the tree list mode. */
export type MachineRow = DeviceRow & { agentOutdated?: boolean; liveSessions?: number };

/**
 * Group keys: "all" | "online" | "offline" | "pending" | "maintenance" | "site:<id>" | "platform:<p>" | "type:<t>" |
 * "group:<id>" | "tag:<tag>" | one of the virtual groups ("outdated", "host_connected", "recent", "attention", "unassigned").
 */
export type GroupKey = string;

export interface GroupQuery {
  /** Which endpoint serves the rows. */
  source: "devices" | "tree";
  params: Record<string, string | undefined>;
}

const STATUS_KEYS = new Set(["online", "offline", "pending", "maintenance"]);

export function isVirtualGroup(key: GroupKey): key is VirtualGroup {
  return (VIRTUAL_GROUPS as readonly string[]).includes(key);
}

/** Translate a group key into list-endpoint parameters. */
export function groupQuery(key: GroupKey): GroupQuery {
  if (isVirtualGroup(key)) return { source: "tree", params: { list: key } };
  if (STATUS_KEYS.has(key)) return { source: "devices", params: { status: key } };
  const i = key.indexOf(":");
  if (i > 0) {
    const kind = key.slice(0, i), value = key.slice(i + 1);
    if (kind === "site") return { source: "devices", params: { siteId: value } };
    if (kind === "platform") return { source: "devices", params: { platform: value } };
    if (kind === "type") return { source: "devices", params: { deviceType: value } };
    if (kind === "group") return { source: "devices", params: { groupId: value } };
    if (kind === "tag") return { source: "devices", params: { tag: value } };
  }
  return { source: "devices", params: {} };
}

export const STATIC_LABELS: Record<string, string> = {
  all: "All Machines",
  online: "Guest Connected",
  offline: "Offline",
  pending: "Pending approval",
  maintenance: "In maintenance",
  outdated: "Outdated Clients",
  host_connected: "Host Connected",
  recent: "Recently Accessed",
  attention: "Needs Attention",
  unassigned: "Unassigned",
};

export const TYPE_LABELS: Record<string, string> = { workstation: "Workstations", laptop: "Laptops", server: "Servers", vm: "Virtual machines", network: "Network devices", printer: "Printers", mobile: "Mobile", iot: "IoT", other: "Other" };

/** Human label for a group key, resolving site/group ids through the tree data. */
export function groupLabel(key: GroupKey, tree?: TreeData | null): string {
  if (STATIC_LABELS[key]) return STATIC_LABELS[key];
  const i = key.indexOf(":");
  if (i > 0) {
    const kind = key.slice(0, i), value = key.slice(i + 1);
    if (kind === "site") return tree?.sites.find((s) => s.id === value)?.name ?? "Site";
    if (kind === "group") return tree?.groups.find((g) => g.id === value)?.name ?? "Group";
    if (kind === "platform") return platformLabel[value] ?? value;
    if (kind === "type") return TYPE_LABELS[value] ?? value;
    if (kind === "tag") return `#${value}`;
  }
  return STATIC_LABELS.all;
}

/** Count shown next to the selected group in the list header, from the tree aggregate when available. */
export function groupCounts(key: GroupKey, tree?: TreeData | null): { total: number; online: number } | null {
  if (!tree) return null;
  switch (key) {
    case "all": return { total: tree.totals.all, online: tree.totals.online };
    case "online": return { total: tree.totals.online, online: tree.totals.online };
    case "offline": return { total: tree.totals.offline, online: 0 };
    case "pending": return { total: tree.totals.pending, online: 0 };
    case "maintenance": return { total: tree.totals.maintenance, online: 0 };
    case "outdated": return { total: tree.outdated.total, online: 0 };
    case "host_connected": return { total: tree.hostConnected.total, online: tree.hostConnected.total };
    case "recent": return { total: tree.recent.total, online: 0 };
    case "attention": return { total: tree.attention.total, online: 0 };
    case "unassigned": return tree.unassigned;
  }
  const i = key.indexOf(":");
  if (i > 0) {
    const kind = key.slice(0, i), value = key.slice(i + 1);
    const pick = (x?: { total: number; online: number }) => (x ? { total: x.total, online: x.online } : null);
    if (kind === "site") return pick(tree.sites.find((s) => s.id === value));
    if (kind === "group") return pick(tree.groups.find((g) => g.id === value));
    if (kind === "platform") return pick(tree.platforms.find((p) => p.platform === value));
    if (kind === "type") return pick(tree.deviceTypes.find((t) => t.type === value));
    if (kind === "tag") return pick(tree.tags.find((t) => t.tag === value));
  }
  return null;
}

export function makeCan(permissions: string[]) {
  return (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
}

/** "3d 4h" style uptime from a boot timestamp, computed against a `now` passed in (never Date.now() in render). */
export function uptimeLabel(lastBootAt: string | null | undefined, now: number): string | null {
  if (!lastBootAt) return null;
  const s = Math.max(0, Math.floor((now - new Date(lastBootAt).getTime()) / 1000));
  if (!Number.isFinite(s)) return null;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const STATUS_PILLS = [
  { v: "", label: "All" },
  { v: "online", label: "Online" },
  { v: "offline", label: "Offline" },
  { v: "pending", label: "Pending" },
  { v: "maintenance", label: "Maintenance" },
] as const;

export const SORT_OPTIONS = [
  { field: "name", label: "Name" },
  { field: "lastSeenAt", label: "Last seen" },
  { field: "status", label: "Status" },
  { field: "loggedInUser", label: "Signed-in user" },
  { field: "healthScore", label: "Health" },
  { field: "osName", label: "Operating system" },
] as const;

export interface LiveSample { cpuPercent: number | null; memPercent: number | null; ts: string }

/** Callbacks the console hands to the list toolbar, the rows and the detail panel so every surface triggers the same dialogs. */
export interface DeviceActions {
  join: (id: string) => void;
  open: (id: string) => void;
  edit: (id: string) => void;
  end: (id: string) => void;
  quick: (action: import("@/components/jobs/quick-job-dialog").QuickAction, ids: string[]) => void;
  approve: (id: string) => void;
  wake: (id: string) => void;
  screenshot: (id: string) => void;
  askAi: (id: string) => void;
}

/** Compact "3d" / "2h" / "5m" / "now" age for chips; `now` is injected so it is never read during render. */
export function shortAgo(input: string | Date | null | undefined, now: number): string {
  if (!input || !now) return "never";
  const t = new Date(input).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}
