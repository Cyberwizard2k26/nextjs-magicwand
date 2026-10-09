import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { AlertDetail } from "@/components/alerts/alert-detail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alert" };

export default async function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await requireUser(`/alerts/${id}`);
  return <AlertDetail id={id} permissions={principalPermissions(p, p.activeOrgId)} />;
}
