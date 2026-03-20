import * as fs from "fs";
import * as path from "path";
import { HistoryLogger, type Entry } from "./history";
import { generateScript } from "./scripts";

interface CommandFrequency {
  command: string;
  count: number;
  lastUsed: string;
}

/**
 * Analyze action history to find repeated command patterns
 * that could be saved as scripts.
 */
export function detectPatterns(gaitDir: string, minCount = 3): CommandFrequency[] {
  const logger = new HistoryLogger(gaitDir);
  const freq = new Map<string, CommandFrequency>();

  // Read last 30 days of history
  const today = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);

    let entries: Entry[];
    try {
      entries = logger.read(date);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.kind !== "stage_run" && entry.kind !== "pipeline_run") continue;

      // Extract command-like info from data
      const key = extractCommandKey(entry);
      if (!key) continue;

      const existing = freq.get(key);
      if (existing) {
        existing.count++;
        existing.lastUsed = entry.timestamp;
      } else {
        freq.set(key, { command: key, count: 1, lastUsed: entry.timestamp });
      }
    }
  }

  return [...freq.values()]
    .filter((f) => f.count >= minCount)
    .sort((a, b) => b.count - a.count);
}

/**
 * Check if a detected pattern already has a matching script in .gait/scripts/
 */
export function isAlreadyScripted(scriptsDir: string, command: string): boolean {
  if (!fs.existsSync(scriptsDir)) return false;
  for (const file of fs.readdirSync(scriptsDir)) {
    if (!file.endsWith(".sh")) continue;
    const content = fs.readFileSync(path.join(scriptsDir, file), "utf-8");
    if (content.includes(command)) return true;
  }
  return false;
}

/**
 * Generate a suggested script from a detected pattern
 */
export function suggestScript(pattern: CommandFrequency): { filename: string; content: string } {
  const name = pattern.command
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toLowerCase();
  const filename = `${name}.sh`;
  const content = generateScript(
    name,
    `Auto-detected: ran ${pattern.count} times`,
    pattern.command,
  );
  return { filename, content };
}

function extractCommandKey(entry: Entry): string | null {
  const data = entry.data;
  if (typeof data.script === "string") return data.script;
  if (typeof data.name === "string" && typeof data.status === "string") {
    return `stage:${data.name}`;
  }
  if (Array.isArray(data.stages)) {
    return `pipeline:${(data.stages as Array<{ name: string }>).map((s) => s.name).join("+")}`;
  }
  return null;
}
