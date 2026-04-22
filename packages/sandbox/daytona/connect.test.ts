import { beforeEach, describe, expect, mock, test } from "bun:test";

const connectCalls: Array<{
  sandboxName: string;
  options: Record<string, unknown> | undefined;
}> = [];
const createCalls: Array<Record<string, unknown>> = [];

let connectError: Error | null = null;

mock.module("./sandbox", () => ({
  DaytonaSandbox: {
    connect: async (sandboxName: string, options?: Record<string, unknown>) => {
      connectCalls.push({ sandboxName, options });
      if (connectError) {
        throw connectError;
      }

      return {
        id: sandboxName,
        getState: () => ({
          type: "daytona" as const,
          sandboxName,
          expiresAt: Date.now() + 60_000,
        }),
      };
    },
    create: async (config: Record<string, unknown>) => {
      createCalls.push(config);
      return {
        id: String(config.name ?? "created"),
        getState: () => ({
          type: "daytona" as const,
          sandboxName: String(config.name ?? "created"),
          expiresAt: Date.now() + 60_000,
        }),
      };
    },
  },
}));

const { connectDaytona } = await import("./connect");

describe("connectDaytona", () => {
  beforeEach(() => {
    connectCalls.length = 0;
    createCalls.length = 0;
    connectError = null;
  });

  test("creates a fresh named sandbox when resume is false and the name is missing", async () => {
    connectError = new Error("Sandbox with ID or name session_123 not found");

    await connectDaytona(
      {
        sandboxName: "session_123",
      },
      {
        createIfMissing: true,
        resume: false,
        persistent: true,
      },
    );

    expect(connectCalls).toHaveLength(1);
    expect(createCalls).toEqual([
      expect.objectContaining({
        name: "session_123",
        public: true,
      }),
    ]);
  });

  test("does not recreate a missing resumed sandbox without source", async () => {
    connectError = new Error("Sandbox with ID or name session_123 not found");

    await expect(
      connectDaytona(
        {
          sandboxName: "session_123",
        },
        {
          createIfMissing: true,
          resume: true,
          persistent: true,
        },
      ),
    ).rejects.toThrow("not found");

    expect(createCalls).toHaveLength(0);
  });
});
