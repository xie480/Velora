export type ProviderType = "openai_compatible" | "chatgpt_plan";

export interface ProviderModels {
  small: string;
  medium: string;
  large: string;
}

export interface ProviderModelCatalogEntry {
  id: string;
  name: string;
}

export interface ProviderProfile {
  id: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string | null;
  models: ProviderModels;
  temperature: number;
  isActive: boolean;
  hasApiKey: boolean;
  chatgpt: {
    signedIn: boolean;
    planUsageAuthorized: boolean;
    email: string | null;
    expiresAt: string | null;
  };
}

export interface ProviderProfileDraft {
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  clearApiKey: boolean;
  models: ProviderModels;
  temperature: number;
}
