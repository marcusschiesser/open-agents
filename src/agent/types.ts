import { z } from "zod";
import type { Sandbox } from "./sandbox";

export const todoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoItemSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z.string().describe("The task description"),
  status: todoStatusSchema.describe(
    "Current status. Only ONE task should be in_progress at a time."
  ),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

export const scratchpadEntrySchema = z.object({
  path: z.string(),
  content: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  size: z.number(),
});
export type ScratchpadEntry = z.infer<typeof scratchpadEntrySchema>;

export const memoryEntrySchema = z.object({
  id: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  createdAt: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

export interface AgentState {
  todos: TodoItem[];
  scratchpad: Map<string, ScratchpadEntry>;
  workingDirectory: string;
}

export interface MemoryStore {
  entries: MemoryEntry[];
}

export interface AgentContext {
  sandbox: Sandbox;
}

export const EVICTION_THRESHOLD_BYTES = 80 * 1024;
