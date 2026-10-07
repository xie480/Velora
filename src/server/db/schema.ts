import {
  blob,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
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

/** Current editable Blueprint. Revision is the compare-and-swap token used by every write. */
export const workflowWorking = sqliteTable(
  "workflow_working",
  {
    id: text("id").primaryKey(),
    revision: integer("revision").notNull().default(0),
    blueprintJson: text("blueprint_json").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("workflow_working_singleton", sql`${table.id} = 'working'`),
    check("workflow_working_revision", sql`${table.revision} >= 0`),
    check("workflow_working_json", sql`json_valid(${table.blueprintJson})`),
  ],
);

/** Immutable finalized or manually created snapshots; SQLite triggers guard UPDATE and DELETE. */
export const workflowVersions = sqliteTable(
  "workflow_versions",
  {
    version: integer("version").primaryKey(),
    parentVersion: integer("parent_version").references((): AnySQLiteColumn => workflowVersions.version),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    description: text("description").notNull(),
    userNote: text("user_note").notNull(),
    finalized: integer("finalized", { mode: "boolean" }).notNull().default(false),
    workflowStateJson: text("workflow_state_json").notNull(),
    blueprintJson: text("blueprint_json").notNull(),
  },
  (table) => [
    check("workflow_versions_positive", sql`${table.version} > 0`),
    check("workflow_versions_parent", sql`${table.parentVersion} IS NULL OR ${table.parentVersion} < ${table.version}`),
    check("workflow_versions_finalized", sql`${table.finalized} IN (0, 1)`),
    check("workflow_versions_state_json", sql`json_valid(${table.workflowStateJson})`),
    check("workflow_versions_blueprint_json", sql`json_valid(${table.blueprintJson})`),
  ],
);
