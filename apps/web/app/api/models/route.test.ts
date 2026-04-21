import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const requestedUrls: string[] = [];

let modelsDevApiData: unknown = {};
let currentSession: {
  authProvider?: "vercel" | "github";
  user: { id: string; email?: string; username?: string; avatar?: string };
} | null = null;

const originalFetch = globalThis.fetch;
const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

mock.module("server-only", () => ({}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

const routeModulePromise = import("./route");

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.OPENAI_API_KEY = originalOpenAIKey;
  process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
});

describe("/api/models", () => {
  beforeEach(() => {
    requestedUrls.length = 0;
    modelsDevApiData = {};
    currentSession = null;
    process.env.OPENAI_API_KEY = "openai-test-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";

    globalThis.fetch = mock((input: RequestInfo | URL, _init?: RequestInit) => {
      requestedUrls.push(getRequestUrl(input));
      return Promise.resolve(
        new Response(JSON.stringify(modelsDevApiData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  test("enriches the static catalog with models.dev metadata", async () => {
    modelsDevApiData = {
      openai: {
        models: {
          "gpt-5.3-codex": {
            limit: { context: 400_000 },
          },
        },
      },
      anthropic: {
        models: {
          "claude-opus-4.6": {
            limit: { context: 1_000_000 },
          },
        },
      },
    };

    const { GET } = await routeModulePromise;
    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      models: Array<{ id: string; context_window?: number }>;
    };
    const contextById = new Map(
      body.models.map((model) => [model.id, model.context_window]),
    );

    expect(contextById.get("openai/gpt-5.3-codex")).toBe(400_000);
    expect(contextById.get("anthropic/claude-opus-4.6")).toBe(1_000_000);
    expect(contextById.get("openai/gpt-4o-mini")).toBe(128_000);
    expect(requestedUrls).toContain("https://models.dev/api.json");
  });

  test("shows only configured providers", async () => {
    delete process.env.OPENAI_API_KEY;

    const { GET } = await routeModulePromise;
    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      models: Array<{ id: string }>;
    };

    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models.every((model) => model.id.startsWith("anthropic/"))).toBe(
      true,
    );
  });

  test("returns no models when neither provider key is set", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const { GET } = await routeModulePromise;
    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      models: Array<{ id: string }>;
    };

    expect(body.models).toEqual([]);
  });

  test("hides Claude Opus models for managed trial users", async () => {
    currentSession = {
      authProvider: "vercel",
      user: { id: "user-1", email: "person@example.com" },
    };

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("https://open-agents.dev/api/models"),
    );
    const body = (await response.json()) as {
      models: Array<{ id: string }>;
    };

    expect(body.models.some((model) => model.id === "anthropic/claude-opus-4.6")).toBe(
      false,
    );
    expect(body.models.some((model) => model.id === "anthropic/claude-haiku-4.5")).toBe(
      true,
    );
  });

  test("keeps valid models.dev metadata when sibling fields are invalid", async () => {
    modelsDevApiData = {
      invalidProvider: "bad",
      openai: {
        models: {
          "gpt-5.3-codex": {
            limit: { context: "400_000" },
            cost: {
              input: 1.25,
              output: 10,
              context_over_200k: {
                input: 2.5,
              },
            },
          },
          broken: {
            limit: { context: "not-a-number" },
            cost: { input: "expensive" },
          },
        },
      },
    };

    const { GET } = await routeModulePromise;
    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      models: Array<{
        id: string;
        context_window?: number;
        cost?: {
          input?: number;
          output?: number;
          context_over_200k?: {
            input?: number;
          };
        };
      }>;
    };

    expect(body.models.find((model) => model.id === "openai/gpt-5.3-codex")).toMatchObject(
      {
        id: "openai/gpt-5.3-codex",
        context_window: 200_000,
        cost: {
          input: 1.25,
          output: 10,
          context_over_200k: {
            input: 2.5,
          },
        },
      },
    );
  });
});
