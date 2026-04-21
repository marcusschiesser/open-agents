import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { createOpenAI, type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import {
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type JSONValue,
} from "ai";

function supportsAdaptiveAnthropicThinking(modelId: string): boolean {
  return modelId.includes("4.6") || modelId.includes("4.7");
}

// Models with adaptive thinking support use effort control.
// Older models use the legacy extended thinking API with a budget.
function getAnthropicSettings(modelId: string): AnthropicLanguageModelOptions {
  if (supportsAdaptiveAnthropicThinking(modelId)) {
    return {
      effort: "medium",
      thinking: { type: "adaptive" },
    } satisfies AnthropicLanguageModelOptions;
  }

  return {
    thinking: { type: "enabled", budgetTokens: 8000 },
  };
}

function isJsonObject(value: unknown): value is Record<string, JSONValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toProviderOptionsRecord(
  options: Record<string, unknown>,
): Record<string, JSONValue> {
  return options as Record<string, JSONValue>;
}

function mergeRecords(
  base: Record<string, JSONValue>,
  override: Record<string, JSONValue>,
): Record<string, JSONValue> {
  const merged: Record<string, JSONValue> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existingValue = merged[key];

    if (isJsonObject(existingValue) && isJsonObject(value)) {
      merged[key] = mergeRecords(existingValue, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

export type ProviderOptionsByProvider = Record<
  string,
  Record<string, JSONValue>
>;

export function mergeProviderOptions(
  defaults: ProviderOptionsByProvider,
  overrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  if (!overrides || Object.keys(overrides).length === 0) {
    return defaults;
  }

  const merged: ProviderOptionsByProvider = { ...defaults };

  for (const [provider, providerOverrides] of Object.entries(overrides)) {
    const providerDefaults = merged[provider];

    if (!providerDefaults) {
      merged[provider] = providerOverrides;
      continue;
    }

    merged[provider] = mergeRecords(providerDefaults, providerOverrides);
  }

  return merged;
}

export type SupportedModelProvider = "anthropic" | "openai";
export type GatewayModelId = `${SupportedModelProvider}/${string}`;

export interface GatewayOptions {
  providerOptionsOverrides?: ProviderOptionsByProvider;
}

export type LanguageModel = LanguageModelV3;
export type { JSONValue };

export function shouldApplyOpenAIReasoningDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5");
}

function shouldApplyOpenAITextVerbosityDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5.4");
}

export function getProviderOptionsForModel(
  modelId: string,
  providerOptionsOverrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  const defaultProviderOptions: ProviderOptionsByProvider = {};

  // Apply anthropic defaults
  if (modelId.startsWith("anthropic/")) {
    defaultProviderOptions.anthropic = toProviderOptionsRecord(
      getAnthropicSettings(modelId),
    );
  }

  // OpenAI model responses should never be persisted.
  if (modelId.startsWith("openai/")) {
    defaultProviderOptions.openai = toProviderOptionsRecord({
      store: false,
    } satisfies OpenAIResponsesProviderOptions);
  }

  // Apply OpenAI defaults for all GPT-5 variants to expose encrypted reasoning content.
  // This avoids Responses API failures when `store: false`, e.g.:
  // "Item with id 'rs_...' not found. Items are not persisted when `store` is set to false."
  if (shouldApplyOpenAIReasoningDefaults(modelId)) {
    defaultProviderOptions.openai = mergeRecords(
      defaultProviderOptions.openai ?? {},
      toProviderOptionsRecord({
        reasoningSummary: "detailed",
        include: ["reasoning.encrypted_content"],
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  if (shouldApplyOpenAITextVerbosityDefaults(modelId)) {
    defaultProviderOptions.openai = mergeRecords(
      defaultProviderOptions.openai ?? {},
      toProviderOptionsRecord({
        textVerbosity: "low",
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  const providerOptions = mergeProviderOptions(
    defaultProviderOptions,
    providerOptionsOverrides,
  );

  // Enforce OpenAI non-persistence even when custom provider overrides are present.
  if (modelId.startsWith("openai/")) {
    providerOptions.openai = mergeRecords(
      providerOptions.openai ?? {},
      toProviderOptionsRecord({
        store: false,
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  return providerOptions;
}

function parseModelId(modelId: GatewayModelId): {
  provider: SupportedModelProvider;
  providerModelId: string;
} {
  const separatorIndex = modelId.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    throw new Error(`Invalid model id "${modelId}". Expected "<provider>/<model>".`);
  }

  const provider = modelId.slice(0, separatorIndex);
  const providerModelId = modelId.slice(separatorIndex + 1);

  if (provider !== "anthropic" && provider !== "openai") {
    throw new Error(
      `Unsupported model provider "${provider}" for "${modelId}". Supported providers: anthropic, openai.`,
    );
  }

  return {
    provider,
    providerModelId,
  };
}

function getRequiredApiKey(envVarName: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY"): string {
  const apiKey = process.env[envVarName]?.trim();

  if (!apiKey) {
    throw new Error(
      `${envVarName} is required to use direct ${envVarName === "OPENAI_API_KEY" ? "OpenAI" : "Anthropic"} models.`,
    );
  }

  return apiKey;
}

const openAIProviderCache = new Map<string, ReturnType<typeof createOpenAI>>();
const anthropicProviderCache = new Map<string, ReturnType<typeof createAnthropic>>();

function getOpenAIProvider(apiKey: string) {
  const cachedProvider = openAIProviderCache.get(apiKey);
  if (cachedProvider) {
    return cachedProvider;
  }

  const provider = createOpenAI({ apiKey });
  openAIProviderCache.set(apiKey, provider);
  return provider;
}

function getAnthropicProvider(apiKey: string) {
  const cachedProvider = anthropicProviderCache.get(apiKey);
  if (cachedProvider) {
    return cachedProvider;
  }

  const provider = createAnthropic({ apiKey });
  anthropicProviderCache.set(apiKey, provider);
  return provider;
}

function createBaseLanguageModel(modelId: GatewayModelId): LanguageModel {
  const { provider, providerModelId } = parseModelId(modelId);

  switch (provider) {
    case "anthropic":
      return getAnthropicProvider(getRequiredApiKey("ANTHROPIC_API_KEY"))(
        providerModelId,
      );
    case "openai":
      return getOpenAIProvider(getRequiredApiKey("OPENAI_API_KEY"))(
        providerModelId,
      );
  }
}

export function gateway(
  modelId: GatewayModelId,
  options: GatewayOptions = {},
): LanguageModel {
  const { providerOptionsOverrides } = options;

  let model: LanguageModel = createBaseLanguageModel(modelId);

  const providerOptions = getProviderOptionsForModel(
    modelId,
    providerOptionsOverrides,
  );

  if (Object.keys(providerOptions).length > 0) {
    model = wrapLanguageModel({
      model,
      middleware: defaultSettingsMiddleware({
        settings: { providerOptions },
      }),
    });
  }

  return model;
}
