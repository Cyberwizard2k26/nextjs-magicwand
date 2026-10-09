"use client";
import * as React from "react";
import useSWR, { type KeyedMutator } from "swr";
import { useRealtime } from "@/components/shell/realtime-provider";

export interface DeviceDetail {
  device: Record<string, unknown> & {
    id: string; orgId: string; name: string; hostname: string | null; displayName: string | null; description: string | null; platform: string; deviceType: string; osName: string | null; osVersion: string | null; osBuild: string | null; kernel: string | null; arch: string | null; agentVersion: string | null; status: string;
    lastSeenAt: string | null; lastBootAt: string | null; lastInventoryAt: string | null; publicIp: string | null; localIps: string[]; macAddresses: string[]; serialNumber: string | null; manufacturer: string | null; model: string | null; cpuModel: string | null; cpuCores: number | null; memoryBytes: number | null; diskTotalBytes: number | null;
    loggedInUser: string | null; loggedInUsers: { user: string; session: string; type: string; since?: string }[]; timezone: string | null; domain: string | null; tags: string[]; customFields: Record<string, unknown>; healthScore: number | null; healthFactors: { key: string; label: string; score: number; weight: number; detail?: string }[];
    pendingReboot: boolean; isProbe: boolean; isAgentless: boolean; notes: string | null; siteId: string | null; groupId: string | null; enrolledAt: string | null; createdAt: string; facts: Record<string, unknown>; location: { lat: number; lng: number; city?: string; region?: string; country?: string; source: string } | null; warranty: { vendor?: string; status?: string; endDate?: string } | null;
    connected: boolean; capabilities: string[];
  };
  hardware: Record<string, unknown> | null;
  security: { posture: Record<string, unknown>; score: number | null; findings: { id: string; severity: string; title: string; detail?: string }[]; updatedAt: string } | null;
  site: { id: string; name: string } | null;
  group: { id: string; name: string } | null;
}

interface Ctx { data: DeviceDetail; mutate: KeyedMutator<DeviceDetail>; permissions: string[]; can: (p: string) => boolean }
const DeviceCtx = React.createContext<Ctx | null>(null);

export function DeviceProvider({ initial, permissions, children }: { initial: DeviceDetail; permissions: string[]; children: React.ReactNode }) {
  const id = initial.device.id;
  const { data, mutate } = useSWR<DeviceDetail>(`devices/${id}`, { fallbackData: initial, revalidateOnMount: false, refreshInterval: 60_000 });
  useRealtime(["device.online", "device.offline", "device.approved", "device.heartbeat", "device.inventory", "device.updated"], (ev) => {
    if ((ev.payload as { deviceId?: string })?.deviceId === id || ev.deviceId === id) mutate();
  }, [`device:${id}`]);
  const can = React.useCallback((p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*"), [permissions]);
  return <DeviceCtx.Provider value={{ data: data ?? initial, mutate, permissions, can }}>{children}</DeviceCtx.Provider>;
}

export function useDevice() {
  const ctx = React.useContext(DeviceCtx);
  if (!ctx) throw new Error("useDevice must be used inside DeviceProvider");
  return ctx;
}
