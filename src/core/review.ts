import { AgentRunner } from "./agent";
import { buildPromptPrefix } from "./memory";
import * as fs from "fs";
import * as path from "path";

export interface ReviewFinding {
  file: string;
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
  raw: string;
  duration: number;
}

/** Run an AI code review on a diff */
export async function reviewDiff(
  cwd: string,
  gaitDir: string,
  diff: string,
  changedFiles: string[],
  agentKind: "claude" | "codex" = "claude",
  onOutput?: (line: string) => void,
): Promise<ReviewResult> {
  const start = Date.now();

  // Build review prompt
  const memory = buildPromptPrefix(gaitDir);
  const fileContents = loadChangedFiles(cwd, changedFiles, 3000);

  const prompt = `You are a code reviewer. Review this diff for bugs, security issues, logic errors, and code quality problems.

${memory ? `## Project Context\n${memory}\n` : ""}
## Diff to review
\`\`\`diff
${diff.slice(0, 8000)}
\`\`\`

## Changed file contents
${fileContents}

## Response format
Respond ONLY with a JSON array. No markdown, no explanation. Each item:
[{"file": "path/to/file.ts", "line": 42, "severity": "error|warning|info", "message": "description", "suggestion": "how to fix"}]

If no issues found, respond with: []`;

  // Run agent
  const agent = new AgentRunner();
  const lines: string[] = [];

  agent.on("output", (line: string) => {
    lines.push(line);
    onOutput?.(line);
  });

  await new Promise<void>((resolve) => {
    agent.on("done", () => resolve());
    agent.on("error", () => resolve());
    agent.start(agentKind, prompt, cwd).catch(() => resolve());
  });

  const raw = lines.join("\n");
  const findings = parseFindings(raw);

  return { findings, raw, duration: Date.now() - start };
}

/** Parse findings from agent output (tolerant JSON extraction) */
export function parseFindings(output: string): ReviewFinding[] {
  // Try to find JSON array in the output
  const jsonMatch = output.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((f: unknown) => f && typeof f === "object")
      .map((f: Record<string, unknown>) => ({
        file: String(f.file ?? ""),
        line: Number(f.line ?? 0),
        severity: (["error", "warning", "info"].includes(String(f.severity)) ? f.severity : "info") as ReviewFinding["severity"],
        message: String(f.message ?? ""),
        suggestion: f.suggestion ? String(f.suggestion) : undefined,
      }))
      .filter((f) => f.message);
  } catch {
    return [];
  }
}

/** Check if findings should block the gate */
export function shouldBlock(findings: ReviewFinding[], blockOn: string): boolean {
  if (blockOn === "none") return false;
  const levels: Record<string, number> = { error: 3, warning: 2, info: 1 };
  const threshold = levels[blockOn] ?? 3;
  return findings.some((f) => (levels[f.severity] ?? 0) >= threshold);
}

function loadChangedFiles(cwd: string, files: string[], maxPerFile: number): string {
  const parts: string[] = [];
  for (const file of files.slice(0, 5)) {
    const fullPath = path.join(cwd, file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      if (content.length <= maxPerFile) {
        parts.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
      } else {
        parts.push(`### ${file} (${content.split("\n").length} lines, truncated)\n\`\`\`\n${content.slice(0, maxPerFile)}\n...\n\`\`\``);
      }
    } catch { /* skip unreadable */ }
  }
  return parts.join("\n\n");
}
