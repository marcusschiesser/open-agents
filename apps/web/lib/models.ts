export const DEFAULT_MODEL_ID = "anthropic/claude-haiku-4.5";
export const APP_DEFAULT_MODEL_ID = "openai/gpt-5.4";
export const DEFAULT_CONTEXT_LIMIT = 200_000;
const TOKENS_PER_MILLION = 1_000_000;

export interface GatewayAvailableModel {
  id: string;
  name: string;
  description?: string | null;
  modelType?: string | null;
}

export interface AvailableModelCostTier {
  input?: number;
  output?: number;
  cache_read?: number;
}

export interface AvailableModelCost extends AvailableModelCostTier {
  context_over_200k?: AvailableModelCostTier;
}

export type AvailableModel = GatewayAvailableModel & {
  context_window?: number;
  cost?: AvailableModelCost;
};

export const STATIC_AVAILABLE_LANGUAGE_MODELS: AvailableModel[] = [
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    description: "Fast Anthropic model for lightweight agent tasks.",
    modelType: "language",
    context_window: 200_000,
  },
  {
    id: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
    description: "Balanced Anthropic model for general-purpose coding work.",
    modelType: "language",
    context_window: 200_000,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    description: "Latest Sonnet generation with adaptive thinking support.",
    modelType: "language",
    context_window: 200_000,
  },
  {
    id: "anthropic/claude-opus-4.6",
    name: "Claude Opus 4.6",
    description: "Highest-capability Anthropic model for complex coding tasks.",
    modelType: "language",
    context_window: 200_000,
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o mini",
    description: "Fast, lower-cost OpenAI model.",
    modelType: "language",
    context_window: 128_000,
  },
  {
    id: "openai/gpt-5",
    name: "GPT-5",
    description: "General GPT-5 reasoning model.",
    modelType: "language",
    context_window: 272_000,
  },
  {
    id: "openai/gpt-5-mini",
    name: "GPT-5 mini",
    description: "Smaller GPT-5 model for cheaper, faster runs.",
    modelType: "language",
    context_window: 272_000,
  },
  {
    id: "openai/gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    description: "Codex-oriented GPT-5.3 model for implementation tasks.",
    modelType: "language",
    context_window: 200_000,
  },
  {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    description: "Default OpenAI flagship model for the app.",
    modelType: "language",
    context_window: 272_000,
  },
];

export function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function isProviderConfigured(provider: string): boolean {
  if (provider === "openai") {
    return hasOpenAIKey();
  }

  if (provider === "anthropic") {
    return hasAnthropicKey();
  }

  return false;
}

export function getModelDisplayName(model: AvailableModel): string {
  return model.name ?? model.id;
}

export function getModelContextLimit(
  modelId: string,
  models: AvailableModel[],
): number | undefined {
  const directMatch = models.find((model) => model.id === modelId);
  if (
    typeof directMatch?.context_window !== "number" ||
    directMatch.context_window <= 0
  ) {
    return undefined;
  }

  return directMatch.context_window;
}

function resolveCostTier(
  usage: { inputTokens: number },
  cost: AvailableModelCost | undefined,
): AvailableModelCostTier | undefined {
  if (!cost) {
    return undefined;
  }

  if (
    usage.inputTokens > 200_000 &&
    (typeof cost.context_over_200k?.input === "number" ||
      typeof cost.context_over_200k?.output === "number")
  ) {
    return {
      input: cost.context_over_200k.input ?? cost.input,
      output: cost.context_over_200k.output ?? cost.output,
      cache_read: cost.context_over_200k.cache_read ?? cost.cache_read,
    };
  }

  return cost;
}

export function estimateModelUsageCost(
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  },
  cost: AvailableModelCost | undefined,
): number | undefined {
  const costTier = resolveCostTier(usage, cost);
  const inputPrice = costTier?.input;
  const outputPrice = costTier?.output;
  if (typeof inputPrice !== "number" || typeof outputPrice !== "number") {
    return undefined;
  }

  const cachedInputTokens = Math.max(0, usage.cachedInputTokens);
  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - cachedInputTokens,
  );
  const cacheReadPrice = costTier?.cache_read ?? inputPrice;

  return (
    (uncachedInputTokens * inputPrice) / TOKENS_PER_MILLION +
    (cachedInputTokens * cacheReadPrice) / TOKENS_PER_MILLION +
    (Math.max(0, usage.outputTokens) * outputPrice) / TOKENS_PER_MILLION
  );
}
