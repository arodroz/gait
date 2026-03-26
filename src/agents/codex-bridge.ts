import { spawn } from "child_process";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { findGaitDir } from "../core/find-gait-dir";

interface PendingAction {
  id: string;
  agent: "claude" | "codex";
  session_id: string;
  tool: string;
  files: string[];
  intent: string;
  diff_preview?: string;
  session_context?: string;
  ts: string;
}

interface DecisionResult {
  id: string;
  decision: "accept" | "reject" | "edit";
  note?: string;
  ts: string;
}

function generateActionId(): string {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `act_${ts}_${rand}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForDecision(
  gaitDir: string,
  id: string,
  timeoutMs = 120000,
  intervalMs = 200,
): Promise<DecisionResult> {
  const decisionPath = path.join(gaitDir, "decisions", `${id}.json`);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const raw = await fs.promises.readFile(decisionPath, "utf8");
      const decision = JSON.parse(raw) as DecisionResult;
      await fs.promises.unlink(decisionPath).catch(() => {});
      return decision;
    } catch {
      await sleep(intervalMs);
    }
  }

  return { id, decision: "reject", note: "timeout", ts: new Date().toISOString() };
}

/**
 * Run Codex CLI with HITL-Gate interception.
 * Intercepts approval prompts and routes them through the IPC system.
 */
export async function runCodexWithInterception(
  task: string,
  workspaceRoot: string,
  gaitDir: string,
  onOutput?: (line: string) => void,
): Promise<{ exitCode: number }> {
  const sessionId = `codex_${Date.now()}`;

  const proc = spawn("codex", ["--approval-mode=suggest", task], {
    cwd: workspaceRoot,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const rl = readline.createInterface({ input: proc.stdout! });

  let buffer: string[] = [];
  let inApprovalBlock = false;
  let currentFile = "";
  let diffLines: string[] = [];
  let processingLock: Promise<void> = Promise.resolve();

  rl.on("line", (line) => {
    onOutput?.(line);

    // Detect start of approval block
    if (line.includes("APPLY PATCH") || line.match(/^file:\s/)) {
      inApprovalBlock = true;
      buffer = [];
      diffLines = [];
      const fileMatch = line.match(/file:\s*(.+)/);
      if (fileMatch) currentFile = fileMatch[1].trim();
    }

    if (inApprovalBlock) {
      buffer.push(line);
      if (line.startsWith("+") || line.startsWith("-") || line.startsWith("@@")) {
        diffLines.push(line);
      }
    }

    // Detect confirmation prompt — serialize async work through a lock
    if (line.includes("Accept?") || line.match(/\[y\/N\]/i)) {
      inApprovalBlock = false;

      // Extract file from buffer if not already found
      if (!currentFile) {
        for (const bufLine of buffer) {
          const m = bufLine.match(/file:\s*(.+)/);
          if (m) { currentFile = m[1].trim(); break; }
        }
      }

      // Capture state for this approval block before resetting
      const capturedFile = currentFile;
      const capturedDiff = diffLines.join("\n").slice(0, 6000) || undefined;

      // Reset immediately so next block can accumulate
      buffer = [];
      diffLines = [];
      currentFile = "";

      // Chain async work to prevent interleaving
      processingLock = processingLock.then(async () => {
        const id = generateActionId();
        const action: PendingAction = {
          id,
          agent: "codex",
          session_id: sessionId,
          tool: "Edit",
          files: capturedFile ? [capturedFile] : [],
          intent: task.slice(0, 200),
          diff_preview: capturedDiff,
          session_context: task,
          ts: new Date().toISOString(),
        };

        // Write pending file
        const pendingPath = path.join(gaitDir, "pending", `${id}.json`);
        await fs.promises.mkdir(path.dirname(pendingPath), { recursive: true });
        await fs.promises.writeFile(pendingPath, JSON.stringify(action, null, 2));

        // Poll for decision
        const decision = await pollForDecision(gaitDir, id);

        // Cleanup pending
        await fs.promises.unlink(pendingPath).catch(() => {});

        // Respond to Codex
        if (decision.decision === "reject") {
          proc.stdin!.write("n\n");
          onOutput?.(`[hitlgate] Rejected: ${capturedFile}`);
        } else {
          proc.stdin!.write("y\n");
          onOutput?.(`[hitlgate] Accepted: ${capturedFile}`);
        }
      }).catch((err) => {
        console.error(`[hitlgate] Codex bridge error: ${err}`);
      });
    }
  });

  return new Promise((resolve) => {
    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 0 });
    });
    proc.on("error", () => {
      resolve({ exitCode: 1 });
    });
  });
}
