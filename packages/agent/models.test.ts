import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ProviderOptionsByProvider } from "./models";

const openAIInvocations: Array<{
  apiKey: string;
  modelId: string;
  baseURL?: string;
}> = [];
const anthropicInvocations: Array<{ apiKey: string; modelId: string }> = [];
const openRouterInvocations: Array<{
  apiKey: string;
  modelId: string;
  baseURL?: string;
}> = [];

mock.module("@ai-sdk/openai", () => ({
  createOpenAI: ({ apiKey, baseURL }: { apiKey: string; baseURL?: string }) => {
    const createModel = (modelId: string) => {
      if (baseURL === "https://openrouter.ai/api/v1") {
        openRouterInvocations.push({ apiKey, modelId, baseURL });
        return { provider: "openrouter", modelId };
      }
      openAIInvocations.push({ apiKey, modelId });
      return { provider: "openai", modelId };
    };
    return Object.assign(createModel, { chat: createModel });
  },
}));

mock.module("@ai-sdk/anthropic", () => ({
  createAnthropic:
    ({ apiKey }: { apiKey: string }) =>
    (modelId: string) => {
      anthropicInvocations.push({ apiKey, modelId });
      return { provider: "anthropic", modelId };
    },
}));

mock.module("ai", () => ({
  defaultSettingsMiddleware: (_settings: unknown) => ({
    kind: "default-settings-middleware",
  }),
  wrapLanguageModel: ({ model }: { model: unknown }) => model,
}));

const {
  gateway,
  getProviderOptionsForModel,
  mergeProviderOptions,
  shouldApplyOpenAIReasoningDefaults,
} = await import("./models");

const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

describe("shouldApplyOpenAIReasoningDefaults", () => {
  test("returns true for existing GPT-5 variants", () => {
    expect(shouldApplyOpenAIReasoningDefaults("openai/gpt-5.3")).toBe(true);
    expect(shouldApplyOpenAIReasoningDefaults("openai/gpt-5.4")).toBe(true);
  });

  test("returns true for future GPT-5 variants", () => {
    expect(shouldApplyOpenAIReasoningDefaults("openai/gpt-5.9")).toBe(true);
  });

  test("returns false for non-GPT-5 OpenAI models", () => {
    expect(shouldApplyOpenAIReasoningDefaults("openai/gpt-4o")).toBe(false);
  });
});

describe("getProviderOptionsForModel", () => {
  test("applies adaptive thinking defaults to Anthropic 4.6 models", () => {
    const result = getProviderOptionsForModel("anthropic/claude-sonnet-4.6");

    expect(result).toEqual({
      anthropic: {
        effort: "medium",
        thinking: { type: "adaptive" },
      },
    });
  });

  test("applies adaptive thinking defaults to Anthropic 4.7 models", () => {
    const result = getProviderOptionsForModel("anthropic/claude-opus-4.7");

    expect(result).toEqual({
      anthropic: {
        effort: "medium",
        thinking: { type: "adaptive" },
      },
    });
  });

  test("preserves legacy thinking defaults for older Anthropic models", () => {
    const result = getProviderOptionsForModel("anthropic/claude-opus-4.5");

    expect(result).toEqual({
      anthropic: {
        thinking: {
          type: "enabled",
          budgetTokens: 8000,
        },
      },
    });
  });

  test("merges OpenAI defaults with custom variant options", () => {
    const result = getProviderOptionsForModel("openai/gpt-5", {
      openai: {
        reasoningEffort: "medium",
      },
    });

    expect(result).toEqual({
      openai: {
        reasoningSummary: "detailed",
        include: ["reasoning.encrypted_content"],
        reasoningEffort: "medium",
        store: false,
      },
    });
  });

  test("applies low text verbosity defaults to GPT-5.4 snapshots", () => {
    const result = getProviderOptionsForModel("openai/gpt-5.4-2026-03-05");

    expect(result).toEqual({
      openai: {
        reasoningSummary: "detailed",
        include: ["reasoning.encrypted_content"],
        store: false,
        textVerbosity: "low",
      },
    });
  });

  test("preserves low text verbosity when GPT-5.4 overrides reasoning settings", () => {
    const result = getProviderOptionsForModel("openai/gpt-5.4", {
      openai: {
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
      },
    });

    expect(result).toEqual({
      openai: {
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
        store: false,
        textVerbosity: "low",
      },
    });
  });

  test("enforces store false for OpenAI models even when variant overrides it", () => {
    const result = getProviderOptionsForModel("openai/gpt-5", {
      openai: {
        store: true,
      },
    });

    expect(result).toEqual({
      openai: {
        reasoningSummary: "detailed",
        include: ["reasoning.encrypted_content"],
        store: false,
      },
    });
  });

  test("applies store false to non-GPT-5 OpenAI models", () => {
    const result = getProviderOptionsForModel("openai/gpt-4o");

    expect(result).toEqual({
      openai: {
        store: false,
      },
    });
  });
});

