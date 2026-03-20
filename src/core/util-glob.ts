import * as fs from "fs";
import * as path from "path";

/** Simple glob for workspace patterns like "packages/*" */
export function glob(root: string, pattern: string): string[] {
  // Handle "packages/*" style patterns
  const parts = pattern.split("/");
  return globRecurse(root, parts);
}

function globRecurse(dir: string, parts: string[]): string[] {
  if (parts.length === 0) return [dir];

  const [current, ...rest] = parts;
  if (!fs.existsSync(dir)) return [];

  if (current === "*" || current === "**") {
    const results: string[] = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        results.push(...globRecurse(path.join(dir, entry.name), rest));
      }
    } catch {
      // ignore permission errors
    }
    return results;
  }

  const next = path.join(dir, current);
  if (!fs.existsSync(next)) return [];
  return globRecurse(next, rest);
}
