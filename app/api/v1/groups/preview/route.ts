import { api } from "@/lib/api/route";
import { FilterPreviewBody } from "@/lib/api/contracts/groups";
import { previewFilter } from "@/lib/services/groups";
import { siteScope } from "@/lib/services/device-access";

export const dynamic = "force-dynamic";

/** Evaluate an unsaved dynamic-group filter against the fleet (used by the filter builder). */
export const POST = api({ permission: "devices.view", body: FilterPreviewBody }, async ({ orgId, body, principal }) => previewFilter(orgId, body.filter, { page: body.page, pageSize: body.pageSize, siteIds: siteScope(principal, orgId) }));
