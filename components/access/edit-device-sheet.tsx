"use client";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import type { DeviceDetail } from "@/components/devices/device-context";
import { api, ApiClientError } from "@/lib/client/api";

const TYPES = ["workstation", "laptop", "server", "vm", "network", "printer", "mobile", "iot", "other"];

/** Rename / re-site / tag / department sheet used by the Access console toolbar and the General panel. */
export function EditDeviceSheet({ deviceId, open, onOpenChange, onSaved }: { deviceId: string; open: boolean; onOpenChange: (o: boolean) => void; onSaved?: () => void }) {
  const { data: detail, mutate } = useSWR<DeviceDetail>(open ? `devices/${deviceId}` : null);
  const { data: sites } = useSWR<{ items: { id: string; name: string }[] }>(open ? "sites" : null);
  const { data: groups } = useSWR<{ items: { id: string; name: string; isDynamic: boolean }[] }>(open ? "groups" : null);
  const device = detail?.device;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={device ? `Edit ${device.name}` : "Edit device"} description={device?.hostname && device.hostname !== device.name ? `hostname ${device.hostname}` : "Details shared with every technician"} width="max-w-lg">
      {!device ? <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div> : <EditForm key={device.id + device.updatedAt} device={device} sites={sites?.items ?? []} groups={groups?.items ?? []} onDone={() => { mutate(); onSaved?.(); onOpenChange(false); }} onCancel={() => onOpenChange(false)} />}
    </Sheet>
  );
}

function EditForm({ device: d, sites, groups, onDone, onCancel }: { device: DeviceDetail["device"]; sites: { id: string; name: string }[]; groups: { id: string; name: string; isDynamic: boolean }[]; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = React.useState({
    displayName: d.displayName ?? "",
    description: d.description ?? "",
    deviceType: d.deviceType,
    tags: d.tags.join(", "),
    notes: d.notes ?? "",
    siteId: d.siteId ?? "",
    groupId: d.groupId ?? "",
    department: typeof d.customFields?.department === "string" ? (d.customFields.department as string) : "",
    maintenance: d.status === "maintenance",
  });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function save() {
    setBusy(true);
    try {
      const customFields = { ...(d.customFields ?? {}) } as Record<string, unknown>;
      if (form.department.trim()) customFields.department = form.department.trim(); else delete customFields.department;
      await api.patch(`devices/${d.id}`, {
        displayName: form.displayName.trim() || null,
        description: form.description.trim() || null,
        deviceType: form.deviceType,
        tags: Array.from(new Set(form.tags.split(",").map((t) => t.trim()).filter(Boolean))),
        notes: form.notes.trim() || null,
        siteId: form.siteId || null,
        groupId: form.groupId || null,
        customFields,
        ...(form.maintenance !== (d.status === "maintenance") ? { status: form.maintenance ? "maintenance" : d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 5 * 60_000 ? "online" : "offline" } : {}),
      });
      toast.success(`${form.displayName.trim() || d.hostname || d.name} updated`);
      onDone();
    } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Save failed"); } finally { setBusy(false); }
  }
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Field label="Display name" hint={`hostname: ${d.hostname ?? "unknown"}`}><Input value={form.displayName} onChange={set("displayName")} placeholder={d.hostname ?? d.name} autoFocus /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <Field label="Company / site"><Select value={form.siteId} onChange={set("siteId")}><option value="">Unassigned</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Department" hint="custom field"><Input value={form.department} onChange={set("department")} placeholder="Finance, Reception, Warehouse…" /></Field>
        <Field label="Group"><Select value={form.groupId} onChange={set("groupId")}><option value="">No group</option>{groups.filter((g) => !g.isDynamic || g.id === d.groupId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
        <Field label="Device type"><Select value={form.deviceType} onChange={set("deviceType")}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
      </div>
      <Field label="Tags" hint="comma separated"><Input value={form.tags} onChange={set("tags")} placeholder="finance, laptop, vip" /></Field>
      <Field label="Description"><Input value={form.description} onChange={set("description")} placeholder="Reception desk PC, 2nd floor" /></Field>
      <Field label="Device notes" hint="free text on the device record"><Textarea value={form.notes} onChange={set("notes")} placeholder="Known quirks, warranty details, who to call…" className="min-h-[72px]" /></Field>
      <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border-strong accent-[var(--accent)]" checked={form.maintenance} onChange={(e) => setForm((f) => ({ ...f, maintenance: e.target.checked }))} />
        <span><span className="font-medium text-fg">Maintenance mode</span><span className="block text-xs text-fg-muted">Suppresses availability alerts while you work on the machine.</span></span>
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>Save changes</Button>
      </div>
    </form>
  );
}
