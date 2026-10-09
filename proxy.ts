import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge-side gate: unauthenticated visitors to app pages go to /login. The real authorization happens in
 * server components and API handlers (this only checks the presence of the session cookie).
 */
export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has("mw_session");
  const isPublic = pathname.startsWith("/login") || pathname.startsWith("/setup") || pathname.startsWith("/portal") || pathname.startsWith("/share") || pathname.startsWith("/status") || pathname.startsWith("/invite") || pathname.startsWith("/reset") || pathname.startsWith("/dl") || pathname.startsWith("/install");
  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (hasSession && pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|agent|ws|_next|favicon.ico|icons|fonts|manifest.webmanifest|.*\\..*).*)"],
};
