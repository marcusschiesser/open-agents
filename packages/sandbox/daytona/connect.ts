import type { Sandbox, SandboxHooks } from "../interface";
import type { DaytonaSandboxConfig } from "./config";
import { DaytonaSandbox } from "./sandbox";
import type { DaytonaState } from "./state";

interface ConnectOptions {
  env?: Record<string, string>;
  githubToken?: string;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
  timeout?: number;
  ports?: number[];
  baseSnapshotId?: string;
  resume?: boolean;
  createIfMissing?: boolean;
  persistent?: boolean;
  snapshotExpiration?: number;
  skipGitWorkspaceBootstrap?: boolean;
}

function getSandboxName(state: DaytonaState): string | undefined {
  if (typeof state.sandboxName === "string" && state.sandboxName.length > 0) {
    return state.sandboxName;
  }

  if (typeof state.sandboxId === "string" && state.sandboxId.length > 0) {
    return state.sandboxId;
  }

  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isSandboxNotFoundError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes("not found") || message.includes("404");
}

function buildCreateConfig(
  state: DaytonaState,
  options?: ConnectOptions,
): DaytonaSandboxConfig {
  const sandboxName = getSandboxName(state);

  return {
    ...(sandboxName ? { name: sandboxName } : {}),
    ...(state.source
      ? {
          source: {
            url: state.source.repo,
            branch: state.source.branch,
            token: state.source.token ?? options?.githubToken,
            newBranch: state.source.newBranch,
          },
        }
      : {}),
    env: options?.env,
    gitUser: options?.gitUser,
    hooks: options?.hooks,
    ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
    public: true,
  };
}

function canRecreateSandboxFromState(state: DaytonaState): boolean {
  return state.source !== undefined;
}

async function connectNamedSandbox(
  state: DaytonaState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  const sandboxName = getSandboxName(state);
  if (!sandboxName) {
    throw new Error("Persistent sandbox name is required");
  }

  try {
    return await DaytonaSandbox.connect(sandboxName, {
      env: options?.env,
      hooks: options?.hooks,
      remainingTimeout: state.expiresAt
        ? Math.max(state.expiresAt - Date.now(), 0)
        : undefined,
      resume: options?.resume,
    });
  } catch (error) {
    if (!options?.createIfMissing || !isSandboxNotFoundError(error)) {
      throw error;
    }

    if (!canRecreateSandboxFromState(state)) {
      throw error;
    }
  }

  return DaytonaSandbox.create(buildCreateConfig(state, options));
}

export async function connectDaytona(
  state: DaytonaState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  const sandboxName = getSandboxName(state);

  if (sandboxName) {
    return connectNamedSandbox(state, options);
  }

  return DaytonaSandbox.create(buildCreateConfig(state, options));
}
