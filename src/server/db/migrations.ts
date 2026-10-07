export const databaseMigrations = [
  {
    id: "0001_base_schema",
    sql: `
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
    `,
  },
  {
    id: "0002_provider_profiles",
    sql: `
      CREATE TABLE IF NOT EXISTS provider_profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL CHECK (provider_type IN ('openai_compatible', 'chatgpt_plan')),
        base_url TEXT,
        api_key_ciphertext TEXT,
        model_small TEXT NOT NULL,
        model_medium TEXT NOT NULL,
        model_large TEXT NOT NULL,
        temperature REAL NOT NULL DEFAULT 0.7 CHECK (temperature >= 0 AND temperature <= 2),
        is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
        chatgpt_client_id TEXT,
        chatgpt_email TEXT,
        chatgpt_subject TEXT,
        chatgpt_scopes TEXT,
        chatgpt_id_token_ciphertext TEXT,
        chatgpt_access_token_ciphertext TEXT,
        chatgpt_refresh_token_ciphertext TEXT,
        chatgpt_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (length(trim(model_small)) > 0),
        CHECK (length(trim(model_medium)) > 0),
        CHECK (length(trim(model_large)) > 0),
        CHECK (
          (provider_type = 'openai_compatible' AND base_url IS NOT NULL)
          OR (provider_type = 'chatgpt_plan' AND base_url IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS provider_profiles_single_active
        ON provider_profiles (is_active) WHERE is_active = 1;
      CREATE INDEX IF NOT EXISTS provider_profiles_provider_type
        ON provider_profiles (provider_type);
    `,
  },
] as const;
