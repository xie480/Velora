import type { ProviderModelCatalogEntry } from "../../shared/providers.js";

export function normalizeProviderBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Provider URL must use HTTP or HTTPS");
  }
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("Non-local provider URLs must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Provider URL must not contain credentials, query, or fragment");
  }
  return url.toString().replace(/\/$/, "");
}

export async function listOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string | undefined,
): Promise<ProviderModelCatalogEntry[]> {
  const client = await createOpenAICompatibleClient(baseUrl, apiKey);
  const result = await client.models.list();
  return result.data
    .filter((model) => typeof model.id === "string" && model.id.trim().length > 0)
    .map((model) => ({ id: model.id, name: model.id }));
}

export async function listChatGPTModels(
  accessToken: string,
): Promise<ProviderModelCatalogEntry[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`ChatGPT model catalog request failed (${response.status}).`);

  const payload = await response.json() as {
    models?: Array<{ slug?: unknown; display_name?: unknown; visibility?: unknown }>;
  };
  if (!Array.isArray(payload.models)) throw new Error("ChatGPT model catalog response was invalid.");
  return payload.models.flatMap((model) => {
    if (model.visibility !== "list" || typeof model.slug !== "string" || !model.slug.trim()) return [];
    return [{
      id: model.slug,
      name: typeof model.display_name === "string" && model.display_name.trim()
        ? model.display_name
        : model.slug,
    }];
  });
}

export async function createOpenAICompatibleClient(baseUrl: string, apiKey: string | undefined) {
  const normalizedBaseUrl = normalizeProviderBaseUrl(baseUrl);
  const { default: OpenAI } = await import("openai");
  return new OpenAI({
    apiKey: apiKey || "local-provider",
    baseURL: normalizedBaseUrl,
    timeout: 8_000,
    maxRetries: 0,
    fetch: (request, init) =>
      fetch(request, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      }),
  });
}
