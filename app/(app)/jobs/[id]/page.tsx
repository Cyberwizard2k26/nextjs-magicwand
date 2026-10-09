import * as React from "react";
import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { JobDetail } from "@/components/jobs/job-detail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Job" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await requireUser(`/jobs/${id}`);
  return <React.Suspense><JobDetail id={id} permissions={principalPermissions(p, p.activeOrgId)} /></React.Suspense>;
}
