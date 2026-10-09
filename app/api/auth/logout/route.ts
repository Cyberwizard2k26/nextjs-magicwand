import { NextResponse } from "next/server";
import { api } from "@/lib/api/route";
import { destroySession, parseCookies, SESSION_COOKIE, clearSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const POST = api({ public: true }, async ({ req }) => {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (token) await destroySession(token);
  return NextResponse.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
});
