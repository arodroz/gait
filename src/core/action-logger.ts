import * as fs from "fs";
import * as path from "path";
import type { Severity } from "./config";

// ── Types ──

export type HumanDecision = "accept" | "reject" | "edit" | "auto_accept" | "timeout_reject";

export interface DecisionPoint {
  type: string;
  description: string;
}

export interface ReviewerAnalysis {
  reviewerAgent: "claude" | "codex";
  model: string;
  understood_intent: string;
  actual_action: string;
  divergences: string[];
  risks: string[];
  recommendation: "accept" | "reject" | "modify";
  confidence: number;
  suggestion?: string;
  duration_ms: number;
}

export interface ActionRecord {
  id: string;
  ts: string;
  agent: "claude" | "codex";
  session_id: string;
  tool: string;
  files: string[];
  intent: string;
  diff_ref?: string;
  decision_points: DecisionPoint[];
  severity: Severity;
  human_decision: HumanDecision;
  human_note?: string;
  reviewer_agent?: "claude" | "codex";
  reviewer_analysis?: ReviewerAnalysis;
  snapshot_ref?: string;
  cost_estimate_usd?: number;
  duration_ms?: number;
}

export interface PendingAction {
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

export interface DecisionResult {
  id: string;
  decision: "accept" | "reject" | "edit";
  note?: string;
  reviewer_analysis?: ReviewerAnalysis;
  ts: string;
}

// ── ActionLogger ──

const ACTIONS_FILE = "actions.jsonl";

export class ActionLogger {
  private readonly filePath: string;

  constructor(private readonly gaitDir: string) {
    this.filePath = path.join(gaitDir, ACTIONS_FILE);
  }

  async append(record: ActionRecord): Promise<void> {
    const line = JSON.stringify(record) + "\n";
    await fs.promises.appendFile(this.filePath, line, "utf8");
  }

  async readRecent(n?: number): Promise<ActionRecord[]> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(this.filePath, "utf8");
    } catch {
      return [];
    }

    const records: ActionRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // Skip corrupted lines
      }
    }

    if (n !== undefined && n > 0) {
      return records.slice(-n);
    }
    return records;
  }

  async findById(id: string): Promise<ActionRecord | null> {
    const records = await this.readRecent();
    return records.find((r) => r.id === id) ?? null;
  }

  async query(filter: Partial<ActionRecord>): Promise<ActionRecord[]> {
    const records = await this.readRecent();
    return records.filter((r) => {
      for (const [key, value] of Object.entries(filter)) {
        if (r[key as keyof ActionRecord] !== value) return false;
      }
      return true;
    });
  }

  async storeDiff(id: string, patch: string): Promise<string> {
    const diffsDir = path.join(this.gaitDir, "diffs");
    await fs.promises.mkdir(diffsDir, { recursive: true });
    const filename = `${id}.patch`;
    await fs.promises.writeFile(path.join(diffsDir, filename), patch, "utf8");
    return `.gait/diffs/${filename}`;
  }
}
