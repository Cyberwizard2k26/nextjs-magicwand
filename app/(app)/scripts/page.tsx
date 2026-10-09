import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { ScriptList } from "@/components/scripts/script-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scripts" };

export default async function ScriptsPage() {
  const p = await requireUser("/scripts");
  return <ScriptList permissions={principalPermissions(p, p.activeOrgId)} />;
}
