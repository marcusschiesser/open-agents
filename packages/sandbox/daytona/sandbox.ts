import { Daytona } from "@daytona/sdk";
import type { FileInfo } from "@daytona/toolbox-api-client";
import type { Dirent } from "fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxStats,
  SnapshotResult,
} from "../interface";
import type { SandboxStatus } from "../types";
import type {
  DaytonaSandboxConfig,
  DaytonaSandboxConnectConfig,
} from "./config";
import type { DaytonaState } from "./state";

const MAX_OUTPUT_LENGTH = 50_000;
const DEFAULT_RECONNECT_TIMEOUT_MS = 300_000;
const DETACHED_QUICK_FAILURE_WINDOW_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 60 * 1000;

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildAuthenticatedGitHubUrl(
  repoUrl: string,
  token: string,
): string | null {
  const githubUrlMatch = repoUrl.match(
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/,
  );

  if (!githubUrlMatch) {
    return null;
  }

  const [, owner, repo] = githubUrlMatch;
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

function toSeconds(timeoutMs: number): number {
  return Math.max(1, Math.ceil(timeoutMs / 1000));
}

function toMinutes(timeoutMs: number): number {
  return Math.max(1, Math.ceil(timeoutMs / 60_000));
}

function toExpiresAt(timeoutMs: number | undefined): number | undefined {
  return timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
}

function getCommandEnv(
  sandboxEnv: Record<string, string> | undefined,
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!sandboxEnv && !env) {
    return undefined;
  }

  return {
    ...(sandboxEnv ?? {}),
    ...(env ?? {}),
  };
}

