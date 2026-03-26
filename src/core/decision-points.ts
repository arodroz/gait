import type { HitlConfig, Severity } from "./config";
import type { PendingAction, ActionRecord } from "./action-logger";
import * as path from "path";

// ── Types ──

export type DecisionPointType =
  | "interface_change"
  | "file_deleted"
  | "file_renamed"
  | "schema_change"
  | "cross_agent_conflict"
  | "prod_file"
  | "intent_drift"
  | "public_api_change";

export interface EvaluationResult {
  points: DecisionPointType[];
  severity: Severity;
  presentation: "notification" | "panel" | "modal";
  requires_cross_review: boolean;
  explanations: Partial<Record<DecisionPointType, string>>;
}

// ── Weight table ──

const WEIGHTS: Record<DecisionPointType, "low" | "medium" | "high"> = {
  file_renamed: "low",
  cross_agent_conflict: "medium",
  interface_change: "medium",
  public_api_change: "medium",
  schema_change: "medium",
  file_deleted: "high",
  prod_file: "high",
  intent_drift: "medium",
};

// ── Labels for UI ──

export const DECISION_POINT_LABELS: Record<DecisionPointType, string> = {
  interface_change: "Exported interface changed",
  file_deleted: "File deleted",
  file_renamed: "File renamed",
  schema_change: "Schema or migration modified",
  cross_agent_conflict: "Same file modified by other agent recently",
  prod_file: "Production file",
  intent_drift: "Agent action may diverge from your request",
  public_api_change: "Public API symbol added or removed",
};

// ── Glob matching (simple, no dependency) ──

function matchGlob(pattern: string, filePath: string): boolean {
  return buildGlobRegex(pattern).test(filePath);
}

function buildGlobRegex(glob: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      regex += ".*";
      i += glob[i + 2] === "/" ? 3 : 2;
    } else if (c === "*") {
      regex += "[^/]*";
      i++;
    } else if (c === "?") {
      regex += ".";
      i++;
    } else if (".+^${}()|[]\\".includes(c)) {
      regex += "\\" + c;
      i++;
    } else {
      regex += c;
      i++;
    }
  }
  return new RegExp("^" + regex + "$");
}

// ── Detection functions ──

const EXPORT_ADDED_TS = /^\+\s*export\s+(function|class|interface|type|const|let|enum|default)/;
const EXPORT_REMOVED_TS = /^-\s*export\s+(function|class|interface|type|const|let|enum|default)/;

const EXPORT_ADDED_PY = /^\+(def|class)\s+[a-zA-Z]/;
const EXPORT_REMOVED_PY = /^-(def|class)\s+[a-zA-Z]/;

export function detectInterfaceChange(diffPreview?: string): { detected: boolean; explanation: string } {
  if (!diffPreview) return { detected: false, explanation: "" };
  const lines = diffPreview.split("\n");

  let hasRemovedExport = false;
  let hasAddedExport = false;

  for (const line of lines) {
    if (EXPORT_REMOVED_TS.test(line) || EXPORT_REMOVED_PY.test(line)) hasRemovedExport = true;
    if (EXPORT_ADDED_TS.test(line) || EXPORT_ADDED_PY.test(line)) hasAddedExport = true;
  }

  // Interface change = an exported signature was both removed and added (modified)
  if (hasRemovedExport && hasAddedExport) {
    return { detected: true, explanation: "Exported function/class signature was modified" };
  }
  return { detected: false, explanation: "" };
}

