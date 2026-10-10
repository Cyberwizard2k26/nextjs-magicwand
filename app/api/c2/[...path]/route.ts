import { handleC2 } from "@/lib/c2/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handler(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path: segments } = await ctx.params;
  const rel = (segments || []).join("/");
  const pathname = "/api/c2" + (rel ? "/" + rel : "");
  const res = await handleC2(req, pathname);
  if (res) return res;
  return new Response(JSON.stringify({ error: `unknown c2 route: ${req.method} ${pathname}` }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
