/** Helpers shared by the ticket and contact route handlers (not a route file). */
import { errors } from "@/lib/api/route";
import type { Principal } from "@/lib/auth/session";
import { DeskError, type Actor } from "@/lib/services/tickets";

export function actorOf(p: Principal): Actor {
  return { id: p.user?.id ?? null, name: p.user?.name ?? p.user?.email ?? p.apiKey?.name ?? null, kind: p.kind };
}

/** Run a service call, translating DeskError codes into HTTP errors. */
export async function desk<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DeskError) {
      switch (err.code) {
        case "not_found": throw errors.notFound(err.message);
        case "conflict": throw errors.conflict(err.message);
        case "forbidden": throw errors.forbidden(err.message);
        default: throw errors.badRequest(err.message);
      }
    }
    throw err;
  }
}
