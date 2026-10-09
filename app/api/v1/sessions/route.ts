import { z } from "zod";
import { api, paginationQuery } from "@/lib/api/route";
import { listSessions } from "@/lib/services/remote-sessions";

export const dynamic = "force-dynamic";

const Query = paginationQuery.extend({ deviceId: z.string().optional(), active: z.coerce.boolean().optional(), mine: z.coerce.boolean().optional() });

/** Remote sessions of the org (live and historical). */
export const GET = api({ permission: "remote.terminal", query: Query }, async ({ orgId, query, principal }) => listSessions(orgId, { deviceId: query.deviceId, active: query.active, userId: query.mine ? principal.user?.id : undefined, page: query.page, pageSize: query.pageSize }));
