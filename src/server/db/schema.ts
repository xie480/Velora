import {
  blob,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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

export const providerProfiles = sqliteTable(
  "provider_profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    providerType: text("provider_type", {
      enum: ["openai_compatible", "chatgpt_plan"],
    }).notNull(),
    baseUrl: text("base_url"),
    apiKeyCiphertext: text("api_key_ciphertext"),
    modelSmall: text("model_small").notNull(),
    modelMedium: text("model_medium").notNull(),
    modelLarge: text("model_large").notNull(),
    temperature: real("temperature").notNull().default(0.7),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
    chatgptClientId: text("chatgpt_client_id"),
    chatgptEmail: text("chatgpt_email"),
    chatgptSubject: text("chatgpt_subject"),
    chatgptScopes: text("chatgpt_scopes"),
    chatgptIdTokenCiphertext: text("chatgpt_id_token_ciphertext"),
    chatgptAccessTokenCiphertext: text("chatgpt_access_token_ciphertext"),
    chatgptRefreshTokenCiphertext: text("chatgpt_refresh_token_ciphertext"),
    chatgptExpiresAt: integer("chatgpt_expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "provider_profiles_models_non_empty",
      sql`length(trim(${table.modelSmall})) > 0 AND length(trim(${table.modelMedium})) > 0 AND length(trim(${table.modelLarge})) > 0`,
    ),
    check(
      "provider_profiles_temperature_range",
      sql`${table.temperature} >= 0 AND ${table.temperature} <= 2`,
    ),
    check(
      "provider_profiles_base_url_by_type",
      sql`(${table.providerType} = 'openai_compatible' AND ${table.baseUrl} IS NOT NULL) OR (${table.providerType} = 'chatgpt_plan' AND ${table.baseUrl} IS NULL)`,
    ),
    uniqueIndex("provider_profiles_single_active")
      .on(table.isActive)
      .where(sql`${table.isActive} = 1`),
    index("provider_profiles_provider_type").on(table.providerType),
  ],
);