export function detectPublicApiChange(diffPreview?: string): { detected: boolean; explanation: string } {
  if (!diffPreview) return { detected: false, explanation: "" };
  const lines = diffPreview.split("\n");

  const added: string[] = [];
  const removed: string[] = [];

  for (const line of lines) {
    if (EXPORT_ADDED_TS.test(line) || EXPORT_ADDED_PY.test(line)) added.push(line.slice(1).trim());
    if (EXPORT_REMOVED_TS.test(line) || EXPORT_REMOVED_PY.test(line)) removed.push(line.slice(1).trim());
  }

  // Public API change = a symbol was added or removed (not just modified)
  const addedOnly = added.filter((a) => !removed.some((r) => signaturesMatch(a, r)));
  const removedOnly = removed.filter((r) => !added.some((a) => signaturesMatch(a, r)));

  if (addedOnly.length > 0 || removedOnly.length > 0) {
    const parts: string[] = [];
    if (addedOnly.length) parts.push(`${addedOnly.length} export(s) added`);
    if (removedOnly.length) parts.push(`${removedOnly.length} export(s) removed`);
    return { detected: true, explanation: parts.join(", ") };
  }
  return { detected: false, explanation: "" };
}

function signaturesMatch(a: string, b: string): boolean {
  // Simple: check if the first identifier word matches
  const nameA = a.match(/(?:export\s+(?:default\s+)?)?(?:function|class|interface|type|const|let|enum)\s+(\w+)/)?.[1];
  const nameB = b.match(/(?:export\s+(?:default\s+)?)?(?:function|class|interface|type|const|let|enum)\s+(\w+)/)?.[1];
  return !!(nameA && nameB && nameA === nameB);
}

export function detectFileDeleted(diffPreview?: string): { detected: boolean; explanation: string } {
  if (!diffPreview) return { detected: false, explanation: "" };
  if (diffPreview.includes("deleted file mode")) {
    return { detected: true, explanation: "File was deleted" };
  }
  return { detected: false, explanation: "" };
}

export function detectFileRenamed(diffPreview?: string): { detected: boolean; explanation: string } {
  if (!diffPreview) return { detected: false, explanation: "" };
  if (diffPreview.includes("rename from") && diffPreview.includes("rename to")) {
    const from = diffPreview.match(/rename from (.+)/)?.[1] ?? "";
    const to = diffPreview.match(/rename to (.+)/)?.[1] ?? "";
    return { detected: true, explanation: `Renamed: ${from} → ${to}` };
  }
  if (diffPreview.includes("similarity index")) {
    return { detected: true, explanation: "File was renamed/moved" };
  }
  return { detected: false, explanation: "" };
}

const SCHEMA_PATH_PATTERNS = [
  /migrations?\//i,
  /\.sql$/i,
  /schema\./i,
  /prisma\/schema\.prisma$/i,
  /\.graphql$/i,
  /\.proto$/i,
];

const SCHEMA_CONTENT_PATTERNS = [
  /^\+.*CREATE\s+TABLE/i,
  /^\+.*ALTER\s+TABLE/i,
  /^\+.*DROP\s+TABLE/i,
];

export function detectSchemaChange(files: string[], diffPreview?: string): { detected: boolean; explanation: string } {
  for (const file of files) {
    if (SCHEMA_PATH_PATTERNS.some((p) => p.test(file))) {
      return { detected: true, explanation: `Schema file modified: ${file}` };
    }
  }

  if (diffPreview) {
    for (const line of diffPreview.split("\n")) {
      if (SCHEMA_CONTENT_PATTERNS.some((p) => p.test(line))) {
        return { detected: true, explanation: "Schema DDL statement detected in diff" };
      }
    }
  }

  return { detected: false, explanation: "" };
}

export function detectCrossAgentConflict(
  action: PendingAction,
  recentActions: ActionRecord[],
  windowSeconds: number,
): { detected: boolean; explanation: string } {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const actionFiles = new Set(action.files);

  for (const record of recentActions) {
    if (record.agent === action.agent) continue;
    if (record.human_decision !== "accept" && record.human_decision !== "auto_accept") continue;
    const recordTime = new Date(record.ts).getTime();
    if (now - recordTime > windowMs) continue;

    const overlap = record.files.filter((f) => actionFiles.has(f));
    if (overlap.length > 0) {
      return {
        detected: true,
        explanation: `${record.agent} also modified ${overlap.join(", ")} ${timeAgo(record.ts)}`,
      };
    }
  }

  return { detected: false, explanation: "" };
}

