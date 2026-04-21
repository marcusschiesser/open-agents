import type { SandboxHooks } from "../interface";

export interface DaytonaSandboxConfig {
  name?: string;
  source?: {
    url: string;
    branch?: string;
    token?: string;
    newBranch?: string;
  };
  gitUser?: {
    name: string;
    email: string;
  };
  env?: Record<string, string>;
  timeout?: number;
  public?: boolean;
  hooks?: SandboxHooks;
}

export interface DaytonaSandboxConnectConfig {
  sandboxName?: string;
  sandboxId?: string;
  env?: Record<string, string>;
  hooks?: SandboxHooks;
  remainingTimeout?: number;
  resume?: boolean;
}
