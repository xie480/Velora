import { performance } from "node:perf_hooks";
import { basename } from "node:path";
import { sql } from "drizzle-orm";
import type { DiagnosticItem, DiagnosticReport } from "../../shared/diagnostics.js";
import { appMeta } from "../db/schema.js";
import { providerSettingsResult } from "./config.js";
import { embedLocalText } from "./localEmbedding.js";

function runLocalCheck(
  id: string,
  label: string,
  check: () => string,
): DiagnosticItem {
  const startedAt = performance.now();
  try {
    const detail = check();
    return {
      id,
      label,
      group: "local",
      state: "connected",
      detail,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      id,
      label,
      group: "local",
      state: "failed",
      detail: "检查失败，请查看本机 API 终端日志。",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

function notConfigured(id: string, label: string, detail: string): DiagnosticItem {
  return { id, label, group: "ai", state: "not_configured", detail };
}

function failedProviderCheck(
  id: string,
  label: string,
  error: unknown,
  startedAt: number,
): DiagnosticItem {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const detail =
    typeof status === "number"
      ? `服务返回 HTTP ${status}。请检查服务端点、密钥和模型权限。`
      : "连接失败。请检查服务端点、本机网络和服务端日志。";

  return {
    id,
    label,
    group: "ai",
    state: "failed",
    detail,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

async function checkOpenAICompatible(): Promise<DiagnosticItem> {
  let profile;
  try {
    const { getActiveProviderProfileRow } = await import("./providerProfiles.js");
    profile = getActiveProviderProfileRow();
  } catch {
    return {
      id: "openai-relay",
      label: "OpenAI 兼容服务",
      group: "ai",
      state: "failed",
      detail: "SQLite 未能打开，无法读取本机 API 配置。",
    };
  }
  if (!profile || profile.providerType !== "openai_compatible" || !profile.baseUrl) {
    return notConfigured(
      "openai-relay",
      "OpenAI 兼容服务",
      "当前未激活 OpenAI 兼容中转配置；请在模型与 API 设置中添加并切换预设。",
    );
  }

  const startedAt = performance.now();
  try {
    const [{ decryptSecret }, { createOpenAICompatibleClient }] = await Promise.all([
      import("./secretVault.js"),
      import("./openAICompatible.js"),
    ]);
    const apiKey = profile.apiKeyCiphertext ? decryptSecret(profile.apiKeyCiphertext) : undefined;
    const client = await createOpenAICompatibleClient(profile.baseUrl, apiKey);
    const result = await client.models.list();
    const configured = new Set([profile.modelSmall, profile.modelMedium, profile.modelLarge]);
    const availableCount = result.data.filter((model) => configured.has(model.id)).length;
    return {
      id: "openai-relay",
      label: "OpenAI 兼容服务",
      group: "ai",
      state: "connected",
      detail: `“${profile.name}”端点可访问，返回 ${result.data.length} 个模型；${availableCount} 个与预设相符。`,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return failedProviderCheck("openai-relay", "OpenAI 兼容服务", error, startedAt);
  }
}

async function checkEmbeddingProvider(): Promise<DiagnosticItem> {
  if (!providerSettingsResult.success) {
    return {
      id: "embedding",
      label: "Embedding 服务",
      group: "ai",
      state: "failed",
      detail: "环境变量格式无效，请检查服务端配置。",
    };
  }

  const settings = providerSettingsResult.data;
  if (settings.EMBEDDING_LOCAL_ENABLED) {
    const startedAt = performance.now();
    try {
      const vector = await embedLocalText("Project Chronicle local embedding connectivity check.");
      return {
        id: "embedding",
        label: "本地 Embedding 模型",
        group: "ai",
        state: "connected",
        detail: `BGE 本地模型已加载并完成推理 · ${vector.length} 维 · ONNX q8 / CPU。`,
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch {
      return {
        id: "embedding",
        label: "本地 Embedding 模型",
        group: "ai",
        state: "failed",
        detail: "本地模型加载或推理失败；请检查 EMBEDDING_LOCAL_MODEL_PATH 与量化 ONNX 文件。",
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
  }

  if (!settings.EMBEDDING_BASE_URL || !settings.EMBEDDING_MODEL) {
    return notConfigured(
      "embedding",
      "Embedding 服务",
      "需要配置 EMBEDDING_BASE_URL 与 EMBEDDING_MODEL。检查时会发送一条固定短文本。",
    );
  }

  const startedAt = performance.now();
  try {
    const { createOpenAICompatibleClient } = await import("./openAICompatible.js");
    const client = await createOpenAICompatibleClient(settings.EMBEDDING_BASE_URL, settings.EMBEDDING_API_KEY);
    const result = await client.embeddings.create({
      model: settings.EMBEDDING_MODEL,
      input: "Project Chronicle local embedding connectivity check.",
    });
    if (!result.data[0]?.embedding.length) throw new Error("Embedding service returned no vector");
    return {
      id: "embedding",
      label: "Embedding 服务",
      group: "ai",
      state: "connected",
      detail: `已返回 ${result.data[0].embedding.length} 维向量；本机可用 USearch 建立 HNSW 索引。`,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return failedProviderCheck("embedding", "Embedding 服务", error, startedAt);
  }
}

async function checkChatGPTPlanProvider(): Promise<DiagnosticItem> {
  let profile;
  try {
    const { listProviderProfiles } = await import("./providerProfiles.js");
    profile = listProviderProfiles().find(
    (candidate) => candidate.providerType === "chatgpt_plan" && candidate.isActive,
    );
  } catch {
    return notConfigured("siwc", "ChatGPT 计划额度", "SQLite 未能打开，无法读取本机 ChatGPT 授权配置。");
  }
  if (!profile) {
    return notConfigured("siwc", "ChatGPT 计划额度", "当前未激活 ChatGPT 账号预设。可在模型与 API 设置中创建并登录。");
  }
  if (profile.chatgpt.planUsageAuthorized) {
    return {
      id: "siwc",
      label: "ChatGPT 计划额度",
      group: "ai",
      state: "connected",
      detail: `“${profile.name}”已授予 Responses API 计划额度权限；授权令牌保存在本机 SQLite。`,
    };
  }
  if (profile.chatgpt.signedIn) {
    return notConfigured("siwc", "ChatGPT 计划额度", "账号已登录，但未授予 chatgpt.tokens.use.direct scope。");
  }
  return notConfigured("siwc", "ChatGPT 计划额度", "此配置尚未完成 ChatGPT 账号授权；计划额度要求授权返回 chatgpt.tokens.use.direct scope，并使用符合资格的账户。");
}

async function checkUsearch(): Promise<DiagnosticItem> {
  const startedAt = performance.now();
  try {
    const loaded = (await import("usearch")) as unknown as {
      Index?: new (options: {
        metric: string;
        dimensions: number;
        connectivity: number;
      }) => {
        add: (key: bigint, vector: Float32Array) => void;
        search: (vector: Float32Array, count: number) => { keys: BigUint64Array };
        size: () => number;
      };
      default?: {
        Index?: new (options: {
          metric: string;
          dimensions: number;
          connectivity: number;
        }) => {
          add: (key: bigint, vector: Float32Array) => void;
          search: (vector: Float32Array, count: number) => { keys: BigUint64Array };
          size: () => number;
        };
      };
    };
    const Index = loaded.Index ?? loaded.default?.Index;
    if (!Index) throw new Error("USearch Index export unavailable");

    const index = new Index({ metric: "l2sq", dimensions: 3, connectivity: 16 });
    const probe = new Float32Array([0.25, 0.5, 0.75]);
    index.add(1n, probe);
    const matches = index.search(probe, 1);
    if (index.size() !== 1 || matches.keys[0] !== 1n) {
      throw new Error("USearch in-memory index probe did not match");
    }
    return {
      id: "usearch",
      label: "USearch HNSW",
      group: "local",
      state: "connected",
      detail: "已完成内存索引写入和最近邻查询；索引文件可从 SQLite 向量源数据重建。",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      id: "usearch",
      label: "USearch HNSW",
      group: "local",
      state: "failed",
      detail: "索引初始化或查询失败；请确认当前 Node.js 与系统架构有可用的 USearch 原生模块。",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

export async function getDiagnosticReport(): Promise<DiagnosticReport> {
  let databaseRuntime: typeof import("../db/index.js") | undefined;
  try {
    databaseRuntime = await import("../db/index.js");
  } catch {
    // Keep the diagnostic endpoint available when a native SQLite dependency cannot load.
  }

  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  const nodeSupported = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12);
  const runtime: DiagnosticItem = {
    id: "node",
    label: "Node.js 运行时",
    group: "local",
    state: nodeSupported ? "connected" : "failed",
    detail: `当前版本 ${process.version} · ${process.platform}/${process.arch}；项目要求 Node.js 22.12 或更新版本。`,
  };

  const localChecks: DiagnosticItem[] = [
    runtime,
    {
      id: "hono-api",
      label: "Hono 本机 API",
      group: "local",
      state: "connected",
      detail: "诊断请求已到达本机 API；服务仅绑定回环地址。",
    },
    databaseRuntime
      ? runLocalCheck("sqlite", "SQLite + better-sqlite3", () => {
          const result = databaseRuntime!.sqlite.pragma("quick_check", { simple: true });
          if (result !== "ok") throw new Error("SQLite quick_check did not return ok");
          const version = (databaseRuntime!.sqlite.prepare("SELECT sqlite_version() AS version").get() as
            | { version?: string }
            | undefined)?.version;
          return `数据库检查通过 · ${basename(databaseRuntime!.databaseFile)} · SQLite ${version ?? "未知版本"}`;
        })
      : {
          id: "sqlite",
          label: "SQLite + better-sqlite3",
          group: "local",
          state: "failed",
          detail: "数据库驱动未能初始化；请查看本机 API 终端日志。",
        },
    databaseRuntime
      ? runLocalCheck("drizzle", "Drizzle ORM", () => {
          const result = databaseRuntime!.db
            .select({ value: sql<number>`count(*)` })
            .from(appMeta)
            .get();
          if (typeof result?.value !== "number") throw new Error("Drizzle select failed");
          return "已通过 Drizzle 查询当前 SQLite 数据库。";
        })
      : {
          id: "drizzle",
          label: "Drizzle ORM",
          group: "local",
          state: "failed",
          detail: "ORM 未能连接 SQLite；请先检查数据库驱动状态。",
        },
    {
      id: "zod",
      label: "Zod 配置校验",
      group: "local",
      state: providerSettingsResult.success ? "connected" : "failed",
      detail: providerSettingsResult.success
        ? "服务端已加载本地 Embedding 配置 Schema。"
        : "Embedding 环境配置不符合 Schema，请检查服务端环境变量。",
    },
  ];

  const [usearch, openai, embedding, chatgpt] = await Promise.all([
    checkUsearch(),
    checkOpenAICompatible(),
    checkEmbeddingProvider(),
    checkChatGPTPlanProvider(),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    items: [...localChecks, usearch, openai, embedding, chatgpt],
  };
}
