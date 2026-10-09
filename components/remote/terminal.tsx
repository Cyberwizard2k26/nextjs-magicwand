"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Eraser, History, Loader2, Minus, Plus, Power, RefreshCw, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/menu";
import { api, ApiClientError } from "@/lib/client/api";
import { getRealtime } from "@/lib/client/ws";
import { useDevice } from "@/components/devices/device-context";
import { DeviceOfflineNotice } from "@/components/devices/device-header";

/** Frame types inside a terminal stream - must match agent/internal/sessions and lib/services/remote-sessions. */
const F = { DATA: 0, RESIZE: 1, CLOSE: 2, READY: 3 } as const;
type Status = "idle" | "opening" | "connected" | "ended" | "error";

const THEME = { background: "#0b0d12", foreground: "#e6e9f0", cursor: "#8f81ff", cursorAccent: "#0b0d12", selectionBackground: "rgba(124,108,255,0.35)", black: "#1c2230", red: "#ff5c6c", green: "#2fd58a", yellow: "#f5b544", blue: "#4cc2ff", magenta: "#c678dd", cyan: "#56b6c2", white: "#dfe3ec", brightBlack: "#5f6880", brightRed: "#ff8591", brightGreen: "#5ee3a4", brightYellow: "#f8c66c", brightBlue: "#7ad1ff", brightMagenta: "#d79aec", brightCyan: "#7cc9d4", brightWhite: "#ffffff" };

