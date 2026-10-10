import { api } from "@/lib/api/route";
import { listSsoProviders } from "@/lib/services/org";

export const dynamic = "force-dynamic";

/** Configured single sign-on providers (secrets are never returned). */
export const GET = api({ permission: "org.view" }, async ({ orgId }) => ({ items: await listSsoProviders(orgId) }));
