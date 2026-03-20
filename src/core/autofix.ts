import { AgentRunner, type AgentKind } from "./agent";
import type { StageResult } from "./pipeline";
import * as fs from "fs";

export interface FixAttempt {
  attempt: number;
  maxAttempts: number;
  stageName: string;
  agentKind: AgentKind;
  prompt: string;
  success: boolean;
  duration: number;
}

export interface AutofixCallbacks {
  onAttemptStart: (attempt: number, maxAttempts: number, prompt: string) => void;
  onAttemptEnd: (result: FixAttempt) => void;
  onAgentOutput: (line: string) => void;
  onGateStart: () => void;
  onGateResult: (passed: boolean) => void;
}

/**
 * Build a targeted fix prompt from a failed stage result.
 * Includes error output, relevant file paths, and source context.
 */
export function buildFixPrompt(failed: StageResult, cwd: string, stageCommand?: string, blameContext?: string): string {
  const lines: string[] = [];

  lines.push(`The "${failed.name}" stage failed. Fix the error below.`);
  lines.push("");

  if (stageCommand) {
    lines.push("## Command that was run");
    lines.push("```");
    lines.push(stageCommand);
    lines.push("```");
    lines.push("");
  }

  if (failed.error) {
    lines.push("## Error output");
    lines.push("```");
    lines.push(failed.error.slice(0, 3000));
    lines.push("```");
    lines.push("");
  }

  if (failed.output) {
    lines.push("## Full output");
    lines.push("```");
    lines.push(failed.output.slice(0, 3000));
    lines.push("```");
    lines.push("");
  }

  // Extract file paths from error output and include source
  const fileRefs = extractFilePaths(failed.error + "\n" + failed.output);
  if (fileRefs.length > 0) {
    lines.push("## Relevant files");
    for (const ref of fileRefs.slice(0, 5)) {
      const fullPath = `${cwd}/${ref}`;
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (content.length < 5000) {
            lines.push(`### ${ref}`);
            lines.push("```");
            lines.push(content);
            lines.push("```");
            lines.push("");
          } else {
            lines.push(`- ${ref} (${content.split("\n").length} lines)`);
          }
        } catch {
          lines.push(`- ${ref}`);
        }
      }
    }
  }

  lines.push("## Instructions");
  lines.push("- Fix ONLY the error shown above");
  lines.push("- Do not refactor unrelated code");
  lines.push("- Do not add features");
  lines.push("- Make the minimal change needed to make the stage pass");

  if (blameContext) {
    lines.push("");
    lines.push(blameContext);
  }

  return lines.join("\n");
}

/**
 * Run an auto-fix loop: agent fixes -> gate runs -> repeat until pass or max attempts.
 * Uses AgentRunner which spawns processes via child_process.spawn (no shell injection).
 */
export async function runAutofixLoop(
  failed: StageResult,
  cwd: string,
  agentKind: AgentKind,
  maxAttempts: number,
  runGate: () => Promise<boolean>,
  callbacks: AutofixCallbacks,
  stageCommand?: string,
  blameContext?: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildFixPrompt(failed, cwd, stageCommand, blameContext);
    callbacks.onAttemptStart(attempt, maxAttempts, prompt);

    const agent = new AgentRunner();
    const start = Date.now();

    agent.on("output", (line: string) => callbacks.onAgentOutput(line));

    await new Promise<void>((resolve) => {
      agent.on("done", () => resolve());
      agent.on("error", () => resolve());
      agent.start(agentKind, prompt, cwd).catch(() => resolve());
    });

    const duration = Date.now() - start;

    callbacks.onGateStart();
    const passed = await runGate();
    callbacks.onGateResult(passed);

    callbacks.onAttemptEnd({
      attempt,
      maxAttempts,
      stageName: failed.name,
      agentKind,
      prompt,
      success: passed,
      duration,
    });

    if (passed) return true;
  }

  return false;
}

/** Extract file paths from error output (e.g., "src/core/config.ts:42:5") */
function extractFilePaths(text: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  const re = /(?:\.\/)?([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,4})(?::\d+)?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const p = m[1];
    if (p.includes("/") && !p.startsWith("http") && !seen.has(p)) {
      seen.add(p);
      paths.push(p);
    }
  }
  return paths;
}
