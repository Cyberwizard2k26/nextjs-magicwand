/** Only allow same-origin relative paths as post-auth redirect targets (blocks `//evil.com` and absolute URLs). */
export function safeNext(v: string | null | undefined): string {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}
