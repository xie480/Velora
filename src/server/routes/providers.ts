import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { sqlite } from "../db/index.js";
import { encryptSecret, decryptSecret } from "../services/secretVault.js";
import {
  getActiveProviderProfileRow,
  getProviderProfileRow,
  listProviderProfiles,
  toProviderProfile,
} from "../services/providerProfiles.js";
import {
  createOpenAICompatibleClient,
  listChatGPTModels,
  listOpenAICompatibleModels,
  normalizeProviderBaseUrl,
} from "../services/openAICompatible.js";
import {
  beginChatGPTAuthorization,
  chatGPTCallbackRedirect,
  completeChatGPTAuthorization,
  getChatGPTAccessToken,
} from "../services/chatgptOAuth.js";

export const providerRoutes = new Hono();

const profileInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  providerType: z.enum(["openai_compatible", "chatgpt_plan"]),
  baseUrl: z.string().trim().max(500).default(""),
  apiKey: z.string().max(2_000).default(""),
  clearApiKey: z.boolean().default(false),
  models: z.object({
    small: z.string().trim().min(1).max(160),
    medium: z.string().trim().min(1).max(160),
    large: z.string().trim().min(1).max(160),
  }),
  temperature: z.number().min(0).max(2),
});

function profileNotFound(context: Context) {
  return context.json({ error: "配置不存在。" }, 404);
}

providerRoutes.get("/profiles", (context) =>
  context.json({ profiles: listProviderProfiles() }),
);

providerRoutes.get("/profiles/active", (context) => {
  const row = getActiveProviderProfileRow();
  return context.json({ profile: row ? toProviderProfile(row) : null });
});

providerRoutes.post("/profiles", async (context) => {
  const body = profileInputSchema.safeParse(await context.req.json().catch(() => null));
  if (!body.success) return context.json({ error: "请检查配置名称、模型 ID、端点和温度范围。" }, 400);

  const input = body.data;
  let baseUrl: string | null = null;
  if (input.providerType === "openai_compatible") {
    try {
      baseUrl = normalizeProviderBaseUrl(input.baseUrl);
    } catch {
      return context.json({ error: "端点需为 HTTPS；HTTP 仅允许本机回环地址，且不能包含凭据或查询参数。" }, 400);
    }
  }

  const id = randomUUID();
  const now = Date.now();
  const apiKeyCiphertext = input.providerType === "openai_compatible" && input.apiKey.trim()
    ? encryptSecret(input.apiKey.trim())
    : null;
  const create = sqlite.transaction(() => {
    const isActive = !sqlite.prepare("SELECT 1 FROM provider_profiles WHERE is_active = 1 LIMIT 1").get();
    sqlite.prepare(`
      INSERT INTO provider_profiles (
        id, name, provider_type, base_url, api_key_ciphertext,
        model_small, model_medium, model_large, temperature, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.providerType,
      baseUrl,
      apiKeyCiphertext,
      input.models.small,
      input.models.medium,
      input.models.large,
      input.temperature,
      isActive ? 1 : 0,
      now,
      now,
    );
  });
  create();
  const row = getProviderProfileRow(id);
  if (!row) return context.json({ error: "配置保存失败。" }, 500);
  return context.json({ profile: toProviderProfile(row) }, 201);
});

providerRoutes.put("/profiles/:id", async (context) => {
  const id = context.req.param("id");
  const current = getProviderProfileRow(id);
  if (!current) return profileNotFound(context);

  const body = profileInputSchema.safeParse(await context.req.json().catch(() => null));
  if (!body.success) return context.json({ error: "请检查配置名称、模型 ID、端点和温度范围。" }, 400);
  const input = body.data;
  if (input.providerType !== current.providerType) {
    return context.json({ error: "已保存配置不能切换服务类型；请新建对应类型的配置。" }, 409);
  }

  let baseUrl: string | null = null;
  if (input.providerType === "openai_compatible") {
    try {
      baseUrl = normalizeProviderBaseUrl(input.baseUrl);
    } catch {
      return context.json({ error: "端点需为 HTTPS；HTTP 仅允许本机回环地址，且不能包含凭据或查询参数。" }, 400);
    }
  }

  let apiKeyCiphertext = current.apiKeyCiphertext;
  if (input.clearApiKey) apiKeyCiphertext = null;
  else if (input.apiKey.trim()) apiKeyCiphertext = encryptSecret(input.apiKey.trim());
  if (input.providerType === "chatgpt_plan") apiKeyCiphertext = null;

  sqlite.prepare(`
    UPDATE provider_profiles
    SET name = ?, base_url = ?, api_key_ciphertext = ?, model_small = ?,
        model_medium = ?, model_large = ?, temperature = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name,
    baseUrl,
    apiKeyCiphertext,
    input.models.small,
    input.models.medium,
    input.models.large,
    input.temperature,
    Date.now(),
    id,
  );

  const updated = getProviderProfileRow(id);
  return context.json({ profile: updated ? toProviderProfile(updated) : null });
});

providerRoutes.post("/profiles/:id/activate", (context) => {
  const id = context.req.param("id");
  if (!getProviderProfileRow(id)) return profileNotFound(context);
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE provider_profiles SET is_active = 0").run();
    sqlite.prepare("UPDATE provider_profiles SET is_active = 1, updated_at = ? WHERE id = ?").run(Date.now(), id);
  })();
  return context.json({ profile: toProviderProfile(getProviderProfileRow(id)!) });
});

