import * as React from "react";
import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { AccessConsole } from "@/components/access/access-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "Devices" };

export default async function DevicesPage() {
  const p = await requireUser("/devices");
  return (
    <React.Suspense>
      <AccessConsole permissions={principalPermissions(p, p.activeOrgId)} />
    </React.Suspense>
  );
}
