/**
 * Device core service: enrollment, identity, presence, inventory ingestion, telemetry and events.
 * Feature modules build on top of this (monitoring, patching, remote...).
 */
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { hashToken } from "../util/crypto";
import { createLogger } from "../logger";
import type { AgentHello, Inventory } from "../protocol/agent";
import { config } from "../config";

const log = createLogger("devices");

export type Device = typeof schema.devices.$inferSelect;

export async function getDevice(deviceId: string): Promise<Device | null> {
  const db = await getDb();
  const [d] = await db.select().from(schema.devices).where(eq(schema.devices.id, deviceId));
  return d ?? null;
}

export async function getDeviceInOrg(deviceId: string, orgId: string): Promise<Device | null> {
  const db = await getDb();
  const [d] = await db.select().from(schema.devices).where(and(eq(schema.devices.id, deviceId), eq(schema.devices.orgId, orgId)));
  return d ?? null;
}

export interface EnrollResult {
  device: Device;
  isNew: boolean;
  pendingApproval: boolean;
}

/**
 * Resolve the device for a connecting agent. Three cases:
 *  1. Known agentId with matching public key -> existing device (re-connect).
 *  2. Unknown agentId + valid enrollment token -> create device in the token's org/site/group.
 *  3. Known agentId with a different key -> reject (possible impersonation) unless re-enrolling with a token.
 */
export async function enrollOrResolve(hello: AgentHello, ip: string): Promise<EnrollResult> {
  const db = await getDb();
  const [existing] = await db.select().from(schema.devices).where(eq(schema.devices.agentId, hello.agentId));
  if (existing) {
    if (existing.agentPublicKey && existing.agentPublicKey !== hello.publicKey) {
      if (!hello.enrollToken) throw new Error("agent key mismatch");
      const token = await consumeEnrollmentToken(hello.enrollToken);
      if (!token || token.orgId !== existing.orgId) throw new Error("agent key mismatch and enrollment token invalid");
      await db.update(schema.devices).set({ agentPublicKey: hello.publicKey }).where(eq(schema.devices.id, existing.id));
      await addDeviceEvent(existing.id, existing.orgId, { type: "agent.reenrolled", severity: "warning", message: "Agent re-enrolled with a new identity key", source: "server" });
    }
    if (existing.status === "decommissioned") throw new Error("device is decommissioned");
    return { device: existing, isNew: false, pendingApproval: existing.status === "pending" };
  }
  if (!hello.enrollToken) throw new Error("unknown agent and no enrollment token");
  const token = await consumeEnrollmentToken(hello.enrollToken);
  if (!token) throw new Error("invalid or exhausted enrollment token");
  const platform = hello.platform as Device["platform"];
  const [device] = await db
    .insert(schema.devices)
    .values({
      orgId: token.orgId,
      siteId: token.siteId,
      groupId: token.groupId,
      agentId: hello.agentId,
      agentPublicKey: hello.publicKey,
      name: hello.hostname,
      hostname: hello.hostname,
      platform,
      osName: hello.osName,
      osVersion: hello.osVersion,
      osBuild: hello.osBuild,
      kernel: hello.kernel,
      arch: hello.arch,
      agentVersion: hello.agentVersion,
      status: token.requireApproval ? "pending" : "offline",
      isProbe: hello.roles.includes("probe"),
      tags: token.tags,
      timezone: hello.tz,
      publicIp: ip,
      enrollmentTokenId: token.id,
      enrolledAt: new Date(),
    })
    .returning();
  await addDeviceEvent(device.id, device.orgId, { type: "device.enrolled", message: `Device enrolled via token "${token.name}" from ${ip}`, source: "server", data: { tokenId: token.id } });
  bus.publish("device.enrolled", { deviceId: device.id, name: device.name, platform: device.platform, pendingApproval: token.requireApproval }, { orgId: device.orgId, deviceId: device.id });
  log.info("device enrolled", { deviceId: device.id, org: device.orgId, host: device.hostname });
  return { device, isNew: true, pendingApproval: token.requireApproval };
}

async function consumeEnrollmentToken(raw: string) {
  const db = await getDb();
  const [token] = await db.select().from(schema.enrollmentTokens).where(and(eq(schema.enrollmentTokens.tokenHash, hashToken(raw)), isNull(schema.enrollmentTokens.revokedAt)));
  if (!token) return null;
  if (token.expiresAt && token.expiresAt < new Date()) return null;
  if (token.maxUses !== null && token.uses >= token.maxUses) return null;
  await db.update(schema.enrollmentTokens).set({ uses: sql`${schema.enrollmentTokens.uses} + 1` }).where(eq(schema.enrollmentTokens.id, token.id));
  return token;
}

