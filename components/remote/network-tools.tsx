"use client";
import * as React from "react";
import { Activity, Globe, Loader2, Radar, Route, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/client/format";
import { useDevice } from "@/components/devices/device-context";
import { DeviceOfflineNotice } from "@/components/devices/device-header";
import { stripAnsi, useRpc } from "./use-rpc";

interface Result { id: string; tool: string; label: string; at: string; ok: boolean; summary: string; output: string; ms: number | null }

export function NetworkTools() {
  const { data, can } = useDevice();
  const d = data.device;
  const rpc = useRpc(d.id);
  const [host, setHost] = React.useState("");
  const [port, setPort] = React.useState("443");
  const [name, setName] = React.useState("");
  const [trace, setTrace] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const online = d.status === "online";

  if (!can("remote.tools")) return <p className="text-sm text-fg-muted">You need the &quot;remote.tools&quot; permission to use network tools.</p>;
  if (!online) return <DeviceOfflineNotice what="Network diagnostics" />;

  const push = (r: Omit<Result, "id" | "at">) => setResults((prev) => [{ ...r, id: crypto.randomUUID(), at: new Date().toISOString() }, ...prev].slice(0, 20));
  const fail = (tool: string, label: string, err: unknown) => push({ tool, label, ok: false, summary: (err as Error).message, output: "", ms: null });

  async function ping() {
    const h = host.trim(); if (!h) return;
    try { const r = await rpc.call<{ reachable: boolean }>("ping", { host: h, count: 4 }); push({ tool: "ping", label: `ping ${h}`, ok: r.data.reachable, summary: r.data.reachable ? "reachable" : "no reply", output: stripAnsi(r.stdout), ms: r.durationMs }); } catch (err) { fail("ping", `ping ${h}`, err); }
  }
  async function portCheck() {
    const h = host.trim(); const p = Number(port); if (!h || !p) return;
    try { const r = await rpc.call<{ open: boolean; latencyMs?: number; error?: string }>("port_check", { host: h, port: p }); push({ tool: "port", label: `tcp ${h}:${p}`, ok: r.data.open, summary: r.data.open ? `open · ${r.data.latencyMs} ms` : `closed · ${r.data.error ?? "no response"}`, output: "", ms: r.durationMs }); } catch (err) { fail("port", `tcp ${h}:${p}`, err); }
  }
  async function dns() {
    const n = name.trim(); if (!n) return;
    try { const r = await rpc.call<{ addresses: string[]; latencyMs: number }>("dns_lookup", { name: n }); push({ tool: "dns", label: `dns ${n}`, ok: true, summary: `${r.data.addresses.length} address${r.data.addresses.length === 1 ? "" : "es"} · ${r.data.latencyMs} ms`, output: r.data.addresses.join("\n"), ms: r.durationMs }); } catch (err) { fail("dns", `dns ${n}`, err); }
  }
  async function traceroute() {
    const h = trace.trim(); if (!h) return;
    try { const r = await rpc.call("traceroute", { host: h }); push({ tool: "trace", label: `traceroute ${h}`, ok: r.exitCode === 0 || r.exitCode === null, summary: `${stripAnsi(r.stdout).split("\n").filter(Boolean).length - 1} hops`, output: stripAnsi(r.stdout + r.stderr), ms: r.durationMs }); } catch (err) { fail("trace", `traceroute ${h}`, err); }
  }
  const busy = (t: string) => rpc.busy === t;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-3">
        <Card>
          <CardHeader title="Reachability" description="Run from the device itself - tests the user's actual network path." />
          <CardBody className="space-y-3">
            <Field label="Host"><Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="gateway, 8.8.8.8, fileserver.local" leftIcon={<Wifi />} onKeyDown={(e) => e.key === "Enter" && ping()} /></Field>
            <div className="flex items-end gap-2">
              <Button variant="secondary" size="sm" onClick={ping} loading={busy("ping")} leftIcon={<Activity className="h-3.5 w-3.5" />}>Ping</Button>
              <Field label="Port" className="w-24"><Input value={port} onChange={(e) => setPort(e.target.value)} className="h-8" inputMode="numeric" /></Field>
              <Button variant="secondary" size="sm" onClick={portCheck} loading={busy("port_check")} leftIcon={<Radar className="h-3.5 w-3.5" />}>Check port</Button>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="DNS" description="Resolve a name with the device's resolver." />
          <CardBody className="flex items-end gap-2">
            <Field label="Name" className="flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="login.microsoftonline.com" leftIcon={<Globe />} onKeyDown={(e) => e.key === "Enter" && dns()} /></Field>
            <Button variant="secondary" size="sm" onClick={dns} loading={busy("dns_lookup")}>Resolve</Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Traceroute" description="Hop-by-hop path; takes up to a minute." />
          <CardBody className="flex items-end gap-2">
            <Field label="Host" className="flex-1"><Input value={trace} onChange={(e) => setTrace(e.target.value)} placeholder="1.1.1.1" leftIcon={<Route />} onKeyDown={(e) => e.key === "Enter" && traceroute()} /></Field>
            <Button variant="secondary" size="sm" onClick={traceroute} loading={busy("traceroute")}>Trace</Button>
          </CardBody>
        </Card>
        <div className="text-xs text-fg-subtle">Device IPs: <span className="mono">{[...(d.localIps ?? []), d.publicIp].filter(Boolean).join(", ") || "unknown"}</span></div>
      </div>
      <Card className="min-h-[300px]">
        <CardHeader title="Results" description={results.length ? `${results.length} this session` : "Run a test to see output here"} actions={results.length ? <Button variant="ghost" size="xs" onClick={() => setResults([])}>Clear</Button> : undefined} />
        <CardBody className="space-y-3">
          {rpc.busy && <div className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Running {rpc.busy.replace("_", " ")}…</div>}
          {results.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-surface-2/50">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <Badge tone={r.ok ? "success" : "danger"} size="xs" dot>{r.ok ? "ok" : "failed"}</Badge>
                <span className="mono font-medium">{r.label}</span>
                <span className="text-fg-muted">{r.summary}</span>
                <span className="ml-auto text-xs text-fg-subtle">{r.ms !== null ? `${r.ms} ms · ` : ""}{formatDateTime(r.at, { dateStyle: undefined, timeStyle: "medium" })}</span>
              </div>
              {r.output && <pre className="mono max-h-72 overflow-auto border-t border-border px-3 py-2 text-[11px] leading-relaxed text-fg-muted">{r.output.trim()}</pre>}
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