providerRoutes.delete("/profiles/:id", (context) => {
  const id = context.req.param("id");
  const current = getProviderProfileRow(id);
  if (!current) return profileNotFound(context);
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM provider_profiles WHERE id = ?").run(id);
    if (current.isActive === 1) {
      const next = sqlite.prepare("SELECT id FROM provider_profiles ORDER BY created_at, name LIMIT 1").get() as { id: string } | undefined;
      if (next) sqlite.prepare("UPDATE provider_profiles SET is_active = 1, updated_at = ? WHERE id = ?").run(Date.now(), next.id);
    }
  })();
  return context.json({ deleted: true });
});

providerRoutes.post("/models", async (context) => {
  const body = z.object({
    providerType: z.enum(["openai_compatible", "chatgpt_plan"]),
    profileId: z.string().uuid().optional(),
    baseUrl: z.string().trim().max(500).default(""),
    apiKey: z.string().max(2_000).default(""),
    clearApiKey: z.boolean().default(false),
  }).safeParse(await context.req.json().catch(() => null));
  if (!body.success) return context.json({ error: "请检查服务类型、端点和凭据。" }, 400);

  if (body.data.providerType === "chatgpt_plan") {
    if (!body.data.profileId) return context.json({ error: "请先登录并保存 ChatGPT 配置。" }, 400);
    const profile = getProviderProfileRow(body.data.profileId);
    if (!profile) return profileNotFound(context);
    if (profile.providerType !== "chatgpt_plan") {
      return context.json({ error: "当前配置不是 ChatGPT 账号。" }, 400);
    }
    const scopes = new Set((profile.chatgptScopes ?? "").split(/\s+/).filter(Boolean));
    if (!scopes.has("chatgpt.tokens.use.direct")) {
      return context.json({ error: "请先登录并授予 ChatGPT 计划额度权限，再拉取账户模型。" }, 403);
    }

    try {
      const accessToken = await getChatGPTAccessToken(profile.id);
      const models = await listChatGPTModels(accessToken);
      return context.json({ models, modelCount: models.length });
    } catch {
      return context.json({ error: "无法读取 ChatGPT 账户模型目录，请检查登录状态和本机网络。" }, 502);
    }
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeProviderBaseUrl(body.data.baseUrl);
  } catch {
    return context.json({ error: "端点需为 HTTPS；HTTP 仅允许本机回环地址，且不能包含凭据或查询参数。" }, 400);
  }

  let apiKey = body.data.apiKey.trim() || undefined;
  if (body.data.profileId) {
    const profile = getProviderProfileRow(body.data.profileId);
    if (!profile) return profileNotFound(context);
    if (profile.providerType !== "openai_compatible") {
      return context.json({ error: "当前配置不是 OpenAI 兼容中转。" }, 400);
    }
    if (!apiKey && !body.data.clearApiKey && profile.apiKeyCiphertext) {
      if (profile.baseUrl !== baseUrl) {
        return context.json({ error: "更换端点后，请重新填写 API Key 再拉取模型。" }, 400);
      }
      apiKey = decryptSecret(profile.apiKeyCiphertext);
    }
  }

  try {
    const models = await listOpenAICompatibleModels(baseUrl, apiKey);
    return context.json({ models, modelCount: models.length });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
    return context.json({
      error: typeof status === "number"
        ? `中转服务返回 HTTP ${status}。请检查 API Key 和端点权限。`
        : "无法读取中转站模型目录。请检查端点、本机网络和服务状态。",
    }, 502);
  }
});

