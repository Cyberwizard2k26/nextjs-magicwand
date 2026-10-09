"use client";
import * as React from "react";
import { api, ApiClientError } from "@/lib/client/api";

export interface RpcResult<T = unknown> { ok: true; data: T; stdout: string; stderr: string; exitCode: number | null; durationMs: number | null }

/** Interactive device RPC with a per-call busy flag and a friendly error string. */
export function useRpc(deviceId: string) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const call = React.useCallback(async <T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> => {
    setBusy(cmd);
    setError(null);
    try {
      return await api.post<RpcResult<T>>(`devices/${deviceId}/rpc`, { cmd, args });
    } catch (err) {
      const msg = err instanceof ApiClientError ? (err.code === "device_offline" ? "The device went offline." : err.message) : "Request failed";
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(null);
    }
  }, [deviceId]);
  return { call, busy, error, clearError: () => setError(null) };
}

/** Strip ANSI escape sequences so command output renders as plain text. */
export function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
}