function mapFileInfoToDirent(parentPath: string, file: FileInfo): Dirent {
  return {
    name: file.name,
    parentPath,
    path: parentPath,
    isDirectory: () => file.isDir,
    isFile: () => !file.isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as Dirent;
}

function mapFileInfoToStats(file: FileInfo): SandboxStats {
  return {
    isDirectory: () => file.isDir,
    isFile: () => !file.isDir,
    size: file.size,
    mtimeMs: new Date(file.modTime).getTime(),
  };
}

function getSandboxStatusValue(state: unknown): string | undefined {
  return typeof state === "string" ? state : undefined;
}

async function resolveWorkingDirectory(
  sandbox: Awaited<ReturnType<Daytona["create"]>>,
): Promise<string> {
  const userHomeDir = await sandbox.getUserHomeDir();
  const workDir = await sandbox.getWorkDir();
  const baseDir = workDir ?? userHomeDir ?? "/home/daytona";
  return path.posix.join(baseDir, "open-harness");
}

export class DaytonaSandbox implements Sandbox {
  readonly type = "cloud" as const;
  readonly name: string;
  readonly id: string;
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;
  readonly currentBranch?: string;
  readonly hooks?: SandboxHooks;
  readonly environmentDetails =
    `- Sandbox VMs are temporary, but named sandboxes can be hibernated and later resumed from their persisted filesystem state
- All bash commands already run in the working directory by default — never prepend \`cd <working-directory> &&\`; just run the command directly
- Do NOT prefix any bash command with a \`cd\` to the working directory — commands like \`cd <working-directory> && npm test\` are WRONG; just use \`npm test\`
- Use workspace-relative paths for read/write/search/edit operations
- Git is already configured (user, email, remote auth) - no setup or verification needed
- Dependencies may not be installed. Before running project scripts (build, typecheck, lint, test), check if \`node_modules\` exists and run the package manager install command if needed (e.g. \`bun install\`, \`npm install\`)
- Preview URLs may not be available immediately for Daytona-backed sandboxes; prefer verifying dev servers from inside the sandbox when routing is unavailable`;

  private readonly sandbox: Awaited<ReturnType<Daytona["create"]>>;
  private readonly _timeout?: number;
  private readonly previewUrls = new Map<number, string>();
  private isStopped = false;
  private isArchived = false;
  private _expiresAt?: number;

  get expiresAt(): number | undefined {
    return this._expiresAt;
  }

  get timeout(): number | undefined {
    return this._timeout;
  }

  private constructor(params: {
    sandbox: Awaited<ReturnType<Daytona["create"]>>;
    workingDirectory: string;
    env?: Record<string, string>;
    currentBranch?: string;
    hooks?: SandboxHooks;
    timeout?: number;
    expiresAt?: number;
  }) {
    this.sandbox = params.sandbox;
    this.name = params.sandbox.name;
    this.id = params.sandbox.id;
    this.workingDirectory = params.workingDirectory;
    this.env = params.env;
    this.currentBranch = params.currentBranch;
    this.hooks = params.hooks;
    this._timeout = params.timeout;
    this._expiresAt = params.expiresAt;
  }

  static async create(config: DaytonaSandboxConfig): Promise<DaytonaSandbox> {
    const client = new Daytona();
    const timeoutMs = config.timeout;
    const sandbox = await client.create(
      {
        ...(config.name ? { name: config.name } : {}),
        envVars: config.env,
        public: config.public ?? true,
        ...(timeoutMs !== undefined
          ? { autoStopInterval: toMinutes(timeoutMs) }
          : {}),
      },
      timeoutMs !== undefined ? { timeout: toSeconds(timeoutMs) } : undefined,
    );

    const workingDirectory = await resolveWorkingDirectory(sandbox);
    await sandbox.fs.createFolder(workingDirectory, "755");

    if (config.source) {
      const cloneUrl = config.source.token
        ? (buildAuthenticatedGitHubUrl(config.source.url, config.source.token) ??
          config.source.url)
        : config.source.url;
      const cloneCommand = [
        "git clone",
        config.source.branch
          ? `--branch ${shellEscape(config.source.branch)}`
          : "",
        shellEscape(cloneUrl),
        ".",
      ]
        .filter(Boolean)
        .join(" ");

      const cloneResult = await sandbox.process.executeCommand(
        cloneCommand,
        workingDirectory,
        config.env,
        timeoutMs !== undefined ? toSeconds(timeoutMs) : undefined,
      );

      if (cloneResult.exitCode !== 0) {
        throw new Error(
          `Failed to clone repository '${config.source.url}' (exit code ${cloneResult.exitCode})`,
        );
      }
    } else {
      await sandbox.process.executeCommand(
        "git init",
        workingDirectory,
        config.env,
        timeoutMs !== undefined ? toSeconds(timeoutMs) : undefined,
      );
    }

    if (config.source?.token) {
      const authenticatedUrl = buildAuthenticatedGitHubUrl(
        config.source.url,
        config.source.token,
      );

      if (authenticatedUrl) {
        await sandbox.process.executeCommand(
          `git remote set-url origin ${shellEscape(authenticatedUrl)}`,
          workingDirectory,
          config.env,
          timeoutMs !== undefined ? toSeconds(timeoutMs) : undefined,
        );
      }
    }

    if (config.gitUser && (config.source || !config.source)) {
      await sandbox.process.executeCommand(
        `git config user.name ${shellEscape(config.gitUser.name)}`,
        workingDirectory,
        config.env,
        timeoutMs !== undefined ? toSeconds(timeoutMs) : undefined,
      );
      await sandbox.process.executeCommand(
        `git config user.email ${shellEscape(config.gitUser.email)}`,
        workingDirectory,
        config.env,
        timeoutMs !== undefined ? toSeconds(timeoutMs) : undefined,
      );
    }

    if (!config.source && config.gitUser) {
      await sandbox.process.executeCommand(
        "git commit --allow-empty -m 'Initial commit'",
        workingDirectory,
        config.env,
        timeoutMs !== undefined ? toSeconds(timeoutMs) : undefined,
      );
    }

    let currentBranch: string | undefined;
    if (config.source?.newBranch) {
      const checkoutResult = await sandbox.process.executeCommand(
        `git checkout -b ${shellEscape(config.source.newBranch)}`,
        workingDirectory,
        config.env,
        timeoutMs !== undefined ? toSeconds(timeoutMs) : undefined,
      );

      if (checkoutResult.exitCode !== 0) {
        throw new Error(
          `Failed to create branch '${config.source.newBranch}' (exit code ${checkoutResult.exitCode})`,
        );
      }

      currentBranch = config.source.newBranch;
    } else if (config.source?.branch) {
      currentBranch = config.source.branch;
    }

    const daytonaSandbox = new DaytonaSandbox({
      sandbox,
      workingDirectory,
      env: config.env,
      currentBranch,
      hooks: config.hooks,
      timeout: timeoutMs,
      expiresAt: toExpiresAt(timeoutMs),
    });

    if (config.hooks?.afterStart) {
      await config.hooks.afterStart(daytonaSandbox);
    }

    return daytonaSandbox;
  }

  static async connect(
    sandboxNameOrId: string,
    options: DaytonaSandboxConnectConfig = {},
  ): Promise<DaytonaSandbox> {
    const client = new Daytona();
    const sandbox = await client.get(sandboxNameOrId);
    const state = getSandboxStatusValue(sandbox.state);

    if (state === "error" && sandbox.recoverable) {
      await sandbox.recover();
    } else if (
      options.resume !== false &&
      (state === "stopped" || state === "archived")
    ) {
      await sandbox.start(
        options.remainingTimeout !== undefined
          ? toSeconds(options.remainingTimeout)
          : undefined,
      );
    }

    const workingDirectory = await resolveWorkingDirectory(sandbox);
    const daytonaSandbox = new DaytonaSandbox({
      sandbox,
      workingDirectory,
      env: options.env,
      hooks: options.hooks,
      timeout:
        options.remainingTimeout !== undefined
          ? options.remainingTimeout
          : DEFAULT_RECONNECT_TIMEOUT_MS,
      expiresAt:
        options.remainingTimeout !== undefined
          ? Date.now() + options.remainingTimeout
          : Date.now() + DEFAULT_RECONNECT_TIMEOUT_MS,
    });

    if (options.hooks?.afterStart) {
      await options.hooks.afterStart(daytonaSandbox);
    }

    return daytonaSandbox;
  }

  async readFile(pathname: string, _encoding: "utf-8"): Promise<string> {
    const content = await this.sandbox.fs.downloadFile(pathname);
    return content.toString("utf-8");
  }

  async writeFile(
    pathname: string,
    content: string,
    _encoding: "utf-8",
  ): Promise<void> {
    const parentDir = pathname.substring(0, pathname.lastIndexOf("/"));
    if (parentDir) {
      await this.mkdir(parentDir, { recursive: true });
    }

    await this.sandbox.fs.uploadFiles([
      { source: Buffer.from(content, "utf-8"), destination: pathname },
    ]);
  }

  async stat(pathname: string): Promise<SandboxStats> {
    const file = await this.sandbox.fs.getFileDetails(pathname);
    return mapFileInfoToStats(file);
  }

  async access(pathname: string): Promise<void> {
    await this.sandbox.fs.getFileDetails(pathname);
  }

  async getPreviewUrl(port: number): Promise<string> {
    const cachedUrl = this.previewUrls.get(port);
    if (cachedUrl) {
      return cachedUrl;
    }

    const previewLink = await this.sandbox.getPreviewLink(port);
    const previewUrl = previewLink.url;
    this.previewUrls.set(port, previewUrl);
    return previewUrl;
  }

  async mkdir(pathname: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      await this.exec(
        `mkdir -p ${shellEscape(pathname)}`,
        this.workingDirectory,
        30_000,
      );
      return;
    }

    await this.sandbox.fs.createFolder(pathname, "755");
  }

  async readdir(
    pathname: string,
    _options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    const files = await this.sandbox.fs.listFiles(pathname);
    return files.map((file) => mapFileInfoToDirent(pathname, file));
  }

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal },
  ): Promise<ExecResult> {
    const execution = this.sandbox.process.executeCommand(
      command,
      cwd,
      getCommandEnv(this.env, undefined),
      toSeconds(timeoutMs),
    );

    if (options?.signal) {
      if (options.signal.aborted) {
        throw options.signal.reason;
      }

      const abortPromise = new Promise<never>((_, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
          { once: true },
        );
      });

      try {
        const result = await Promise.race([execution, abortPromise]);
        const stdout = result.result.slice(0, MAX_OUTPUT_LENGTH);
        return {
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          stdout,
          stderr: "",
          truncated: result.result.length > MAX_OUTPUT_LENGTH,
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        throw error;
      }
    }

    try {
      const result = await execution;
      const stdout = result.result.slice(0, MAX_OUTPUT_LENGTH);
      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout,
        stderr: "",
        truncated: result.result.length > MAX_OUTPUT_LENGTH,
      };
    } catch (error) {
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        truncated: false,
      };
    }
  }

  async execDetached(
    command: string,
    cwd: string,
  ): Promise<{ commandId: string }> {
    const outputChunks: string[] = [];
    const ptyHandle = await this.sandbox.process.createPty({
      id: randomUUID(),
      cwd,
      envs: this.env,
      onData(data) {
        outputChunks.push(new TextDecoder().decode(data));
      },
    });

    await ptyHandle.waitForConnection();

    await ptyHandle.sendInput(`${command}\n`);
    await ptyHandle.sendInput("disown -a >/dev/null 2>&1 || true\n");
    await ptyHandle.sendInput("exit\n");

    const quickProbe = await Promise.race([
      ptyHandle.wait().then((result) => ({ kind: "finished", result }) as const),
      new Promise<{ kind: "timeout" }>((resolve) => {
        setTimeout(() => resolve({ kind: "timeout" }), DETACHED_QUICK_FAILURE_WINDOW_MS);
      }),
    ]);

    if (quickProbe.kind === "timeout") {
      return { commandId: ptyHandle.sessionId };
    }

    if ((quickProbe.result.exitCode ?? 1) !== 0) {
      throw new Error(
        `Background command exited with code ${quickProbe.result.exitCode ?? 1}. output:\n${outputChunks.join("").trim() || "<no output>"}`,
      );
    }

    return { commandId: ptyHandle.sessionId };
  }

  async pause(): Promise<void> {
    if (this.isArchived) {
      return;
    }

    await this.stop();
    await this.sandbox.archive();
    this.isArchived = true;
  }

  async stop(): Promise<void> {
    if (this.isStopped) {
      return;
    }

    this.isStopped = true;
    this._expiresAt = undefined;

    if (this.hooks?.beforeStop) {
      try {
        await this.hooks.beforeStop(this);
      } catch (error) {
        console.error(
          "[DaytonaSandbox] beforeStop hook failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    await this.sandbox.stop();
  }

  async extendTimeout(additionalMs: number): Promise<{ expiresAt: number }> {
    const remainingMs =
      this._expiresAt !== undefined
        ? Math.max(this._expiresAt - Date.now(), 0)
        : DEFAULT_RECONNECT_TIMEOUT_MS;
    const nextTimeoutMs = remainingMs + additionalMs;

    await this.sandbox.setAutostopInterval(toMinutes(nextTimeoutMs));
    await this.sandbox.refreshActivity();

    this._expiresAt = Date.now() + nextTimeoutMs;

    if (this.hooks?.onTimeoutExtended) {
      await this.hooks.onTimeoutExtended(this, additionalMs);
    }

    return { expiresAt: this._expiresAt };
  }

  async snapshot(): Promise<SnapshotResult> {
    const snapshotName = `open-harness-${this.name}-${Date.now()}`;
    await this.sandbox._experimental_createSnapshot(snapshotName);
    return { snapshotId: snapshotName };
  }

  get status(): SandboxStatus {
    if (this.isStopped) {
      return "stopped";
    }

    return "ready";
  }

  getState(): { type: "daytona" } & DaytonaState {
    return {
      type: "daytona",
      sandboxName: this.name,
      sandboxId: this.id,
      ...(this._expiresAt !== undefined ? { expiresAt: this._expiresAt } : {}),
    };
  }
}

export async function connectDaytonaSandbox(
  config: DaytonaSandboxConfig | DaytonaSandboxConnectConfig,
): Promise<DaytonaSandbox> {
  const isConnectConfig =
    "sandboxName" in config || "sandboxId" in config || "resume" in config;

  if (isConnectConfig) {
    const connectConfig = config as DaytonaSandboxConnectConfig;
    const sandboxNameOrId = connectConfig.sandboxName ?? connectConfig.sandboxId;
    if (!sandboxNameOrId) {
      throw new Error("sandboxName or sandboxId is required");
    }
    return DaytonaSandbox.connect(sandboxNameOrId, connectConfig);
  }

  return DaytonaSandbox.create(config as DaytonaSandboxConfig);
}