export function DeviceTerminal() {
  const { data, can } = useDevice();
  const d = data.device;
  const online = d.status === "online";
  const isWin = d.platform === "windows";
  const hostRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<XTerm | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);
  const streamRef = React.useRef<number | null>(null);
  const sessionRef = React.useRef<string | null>(null);
  const [status, setStatusState] = React.useState<Status>("idle");
  // xterm's onData handler is registered once, so it must read the live status through a ref, not a stale closure.
  const statusRef = React.useRef<Status>("idle");
  const setStatus = React.useCallback((s: Status) => { statusRef.current = s; setStatusState(s); }, []);
  const [info, setInfo] = React.useState<{ shell?: string; pid?: number; reason?: string } | null>(null);
  const [shell, setShell] = React.useState("auto");
  const [runAs, setRunAs] = React.useState<"system" | "user">("system");
  const [fontSize, setFontSize] = React.useState(13);
  const encoder = React.useMemo(() => new TextEncoder(), []);

  // Create the xterm instance once. It is opened only after web fonts are available: xterm measures the cell size on
  // open and never re-measures when Geist Mono swaps in later, which left 11 px rows for a 17 px font.
  React.useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const host = hostRef.current;
    // xterm measures cells with canvas `measureText`, which rejects `var()` in a font string and silently falls back to
    // "10px sans-serif" (11 px rows). Resolve the design-system variable to concrete family names first.
    const families = getComputedStyle(host).getPropertyValue("--font-geist-mono").split(",").map((f) => f.trim()).filter(Boolean);
    const fontFamily = [...families, "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"].join(", ");
    const term = new XTerm({ cursorBlink: true, fontSize: 13, fontFamily, theme: THEME, scrollback: 5000, allowProposedApi: true, convertEol: false });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    termRef.current = term;
    fitRef.current = fit;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let sub: { dispose(): void } | null = null;
    // `document.fonts.ready` resolves before an unused web font is even requested, so ask for the terminal font explicitly.
    const fontsReady = "fonts" in document ? Promise.all(families.map((f) => document.fonts.load(`13px ${f}`).catch(() => []))).then(() => undefined) : Promise.resolve();
    void fontsReady.then(() => {
      if (disposed) return;
      term.open(host);
      fit.fit();
      term.writeln("\x1b[90mMagicWand terminal - press \x1b[0mNew session\x1b[90m to start a shell on " + d.name + "\x1b[0m");
      ro = new ResizeObserver(() => { fit.fit(); sendResize(); });
      ro.observe(host);
      sub = term.onData((s) => send(F.DATA, encoder.encode(s)));
    });
    return () => { disposed = true; ro?.disconnect(); sub?.dispose(); term.dispose(); termRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => { if (termRef.current) { termRef.current.options.fontSize = fontSize; fitRef.current?.fit(); sendResize(); } }, [fontSize]); // eslint-disable-line react-hooks/exhaustive-deps

  function send(type: number, payload: Uint8Array) {
    const id = streamRef.current;
    if (id === null || statusRef.current !== "connected") return;
    const buf = new Uint8Array(1 + payload.byteLength);
    buf[0] = type;
    buf.set(payload, 1);
    getRealtime().sendBinary(id, buf);
  }
  function sendResize() {
    const t = termRef.current;
    if (!t || streamRef.current === null) return;
    send(F.RESIZE, encoder.encode(JSON.stringify({ cols: t.cols, rows: t.rows })));
  }

  const open = React.useCallback(async () => {
    const term = termRef.current;
    if (!term) return;
    await close(false);
    setStatus("opening");
    setInfo(null);
    term.reset();
    term.writeln(`\x1b[90mOpening ${runAs === "user" ? "user" : isWin ? "SYSTEM" : "root"} shell on ${d.name}…\x1b[0m`);
    try {
      fitRef.current?.fit();
      const r = await api.post<{ sessionId: string; shell: string | null }>(`devices/${d.id}/sessions`, { type: "terminal", shell, runAs, cols: Math.min(500, Math.max(20, term.cols)), rows: Math.min(200, Math.max(5, term.rows)) });
      sessionRef.current = r.sessionId;
      const rt = getRealtime();
      let ready = false;
      const viewerStreamId = rt.openStream((payload) => {
        if (!payload.length) return;
        const body = payload.subarray(1);
        switch (payload[0]) {
          case F.DATA: term.write(body); break;
          case F.READY: {
            ready = true;
            try { setInfo(JSON.parse(new TextDecoder().decode(body))); } catch { /* ignore */ }
            setStatus("connected");
            term.focus();
            break;
          }
          case F.CLOSE: {
            let reason = "ended";
            try { reason = (JSON.parse(new TextDecoder().decode(body)) as { reason?: string }).reason ?? reason; } catch { /* ignore */ }
            term.writeln(`\r\n\x1b[90m[session ${reason}]\x1b[0m`);
            setInfo((i) => ({ ...i, reason }));
            setStatus("ended");
            rt.closeStream(viewerStreamId);
            streamRef.current = null;
            break;
          }
        }
      });
      streamRef.current = viewerStreamId;
      rt.send({ t: "attach", sessionId: r.sessionId, viewerStreamId });
      setTimeout(() => { if (!ready && sessionRef.current === r.sessionId) { setStatus("error"); term.writeln("\x1b[31mNo data from the device within 8 s - the live connection may be down.\x1b[0m"); } }, 8000);
    } catch (err) {
      setStatus("error");
      const msg = err instanceof ApiClientError ? err.message : "Could not open a session";
      term.writeln(`\x1b[31m${msg}\x1b[0m`);
      toast.error(msg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id, shell, runAs]);

  async function close(announce = true) {
    const id = sessionRef.current;
    const stream = streamRef.current;
    sessionRef.current = null;
    streamRef.current = null;
    if (stream !== null) { const rt = getRealtime(); rt.send({ t: "detach", sessionId: id }); rt.closeStream(stream); }
    if (id) { try { await api.delete(`sessions/${id}`); } catch { /* already gone */ } }
    if (announce) { setStatus("ended"); termRef.current?.writeln("\r\n\x1b[90m[session ended]\x1b[0m"); }
  }
  React.useEffect(() => () => { void close(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can("remote.terminal")) return <p className="text-sm text-fg-muted">You need the &quot;remote.terminal&quot; permission to open a terminal.</p>;
  if (!online) return <DeviceOfflineNotice what="The terminal" />;
  const supported = d.capabilities.includes("terminal");

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-[#0b0d12] shadow-card" style={{ colorScheme: "dark" }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
        <SquareTerminal className="h-4 w-4 text-accent-hover" />
        <span className="font-medium text-zinc-200">{d.name}</span>
        <StatusBadge status={status} info={info} />
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Select value={shell} onChange={(e) => setShell(e.target.value)} className="h-7 w-auto border-white/10 bg-black/40 text-xs text-zinc-300" aria-label="Shell" disabled={status === "opening"}>
            <option value="auto">{isWin ? "PowerShell" : "bash"}</option>
            {isWin ? <><option value="pwsh">pwsh 7</option><option value="cmd">cmd.exe</option></> : <><option value="zsh">zsh</option><option value="sh">sh</option></>}
          </Select>
          <Select value={runAs} onChange={(e) => setRunAs(e.target.value as "system" | "user")} className="h-7 w-auto border-white/10 bg-black/40 text-xs text-zinc-300" aria-label="Run as" disabled={status === "opening"}>
            <option value="system">{isWin ? "SYSTEM" : "root"}</option>
            <option value="user">{d.loggedInUser ? `user (${d.loggedInUser})` : "signed-in user"}</option>
          </Select>
          <Tooltip content="Smaller text"><button type="button" className="rounded p-1 hover:bg-white/10" onClick={() => setFontSize((f) => Math.max(10, f - 1))} aria-label="Smaller"><Minus className="h-3.5 w-3.5" /></button></Tooltip>
          <Tooltip content="Larger text"><button type="button" className="rounded p-1 hover:bg-white/10" onClick={() => setFontSize((f) => Math.min(22, f + 1))} aria-label="Larger"><Plus className="h-3.5 w-3.5" /></button></Tooltip>
          <Tooltip content="Clear screen"><button type="button" className="rounded p-1 hover:bg-white/10" onClick={() => termRef.current?.clear()} aria-label="Clear"><Eraser className="h-3.5 w-3.5" /></button></Tooltip>
          {status === "connected" ? <Button size="xs" variant="danger" leftIcon={<Power className="h-3 w-3" />} onClick={() => close()}>End session</Button>
            : <Button size="xs" leftIcon={status === "opening" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} onClick={open} disabled={status === "opening" || !supported}>{status === "idle" ? "New session" : "New session"}</Button>}
        </span>
      </div>
      {!supported && <div className="border-b border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">This device&apos;s agent ({d.agentVersion ?? "unknown"}) predates terminal support. Update the agent from the Actions menu.</div>}
      <div ref={hostRef} className="h-[max(360px,calc(100vh-300px))] overflow-hidden p-2" onClick={() => termRef.current?.focus()} />
      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 bg-white/[0.02] px-3 py-1.5 text-[11px] text-zinc-500">
        <span>Real PTY: colours, tab completion, vim and top all work. Paste with <Kbd className="border-white/15 bg-white/5 text-zinc-400">Ctrl Shift V</Kbd></span>
        <span className="ml-auto flex items-center gap-1.5"><History className="h-3 w-3" /><Link href={`/remote?deviceId=${d.id}`} className="hover:text-zinc-300">Session history</Link></span>
      </div>
    </div>
  );
}

function StatusBadge({ status, info }: { status: Status; info: { shell?: string; pid?: number; reason?: string } | null }) {
  switch (status) {
    case "connected": return <Badge tone="success" size="xs" dot>connected{info?.shell ? ` · ${info.shell}${info.pid ? ` pid ${info.pid}` : ""}` : ""}</Badge>;
    case "opening": return <Badge tone="warning" size="xs" dot>opening…</Badge>;
    case "ended": return <Badge tone="neutral" size="xs" dot>ended{info?.reason ? ` · ${info.reason}` : ""}</Badge>;
    case "error": return <Badge tone="danger" size="xs" dot>failed</Badge>;
    default: return <Badge tone="outline" size="xs">no session</Badge>;
  }
}
