import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const vectorChunks = sqliteTable(
  "vector_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id").notNull(),
    sourceId: text("source_id").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: blob("embedding", { mode: "buffer" }).notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("vector_chunks_project_source_model").on(
      table.projectId,
      table.sourceId,
      table.embeddingModel,
    ),
    index("vector_chunks_project_model").on(
      table.projectId,
      table.embeddingModel,
    ),
  ],
);
