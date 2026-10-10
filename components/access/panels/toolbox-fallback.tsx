"use client";
import * as React from "react";
import Link from "next/link";
import { Wrench } from "lucide-react";
import { PanelEmpty } from "./panel-bits";

/** Stand-in rendered while the shared Toolbox module is not part of this build. Same props as the contract. */
export function ToolboxPanel({ deviceId }: { deviceId: string; platform: string; compact?: boolean; permissions?: string[] }) {
  return <PanelEmpty icon={<Wrench />} title="Toolbox is not installed in this build" description="Packaged tools (PowerShell, batch, shell) run from here once the Toolbox module is present. Until then, use the console command box or run a script." action={<Link href={`/jobs/new?device=${deviceId}`} className="text-xs text-accent-hover hover:underline">Run a script instead</Link>} />;
}
