"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { StickyNote, Wrench } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDevice } from "@/components/devices/device-context";
import { NotesPanel } from "./panels/notes-panel";
import { PanelSkeleton } from "./panels/panel-bits";
import { useNow } from "./use-media";
import type { DeviceActions } from "./access-model";

const ToolboxPanel = React.lazy(() => import("@/components/toolbox/toolbox-panel").then((m) => ({ default: m.ToolboxPanel })));

/** Shared no-op-free action set for panels rendered inside the full device page (where the header owns the dialogs). */
function usePageActions(): DeviceActions {
  const router = useRouter();
  const { data } = useDevice();
  const base = `/devices/${data.device.id}`;
  return {
    join: () => router.push(`${base}/terminal`),
    open: () => router.push(base),
    edit: () => router.push(base),
    end: () => router.push("/remote"),
    quick: () => router.push(`${base}/console`),
    approve: () => router.push(base),
    wake: () => router.push(base),
    screenshot: () => router.push(base),
    askAi: (id) => router.push(`/copilot?device=${encodeURIComponent(id)}`),
  };
}

/** /devices/[id]/toolbox - the Toolbox in its full-width form. */
export function DeviceToolboxTab() {
  const { data, permissions, can } = useDevice();
  const d = data.device;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Wrench className="h-4 w-4 text-accent-hover" />Toolbox</span>} description={d.status === "online" ? `Run packaged tools on ${d.name}; every run becomes an audited job.` : `${d.name} is offline - tools queue and run when it reconnects.`} actions={<Badge tone="neutral" size="xs" className="capitalize">{d.platform}</Badge>} />
      <CardBody>
        <React.Suspense fallback={<PanelSkeleton rows={6} />}>
          <ToolboxPanel deviceId={d.id} platform={d.platform} permissions={permissions} />
        </React.Suspense>
        {!can("scripts.run") && <p className="mt-3 text-xs text-fg-muted">Running tools requires the &quot;scripts.run&quot; permission.</p>}
      </CardBody>
    </Card>
  );
}

/** /devices/[id]/notes - technician notes, pinned first. */
export function DeviceNotesTab() {
  const { data, can } = useDevice();
  const actions = usePageActions();
  const now = useNow(30_000);
  const { data: notes } = useSWR<{ total: number; pinned: number }>(`devices/${data.device.id}/notes`);
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><StickyNote className="h-4 w-4 text-accent-hover" />Notes</span>} description="Shared with every technician and read by the AI copilot when it works on this machine." actions={notes ? <span className="text-xs text-fg-muted">{notes.total} note{notes.total === 1 ? "" : "s"}{notes.pinned ? ` · ${notes.pinned} pinned` : ""}</span> : null} />
      <CardBody className="@container/detail">
        <div className="max-w-3xl">
          <NotesPanel detail={data} can={can} actions={actions} newestAgentVersion={null} now={now} goTo={() => {}} />
        </div>
      </CardBody>
    </Card>
  );
}
