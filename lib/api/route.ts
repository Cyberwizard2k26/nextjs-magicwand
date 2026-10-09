/**
 * Helpers for App Router API handlers: auth, RBAC, validation, consistent errors, pagination.
 *
 *   export const GET = api({ permission: "devices.view" }, async ({ principal, orgId, query }) => ({ ... }));
 */
import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { resolvePrincipal, can, requiresMfa, clientIp, type Principal } from "../auth/session";
import type { Permission } from "../rbac/permissions";
import { createLogger } from "../logger";
import { getDb, schema } from "../db";

const log = createLogger("api");

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "error", public details?: unknown) {
    super(message);
  }
}
export const errors = {
  badRequest: (m = "Bad request", details?: unknown) => new ApiError(400, m, "bad_request", details),
  unauthorized: (m = "Authentication required") => new ApiError(401, m, "unauthorized"),
  forbidden: (m = "You do not have permission to do that") => new ApiError(403, m, "forbidden"),
  notFound: (m = "Not found") => new ApiError(404, m, "not_found"),
  conflict: (m = "Conflict") => new ApiError(409, m, "conflict"),
  tooMany: (m = "Too many requests") => new ApiError(429, m, "rate_limited"),
  offline: (m = "Device is offline") => new ApiError(409, m, "device_offline"),
  unavailable: (m = "Service unavailable") => new ApiError(503, m, "unavailable"),
};

export interface ApiContext<Q = unknown, B = unknown> {
  req: Request;
  principal: Principal;
  /** Active organization id (validated against membership, or any org for super admins). */
  orgId: string;
  params: Record<string, string>;
  query: Q;
  body: B;
  ip: string;
  /** Write an audit log entry attributed to this principal. */
  audit: (action: string, target?: { type?: string; id?: string; name?: string }, details?: Record<string, unknown>) => Promise<void>;
}

export interface ApiOptions<Q extends ZodType | undefined, B extends ZodType | undefined> {
  /** Permission(s) required in the active org. Omit for authenticated-only endpoints; set `public: true` for none. */
  permission?: Permission | Permission[];
  public?: boolean;
  /** Allow access without an active org (platform-level endpoints, account endpoints). */
  orgOptional?: boolean;
  query?: Q;
  body?: B;
  /** Skip the MFA-complete requirement (used by the MFA endpoints themselves). */
  allowPendingMfa?: boolean;
}

type Infer<T> = T extends ZodType ? z.infer<T> : undefined;

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function api<Q extends ZodType | undefined = undefined, B extends ZodType | undefined = undefined>(
  opts: ApiOptions<Q, B>,
  handler: (ctx: ApiContext<Infer<Q>, Infer<B>>) => Promise<unknown | Response>,
) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string>> | Record<string, string> }): Promise<Response> => {
    const started = Date.now();
    try {
      const params = (await routeCtx?.params) ?? {};
      const ip = clientIp(req.headers);
      const userAgent = req.headers.get("user-agent") || "";
      let principal: Principal | null = null;
      if (!opts.public) {
        principal = await resolvePrincipal({ cookieHeader: req.headers.get("cookie"), authorization: req.headers.get("authorization"), orgHeader: req.headers.get("x-org-id"), ip, userAgent });
        if (!principal) throw errors.unauthorized();
        if (!opts.allowPendingMfa && requiresMfa(principal)) throw new ApiError(401, "Multi-factor authentication required", "mfa_required");
      }
      const orgId = principal?.activeOrgId ?? "";
      if (!opts.public && !opts.orgOptional && !orgId) throw new ApiError(403, "No organization selected", "no_org");
      if (opts.permission && principal && !can(principal, opts.permission, orgId || null)) throw errors.forbidden();

      let query: unknown = undefined;
      if (opts.query) {
        const url = new URL(req.url);
        const raw: Record<string, string | string[]> = {};
        for (const [k, v] of url.searchParams) {
          if (k in raw) raw[k] = ([] as string[]).concat(raw[k], v);
          else raw[k] = v;
        }
        const parsed = opts.query.safeParse(raw);
        if (!parsed.success) throw errors.badRequest("Invalid query", z.treeifyError(parsed.error));
        query = parsed.data;
      }
      let body: unknown = undefined;
      if (opts.body) {
        let rawBody: unknown = {};
        const ct = req.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          try { rawBody = await req.json(); } catch { throw errors.badRequest("Body must be valid JSON"); }
        } else if (ct.includes("form")) {
          rawBody = Object.fromEntries((await req.formData()).entries());
        }
        const parsed = opts.body.safeParse(rawBody);
        if (!parsed.success) throw errors.badRequest("Invalid request body", z.treeifyError(parsed.error));
        body = parsed.data;
      }

      const audit: ApiContext["audit"] = async (action, target, details) => {
        try {
          const db = await getDb();
          await db.insert(schema.auditLogs).values({
            orgId: orgId || null,
            actorType: principal?.kind === "apikey" ? "apikey" : "user",
            actorId: principal?.kind === "apikey" ? principal.apiKey?.id : principal?.user?.id,
            actorName: principal?.kind === "apikey" ? principal.apiKey?.name : principal?.user?.email,
            action,
            targetType: target?.type,
            targetId: target?.id,
            targetName: target?.name,
            ip,
            userAgent: userAgent.slice(0, 512),
            details: details ?? {},
          });
        } catch (err) {
          log.error("audit write failed", { err: String(err) });
        }
      };

      const result = await handler({ req, principal: principal as Principal, orgId, params, query: query as Infer<Q>, body: body as Infer<B>, ip, audit });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.code, message: err.message, details: err.details }, { status: err.status });
      }
      const e = err as Error;
      if (e?.name === "DeviceOfflineError") return NextResponse.json({ error: "device_offline", message: e.message }, { status: 409 });
      log.error(`unhandled error in ${req.method} ${new URL(req.url).pathname}`, { err: e?.stack || String(err), ms: Date.now() - started });
      return NextResponse.json({ error: "internal", message: process.env.NODE_ENV === "production" ? "Internal server error" : String(e?.message || err) }, { status: 500 });
    }
  };
}

/** Common pagination query schema. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().optional(),
  sort: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export function paginate<T>(items: T[], total: number, q: { page: number; pageSize: number }) {
  return { items, total, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
}
