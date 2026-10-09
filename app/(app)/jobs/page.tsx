import * as React from "react";
import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { JobList } from "@/components/jobs/job-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs" };

export default async function JobsPage() {
  const p = await requireUser("/jobs");
  return <React.Suspense><JobList permissions={principalPermissions(p, p.activeOrgId)} /></React.Suspense>;
}
