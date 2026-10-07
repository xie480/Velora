import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { databaseMigrations } from "./migrations.js";
import * as schema from "./schema.js";

const configuredDatabaseFile = process.env.DATABASE_FILE ?? ".data/project-chronicle.sqlite";
export const databaseFile = resolve(process.cwd(), configuredDatabaseFile);

mkdirSync(dirname(databaseFile), { recursive: true });

export const sqlite = new Database(databaseFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY NOT NULL,
    applied_at INTEGER NOT NULL
  );
`);

const hasMigration = sqlite.prepare("SELECT 1 FROM schema_migrations WHERE id = ?");
const recordMigration = sqlite.prepare(
  "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
);
for (const migration of databaseMigrations) {
  if (hasMigration.get(migration.id)) continue;
  sqlite.transaction(() => {
    sqlite.exec(migration.sql);
    recordMigration.run(migration.id, Date.now());
  })();
}

export const db = drizzle({ client: sqlite, schema });

export function closeDatabase(): void {
  if (sqlite.open) sqlite.close();
}
