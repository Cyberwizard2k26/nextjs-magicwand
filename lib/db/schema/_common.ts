import { text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** UUID primary key generated in the application layer (works on PGlite and Postgres alike). */
export const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

export const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const ts = (name = "ts") => timestamp(name, { withTimezone: true, mode: "date" }).notNull().defaultNow();
export const tsNullable = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const now = sql`now()`;
