import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { providerSettingsResult } from "./config.js";

const expectedQueryInstruction = "为这个句子生成表示以用于检索相关文章：";
const expectedModelFile = join("onnx", "model_quantized.onnx");

type EmbeddingTensor = {
  data: ArrayLike<number>;
  dims: number[];
  dispose: () => void;
};

type LocalFeatureExtractor = (
  text: string,
  options: { pooling: "cls"; normalize: true },
) => Promise<EmbeddingTensor>;

export type LocalEmbeddingPurpose = "query" | "document";

let extractorPromise: Promise<LocalFeatureExtractor> | undefined;
let inferenceQueue: Promise<void> = Promise.resolve();

function getLocalSettings() {
  if (!providerSettingsResult.success) {
    throw new Error("Embedding environment configuration is invalid.");
  }
  if (!providerSettingsResult.data.EMBEDDING_LOCAL_ENABLED) {
    throw new Error("Local embedding is disabled.");
  }

  const modelPath = providerSettingsResult.data.EMBEDDING_LOCAL_MODEL_PATH;
  if (!modelPath) {
    throw new Error("EMBEDDING_LOCAL_MODEL_PATH is required when local embedding is enabled.");
  }
  return resolve(modelPath);
}

function loadLocalFeatureExtractor(): Promise<LocalFeatureExtractor> {
  if (extractorPromise) return extractorPromise;

  extractorPromise = (async () => {
    const modelPath = getLocalSettings();
    if (!existsSync(join(modelPath, expectedModelFile))) {
      throw new Error(`Quantized ONNX model not found at ${join(modelPath, expectedModelFile)}.`);
    }

    const { env, pipeline } = await import("@huggingface/transformers");
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = dirname(modelPath);

    const extractor = await pipeline("feature-extraction", basename(modelPath), {
      device: "cpu",
      dtype: "q8",
      local_files_only: true,
      session_options: {
        executionMode: "sequential",
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
      },
    });
    return extractor as unknown as LocalFeatureExtractor;
  })();

  return extractorPromise;
}

/** Start loading once during API startup; the retained pipeline keeps the ONNX session resident. */
export function preloadLocalEmbeddingModel(): void {
  if (!providerSettingsResult.success || !providerSettingsResult.data.EMBEDDING_LOCAL_ENABLED) return;

  void loadLocalFeatureExtractor().catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error(`Local Embedding model failed to preload: ${reason}`);
  });
}

export async function embedLocalText(
  input: string,
  purpose: LocalEmbeddingPurpose = "document",
): Promise<Float32Array> {
  const text = input.trim();
  if (!text) throw new Error("Embedding input must not be empty.");

  const inference = inferenceQueue.then(async () => {
    const extractor = await loadLocalFeatureExtractor();
    const preparedText = purpose === "query" ? `${expectedQueryInstruction}${text}` : text;
    const output = await extractor(preparedText, { pooling: "cls", normalize: true });
    try {
      const dimensions = output.dims.at(-1) ?? 0;
      if (dimensions <= 0 || output.data.length !== dimensions) {
        throw new Error("Local Embedding model returned an invalid vector shape.");
      }

      const vector = Float32Array.from(output.data);
      if (vector.some((value) => !Number.isFinite(value))) {
        throw new Error("Local Embedding model returned non-finite vector values.");
      }
      return vector;
    } finally {
      output.dispose();
    }
  });

  inferenceQueue = inference.then(() => undefined, () => undefined);
  return inference;
}
