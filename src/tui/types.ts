import type {
  DynamicToolUIPart,
  InferAgentUIMessage,
  InferUITools,
  ToolUIPart,
} from "ai";
import type { tuiAgent } from "./config";

export type TUIAgent = typeof tuiAgent;
export type TUIAgentCallOptions = Parameters<
  TUIAgent["generate"]
>["0"]["options"];

// all derived
export type TUIAgentUIMessage = InferAgentUIMessage<TUIAgent>;
export type TUIAgentUIMessagePart = TUIAgentUIMessage["parts"][number];
export type TUIAgentTools = TUIAgent["tools"];
export type TUIAgentUITools = InferUITools<TUIAgentTools>;
export type TUIAgentUIToolPart =
  | DynamicToolUIPart
  | ToolUIPart<TUIAgentUITools>;

/* --- */
export type AutoAcceptMode = "off" | "edits" | "all";

export type TUIOptions = {
  /** Initial prompt to run (for one-shot mode) */
  initialPrompt?: string;
  /** Working directory for the agent */
  workingDirectory?: string;
  /** Custom agent options (defaults provided if not specified) */
  agentOptions?: TUIAgentCallOptions;
  /** Header configuration */
  header?: {
    name?: string;
    version?: string;
    model?: string;
  };
};
