import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
  constants,
  type JsonWebKey,
} from "node:crypto";
import { sqlite } from "../db/index.js";
import { decryptSecret, encryptSecret } from "./secretVault.js";
import { getProviderProfileRow } from "./providerProfiles.js";
import { localApiPort } from "./config.js";

const openAIssuer = "https://auth.openai.com";
const authorizeEndpoint = `${openAIssuer}/api/accounts/authorize`;
const tokenEndpoint = `${openAIssuer}/api/accounts/oauth/token`;
const resource = "https://api.openai.com/v1";
const callbackUri = `http://127.0.0.1:${localApiPort}/api/providers/chatgpt/callback`;
const requiredScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
].join(" ");
const initialClientId = "dynamic_agent_client";
const allowedReturnOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  `http://127.0.0.1:${localApiPort}`,
  `http://localhost:${localApiPort}`,
]);

interface PendingAuthorization {
  state: string;
  nonce: string;
  codeVerifier: string;
  profileId: string;
  clientId: string;
  hostId: string;
  returnOrigin: string;
  startedAt: number;
}

interface OidcDiscovery {
  issuer: string;
  jwks_uri: string;
}

interface JwkSet {
  keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>;
}

interface IdentityClaims {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
  nonce?: string;
  sub?: string;
  email?: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
}

export type ChatGPTAuthError =
  | "access_denied"
  | "authorization_failed"
  | "invalid_state"
  | "scope_missing"
  | "account_mismatch";

export interface ChatGPTCallbackResult {
  profileId: string | null;
  returnOrigin: string | null;
  error: ChatGPTAuthError | null;
}

const pendingAuthorizations = new Map<string, PendingAuthorization>();
let discoveryPromise: Promise<OidcDiscovery> | undefined;

function getOrCreateHostId(): string {
  const key = "chatgpt_ext_agent_host_id";
  const existing = sqlite.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | undefined;
  if (existing) return existing.value;
  const created = `urn:uuid:${randomUUID()}`;
  sqlite.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)").run(key, created);
  const saved = sqlite.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string };
  return saved.value;
}

function safeReturnOrigin(value: string | undefined): string {
  return value && allowedReturnOrigins.has(value) ? value : `http://127.0.0.1:${localApiPort}`;
}

function encodeBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function makeAuthorizeUrl(input: PendingAuthorization, agentNameHint: string | null, idTokenHint: string | null, loginHint: string | null): string {
  const url = new URL(authorizeEndpoint);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", callbackUri);
  url.searchParams.set("scope", requiredScopes);
  url.searchParams.set("resource", resource);
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set(
    "code_challenge",
    encodeBase64Url(createHash("sha256").update(input.codeVerifier).digest()),
  );
  url.searchParams.set("ext_agent_host_id", input.hostId);
  if (input.clientId === initialClientId && agentNameHint) {
    url.searchParams.set("agent_name_hint", agentNameHint);
  }
  if (idTokenHint) url.searchParams.set("id_token_hint", idTokenHint);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export function beginChatGPTAuthorization(profileId: string, origin: string | undefined): string {
  const profile = getProviderProfileRow(profileId);
  if (!profile || profile.providerType !== "chatgpt_plan") {
    throw new Error("ChatGPT configuration not found.");
  }

  const now = Date.now();
  for (const [state, pending] of pendingAuthorizations) {
    if (now - pending.startedAt > 10 * 60_000) pendingAuthorizations.delete(state);
  }

  const pending: PendingAuthorization = {
    state: encodeBase64Url(randomBytes(32)),
    nonce: encodeBase64Url(randomBytes(32)),
    codeVerifier: encodeBase64Url(randomBytes(32)),
    profileId,
    clientId: profile.chatgptClientId ?? initialClientId,
    hostId: getOrCreateHostId(),
    returnOrigin: safeReturnOrigin(origin),
    startedAt: now,
  };
  pendingAuthorizations.set(pending.state, pending);

  let idTokenHint: string | null = null;
  if (profile.chatgptIdTokenCiphertext) {
    try {
      idTokenHint = decryptSecret(profile.chatgptIdTokenCiphertext);
    } catch {
      idTokenHint = null;
    }
  }
  return makeAuthorizeUrl(pending, "Project Chronicle", idTokenHint, profile.chatgptEmail);
}

async function getOidcDiscovery(): Promise<OidcDiscovery> {
  if (!discoveryPromise) {
    discoveryPromise = (async () => {
      const response = await fetch(`${openAIssuer}/.well-known/openid-configuration`, {
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error("OpenID discovery failed.");
      const discovery = (await response.json()) as OidcDiscovery;
      if (
        discovery.issuer !== openAIssuer ||
        !discovery.jwks_uri ||
        new URL(discovery.jwks_uri).origin !== openAIssuer
      ) {
        throw new Error("OpenID discovery metadata is invalid.");
      }
      return discovery;
    })().catch((error) => {
      discoveryPromise = undefined;
      throw error;
    });
  }
  return discoveryPromise;
}

async function verifyIdentityToken(token: string, clientId: string, expectedNonce?: string): Promise<IdentityClaims> {
  if (token.length > 16_384) throw new Error("ID token is too large.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("ID token format is invalid.");

  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as IdentityClaims;
  if (!header.kid || (header.alg !== "RS256" && header.alg !== "PS256")) {
    throw new Error("ID token signing algorithm is not supported.");
  }

  const discovery = await getOidcDiscovery();
  const response = await fetch(discovery.jwks_uri, {
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("OpenID signing keys could not be loaded.");
  const jwks = (await response.json()) as JwkSet;
  const jwk = jwks.keys.find((key) => key.kid === header.kid && (!key.use || key.use === "sig"));
  if (!jwk) throw new Error("ID token signing key was not found.");

  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const signature = Buffer.from(parts[2], "base64url");
  const signedPayload = `${parts[0]}.${parts[1]}`;
  const validSignature = header.alg === "PS256"
    ? verify("RSA-SHA256", Buffer.from(signedPayload), {
        key: publicKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      }, signature)
    : verify("RSA-SHA256", Buffer.from(signedPayload), publicKey, signature);
  if (!validSignature) throw new Error("ID token signature is invalid.");

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== openAIssuer ||
    !audience.includes(clientId) ||
    (audience.length > 1 && !claims.azp) ||
    (claims.azp !== undefined && claims.azp !== clientId) ||
    typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000) ||
    (expectedNonce !== undefined && claims.nonce !== expectedNonce) ||
    !claims.sub
  ) {
    throw new Error("ID token claims are invalid.");
  }
  return claims;
}

function makeSettingsReturn(origin: string, profileId: string | null, error: ChatGPTAuthError | null): string {
  const url = new URL("/", origin);
  url.searchParams.set("view", "providers");
  if (profileId) url.searchParams.set("profile", profileId);
  if (error) url.searchParams.set("chatgpt_auth", error);
  else url.searchParams.set("chatgpt_auth", "connected");
  return url.toString();
}

export function invalidChatGPTCallback(): ChatGPTCallbackResult {
  return { profileId: null, returnOrigin: null, error: "invalid_state" };
}

export async function completeChatGPTAuthorization(url: URL): Promise<ChatGPTCallbackResult> {
  const state = url.searchParams.get("state");
  const pending = state ? pendingAuthorizations.get(state) : undefined;
  if (!state || !pending || Date.now() - pending.startedAt > 10 * 60_000) {
    if (state) pendingAuthorizations.delete(state);
    return invalidChatGPTCallback();
  }
  pendingAuthorizations.delete(state);

  const profile = getProviderProfileRow(pending.profileId);
  if (!profile || profile.providerType !== "chatgpt_plan") {
    return { profileId: pending.profileId, returnOrigin: pending.returnOrigin, error: "authorization_failed" };
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return {
      profileId: pending.profileId,
      returnOrigin: pending.returnOrigin,
      error: oauthError === "access_denied" ? "access_denied" : "authorization_failed",
    };
  }

  const code = url.searchParams.get("code");
  const callbackClientId = url.searchParams.get("client_id");
  if (!code || code.length > 4_096) {
    return { profileId: pending.profileId, returnOrigin: pending.returnOrigin, error: "authorization_failed" };
  }
  let clientId = pending.clientId;
  if (clientId === initialClientId) {
    if (!callbackClientId || callbackClientId.length > 300) {
      return { profileId: pending.profileId, returnOrigin: pending.returnOrigin, error: "authorization_failed" };
    }
    clientId = callbackClientId;
  } else if (callbackClientId && callbackClientId !== clientId) {
    return { profileId: pending.profileId, returnOrigin: pending.returnOrigin, error: "authorization_failed" };
  }

  try {
    const tokenForm = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: callbackUri,
      code_verifier: pending.codeVerifier,
      resource,
    });
    const tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: tokenForm,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) {
      return { profileId: pending.profileId, returnOrigin: pending.returnOrigin, error: "authorization_failed" };
    }
    const tokens = (await tokenResponse.json()) as OAuthTokenResponse;
    if (!tokens.access_token || !tokens.id_token || !Number.isFinite(tokens.expires_in) || !tokens.expires_in) {
      return { profileId: pending.profileId, returnOrigin: pending.returnOrigin, error: "authorization_failed" };
    }

    const claims = await verifyIdentityToken(tokens.id_token, clientId, pending.nonce);
    if (profile.chatgptSubject && profile.chatgptSubject !== claims.sub) {
      return { profileId: pending.profileId, returnOrigin: pending.returnOrigin, error: "account_mismatch" };
    }

    // Plan-usage authorization must come from the token endpoint's granted scopes.
    // A scope echoed by the browser callback is not proof that the token exchange granted it.
    const scopes = (tokens.scope ?? "").split(/\s+/).filter(Boolean);
    const refreshToken = tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : profile.chatgptRefreshTokenCiphertext;
    sqlite.prepare(`
      UPDATE provider_profiles
      SET chatgpt_client_id = ?, chatgpt_email = ?, chatgpt_subject = ?, chatgpt_scopes = ?,
          chatgpt_id_token_ciphertext = ?, chatgpt_access_token_ciphertext = ?,
          chatgpt_refresh_token_ciphertext = ?, chatgpt_expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      clientId,
      claims.email ?? null,
      claims.sub,
      scopes.join(" "),
      encryptSecret(tokens.id_token),
      encryptSecret(tokens.access_token),
      refreshToken,
      Date.now() + Math.min(tokens.expires_in, 86_400) * 1_000,
      Date.now(),
      pending.profileId,
    );

    const error: ChatGPTAuthError | null = scopes.includes("chatgpt.tokens.use.direct")
      ? null
      : "scope_missing";
    return { profileId: pending.profileId, returnOrigin: pending.returnOrigin, error };
  } catch {
    return { profileId: pending.profileId, returnOrigin: pending.returnOrigin, error: "authorization_failed" };
  }
}

export function chatGPTCallbackRedirect(result: ChatGPTCallbackResult): string | null {
  if (!result.returnOrigin) return null;
  return makeSettingsReturn(result.returnOrigin, result.profileId, result.error);
}

export async function getChatGPTAccessToken(profileId: string): Promise<string> {
  const profile = getProviderProfileRow(profileId);
  const scopes = new Set((profile?.chatgptScopes ?? "").split(/\s+/).filter(Boolean));
  if (
    !profile || profile.providerType !== "chatgpt_plan" ||
    !profile.chatgptClientId || !profile.chatgptAccessTokenCiphertext ||
    !scopes.has("chatgpt.tokens.use.direct")
  ) {
    throw new Error("ChatGPT plan usage is not authorized for this profile.");
  }

  if (profile.chatgptExpiresAt && profile.chatgptExpiresAt > Date.now() + 60_000) {
    return decryptSecret(profile.chatgptAccessTokenCiphertext);
  }
  if (!profile.chatgptRefreshTokenCiphertext) {
    throw new Error("ChatGPT refresh token is unavailable; sign in again.");
  }

  const tokenForm = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: profile.chatgptClientId,
    refresh_token: decryptSecret(profile.chatgptRefreshTokenCiphertext),
    resource,
  });
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: tokenForm,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("ChatGPT token refresh failed; sign in again.");

  const tokens = (await response.json()) as OAuthTokenResponse;
  if (!tokens.access_token || !Number.isFinite(tokens.expires_in) || !tokens.expires_in) {
    throw new Error("ChatGPT token refresh response is incomplete.");
  }
  const refreshedScopes = (tokens.scope ?? profile.chatgptScopes ?? "").split(/\s+/).filter(Boolean);
  if (!refreshedScopes.includes("chatgpt.tokens.use.direct")) {
    throw new Error("ChatGPT plan usage permission is no longer granted.");
  }

  let idTokenCiphertext = profile.chatgptIdTokenCiphertext;
  if (tokens.id_token) {
    const claims = await verifyIdentityToken(tokens.id_token, profile.chatgptClientId);
    if (claims.sub !== profile.chatgptSubject) {
      throw new Error("ChatGPT account identity changed during token refresh.");
    }
    idTokenCiphertext = encryptSecret(tokens.id_token);
  }
  const refreshTokenCiphertext = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : profile.chatgptRefreshTokenCiphertext;

  sqlite.prepare(`
    UPDATE provider_profiles
    SET chatgpt_scopes = ?, chatgpt_id_token_ciphertext = ?,
        chatgpt_access_token_ciphertext = ?, chatgpt_refresh_token_ciphertext = ?,
        chatgpt_expires_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    refreshedScopes.join(" "),
    idTokenCiphertext,
    encryptSecret(tokens.access_token),
    refreshTokenCiphertext,
    Date.now() + Math.min(tokens.expires_in, 86_400) * 1_000,
    Date.now(),
    profileId,
  );
  return tokens.access_token;
}
