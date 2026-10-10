import { api, errors } from "@/lib/api/route";
import { requireDevice } from "@/lib/services/device-access";
import { deleteDeviceNote, getDeviceNote, updateDeviceNote } from "@/lib/services/device-notes";
import { NotePatchBody } from "@/lib/api/contracts/device-notes";

export const dynamic = "force-dynamic";

export const GET = api({ permission: "devices.view" }, async ({ orgId, params, principal }) => {
  const device = await requireDevice(principal, orgId, params.id);
  const note = await getDeviceNote(device.id, params.noteId);
  if (!note) throw errors.notFound("Note not found");
  return { note };
});

/** Edit the text and/or pin state of a note. */
export const PATCH = api({ permission: "devices.manage", body: NotePatchBody }, async ({ orgId, params, body, principal, audit }) => {
  const device = await requireDevice(principal, orgId, params.id);
  const actor = { id: principal.user?.id ?? principal.apiKey?.id ?? null, name: principal.user?.name ?? principal.user?.email ?? principal.apiKey?.name ?? null };
  const note = await updateDeviceNote(orgId, device.id, params.noteId, body, actor);
  if (!note) throw errors.notFound("Note not found");
  await audit("device.note.updated", { type: "device", id: device.id, name: device.name }, { noteId: note.id, fields: Object.keys(body), pinned: note.pinned });
  return { note };
});

export const DELETE = api({ permission: "devices.manage" }, async ({ orgId, params, principal, audit }) => {
  const device = await requireDevice(principal, orgId, params.id);
  const actor = { id: principal.user?.id ?? principal.apiKey?.id ?? null, name: principal.user?.name ?? principal.user?.email ?? principal.apiKey?.name ?? null };
  const note = await deleteDeviceNote(orgId, device.id, params.noteId, actor);
  if (!note) throw errors.notFound("Note not found");
  await audit("device.note.deleted", { type: "device", id: device.id, name: device.name }, { noteId: note.id });
  return { ok: true, id: note.id };
});
