import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only native / WASM packages must not be bundled by Turbopack.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "ws", "pdfkit", "net-snmp", "ioredis", "nodemailer"],
  typedRoutes: false,
  experimental: {},
  images: { unoptimized: true },
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self)" },
      ],
    },
  ],
};

export default nextConfig;
