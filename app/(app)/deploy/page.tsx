import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { DeployPage } from "@/components/deploy/deploy-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deploy agent" };

export default async function Page() {
  const p = await requireUser("/deploy");
  return <DeployPage permissions={principalPermissions(p, p.activeOrgId)} />;
}
