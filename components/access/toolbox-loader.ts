"use client";
import * as React from "react";

export interface ToolboxPanelProps { deviceId: string; platform: string; compact?: boolean; permissions?: string[] }

/**
 * Single place that resolves the shared Toolbox panel (contract: `components/toolbox/toolbox-panel` exporting
 * `ToolboxPanel(props: { deviceId, platform, compact?, permissions? })`). Both the console's Toolbox tab and the
 * /devices/[id]/toolbox page load it through here, lazily, so the console's first paint never waits for the catalogue.
 */
export const LazyToolboxPanel = React.lazy(() => import("./panels/toolbox-fallback").then((m) => ({ default: m.ToolboxPanel as React.ComponentType<ToolboxPanelProps> })));
