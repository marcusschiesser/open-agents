import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import type { Sandbox } from "../../sandbox";
import { isPathWithinDirectory, getSandbox } from "../../utils";

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

async function grepFile(
  filePath: string,
  pattern: RegExp,
  maxMatchesPerFile: number,
  sandbox: Sandbox
): Promise<GrepMatch[]> {
  try {
    const content = await sandbox.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const matches: GrepMatch[] = [];

    for (let i = 0; i < lines.length && matches.length < maxMatchesPerFile; i++) {
      const line = lines[i];
      if (line !== undefined && pattern.test(line)) {
        matches.push({
          file: filePath,
          line: i + 1,
          content: line.slice(0, 200),
        });
      }
    }

    return matches;
  } catch {
    return [];
  }
}

async function walkDirectory(
  dir: string,
  glob: string | undefined,
  sandbox: Sandbox
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string) {
    try {
      const entries = await sandbox.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (glob) {
            const ext = path.extname(entry.name);
            const globExt = glob.startsWith("*") ? glob.slice(1) : glob;
            if (ext === globExt || entry.name.endsWith(globExt)) {
              files.push(fullPath);
            }
          } else {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await walk(dir);
  return files;
}

export const grepTool = tool({
  description: `Search for patterns in files using JavaScript regular expressions.

WHEN TO USE:
- Finding where a function, variable, or string literal is used
- Locating configuration keys, routes, or error messages across files
- Narrowing down which files to read or edit

WHEN NOT TO USE:
- Simple filename-only searches (use globTool instead)
- Complex, multi-round codebase exploration (use taskTool with detailed instructions)
- Directory listings, builds, or other shell tasks (use bashTool instead)

USAGE:
- Uses JavaScript RegExp syntax (e.g., "log.*Error", "function\\s+\\w+")
- Search a specific file OR an entire directory via the path parameter
- Optionally filter files with glob (e.g., "*.ts", "*.test.js")
- Matches are SINGLE-LINE: patterns do not span across newline characters
- Results are limited to 100 matches total, with up to 10 matches per file; each match line is truncated to 200 characters

IMPORTANT:
- ALWAYS use this tool for code/content searches instead of running grep/rg via bashTool
- Use caseSensitive: false for case-insensitive searches
- Hidden files and node_modules are skipped when searching directories
- Access is restricted to files under the current working directory; paths outside will be rejected

EXAMPLES:
- Find all TODO comments in TypeScript files: pattern: "TODO", path: "/Users/username/project", glob: "*.ts"
- Find all references to a function (case-insensitive): pattern: "handleRequest", path: "/Users/username/project/src", caseSensitive: false`,
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z
      .string()
      .describe("File or directory to search in (absolute path)"),
    glob: z
      .string()
      .optional()
      .describe("Glob pattern to filter files (e.g., '*.ts')"),
    caseSensitive: z
      .boolean()
      .optional()
      .describe("Case-sensitive search. Default: true"),
  }),
  execute: async ({
    pattern,
    path: searchPath,
    glob,
    caseSensitive = true,
  }, { experimental_context }) => {
    const sandbox = getSandbox(experimental_context);
    const workingDirectory = sandbox.workingDirectory;

    try {
      const flags = caseSensitive ? "g" : "gi";
      const regex = new RegExp(pattern, flags);

      const absolutePath = path.isAbsolute(searchPath)
        ? searchPath
        : path.resolve(workingDirectory, searchPath);

      // Security check: ensure path is within working directory
      if (!isPathWithinDirectory(absolutePath, workingDirectory)) {
        return {
          success: false,
          error: `Access denied: path "${absolutePath}" is outside the working directory "${workingDirectory}"`,
        };
      }

      const stats = await sandbox.stat(absolutePath);
      let files: string[];

      if (stats.isDirectory()) {
        files = await walkDirectory(absolutePath, glob, sandbox);
      } else {
        files = [absolutePath];
      }

      const allMatches: GrepMatch[] = [];
      const maxTotal = 100;
      const maxPerFile = 10;

      for (const file of files) {
        if (allMatches.length >= maxTotal) break;

        const remaining = maxTotal - allMatches.length;
        const limit = Math.min(maxPerFile, remaining);
        const matches = await grepFile(file, regex, limit, sandbox);
        allMatches.push(...matches);
      }

      return {
        success: true,
        pattern,
        matchCount: allMatches.length,
        filesSearched: files.length,
        matches: allMatches,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Grep failed: ${message}`,
      };
    }
  },
});