export async function markOnline(device: Device, hello: AgentHello, ip: string) {
  const db = await getDb();
  const wasOffline = device.status !== "online";
  await db
    .update(schema.devices)
    .set({
      status: device.status === "pending" ? "pending" : "online",
      lastSeenAt: new Date(),
      agentVersion: hello.agentVersion,
      hostname: hello.hostname,
      osName: hello.osName ?? device.osName,
      osVersion: hello.osVersion ?? device.osVersion,
      osBuild: hello.osBuild ?? device.osBuild,
      kernel: hello.kernel ?? device.kernel,
      arch: hello.arch,
      publicIp: ip,
      timezone: hello.tz ?? device.timezone,
      isProbe: hello.roles.includes("probe") || device.isProbe,
    })
    .where(eq(schema.devices.id, device.id));
  if (wasOffline && device.status !== "pending") {
    await addDeviceEvent(device.id, device.orgId, { type: "device.online", message: `Agent connected from ${ip} (v${hello.agentVersion})`, source: "server" });
    bus.publish("device.online", { deviceId: device.id, name: device.name, ip, agentVersion: hello.agentVersion }, { orgId: device.orgId, deviceId: device.id });
  }
}

export async function markOffline(deviceId: string, orgId: string, reason: string) {
  const db = await getDb();
  const [d] = await db.update(schema.devices).set({ status: "offline", lastSeenAt: new Date() }).where(and(eq(schema.devices.id, deviceId), eq(schema.devices.status, "online"))).returning({ id: schema.devices.id, name: schema.devices.name });
  if (!d) return;
  await addDeviceEvent(deviceId, orgId, { type: "device.offline", message: `Agent disconnected (${reason})`, source: "server", severity: "warning" });
  bus.publish("device.offline", { deviceId, name: d.name, reason }, { orgId, deviceId });
}

export async function touchHeartbeat(deviceId: string, patch: Partial<Pick<Device, "loggedInUsers" | "loggedInUser" | "publicIp" | "pendingReboot">> = {}) {
  const db = await getDb();
  await db.update(schema.devices).set({ lastSeenAt: new Date(), ...patch }).where(eq(schema.devices.id, deviceId));
}

/** Sweep devices whose agent silently vanished (no heartbeat). Runs on the leader node. */
export async function sweepStaleDevices() {
  const db = await getDb();
  const cutoff = new Date(Date.now() - config.agent.offlineAfterSeconds * 1000);
  const stale = await db.select({ id: schema.devices.id, orgId: schema.devices.orgId }).from(schema.devices).where(and(eq(schema.devices.status, "online"), lt(schema.devices.lastSeenAt, cutoff)));
  for (const d of stale) await markOffline(d.id, d.orgId, "heartbeat timeout");
  return stale.length;
}

export async function addDeviceEvent(deviceId: string, orgId: string, ev: { type: string; message: string; severity?: "info" | "warning" | "error" | "critical"; source?: "agent" | "server" | "user" | "oslog" | "automation"; actorId?: string; data?: Record<string, unknown>; ts?: Date }) {
  const db = await getDb();
  const [row] = await db.insert(schema.deviceEvents).values({ deviceId, orgId, type: ev.type, message: ev.message, severity: ev.severity ?? "info", source: ev.source ?? "agent", actorId: ev.actorId, data: ev.data ?? {}, ts: ev.ts ?? new Date() }).returning();
  bus.publish("device.event", row, { orgId, deviceId });
  return row;
}

export async function recordTelemetry(device: Device, sample: Omit<typeof schema.telemetry.$inferInsert, "deviceId" | "id">) {
  const db = await getDb();
  await db.insert(schema.telemetry).values({ ...sample, deviceId: device.id });
  bus.publish("device.telemetry", { deviceId: device.id, ...sample }, { orgId: device.orgId, deviceId: device.id });
}

