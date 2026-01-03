import { tool } from "ai";
import { z } from "zod";
import { addMemoryEntry } from "../../state/memory-store";
import { getSandbox } from "../../utils";

export const memorySaveTool = tool({
  description: `Save information to long-term memory for recall in future conversations (per workspace/project).

WHEN TO USE:
- Important facts discovered during research (APIs, invariants, gotchas)
- User preferences or project conventions (coding style, tools, commands)
- Key design or implementation decisions made in the conversation
- Patterns or solutions that are likely to be reused later in the same project

WHEN NOT TO USE:
- Ephemeral details that are only relevant to the current small task
- Sensitive information such as secrets, credentials, or private data
- Information that is already well-documented in the codebase or docs

USAGE:
- Provide content that is concise but complete enough to be useful later
- Add descriptive tags to make retrieval easier (e.g., ["auth", "login", "api-pattern"])
- Optionally include structured metadata (e.g., { source: "user", ticket: "JIRA-123" })

IMPORTANT:
- Memories are scoped to the current working directory/project
- Include context about when and why this is useful (e.g., "Preferred auth error format for this API")
- Use consistent tagging schemes across saves to make recall more reliable

EXAMPLES:
- Save a discovered convention: content: "All API errors use shape { code, message, details? }.", tags: ["api", "errors", "convention"]
- Save a user preference: content: "User prefers functional React components with hooks.", tags: ["frontend", "react", "preference"]`,
  inputSchema: z.object({
    content: z.string().describe("The information to remember"),
    tags: z
      .array(z.string())
      .describe("Tags for categorization and retrieval (e.g., ['auth', 'security', 'pattern'])"),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional structured metadata"),
  }),
  execute: async ({ content, tags, metadata }, { experimental_context }) => {
    try {
      const sandbox = getSandbox(experimental_context);
      const workingDirectory = sandbox.workingDirectory;

      const entry = await addMemoryEntry(workingDirectory, {
        content,
        tags,
        metadata,
      });

      return {
        success: true,
        id: entry.id,
        message: `Saved to memory with tags: ${tags.join(", ")}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to save memory: ${message}`,
      };
    }
  },
});
