import { sqlite } from "../db/index.js";
import type { ProviderProfile, ProviderType } from "../../shared/providers.js";

export interface ProviderProfileRow {
  id: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string | null;
  apiKeyCiphertext: string | null;
  modelSmall: string;
  modelMedium: string;
  modelLarge: string;
  temperature: number;
  isActive: number;
  chatgptClientId: string | null;
  chatgptEmail: string | null;
  chatgptSubject: string | null;
  chatgptScopes: string | null;
  chatgptIdTokenCiphertext: string | null;
  chatgptAccessTokenCiphertext: string | null;
  chatgptRefreshTokenCiphertext: string | null;
  chatgptExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const selectColumns = `
  id,
  name,
  provider_type AS providerType,
  base_url AS baseUrl,
  api_key_ciphertext AS apiKeyCiphertext,
  model_small AS modelSmall,
  model_medium AS modelMedium,
  model_large AS modelLarge,
  temperature,
  is_active AS isActive,
  chatgpt_client_id AS chatgptClientId,
  chatgpt_email AS chatgptEmail,
  chatgpt_subject AS chatgptSubject,
  chatgpt_scopes AS chatgptScopes,
  chatgpt_id_token_ciphertext AS chatgptIdTokenCiphertext,
  chatgpt_access_token_ciphertext AS chatgptAccessTokenCiphertext,
  chatgpt_refresh_token_ciphertext AS chatgptRefreshTokenCiphertext,
  chatgpt_expires_at AS chatgptExpiresAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

export function getProviderProfileRow(id: string): ProviderProfileRow | undefined {
  return sqlite
    .prepare(`SELECT ${selectColumns} FROM provider_profiles WHERE id = ?`)
    .get(id) as ProviderProfileRow | undefined;
}

export function getActiveProviderProfileRow(): ProviderProfileRow | undefined {
  return sqlite
    .prepare(`SELECT ${selectColumns} FROM provider_profiles WHERE is_active = 1 LIMIT 1`)
    .get() as ProviderProfileRow | undefined;
}

function toPublicProfile(row: ProviderProfileRow): ProviderProfile {
  const scopes = new Set((row.chatgptScopes ?? "").split(/\s+/).filter(Boolean));
  const signedIn = Boolean(row.chatgptIdTokenCiphertext && row.chatgptSubject);
  return {
    id: row.id,
    name: row.name,
    providerType: row.providerType,
    baseUrl: row.baseUrl,
    models: {
      small: row.modelSmall,
      medium: row.modelMedium,
      large: row.modelLarge,
    },
    temperature: row.temperature,
    isActive: row.isActive === 1,
    hasApiKey: Boolean(row.apiKeyCiphertext),
    chatgpt: {
      signedIn,
      planUsageAuthorized: signedIn && scopes.has("chatgpt.tokens.use.direct"),
      email: row.chatgptEmail,
      expiresAt: row.chatgptExpiresAt ? new Date(row.chatgptExpiresAt).toISOString() : null,
    },
  };
}

export function listProviderProfiles(): ProviderProfile[] {
  const rows = sqlite
    .prepare(`SELECT ${selectColumns} FROM provider_profiles ORDER BY created_at, name`)
    .all() as ProviderProfileRow[];
  return rows.map(toPublicProfile);
}

export function toProviderProfile(row: ProviderProfileRow): ProviderProfile {
  return toPublicProfile(row);
}