/** Apply an inventory message: system facts, hardware, software (diffed), services, local users, security posture. */
export async function applyInventory(device: Device, inv: Inventory) {
  const db = await getDb();
  const now = new Date();
  const changes: string[] = [];

  if (inv.system) {
    const s = inv.system;
    const patch: Partial<typeof schema.devices.$inferInsert> = { lastInventoryAt: now };
    if (s.hostname) patch.hostname = s.hostname;
    if (s.osName) patch.osName = s.osName;
    if (s.osVersion) patch.osVersion = s.osVersion;
    if (s.osBuild) patch.osBuild = s.osBuild;
    if (s.kernel) patch.kernel = s.kernel;
    if (s.arch) patch.arch = s.arch;
    if (s.domain !== undefined) patch.domain = s.domain;
    if (s.serialNumber) patch.serialNumber = s.serialNumber;
    if (s.manufacturer) patch.manufacturer = s.manufacturer;
    if (s.model) patch.model = s.model;
    if (s.deviceType) patch.deviceType = s.deviceType as Device["deviceType"];
    if (s.lastBootAt) patch.lastBootAt = new Date(s.lastBootAt);
    if (s.timezone) patch.timezone = s.timezone;
    if (s.localIps) patch.localIps = s.localIps;
    if (s.macAddresses) patch.macAddresses = s.macAddresses;
    if (s.loggedInUser !== undefined) patch.loggedInUser = s.loggedInUser;
    if (s.facts) patch.facts = { ...device.facts, ...s.facts };
    if (!device.displayName && s.hostname) patch.name = s.hostname;
    await db.update(schema.devices).set(patch).where(eq(schema.devices.id, device.id));
  }

  if (inv.hardware) {
    const raw = inv.hardware as Record<string, unknown>;
    // Only known columns, with null arrays normalised to [] (agents may send null for empty lists).
    const arr = (v: unknown) => (Array.isArray(v) ? v : []);
    const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
    const hw = {
      cpu: obj(raw.cpu) as typeof schema.deviceHardware.$inferInsert.cpu,
      memory: obj(raw.memory) as typeof schema.deviceHardware.$inferInsert.memory,
      disks: arr(raw.disks) as schema.HardwareDisk[],
      gpus: arr(raw.gpus) as schema.HardwareGpu[],
      nics: arr(raw.nics) as schema.HardwareNic[],
      bios: obj(raw.bios) as typeof schema.deviceHardware.$inferInsert.bios,
      baseboard: obj(raw.baseboard) as typeof schema.deviceHardware.$inferInsert.baseboard,
      chassis: obj(raw.chassis) as typeof schema.deviceHardware.$inferInsert.chassis,
      monitors: arr(raw.monitors) as schema.HardwareMonitor[],
      batteries: arr(raw.batteries) as schema.HardwareBattery[],
      tpm: obj(raw.tpm) as typeof schema.deviceHardware.$inferInsert.tpm,
      usb: arr(raw.usb) as typeof schema.deviceHardware.$inferInsert.usb,
      printers: arr(raw.printers) as typeof schema.deviceHardware.$inferInsert.printers,
      virtualization: obj(raw.virtualization) as typeof schema.deviceHardware.$inferInsert.virtualization,
      raw: Object.fromEntries(Object.entries(raw).filter(([k]) => !["cpu", "memory", "disks", "gpus", "nics", "bios", "baseboard", "chassis", "monitors", "batteries", "tpm", "usb", "printers", "virtualization"].includes(k))),
    };
    const cpu = hw.cpu as { model?: string; cores?: number } | null;
    const mem = hw.memory as { totalBytes?: number } | null;
    const disks = hw.disks as { sizeBytes?: number }[];
    await db
      .insert(schema.deviceHardware)
      .values({ deviceId: device.id, ...hw, updatedAt: now })
      .onConflictDoUpdate({ target: schema.deviceHardware.deviceId, set: { ...hw, updatedAt: now } });
    await db
      .update(schema.devices)
      .set({ cpuModel: cpu?.model ?? device.cpuModel, cpuCores: cpu?.cores ?? device.cpuCores, memoryBytes: mem?.totalBytes ?? device.memoryBytes, diskTotalBytes: disks.reduce((a, d) => a + (d.sizeBytes ?? 0), 0) || device.diskTotalBytes })
      .where(eq(schema.devices.id, device.id));
    changes.push("hardware");
  }

  if (inv.software) {
    const existing = await db.select().from(schema.deviceSoftware).where(and(eq(schema.deviceSoftware.deviceId, device.id), isNull(schema.deviceSoftware.removedAt)));
    const key = (s: { name: string; version?: string | null }) => `${s.name}\u0000${s.version ?? ""}`;
    const seen = new Map(existing.map((s) => [key(s), s]));
    const incoming = new Map(inv.software.map((s) => [key(s), s]));
    const added = [...incoming.entries()].filter(([k]) => !seen.has(k)).map(([, s]) => s);
    const removed = [...seen.entries()].filter(([k]) => !incoming.has(k)).map(([, s]) => s);
    if (added.length) {
      await db.insert(schema.deviceSoftware).values(
        added.map((s) => ({ deviceId: device.id, orgId: device.orgId, name: s.name, version: s.version, publisher: s.publisher, installDate: s.installDate, source: (s.source as typeof schema.deviceSoftware.$inferInsert.source) ?? "other", sizeBytes: s.sizeBytes, installLocation: s.installLocation, uninstallString: s.uninstallString, isSystemComponent: s.isSystemComponent ?? false, firstSeenAt: now, lastSeenAt: now })),
      );
    }
    for (const r of removed) await db.update(schema.deviceSoftware).set({ removedAt: now }).where(eq(schema.deviceSoftware.id, r.id));
    if (existing.length) await db.update(schema.deviceSoftware).set({ lastSeenAt: now }).where(and(eq(schema.deviceSoftware.deviceId, device.id), isNull(schema.deviceSoftware.removedAt)));
    if (!inv.full || existing.length) {
      for (const s of added) bus.publish("software.installed", { deviceId: device.id, name: s.name, version: s.version, publisher: s.publisher }, { orgId: device.orgId, deviceId: device.id });
      for (const s of removed) bus.publish("software.removed", { deviceId: device.id, name: s.name, version: s.version }, { orgId: device.orgId, deviceId: device.id });
    }
    if (added.length || removed.length) changes.push(`software(+${added.length}/-${removed.length})`);
  }

  if (inv.services) {
    await db.delete(schema.deviceServices).where(eq(schema.deviceServices.deviceId, device.id));
    if (inv.services.length) {
      await db.insert(schema.deviceServices).values(inv.services.map((s) => ({ deviceId: device.id, name: s.name, displayName: s.displayName, status: (s.status as typeof schema.deviceServices.$inferInsert.status) ?? "unknown", startType: (s.startType as typeof schema.deviceServices.$inferInsert.startType) ?? "unknown", account: s.account, pid: s.pid, path: s.path, description: s.description })));
    }
    changes.push("services");
  }

  if (inv.localUsers) {
    await db.delete(schema.deviceLocalUsers).where(eq(schema.deviceLocalUsers.deviceId, device.id));
    if (inv.localUsers.length) {
      await db.insert(schema.deviceLocalUsers).values(inv.localUsers.map((u) => ({ deviceId: device.id, username: u.username, fullName: u.fullName, isAdmin: u.isAdmin ?? false, enabled: u.enabled ?? true, passwordExpires: u.passwordExpires ?? true, lastLogonAt: u.lastLogonAt ? new Date(u.lastLogonAt) : null, uid: u.uid })));
    }
    changes.push("users");
  }

  if (inv.security) {
    const posture = inv.security as schema.SecurityPosture;
    await db.insert(schema.deviceSecurity).values({ deviceId: device.id, posture, updatedAt: now }).onConflictDoUpdate({ target: schema.deviceSecurity.deviceId, set: { posture, updatedAt: now } });
    bus.publish("security.posture", { deviceId: device.id, posture }, { orgId: device.orgId, deviceId: device.id });
    changes.push("security");
  }

  if (inv.patches) {
    bus.publish("patches.scan", { deviceId: device.id, patches: inv.patches }, { orgId: device.orgId, deviceId: device.id });
  }
  if (inv.location) {
    await db.update(schema.devices).set({ location: { ...(inv.location as object), updatedAt: now.toISOString() } as schema.DeviceLocation }).where(eq(schema.devices.id, device.id));
  }

  bus.publish("device.inventory", { deviceId: device.id, sections: changes, full: inv.full }, { orgId: device.orgId, deviceId: device.id });
  if (changes.length) bus.publish("inventory.changed", { deviceId: device.id, sections: changes }, { orgId: device.orgId, deviceId: device.id });
}

