/**
 * Process-wide event bus with an optional Redis fan-out so several server nodes behave as one.
 * Event names are dotted: device.online, alert.opened, job.run.updated, session.frame ...
 */
import { EventEmitter } from "node:events";
import os from "node:os";
import { config } from "../config";
import { createLogger } from "../logger";

const log = createLogger("bus");

export interface BusEvent<T = unknown> {
  name: string;
  orgId?: string | null;
  deviceId?: string | null;
  userId?: string | null;
  ts: string;
  payload: T;
  /** Origin node id (to avoid re-publishing messages received from Redis). */
  node?: string;
}

export type BusHandler<T = unknown> = (event: BusEvent<T>) => void | Promise<void>;

export const NODE_ID = process.env.NODE_ID || `${os.hostname()}-${process.pid}`;

class Bus {
  private emitter = new EventEmitter();
  private redisPub: import("ioredis").default | null = null;
  private redisSub: import("ioredis").default | null = null;
  private readonly channel = "magicwand:bus";

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async init() {
    if (!config.redisUrl) return;
    try {
      const { default: Redis } = await import("ioredis");
      this.redisPub = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
      this.redisSub = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
      await this.redisPub.connect();
      await this.redisSub.connect();
      await this.redisSub.subscribe(this.channel);
      this.redisSub.on("message", (_ch: string, raw: string) => {
        try {
          const ev = JSON.parse(raw) as BusEvent;
          if (ev.node === NODE_ID) return;
          this.dispatch(ev);
        } catch (err) {
          log.warn("bad redis bus message", { err: String(err) });
        }
      });
      log.info("redis fan-out enabled");
    } catch (err) {
      log.error("redis bus init failed, continuing single-node", { err: String(err) });
      this.redisPub = null;
      this.redisSub = null;
    }
  }

  private dispatch(ev: BusEvent) {
    this.emitter.emit(ev.name, ev);
    // wildcard listeners: "device.*" and "*"
    const parts = ev.name.split(".");
    for (let i = parts.length - 1; i > 0; i--) this.emitter.emit(parts.slice(0, i).join(".") + ".*", ev);
    this.emitter.emit("*", ev);
  }

  /** Publish an event locally and (when configured) to every other node. */
  publish<T>(name: string, payload: T, scope: { orgId?: string | null; deviceId?: string | null; userId?: string | null } = {}) {
    const ev: BusEvent<T> = { name, ts: new Date().toISOString(), payload, node: NODE_ID, ...scope };
    this.dispatch(ev as BusEvent);
    if (this.redisPub) this.redisPub.publish(this.channel, JSON.stringify(ev)).catch((err: unknown) => log.warn("redis publish failed", { err: String(err) }));
  }

  /** Subscribe to an exact name, a prefix wildcard ("alert.*") or everything ("*"). Returns an unsubscribe fn. */
  subscribe<T = unknown>(name: string, handler: BusHandler<T>): () => void {
    const wrapped = (ev: BusEvent<T>) => {
      Promise.resolve(handler(ev)).catch((err) => log.error(`handler for ${name} failed`, { err: String(err) }));
    };
    this.emitter.on(name, wrapped);
    return () => this.emitter.off(name, wrapped);
  }

  async close() {
    await this.redisSub?.quit();
    await this.redisPub?.quit();
  }
}

interface BusGlobal { __mwBus?: Bus }
const g = globalThis as unknown as BusGlobal;
export const bus: Bus = g.__mwBus ?? (g.__mwBus = new Bus());