providerRoutes.post("/profiles/:id/check", async (context) => {
  const id = context.req.param("id");
  const profile = getProviderProfileRow(id);
  if (!profile) return profileNotFound(context);
  if (profile.providerType !== "openai_compatible" || !profile.baseUrl) {
    return context.json({ error: "ChatGPT 账号授权已在页面单独显示；此项仅检查 OpenAI 兼容中转。" }, 400);
  }

  try {
    const apiKey = profile.apiKeyCiphertext ? decryptSecret(profile.apiKeyCiphertext) : undefined;
    const client = await createOpenAICompatibleClient(profile.baseUrl, apiKey);
    const result = await client.models.list();
    const configured = new Set([profile.modelSmall, profile.modelMedium, profile.modelLarge]);
    const availableCount = result.data.filter((model) => configured.has(model.id)).length;
    return context.json({
      ok: true,
      modelCount: result.data.length,
      configuredModelCount: availableCount,
      detail: `端点已响应，读取到 ${result.data.length} 个模型；其中 ${availableCount} 个与当前预设相符。`,
    });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
    return context.json({
      ok: false,
      error: typeof status === "number"
        ? `中转服务返回 HTTP ${status}。请检查 API Key 和端点权限。`
        : "无法连接中转服务。请检查端点、本机网络和服务状态。",
    }, 502);
  }
});

providerRoutes.post("/chatgpt/start", async (context) => {
  const body = z.object({ profileId: z.string().uuid() }).safeParse(
    await context.req.json().catch(() => null),
  );
  if (!body.success) return context.json({ error: "请选择有效的 ChatGPT 配置。" }, 400);
  try {
    const authorizeUrl = beginChatGPTAuthorization(
      body.data.profileId,
      context.req.header("origin"),
    );
    return context.json({ authorizeUrl });
  } catch {
    return context.json({ error: "无法为当前配置启动 ChatGPT 授权。" }, 400);
  }
});

providerRoutes.post("/profiles/:id/chatgpt/disconnect", (context) => {
  const id = context.req.param("id");
  const profile = getProviderProfileRow(id);
  if (!profile) return profileNotFound(context);
  if (profile.providerType !== "chatgpt_plan") {
    return context.json({ error: "当前配置不是 ChatGPT 账号。" }, 400);
  }
  sqlite.prepare(`
    UPDATE provider_profiles
    SET chatgpt_client_id = NULL, chatgpt_email = NULL, chatgpt_subject = NULL,
        chatgpt_scopes = NULL, chatgpt_id_token_ciphertext = NULL,
        chatgpt_access_token_ciphertext = NULL, chatgpt_refresh_token_ciphertext = NULL,
        chatgpt_expires_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(Date.now(), id);
  return context.json({ disconnected: true });
});

providerRoutes.get("/chatgpt/callback", async (context) => {
  const result = await completeChatGPTAuthorization(new URL(context.req.url));
  const redirect = chatGPTCallbackRedirect(result);
  if (redirect) return context.redirect(redirect, 302);
  return context.html(
    "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>授权未完成</title><body style=\"margin:0;background:#0b1020;color:#f1f4fa;font:16px system-ui;display:grid;min-height:100vh;place-items:center\"><main style=\"max-width:34rem;padding:2rem;border:1px solid #293850;border-radius:16px;background:#111a2b\"><h1>授权未完成</h1><p>请返回 Project Chronicle，重新发起 ChatGPT 登录。</p></main></body></html>",
    400,
  );
});