/** Agent configuration pushed at connect time (merged from org settings + enrollment token overrides + device). */
export async function agentConfigFor(device: Device): Promise<Record<string, unknown>> {
  const db = await getDb();
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, device.orgId));
  const token = device.enrollmentTokenId ? (await db.select().from(schema.enrollmentTokens).where(eq(schema.enrollmentTokens.id, device.enrollmentTokenId)))[0] : undefined;
  return {
    telemetryIntervalSeconds: 60,
    inventoryIntervalMinutes: 60,
    patchScanIntervalHours: 6,
    heartbeatSeconds: config.agent.heartbeatSeconds,
    consent: org?.settings.sessionConsent ?? "notify",
    recording: org?.settings.sessionRecording ?? "off",
    autoUpdate: org?.settings.agentAutoUpdate ?? true,
    updateChannel: org?.settings.agentUpdateChannel ?? "stable",
    branding: {
      productName: org?.branding.productName || "MagicWand",
      supportEmail: org?.branding.supportEmail,
      supportPhone: org?.branding.supportPhone,
      supportUrl: org?.branding.supportUrl,
      trayMessage: org?.branding.trayMessage,
      accentColor: org?.branding.accentColor,
    },
    probe: device.isProbe,
    ...(token?.agentConfig ?? {}),
  };
}
