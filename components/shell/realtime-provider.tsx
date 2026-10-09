"use client";
import * as React from "react";
import { getRealtime, type RealtimeClient, type RealtimeEvent } from "@/lib/client/ws";

const Ctx = React.createContext<RealtimeClient | null>(null);

export function RealtimeProvider({ orgId, children }: { orgId: string | null; children: React.ReactNode }) {
  const [client, setClient] = React.useState<RealtimeClient | null>(null);
  React.useEffect(() => {
    const c = getRealtime();
    setClient(c);
    if (orgId) c.subscribe([`org:${orgId}`]);
    return () => { if (orgId) c.unsubscribe([`org:${orgId}`]); };
  }, [orgId]);
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function useRealtimeClient() {
  return React.useContext(Ctx);
}

/** Subscribe to bus events by exact name, prefix ("alert.*") or "*" while the component is mounted. */
export function useRealtime(name: string | string[], handler: (ev: RealtimeEvent) => void, topics: string[] = []) {
  const client = React.useContext(Ctx);
  const ref = React.useRef(handler);
  ref.current = handler;
  const names = Array.isArray(name) ? name : [name];
  const key = names.join("|") + "#" + topics.join("|");
  React.useEffect(() => {
    if (!client) return;
    if (topics.length) client.subscribe(topics);
    const offs = names.map((n) => client.on(n, (ev) => ref.current(ev)));
    return () => {
      offs.forEach((off) => off());
      if (topics.length) client.unsubscribe(topics);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
}

export function useRealtimeStatus() {
  const client = React.useContext(Ctx);
  const [status, setStatus] = React.useState<"connecting" | "open" | "closed">(client?.status ?? "closed");
  React.useEffect(() => {
    if (!client) return;
    setStatus(client.status);
    return client.onStatus(setStatus);
  }, [client]);
  return status;
}
