import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const configuredDatabaseFile = process.env.DATABASE_FILE ?? ".data/project-chronicle.sqlite";
export const databaseFile = resolve(process.cwd(), configuredDatabaseFile);

mkdirSync(dirname(databaseFile), { recursive: true });

export const sqlite = new Database(databaseFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// This small bootstrap schema keeps a fresh checkout runnable. Drizzle schema
// definitions remain the source for generated migrations as domain tables grow.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vector_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    embedding BLOB NOT NULL,
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (project_id, source_id, embedding_model)
  );

  CREATE INDEX IF NOT EXISTS vector_chunks_project_model
    ON vector_chunks (project_id, embedding_model);
`);

export const db = drizzle({ client: sqlite, schema });

export function closeDatabase(): void {
  if (sqlite.open) sqlite.close();
}
