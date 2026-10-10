"use client";

/**
 * Toolbox panel — placeholder restored after the cloud session lost this file.
 * The lazy import in toolbox-host expects a default ToolboxPanel component.
 */
import * as React from "react";

export function ToolboxPanel({ deviceId, platform, compact, permissions }: { deviceId: string; platform?: string; compact?: boolean; permissions?: string[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
      <div className="font-semibold text-fg mb-1">Toolbox</div>
      <p className="text-xs">
        Remote toolbox for device <span className="font-mono text-fg">{deviceId.slice(0, 12)}</span> is re-initializing.
        Run jobs and scripts from the Automate section meanwhile.
      </p>
      {compact ? null : <p className="text-xs mt-2">This panel rebuilds from the automation module in an upcoming release.</p>}
    </div>
  );
}

export default ToolboxPanel;
