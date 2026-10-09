"use client";
import * as React from "react";
import { Camera, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/client/format";
import { useRpc } from "./use-rpc";

interface Shot { mime: string; contentBase64: string; width?: number; height?: number; user?: string; capturedAt: string }

/** One-shot view of the user's screen. Not a stream: it is what works today without a desktop relay. */
export function ScreenshotDialog({ deviceId, deviceName, open, onOpenChange }: { deviceId: string; deviceName: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const rpc = useRpc(deviceId);
  const [shot, setShot] = React.useState<Shot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const capture = React.useCallback(async () => {
    setError(null);
    try { const r = await rpc.call<Shot>("screenshot"); setShot(r.data); } catch (err) { setError((err as Error).message); }
  }, [rpc]);
  React.useEffect(() => { if (open) void capture(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = shot ? `data:${shot.mime};base64,${shot.contentBase64}` : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl" title={<span className="flex items-center gap-2"><Camera className="h-4 w-4 text-accent-hover" />Screen of {deviceName}</span>} description={shot ? `${shot.user ? `${shot.user} · ` : ""}captured ${formatDateTime(shot.capturedAt)}${shot.width ? ` · ${shot.width}×${shot.height}` : ""}` : "Captures the signed-in user's display once; it is logged in the audit trail."}
      footer={<>
        {src && <a href={src} download={`${deviceName}-screen.${shot?.mime === "image/png" ? "png" : "jpg"}`} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"><Download className="h-4 w-4" /> Save</a>}
        {src && <Button variant="ghost" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={() => { const w = window.open(); if (w) { w.document.write(`<img src="${src}" style="max-width:100%">`); } }}>Open</Button>}
        <Button variant="secondary" leftIcon={rpc.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} onClick={capture} disabled={!!rpc.busy}>Capture again</Button>
      </>}
    >
      <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-border bg-black/60">
        {rpc.busy && !shot && <span className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Capturing…</span>}
        {error && <div className="max-w-md px-6 text-center text-sm text-danger">{error}</div>}
        {/* data: URL from the device; next/image cannot optimise it */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src && !error && <img src={src} alt={`Screen of ${deviceName}`} className="max-h-[70vh] w-auto max-w-full rounded" />}
      </div>
    </Dialog>
  );
}
