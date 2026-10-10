import { api } from "@/lib/api/route";
import { WEBHOOK_EVENT_CATALOG } from "@/lib/services/webhooks";

export const dynamic = "force-dynamic";

/** Event names a webhook can subscribe to, grouped by area. Any dotted bus event is deliverable; wildcards like `alert.*` work. */
export const GET = api({ permission: "integrations.manage" }, async () => ({ groups: WEBHOOK_EVENT_CATALOG }));
