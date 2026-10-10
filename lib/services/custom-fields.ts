/** Custom field definitions per entity (device, site, organization, ticket, contact). */
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import type { CustomFieldCreateT, CustomFieldPatchT } from "../api/contracts/org";
import { ServiceError } from "./org";

export type CustomFieldDefinition = typeof schema.customFieldDefinitions.$inferSelect;

export async function listCustomFields(orgId: string, entity?: CustomFieldDefinition["entity"]) {
  const db = await getDb();
  return db.select().from(schema.customFieldDefinitions).where(and(eq(schema.customFieldDefinitions.orgId, orgId), entity ? eq(schema.customFieldDefinitions.entity, entity) : undefined)).orderBy(asc(schema.customFieldDefinitions.entity), asc(schema.customFieldDefinitions.sortOrder), asc(schema.customFieldDefinitions.label));
}

function checkOptions(type: string, options: string[] | undefined) {
  if ((type === "select" || type === "multiselect") && !(options?.length)) throw new ServiceError(400, "Select fields need at least one option", "bad_request");
}

export async function createCustomField(orgId: string, input: CustomFieldCreateT) {
  const db = await getDb();
  checkOptions(input.type, input.options);
  const dup = await db.select({ id: schema.customFieldDefinitions.id }).from(schema.customFieldDefinitions).where(and(eq(schema.customFieldDefinitions.orgId, orgId), eq(schema.customFieldDefinitions.entity, input.entity), eq(schema.customFieldDefinitions.key, input.key)));
  if (dup.length) throw new ServiceError(409, `A ${input.entity} field with key "${input.key}" already exists`, "conflict");
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${schema.customFieldDefinitions.sortOrder}), -1)::int` }).from(schema.customFieldDefinitions).where(and(eq(schema.customFieldDefinitions.orgId, orgId), eq(schema.customFieldDefinitions.entity, input.entity)));
  const [row] = await db.insert(schema.customFieldDefinitions).values({ orgId, entity: input.entity, key: input.key, label: input.label.trim(), type: input.type, options: input.type === "select" || input.type === "multiselect" ? input.options : [], required: input.required, sourcePath: input.sourcePath ?? null, sortOrder: input.sortOrder ?? max + 1 }).returning();
  bus.publish("custom_field.created", { id: row.id, entity: row.entity, key: row.key }, { orgId });
  return row;
}

export async function updateCustomField(orgId: string, id: string, patch: CustomFieldPatchT) {
  const db = await getDb();
  const [field] = await db.select().from(schema.customFieldDefinitions).where(and(eq(schema.customFieldDefinitions.orgId, orgId), eq(schema.customFieldDefinitions.id, id)));
  if (!field) return null;
  const type = patch.type ?? field.type;
  const options = patch.options ?? field.options;
  checkOptions(type, options);
  const [row] = await db.update(schema.customFieldDefinitions).set({ label: patch.label?.trim() ?? field.label, type, options: type === "select" || type === "multiselect" ? options : [], required: patch.required ?? field.required, sourcePath: patch.sourcePath === undefined ? field.sourcePath : patch.sourcePath, sortOrder: patch.sortOrder ?? field.sortOrder }).where(eq(schema.customFieldDefinitions.id, id)).returning();
  bus.publish("custom_field.updated", { id, entity: row.entity, key: row.key }, { orgId });
  return row;
}

export async function deleteCustomField(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.delete(schema.customFieldDefinitions).where(and(eq(schema.customFieldDefinitions.orgId, orgId), eq(schema.customFieldDefinitions.id, id))).returning();
  if (row) bus.publish("custom_field.deleted", { id, entity: row.entity, key: row.key }, { orgId });
  return row ?? null;
}
