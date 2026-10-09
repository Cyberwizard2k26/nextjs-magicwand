import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { ScriptEditor } from "@/components/scripts/script-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "New script" };

export default async function NewScriptPage() {
  const p = await requireUser("/scripts/new");
  return <ScriptEditor id={null} permissions={principalPermissions(p, p.activeOrgId)} />;
}
