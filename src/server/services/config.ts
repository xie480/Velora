import { z } from "zod";

const apiPortValue = process.env.API_PORT?.trim() || "4310";
const parsedApiPort = Number(apiPortValue);

if (!Number.isInteger(parsedApiPort) || parsedApiPort < 1 || parsedApiPort > 65_535) {
  throw new Error("API_PORT must be an integer between 1 and 65535.");
}

export const localApiPort = parsedApiPort;

const optionalSetting = z.string().trim().optional().transform((value) => value || undefined);
const booleanSetting = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() || undefined : value),
  z.enum(["true", "false"]).optional().default("false"),
).transform((value) => value === "true");

const providerSettingsSchema = z.object({
  EMBEDDING_LOCAL_ENABLED: booleanSetting,
  EMBEDDING_LOCAL_MODEL_PATH: optionalSetting,
  EMBEDDING_BASE_URL: optionalSetting,
  EMBEDDING_API_KEY: optionalSetting,
  EMBEDDING_MODEL: optionalSetting,
});

export const providerSettingsResult = providerSettingsSchema.safeParse(process.env);
