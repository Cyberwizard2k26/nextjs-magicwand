"use client";
import * as React from "react";
import { PanelSkeleton, type PanelProps } from "./panel-bits";

/**
 * Hosts the shared Toolbox panel (components/toolbox/toolbox-panel) in compact mode. Loaded lazily so the console's
 * first paint does not wait for the tool catalogue.
 */
const ToolboxPanel = React.lazy(() => import("@/components/toolbox/toolbox-panel").then((m) => ({ default: m.ToolboxPanel })));

export function ToolboxHost({ detail, can }: PanelProps) {
  const permissions = React.useMemo(() => ["*"].filter(can).length ? ["*"] : ["devices.view", "devices.manage", "scripts.run", "scripts.view", "remote.tools", "remote.terminal", "remote.files", "devices.power", "jobs.view", "software.manage", "patches.manage", "security.manage"].filter(can), [can]);
  return (
    <React.Suspense fallback={<PanelSkeleton rows={6} />}>
      <ToolboxPanel deviceId={detail.device.id} platform={detail.device.platform} compact permissions={permissions} />
    </React.Suspense>
  );
}
