/**
 * API documentation registry. Every route under app/api/** is described here with `endpoint()` so the OpenAPI document
 * (GET /api/v1/openapi.json), the developer reference (/developers), the AI copilot's tool catalogue and the MCP server
 * all derive from one source of truth. A unit test fails when a route file has no matching entry.
 *
 * Each feature area owns one file in ./areas/<area>.ts exporting `default [endpoint({...}), ...]`.
 */
import type { ZodType } from "zod";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** How an AI agent (or a cautious automation) should treat the operation. */
export type EndpointRisk =
  | "read" // no side effects
  | "write" // creates or edits records; reversible
  | "dangerous"; // affects devices or users (reboot, run code, delete, reset passwords): needs confirmation unless autopilot is on

export interface EndpointDoc {
  method: HttpMethod;
  /** OpenAPI path with {braces}, e.g. "/api/v1/devices/{id}". */
  path: string;
  /** Stable operationId, camelCase, e.g. "listDevices". Used as the MCP / copilot tool name. */
  operationId: string;
  summary: string;
  description?: string;
  /** Group shown in the docs sidebar and OpenAPI tag, e.g. "Devices". */
  tag: string;
  /** Permission(s) required (as in lib/rbac/permissions.ts). Omit when any authenticated principal may call it. */
  permission?: string | string[];
  /** No authentication required. */
  public?: boolean;
  /** Path parameter descriptions keyed by name. */
  params?: Record<string, string>;
  /** zod schemas; converted with z.toJSONSchema at request time. */
  query?: ZodType;
  body?: ZodType;
  /** Response schema as zod or a plain JSON-schema object. Omit for untyped responses. */
  response?: ZodType | Record<string, unknown>;
  bodyExample?: unknown;
  responseExample?: unknown;
  /** Extra remarks rendered as a bullet list (pagination, side effects, realtime events emitted). */
  notes?: string[];
  risk: EndpointRisk;
  /** One-line guidance for the AI copilot on when to use this operation. */
  aiHint?: string;
  deprecated?: boolean;
}

export function endpoint(e: EndpointDoc): EndpointDoc {
  return e;
}