export function detectProdFile(files: string[], prodPaths: string[]): { detected: boolean; explanation: string } {
  if (prodPaths.length === 0) return { detected: false, explanation: "" };

  for (const file of files) {
    for (const pattern of prodPaths) {
      if (matchGlob(pattern, file)) {
        return { detected: true, explanation: `${file} matches production path pattern: ${pattern}` };
      }
    }
  }

  return { detected: false, explanation: "" };
}

// ── Severity computation ──

export function computeSeverity(points: DecisionPointType[], mode: "dev" | "prod"): Severity {
  if (points.length === 0) {
    return mode === "prod" ? "medium" : "low";
  }

  const weights = points.map((p) => WEIGHTS[p]);
  const highCount = weights.filter((w) => w === "high").length;
  const mediumCount = weights.filter((w) => w === "medium").length;

  if (highCount > 0 || mediumCount >= 2) {
    return "high";
  }
  if (mediumCount > 0) {
    return mode === "prod" ? "high" : "medium";
  }
  return mode === "prod" ? "medium" : "low";
}

export function computePresentation(severity: Severity, mode: "dev" | "prod"): EvaluationResult["presentation"] {
  if (mode === "prod") return severity === "low" ? "panel" : "modal";
  if (severity === "high") return "modal";
  if (severity === "medium") return "panel";
  return "notification";
}

// ── Main evaluate function ──

export async function evaluate(
  action: PendingAction,
  cfg: HitlConfig,
  recentActions: ActionRecord[],
): Promise<EvaluationResult> {
  const points: DecisionPointType[] = [];
  const explanations: Partial<Record<DecisionPointType, string>> = {};

  const dp = cfg.decision_points;

  // File-based detections
  if (dp.file_deleted) {
    const r = detectFileDeleted(action.diff_preview);
    if (r.detected) { points.push("file_deleted"); explanations.file_deleted = r.explanation; }
  }

  if (dp.file_renamed) {
    const r = detectFileRenamed(action.diff_preview);
    if (r.detected) { points.push("file_renamed"); explanations.file_renamed = r.explanation; }
  }

  if (dp.schema_change) {
    const r = detectSchemaChange(action.files, action.diff_preview);
    if (r.detected) { points.push("schema_change"); explanations.schema_change = r.explanation; }
  }

  // Diff-based detections
  if (dp.interface_change) {
    const r = detectInterfaceChange(action.diff_preview);
    if (r.detected) { points.push("interface_change"); explanations.interface_change = r.explanation; }
  }

  if (dp.public_api_change) {
    const r = detectPublicApiChange(action.diff_preview);
    if (r.detected) { points.push("public_api_change"); explanations.public_api_change = r.explanation; }
  }

  // Cross-agent conflict
  if (dp.cross_agent_conflict) {
    const r = detectCrossAgentConflict(action, recentActions, dp.cross_agent_conflict_window_s);
    if (r.detected) { points.push("cross_agent_conflict"); explanations.cross_agent_conflict = r.explanation; }
  }

  // Prod file
  const prodResult = detectProdFile(action.files, cfg.prod.paths);
  if (prodResult.detected) { points.push("prod_file"); explanations.prod_file = prodResult.explanation; }

  // intent_drift requires LLM comparison — not yet implemented.
  // Log when the config flag is enabled so users know it's a no-op.
  if (dp.intent_drift) {
    console.debug("[hitlgate] intent_drift detection is enabled in config but not yet implemented (planned for Phase 3)");
  }

  const severity = computeSeverity(points, cfg.project.mode);
  const presentation = computePresentation(severity, cfg.project.mode);
  const requires_cross_review = cfg.reviewer.enabled && cfg.reviewer.on_severity.includes(severity);

  return { points, severity, presentation, requires_cross_review, explanations };
}

// ── Helpers ──

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
