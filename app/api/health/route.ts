import { NextResponse } from "next/server";
import { boot } from "@/lib/boot";
import { getDb, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { SERVER_VERSION } from "@/lib/version";
import { agentRegistry } from "@/lib/realtime/agent-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await boot({ withServices: false });
    const db = await getDb();
    await db.execute(sql`select 1`);
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.devices);
    return NextResponse.json({ ok: true, version: SERVER_VERSION, devices: count, agentsOnThisNode: agentRegistry.localCount(), time: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String((err as Error).message || err) }, { status: 503 });
  }
}
