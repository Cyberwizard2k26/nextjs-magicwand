import * as React from "react";
import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { JobWizard } from "@/components/jobs/job-wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "New job" };

export default async function NewJobPage() {
  const p = await requireUser("/jobs/new");
  return <React.Suspense><JobWizard permissions={principalPermissions(p, p.activeOrgId)} /></React.Suspense>;
}
