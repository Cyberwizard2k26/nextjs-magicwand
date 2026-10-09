import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { ScriptEditor } from "@/components/scripts/script-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Script" };

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await requireUser(`/scripts/${id}`);
  return <ScriptEditor id={id} permissions={principalPermissions(p, p.activeOrgId)} />;
}
