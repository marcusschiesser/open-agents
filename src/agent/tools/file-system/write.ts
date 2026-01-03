import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import { isPathWithinDirectory, getSandbox } from "../../utils";

const writeInputSchema = z.object({
  filePath: z.string().describe("Absolute path to the file to write"),
  content: z.string().describe("Content to write to the file"),
});

const editInputSchema = z.object({
  filePath: z.string().describe("Absolute path to the file to edit"),
  oldString: z.string().describe("The exact text to replace"),
  newString: z
    .string()
    .describe("The text to replace it with (must differ from oldString)"),
  replaceAll: z
    .boolean()
    .optional()
    .describe("Replace all occurrences. Default: false"),
});

type WriteInput = z.infer<typeof writeInputSchema>;
type EditInput = z.infer<typeof editInputSchema>;

type WriteApprovalFn = (args: WriteInput) => boolean | Promise<boolean>;
type EditApprovalFn = (args: EditInput) => boolean | Promise<boolean>;

interface WriteToolOptions {
  needsApproval?: boolean | WriteApprovalFn;
}

interface EditToolOptions {
  needsApproval?: boolean | EditApprovalFn;
}

export const writeFileTool = (options?: WriteToolOptions) => tool({
  needsApproval: options?.needsApproval ?? true,
  description: `Write content to a file on the filesystem.

WHEN TO USE:
- Creating a new file that does not yet exist
- Completely replacing the contents of an existing file after you've read it
- Generating code or configuration as part of an implementation task

WHEN NOT TO USE:
- Small or localized changes to an existing file (prefer editFileTool instead)
- Reading files (use readFileTool instead)
- Searching (use grepTool or globTool instead)

USAGE:
- The path must be an absolute path within the workspace
- This will OVERWRITE existing files entirely
- Parent directories are created automatically if they do not exist

IMPORTANT:
- ALWAYS read an existing file with readFileTool before overwriting it
- Prefer editing existing files over creating new ones unless a new file is explicitly needed
- NEVER proactively create documentation files (e.g., *.md) unless the user explicitly requests them
- Do not write files that contain secrets or credentials (API keys, passwords, .env, etc.)
- Access is restricted to paths inside the working directory; paths outside will be rejected

EXAMPLES:
- Create a new test file: filePath: "/Users/username/project/src/user.test.ts", content: "<full file contents>"
- Replace a script after reading it: filePath: "/Users/username/project/scripts/build.sh", content: "<entire updated script>"`,
  inputSchema: writeInputSchema,
  execute: async ({ filePath, content }, { experimental_context }) => {
    const sandbox = getSandbox(experimental_context);
    const workingDirectory = sandbox.workingDirectory;

    try {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workingDirectory, filePath);

      // Security check: ensure path is within working directory
      if (!isPathWithinDirectory(absolutePath, workingDirectory)) {
        return {
          success: false,
          error: `Access denied: path "${absolutePath}" is outside the working directory "${workingDirectory}"`,
        };
      }

      const dir = path.dirname(absolutePath);
      await sandbox.mkdir(dir, { recursive: true });
      await sandbox.writeFile(absolutePath, content, "utf-8");

      const stats = await sandbox.stat(absolutePath);

      return {
        success: true,
        path: absolutePath,
        bytesWritten: stats.size,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to write file: ${message}`,
      };
    }
  },
});

export const editFileTool = (options?: EditToolOptions) => tool({
  needsApproval: options?.needsApproval ?? true,
  description: `Perform exact string replacement in a file.

WHEN TO USE:
- Making small, precise edits to an existing file you have already read
- Renaming a variable or identifier consistently within a single file
- Changing a specific block of code or configuration exactly as seen in the read output

WHEN NOT TO USE:
- Creating new files (use writeFileTool instead)
- Large structural rewrites where it's simpler to rewrite the entire file (use writeFileTool)
- Multi-file refactors (use grepTool + multiple edits, or taskTool for larger jobs)

USAGE:
- You must read the file first with readFileTool in this conversation
- Provide oldString as the EXACT text to replace, including whitespace and indentation
- By default, oldString must be UNIQUE in the file; otherwise the edit will fail
- Use replaceAll: true to change ALL occurrences of oldString in the file (e.g., for a rename)

IMPORTANT:
- Preserve exact indentation and spacing from the file's content as returned by readFileTool
- Never include line numbers or the "N: " line prefixes from the read output in oldString or newString
- If oldString appears multiple times and replaceAll is false, the tool will FAIL with an error and occurrence count
- Access is restricted to paths inside the working directory; paths outside will be rejected

EXAMPLES:
- Replace a single function call: filePath: "/Users/username/project/src/auth.ts", oldString: "login(user, password)", newString: "loginWithAudit(user, password)"
- Rename a variable throughout a file: filePath: "/Users/username/project/src/api.ts", oldString: "oldApiClient", newString: "newApiClient", replaceAll: true`,
  inputSchema: editInputSchema,
  execute: async ({ filePath, oldString, newString, replaceAll = false }, { experimental_context }) => {
    const sandbox = getSandbox(experimental_context);
    const workingDirectory = sandbox.workingDirectory;

    try {
      if (oldString === newString) {
        return {
          success: false,
          error: "oldString and newString must be different",
        };
      }

      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workingDirectory, filePath);

      // Security check: ensure path is within working directory
      if (!isPathWithinDirectory(absolutePath, workingDirectory)) {
        return {
          success: false,
          error: `Access denied: path "${absolutePath}" is outside the working directory "${workingDirectory}"`,
        };
      }

      const content = await sandbox.readFile(absolutePath, "utf-8");

      if (!content.includes(oldString)) {
        return {
          success: false,
          error: "oldString not found in file",
          hint: "Make sure to match exact whitespace and indentation",
        };
      }

      const occurrences = content.split(oldString).length - 1;
      if (occurrences > 1 && !replaceAll) {
        return {
          success: false,
          error: `oldString found ${occurrences} times. Use replaceAll=true or provide more context to make it unique.`,
        };
      }

      const newContent = replaceAll
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString);

      await sandbox.writeFile(absolutePath, newContent, "utf-8");

      return {
        success: true,
        path: absolutePath,
        replacements: replaceAll ? occurrences : 1,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to edit file: ${message}`,
      };
    }
  },
});
