import * as React from "react";
import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { SessionsList } from "@/components/remote/sessions-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Remote sessions" };

export default async function RemotePage() {
  const p = await requireUser("/remote");
  return <React.Suspense><SessionsList permissions={principalPermissions(p, p.activeOrgId)} userId={p.user.id} /></React.Suspense>;
}
