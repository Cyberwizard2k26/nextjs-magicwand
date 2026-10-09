/**
 * Browser realtime client: one WebSocket per tab, auto-reconnect with backoff, topic subscriptions,
 * binary stream multiplexing for remote sessions. Used via the RealtimeProvider / useRealtime hooks.
 */
export type RealtimeEvent = { t: "event"; name: string; payload: unknown; ts: string; deviceId?: string; orgId?: string };
type Listener = (ev: RealtimeEvent) => void;
type StreamListener = (payload: Uint8Array) => void;

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private topics = new Set<string>();
  private listeners = new Map<string, Set<Listener>>(); // name or prefix "alert.*" or "*"
  private streams = new Map<number, StreamListener>();
  private nextStream = 1;
  private backoff = 500;
  private closed = false;
  private statusListeners = new Set<(s: "connecting" | "open" | "closed") => void>();
  status: "connecting" | "open" | "closed" = "closed";

  connect() {
    if (typeof window === "undefined") return;
    this.closed = false;
    this.setStatus("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.setStatus("open");
      if (this.topics.size) ws.send(JSON.stringify({ t: "sub", topics: [...this.topics] }));
    };
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const view = new DataView(e.data);
        const id = view.getUint32(0, false);
        this.streams.get(id)?.(new Uint8Array(e.data, 4));
        return;
      }
      try {
        const msg = JSON.parse(e.data as string) as RealtimeEvent | { t: string };
        if (msg.t === "event") this.dispatch(msg as RealtimeEvent);
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      this.setStatus("closed");
      this.ws = null;
      if (this.closed) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 15_000);
    };
    ws.onerror = () => ws.close();
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  private setStatus(s: typeof this.status) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
  onStatus(l: (s: typeof this.status) => void) {
    this.statusListeners.add(l);
    return () => { this.statusListeners.delete(l); };
  }

  private dispatch(ev: RealtimeEvent) {
    const fire = (key: string) => this.listeners.get(key)?.forEach((l) => { try { l(ev); } catch (err) { console.error(err); } });
    fire(ev.name);
    const parts = ev.name.split(".");
    for (let i = parts.length - 1; i > 0; i--) fire(parts.slice(0, i).join(".") + ".*");
    fire("*");
  }

  subscribe(topics: string[]) {
    const fresh = topics.filter((t) => !this.topics.has(t));
    for (const t of topics) this.topics.add(t);
    if (fresh.length && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "sub", topics: fresh }));
  }
  unsubscribe(topics: string[]) {
    for (const t of topics) this.topics.delete(t);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "unsub", topics }));
  }
  on(name: string, l: Listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(l);
    return () => { this.listeners.get(name)?.delete(l); };
  }
  send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  /** Allocate a viewer stream id and register its handler. */
  openStream(l: StreamListener): number {
    const id = this.nextStream++;
    this.streams.set(id, l);
    return id;
  }
  closeStream(id: number) {
    this.streams.delete(id);
  }
  sendBinary(streamId: number, payload: Uint8Array) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const out = new Uint8Array(4 + payload.byteLength);
    new DataView(out.buffer).setUint32(0, streamId, false);
    out.set(payload, 4);
    this.ws.send(out);
  }
}

let singleton: RealtimeClient | null = null;
export function getRealtime(): RealtimeClient {
  if (!singleton) {
    singleton = new RealtimeClient();
    singleton.connect();
  }
  return singleton;
}
