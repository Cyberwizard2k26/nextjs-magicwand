import { api } from "@/lib/api/route";
import { requireDevice } from "@/lib/services/device-access";
import { createDeviceNote, listDeviceNotes } from "@/lib/services/device-notes";
import { NoteCreateBody, NotesQuery } from "@/lib/api/contracts/device-notes";

export const dynamic = "force-dynamic";

/** Notes technicians left on this device, pinned first then newest first. */
export const GET = api({ permission: "devices.view", query: NotesQuery }, async ({ orgId, params, query, principal }) => {
  const device = await requireDevice(principal, orgId, params.id);
  return listDeviceNotes(device.id, { pinned: query.pinned, limit: query.limit });
});

/** Add a note (optionally pinned). */
export const POST = api({ permission: "devices.manage", body: NoteCreateBody }, async ({ orgId, params, body, principal, audit }) => {
  const device = await requireDevice(principal, orgId, params.id);
  const actor = { id: principal.user?.id ?? principal.apiKey?.id ?? null, name: principal.user?.name ?? principal.user?.email ?? principal.apiKey?.name ?? null };
  const note = await createDeviceNote(orgId, device.id, actor, body);
  await audit("device.note.created", { type: "device", id: device.id, name: device.name }, { noteId: note.id, pinned: note.pinned, length: note.body.length });
  return { note };
});
