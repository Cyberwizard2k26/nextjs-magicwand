import { eq } from "drizzle-orm";
import { api } from "@/lib/api/route";
import { boot } from "@/lib/boot";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Public list of enabled SSO providers shown on the login page. */
export const GET = api({ public: true }, async () => {
  await boot({ withServices: false });
  const db = await getDb();
  const rows = await db.select({ id: schema.ssoProviders.id, name: schema.ssoProviders.name, type: schema.ssoProviders.type }).from(schema.ssoProviders).where(eq(schema.ssoProviders.enabled, true));
  return { providers: rows };
});
