/**
 * Server-only model bridge for a single Workflow outline, entity, or review request.
 * Credentials stay in the existing local vault; this bridge never approves content or expands an outline.
 */
import { getActiveProviderProfileRow } from "./providerProfiles.js";
import { decryptSecret } from "./secretVault.js";
import { getChatGPTAccessToken } from "./chatgptOAuth.js";
import { normalizeProviderBaseUrl } from "./openAICompatible.js";
import type { ProviderModels } from "../../shared/providers.js";

const generationTimeoutMs = 120_000;
const maxOutputCharacters = 2_000_000;
const officialResponsesBaseUrl = "https://api.openai.com/v1";

/** Only safe, actionable messages cross the API boundary; provider error bodies may contain secrets. */
export class WorkflowAIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowAIError";
  }
}

function parseGeneratedJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > maxOutputCharacters) {
    throw new WorkflowAIError("AI 返回内容为空或超过大小限制，请缩小生成范围后重试。");
  }
  // A single JSON fence is accepted; prose before or after it remains invalid JSON.
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  try {
    return JSON.parse(fenced ? fenced[1] : trimmed) as unknown;
  } catch {
    throw new WorkflowAIError("AI 未返回有效 JSON，原有内容已保留，请重试或手动编辑。");
  }
}

/**
 * Perform exactly one model request using the currently activated local preset.
 * Domain schemas validate the returned JSON separately, before any content is written.
 */
export async function requestStructuredWorkflowOutput(
  prompt: string,
  signal?: AbortSignal,
  modelTier: keyof ProviderModels = "medium",
): Promise<unknown> {
  const profile = getActiveProviderProfileRow();
  if (!profile) throw new WorkflowAIError("请先在模型与 API 设置中保存并激活一个模型预设。");
  const model = { small: profile.modelSmall, medium: profile.modelMedium, large: profile.modelLarge }[modelTier];
  const timeoutSignal = AbortSignal.timeout(generationTimeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  try {
    requestSignal.throwIfAborted();
    const { default: OpenAI } = await import("openai");
    const apiKey = profile.providerType === "chatgpt_plan"
      ? await getChatGPTAccessToken(profile.id)
      : profile.apiKeyCiphertext ? decryptSecret(profile.apiKeyCiphertext) : "local-provider";
    const baseURL = profile.providerType === "chatgpt_plan"
      ? officialResponsesBaseUrl
      : normalizeProviderBaseUrl(profile.baseUrl ?? "");
    const client = new OpenAI({
      apiKey,
      baseURL,
      timeout: generationTimeoutMs,
      maxRetries: 0,
      // Keep the caller's cancellation and the whole-request deadline while forbidding credential redirects.
      fetch: (request, init) => fetch(request, {
        ...init,
        redirect: "error",
        signal: init?.signal ? AbortSignal.any([init.signal, requestSignal]) : requestSignal,
      }),
    });

    if (profile.providerType === "chatgpt_plan") {
      // SIWC requires streaming with store:false, and success only after response.completed.
      const stream = await client.responses.create({
        model,
        input: [{ role: "user", content: prompt }],
        store: false,
        stream: true,
      }, { signal: requestSignal });
      let text = "";
      let completed = false;
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") text += event.delta;
        if (text.length > maxOutputCharacters) throw new WorkflowAIError("AI 返回内容超过大小限制，请缩小生成范围后重试。");
        if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
          throw new WorkflowAIError("ChatGPT 生成未完成，请检查账户额度、模型权限或重新登录后重试。");
        }
        if (event.type === "response.completed") completed = true;
      }
      if (!completed) throw new WorkflowAIError("ChatGPT 响应中断，未写入不完整内容，请重试。");
      requestSignal.throwIfAborted();
      return parseGeneratedJson(text);
    }

    const result = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: profile.temperature,
      stream: false,
    }, { signal: requestSignal });
    const choice = result.choices[0];
    if (!choice || choice.finish_reason !== "stop" || choice.message.refusal) {
      throw new WorkflowAIError("AI 生成未完整结束，原有内容已保留，请检查模型或缩小范围后重试。");
    }
    requestSignal.throwIfAborted();
    return parseGeneratedJson(choice.message.content ?? "");
  } catch (error) {
    if (error instanceof WorkflowAIError) throw error;
    if (signal?.aborted) throw new WorkflowAIError("生成已取消，原有内容已保留。");
    if (timeoutSignal.aborted) throw new WorkflowAIError("AI 生成超时，原有内容已保留，请重试或缩小生成范围。");
    const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
    if (typeof status === "number") {
      throw new WorkflowAIError(`模型服务返回 HTTP ${status}，请检查模型权限、额度和 API 配置。`);
    }
    throw new WorkflowAIError("无法完成 AI 生成，请检查本机网络、模型配置或 ChatGPT 登录状态。");
  }
}
