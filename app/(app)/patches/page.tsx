import * as React from "react";
import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { FleetPatches } from "@/components/patches/fleet-patches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Patching" };

export default async function PatchesPage() {
  const p = await requireUser("/patches");
  return <React.Suspense><FleetPatches permissions={principalPermissions(p, p.activeOrgId)} /></React.Suspense>;
}
