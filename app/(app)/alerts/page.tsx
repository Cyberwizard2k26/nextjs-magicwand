import * as React from "react";
import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { AlertList } from "@/components/alerts/alert-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const p = await requireUser("/alerts");
  return <React.Suspense><AlertList permissions={principalPermissions(p, p.activeOrgId)} /></React.Suspense>;
}
