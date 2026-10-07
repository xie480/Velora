import { z } from "zod";

const optionalSetting = z.string().trim().optional().transform((value) => value || undefined);
const booleanSetting = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() || undefined : value),
  z.enum(["true", "false"]).optional().default("false"),
).transform((value) => value === "true");

const providerSettingsSchema = z.object({
  OPENAI_BASE_URL: optionalSetting,
  OPENAI_API_KEY: optionalSetting,
  OPENAI_MODEL: optionalSetting,
  EMBEDDING_LOCAL_ENABLED: booleanSetting,
  EMBEDDING_LOCAL_MODEL_PATH: optionalSetting,
  EMBEDDING_BASE_URL: optionalSetting,
  EMBEDDING_API_KEY: optionalSetting,
  EMBEDDING_MODEL: optionalSetting,
});

export const providerSettingsResult = providerSettingsSchema.safeParse(process.env);
