import {
  APP_DEFAULT_MODEL_ID,
  DEFAULT_MODEL_ID,
  isProviderConfigured,
} from "@/lib/models";

const DISABLED_MODEL_IDS = new Set(["openai/gpt-5.4-pro"]);

export function isModelDisabled(modelId: string): boolean {
  return DISABLED_MODEL_IDS.has(modelId);
}

export function filterDisabledModels<T extends { id: string }>(
  models: T[],
): T[] {
  return models.filter((model) => !isModelDisabled(model.id));
}

export function resolveAvailableModelId(modelId: string): string {
  const provider = modelId.split("/", 1)[0];

  if (!provider || isModelDisabled(modelId) || !isProviderConfigured(provider)) {
    return getConfiguredDefaultModelId();
  }

  return modelId;
}

export function getConfiguredDefaultModelId(): string {
  if (!isModelDisabled(APP_DEFAULT_MODEL_ID) && isProviderConfigured("openai")) {
    return APP_DEFAULT_MODEL_ID;
  }

  if (isProviderConfigured("anthropic")) {
    return DEFAULT_MODEL_ID;
  }

  return APP_DEFAULT_MODEL_ID;
}
