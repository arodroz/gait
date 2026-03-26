#!/usr/bin/env node

/**
 * hitlgate-bridge — standalone IPC bridge between Claude Code hooks and the VS Code extension.
 *
 * Called by Claude Code's PreToolUse hook via stdin JSON.
 * Writes a pending action file, polls for a decision, then exits:
 *   exit 0 = accept (Claude proceeds)
 *   exit 2 = reject (Claude blocks the tool use)
 */

import * as fs from "fs";
import * as path from "path";
import { findGaitDir, pollForDecision } from "../core/find-gait-dir";

// ── Types ──

interface ClaudeHookPayload {
  tool_name: string;
  tool_input: {
    path?: string;
    file_path?: string;
    content?: string;
    edits?: Array<{ path: string }>;
    command?: string;
    description?: string;
  };
  session_id?: string;
  transcript_path?: string;
}

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

// ── Helpers ──

function generateActionId(): string {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `act_${ts}_${rand}`;
}

function extractFiles(payload: ClaudeHookPayload): string[] {
  const { tool_name, tool_input } = payload;

  if (tool_name === "MultiEdit" && tool_input.edits) {
    return [...new Set(tool_input.edits.map((e) => e.path))];
  }
  if (tool_input.file_path) return [tool_input.file_path];
  if (tool_input.path) return [tool_input.path];
  if (tool_name === "Bash") return [];
  return [];
}

function extractIntent(payload: ClaudeHookPayload): string {
  if (payload.tool_input.description) return payload.tool_input.description;
  if (payload.tool_input.command) return `bash: ${payload.tool_input.command.slice(0, 100)}`;
  return payload.tool_name;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
    // If stdin is empty/closed immediately
    if (process.stdin.readableEnded) resolve("");
  });
}

async function extractSessionContext(transcriptPath?: string): Promise<string | undefined> {
  if (!transcriptPath) return undefined;
  try {
    const transcript = await fs.promises.readFile(transcriptPath, "utf8");
    const lines = transcript.trim().split("\n").reverse();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role === "user" && typeof entry.content === "string") {
          return entry.content.slice(0, 500);
        }
      } catch { continue; }
    }
  } catch { return undefined; }
}

// ── Main ──

async function main() {
  // 1. Read stdin
  const raw = await readStdin();
  let payload: ClaudeHookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Not valid JSON — pass through without blocking
    process.exit(0);
  }

  // 2. Find .gait directory
  const gaitDir = await findGaitDir(process.cwd());
  if (!gaitDir) {
    // No .gait dir — project not initialized, pass through
    process.exit(0);
  }

  // 3. Extract action info
  const id = generateActionId();
  const files = extractFiles(payload);
  const intent = extractIntent(payload);
  const sessionId = payload.session_id ?? `sess_${Date.now()}`;

  // 4. Build PendingAction
  const action: PendingAction = {
    id,
    agent: "claude",
    session_id: sessionId,
    tool: payload.tool_name,
    files,
    intent,
    diff_preview: undefined,
    session_context: await extractSessionContext(payload.transcript_path),
    ts: new Date().toISOString(),
  };

  // 5. Write pending file
  const pendingPath = path.join(gaitDir, "pending", `${id}.json`);
  await fs.promises.mkdir(path.dirname(pendingPath), { recursive: true });
  await fs.promises.writeFile(pendingPath, JSON.stringify(action, null, 2));

  // 6. Poll for decision
  const decision = await pollForDecision(gaitDir, id);

  // 7. Cleanup pending file
  await fs.promises.unlink(pendingPath).catch(() => {});

  // 8. Exit based on decision
  if (decision.decision === "reject" || decision.decision === "edit") {
    const label = decision.decision === "edit" ? "rejected with note" : "rejected";
    process.stderr.write(
      decision.note
        ? `HITL-Gate: Action ${label} — ${decision.note}\n`
        : `HITL-Gate: Action ${label} by user\n`,
    );
    process.exit(2);
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`HITL-Gate bridge error: ${err}\n`);
  // On error, pass through — don't block Claude
  process.exit(0);
});
