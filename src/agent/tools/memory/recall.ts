import { tool } from "ai";
import { z } from "zod";
import { searchMemory, getRecentMemories } from "../../state/memory-store";
import { getSandbox } from "../../utils";

export const memoryRecallTool = tool({
  description: `Retrieve information from long-term memory for the current workspace/project.

WHEN TO USE:
- At the start of a session to recall prior decisions, conventions, or preferences
- Before implementing a feature to check for relevant past patterns or solutions
- When you suspect a similar problem has been solved previously
- To recall user-specific preferences or project-specific conventions

USAGE:
- You can search by free-text query, filter by tags, or fetch recent entries:
  - Provide query to search memory content text
  - Provide tags to filter by tags (matches if ANY tag matches)
  - Provide neither query nor tags to retrieve the most recent memories
- Use limit to bound the number of results (default: 10)

IMPORTANT:
- Memories are scoped to the current working directory/project
- If no entries match the query/tags, the tool returns a success message with an empty memories list
- Use this tool proactively when starting new tasks in a familiar project

EXAMPLES:
- Recall previous auth decisions: query: "authentication", tags: ["auth"], limit: 5
- Fetch the most recent memories: (no query, no tags, optional limit: 10)`,
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Text to search for in memory content"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Filter by tags (matches if any tag matches)"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of results. Default: 10"),
  }),
  execute: async ({ query, tags, limit = 10 }, { experimental_context }) => {
    try {
      const sandbox = getSandbox(experimental_context);
      const workingDirectory = sandbox.workingDirectory;

      let entries;

      if (query || (tags && tags.length > 0)) {
        entries = await searchMemory(workingDirectory, query ?? "", tags);
        entries = entries.slice(0, limit);
      } else {
        entries = await getRecentMemories(workingDirectory, limit);
      }

      if (entries.length === 0) {
        return {
          success: true,
          message: "No memories found matching the criteria",
          memories: [],
        };
      }

      return {
        success: true,
        count: entries.length,
        memories: entries.map((e) => ({
          id: e.id,
          content: e.content,
          tags: e.tags,
          createdAt: new Date(e.createdAt).toISOString(),
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to recall memory: ${message}`,
      };
    }
  },
});