describe("mergeProviderOptions", () => {
  test("returns defaults when overrides are undefined", () => {
    const defaults: ProviderOptionsByProvider = {
      openai: {
        reasoningEffort: "high",
      },
    };

    expect(mergeProviderOptions(defaults)).toEqual(defaults);
  });

  test("deep merges nested provider options", () => {
    const defaults: ProviderOptionsByProvider = {
      anthropic: {
        thinking: {
          type: "enabled",
          budgetTokens: 8000,
        },
      },
    };

    const overrides: ProviderOptionsByProvider = {
      anthropic: {
        thinking: {
          budgetTokens: 4000,
        },
      },
    };

    expect(mergeProviderOptions(defaults, overrides)).toEqual({
      anthropic: {
        thinking: {
          type: "enabled",
          budgetTokens: 4000,
        },
      },
    });
  });

  test("adds provider overrides that do not exist in defaults", () => {
    const defaults: ProviderOptionsByProvider = {
      openai: {
        store: false,
      },
    };

    const overrides: ProviderOptionsByProvider = {
      anthropic: {
        effort: "low",
      },
    };

    expect(mergeProviderOptions(defaults, overrides)).toEqual({
      openai: {
        store: false,
      },
      anthropic: {
        effort: "low",
      },
    });
  });

  test("replaces arrays instead of deep-merging arrays", () => {
    const defaults: ProviderOptionsByProvider = {
      openai: {
        include: ["reasoning.encrypted_content"],
      },
    };

    const overrides: ProviderOptionsByProvider = {
      openai: {
        include: ["reasoning.summary"],
      },
    };

    expect(mergeProviderOptions(defaults, overrides)).toEqual({
      openai: {
        include: ["reasoning.summary"],
      },
    });
  });
});

describe("gateway", () => {
  beforeEach(() => {
    openAIInvocations.length = 0;
    anthropicInvocations.length = 0;
    openRouterInvocations.length = 0;
    process.env.OPENAI_API_KEY = "openai-test-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  });

  test("creates an OpenAI model via the provider factory", () => {
    const model = gateway("openai/gpt-5.4");

    expect(model as unknown).toEqual({
      provider: "openai",
      modelId: "gpt-5.4",
    });
    expect(openAIInvocations).toEqual([
      {
        apiKey: "openai-test-key",
        modelId: "gpt-5.4",
      },
    ]);
  });

  test("creates an Anthropic model via the provider factory", () => {
    const model = gateway("anthropic/claude-haiku-4.5");

    expect(model as unknown).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-4.5",
    });
    expect(anthropicInvocations).toEqual([
      {
        apiKey: "anthropic-test-key",
        modelId: "claude-haiku-4.5",
      },
    ]);
  });

  test("fails fast when the OpenAI key is missing", () => {
    delete process.env.OPENAI_API_KEY;

    expect(() => gateway("openai/gpt-5.4")).toThrow(
      "OPENAI_API_KEY is required to use direct OpenAI models.",
    );
  });

  test("fails fast when the Anthropic key is missing", () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => gateway("anthropic/claude-haiku-4.5")).toThrow(
      "ANTHROPIC_API_KEY is required to use direct Anthropic models.",
    );
  });

  test("creates an OpenRouter model via the provider factory", () => {
    const model = gateway("openrouter/z-ai/glm-5.1");

    expect(model as unknown).toEqual({
      provider: "openrouter",
      modelId: "z-ai/glm-5.1",
    });
    expect(openRouterInvocations).toEqual([
      {
        apiKey: "openrouter-test-key",
        modelId: "z-ai/glm-5.1",
        baseURL: "https://openrouter.ai/api/v1",
      },
    ]);
  });

  test("fails fast when the OpenRouter key is missing", () => {
    delete process.env.OPENROUTER_API_KEY;

    expect(() => gateway("openrouter/moonshotai/kimi-k2.6")).toThrow(
      "OPENROUTER_API_KEY is required to use direct OpenRouter models.",
    );
  });

  test("fails for unsupported providers", () => {
    expect(() =>
      gateway("google/gemini-2.5-pro" as Parameters<typeof gateway>[0]),
    ).toThrow('Unsupported model provider "google"');
  });
});
