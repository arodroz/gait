import * as vscode from "vscode";
import * as config from "../core/config";
import { ActionLogger, type ActionRecord } from "../core/action-logger";
import { state, getOutputChannel } from "../state";

export async function cmdOpenJournal() {
  const logger = new ActionLogger(config.gaitDir(state.cwd));
  const records = await logger.readRecent();

  if (records.length === 0) {
    vscode.window.showInformationMessage("No decisions recorded yet.");
    return;
  }

  // Offer filter
  const filter = await vscode.window.showQuickPick(
    [
      { label: "All", description: `${records.length} decision(s)`, value: "all" },
      { label: "Claude only", description: "", value: "claude" },
      { label: "Codex only", description: "", value: "codex" },
      { label: "Rejected only", description: "", value: "rejected" },
      { label: "High severity", description: "", value: "high" },
    ],
    { placeHolder: "Filter decisions" },
  );
  if (!filter) return;

  let filtered = records;
  switch (filter.value) {
    case "claude": filtered = records.filter((r) => r.agent === "claude"); break;
    case "codex": filtered = records.filter((r) => r.agent === "codex"); break;
    case "rejected": filtered = records.filter((r) => r.human_decision === "reject"); break;
    case "high": filtered = records.filter((r) => r.severity === "high"); break;
  }

  const ch = getOutputChannel("HITL-Gate: Decisions Journal");
  ch.clear();
  ch.appendLine(`# Decisions Journal — ${filtered.length} record(s)\n`);

  for (const r of filtered.reverse()) {
    const decIcon = (r.human_decision === "accept" || r.human_decision === "auto_accept") ? "✓" : "✗";
    const time = new Date(r.ts).toLocaleString();
    ch.appendLine(`${decIcon} ${r.human_decision.padEnd(12)} ${r.agent.padEnd(7)} ${r.severity.padEnd(7)} ${r.files.join(", ")}`);
    ch.appendLine(`  Intent: ${r.intent}`);
    ch.appendLine(`  Time: ${time}`);
    if (r.human_note) ch.appendLine(`  Note: ${r.human_note}`);
    if (r.reviewer_analysis) {
      ch.appendLine(`  Reviewer (${r.reviewer_agent}): ${r.reviewer_analysis.recommendation}`);
      if (r.reviewer_analysis.divergences.length > 0) {
        ch.appendLine(`  Divergences: ${r.reviewer_analysis.divergences.join("; ")}`);
      }
    }
    if (r.decision_points.length > 0) {
      ch.appendLine(`  Flags: ${r.decision_points.map((p) => p.type).join(", ")}`);
    }
    ch.appendLine("");
  }

  ch.show(true);
}

export async function cmdExportJournal() {
  const logger = new ActionLogger(config.gaitDir(state.cwd));
  const records = await logger.readRecent();

  if (records.length === 0) {
    vscode.window.showInformationMessage("No decisions to export.");
    return;
  }

  const md = generateMarkdownReport(records);
  const doc = await vscode.workspace.openTextDocument({ content: md, language: "markdown" });
  await vscode.window.showTextDocument(doc);
}

function generateMarkdownReport(records: ActionRecord[]): string {
  const lines: string[] = [];
  lines.push("# HITL-Gate Decisions Report\n");
  lines.push(`Generated: ${new Date().toISOString()}\n`);
  lines.push(`Total decisions: ${records.length}\n`);

  const accepted = records.filter((r) => r.human_decision === "accept" || r.human_decision === "auto_accept").length;
  const rejected = records.filter((r) => r.human_decision === "reject").length;
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Accepted | ${accepted} |`);
  lines.push(`| Rejected | ${rejected} |`);
  lines.push(`| Auto-accepted | ${records.filter((r) => r.human_decision === "auto_accept").length} |`);
  lines.push(`| High severity | ${records.filter((r) => r.severity === "high").length} |`);
  lines.push("");

  lines.push("## Decisions\n");

  for (const r of records.slice(-50).reverse()) {
    const icon = (r.human_decision === "accept" || r.human_decision === "auto_accept") ? "✅" : "❌";
    lines.push(`### ${icon} ${r.agent} — ${r.tool} — ${r.files.join(", ")}`);
    lines.push(`- **Intent:** ${r.intent}`);
    lines.push(`- **Severity:** ${r.severity}`);
    lines.push(`- **Decision:** ${r.human_decision}`);
    lines.push(`- **Time:** ${r.ts}`);
    if (r.human_note) lines.push(`- **Note:** ${r.human_note}`);
    if (r.decision_points.length > 0) {
      lines.push(`- **Flags:** ${r.decision_points.map((p) => `${p.type} (${p.description})`).join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
