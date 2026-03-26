/** Webview app — renders the HITL-Gate dashboard inside VS Code */

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

interface LogEntry {
  time: string;
  message: string;
  level: "info" | "success" | "error" | "warn";
}

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

interface FileDiffInfo {
  path: string;
  diff: string;
  originalContent?: string;
}

interface PendingDecision {
  action: {
    id: string;
    agent: string;
    tool: string;
    files: string[];
    intent: string;
    diff_preview?: string;
    session_context?: string;
  };
  evaluation: {
    points: string[];
    severity: string;
    explanations: Record<string, string>;
  };
  fileDiffs?: FileDiffInfo[];
  reviewerAnalysis?: {
    reviewerAgent: string;
    recommendation: string;
    confidence: number;
    divergences: string[];
    risks: string[];
    suggestion?: string;
    understood_intent: string;
    actual_action: string;
  } | null;
  reviewerLoading?: boolean;
}

interface RecentDecision {
  id: string;
  agent: string;
  tool: string;
  files: string[];
  intent: string;
  severity: string;
  human_decision: string;
  human_note?: string;
  diff_ref?: string;
  ts: string;
}

interface DashboardState {
  project: string;
  version: string;
  branch: string;
  stacks: string[];
  clean: boolean;
  log: LogEntry[];
  files: FileChange[];
  agentRunning?: boolean;
  agentPaused?: boolean;
  agentKind?: string;
  agentPrompt?: string;
  agentTokens?: number;
  agentContextPct?: number;
  agentElapsed?: number;
  review?: {
    taskDesc: string;
    agentKind: string;
    duration: number;
    tokens: number;
    filesChanged: number;
    additions: number;
    deletions: number;
    gatePassed: boolean;
  };
  pendingDecision?: PendingDecision;
  pendingQueue?: PendingDecision[];
  recentDecisions?: RecentDecision[];
}

let activeTab: "dashboard" | "decisions" = "dashboard";
let activeFileTab = 0;
let activePreviewFileTab = 0;
let selectedQueuedDecisionId: string | undefined;
const expandedDiffs = new Set<string>();

// --- Helpers ---

function el(tag: string, attrs?: Record<string, string>, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") e.className = v;
      else if (k === "style") e.setAttribute("style", v);
      else e.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

const POINT_ICONS: Record<string, string> = {
  interface_change: "\u26A0\uFE0F",
  file_deleted: "\uD83D\uDDD1\uFE0F",
  file_renamed: "\u270F\uFE0F",
  schema_change: "\uD83D\uDDC4\uFE0F",
  cross_agent_conflict: "\u26A1",
  prod_file: "\uD83D\uDD34",
  intent_drift: "\uD83C\uDFAF",
  public_api_change: "\uD83D\uDCE4",
};

const POINT_LABELS: Record<string, string> = {
  interface_change: "Exported interface changed",
  file_deleted: "File deleted",
  file_renamed: "File renamed",
  schema_change: "Schema or migration modified",
  cross_agent_conflict: "Same file modified by other agent recently",
  prod_file: "Production file",
  intent_drift: "Agent action may diverge from request",
  public_api_change: "Public API symbol added or removed",
};

// --- Diff rendering ---

interface DiffLine {
  type: "add" | "del" | "context" | "header" | "range";
  content: string;
  oldLine?: number;
  newLine?: number;
}

function parseDiff(raw: string): DiffLine[] {
  if (!raw) return [];
  const lines = raw.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("@@")) {
      result.push({ type: "range", content: line });
      // Parse line numbers from @@ -a,b +c,d @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
    } else if (line.startsWith("+")) {
      result.push({ type: "add", content: line.slice(1), newLine });
      newLine++;
    } else if (line.startsWith("-")) {
      result.push({ type: "del", content: line.slice(1), oldLine });
      oldLine++;
    } else if (line.startsWith(" ")) {
      result.push({ type: "context", content: line.slice(1), oldLine, newLine });
      oldLine++;
      newLine++;
    }
  }
  return result;
}

function buildDiffView(diffText: string): HTMLElement {
  const container = el("div", { className: "diff-container" });
  if (!diffText) {
    container.appendChild(el("div", { className: "diff-empty" }, "No changes detected"));
    return container;
  }

  const parsed = parseDiff(diffText);
  const table = document.createElement("table");
  table.className = "diff-table";

  for (const line of parsed) {
    const tr = document.createElement("tr");
    tr.className = `diff-line diff-${line.type}`;

    if (line.type === "header") {
      const td = document.createElement("td");
      td.colSpan = 3;
      td.className = "diff-header-cell";
      td.textContent = line.content;
      tr.appendChild(td);
    } else if (line.type === "range") {
      const td = document.createElement("td");
      td.colSpan = 3;
      td.className = "diff-range-cell";
      td.textContent = line.content;
      tr.appendChild(td);
    } else {
      const oldNum = document.createElement("td");
      oldNum.className = "diff-linenum";
      oldNum.textContent = line.type === "add" ? "" : String(line.oldLine ?? "");

      const newNum = document.createElement("td");
      newNum.className = "diff-linenum";
      newNum.textContent = line.type === "del" ? "" : String(line.newLine ?? "");

      const code = document.createElement("td");
      code.className = "diff-code";
      const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
      code.textContent = prefix + line.content;

      tr.appendChild(oldNum);
      tr.appendChild(newNum);
      tr.appendChild(code);
    }

    table.appendChild(tr);
  }

  container.appendChild(table);
  return container;
}

// --- Source code viewer ---

function buildSourceView(content: string, highlightLines?: Set<number>): HTMLElement {
  const container = el("div", { className: "source-container" });
  if (!content) {
    container.appendChild(el("div", { className: "diff-empty" }, "File content not available"));
    return container;
  }

  const lines = content.split("\n");
  const table = document.createElement("table");
  table.className = "source-table";

  // Limit to 200 lines for performance; show a note if truncated
  const maxLines = 200;
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  for (let i = 0; i < displayLines.length; i++) {
    const lineNum = i + 1;
    const tr = document.createElement("tr");
    tr.className = highlightLines?.has(lineNum) ? "source-line highlight" : "source-line";

    const num = document.createElement("td");
    num.className = "source-linenum";
    num.textContent = String(lineNum);

    const code = document.createElement("td");
    code.className = "source-code";
    code.textContent = displayLines[i];

    tr.appendChild(num);
    tr.appendChild(code);
    table.appendChild(tr);
  }

  container.appendChild(table);
  if (truncated) {
    container.appendChild(el("div", { className: "source-truncated" }, `... ${lines.length - maxLines} more lines (open in editor to see full file)`));
  }
  return container;
}

// --- Tab bar ---

function buildTabBar(): HTMLElement {
  const bar = el("div", { className: "tab-bar" });
  const dashTab = el("button", { className: `tab ${activeTab === "dashboard" ? "active" : ""}` }, "Dashboard");
  dashTab.addEventListener("click", () => { activeTab = "dashboard"; vscode.postMessage({ command: "requestState" }); });
  const decTab = el("button", { className: `tab ${activeTab === "decisions" ? "active" : ""}` }, "Decisions");
  decTab.addEventListener("click", () => { activeTab = "decisions"; vscode.postMessage({ command: "requestState" }); });
  bar.appendChild(dashTab);
  bar.appendChild(decTab);
  return bar;
}

// --- Header ---

function buildHeader(state: DashboardState): HTMLElement {
  const header = el("div", { className: "header" });
  header.appendChild(el("span", { className: "header-icon" }, "\uD83D\uDEE1\uFE0F"));
  header.appendChild(el("h1", {}, state.project || "HITL-Gate"));
  header.appendChild(el("span", { className: `status-dot ${state.clean ? "clean" : "dirty"}` }));
  if (state.branch) header.appendChild(el("span", { className: "branch" }, state.branch));
  header.appendChild(el("span", { className: "spacer" }));
  for (const s of state.stacks) header.appendChild(el("span", { className: "stack-badge" }, s));
  return header;
}

// --- Pending Decision Panel (Rich) ---

function buildPendingDecision(pending: PendingDecision, readOnly = false): HTMLElement {
  const panel = el("div", { className: "decision-panel" });

  // Header
  const header = el("div", { className: "decision-header" });
  const sevClass = `severity-${pending.evaluation.severity}`;
  header.appendChild(el("span", { className: `severity-badge ${sevClass}` }, pending.evaluation.severity.toUpperCase()));
  header.appendChild(el("span", { className: "decision-agent" },
    `${pending.action.agent} \u00B7 ${pending.action.tool} \u00B7 ${pending.action.files.length} file(s)`));
  if (readOnly) {
    header.appendChild(el("span", { className: "queue-readonly" }, "QUEUED PREVIEW"));
  }
  panel.appendChild(header);

  // Intent
  const intentSection = el("div", { className: "decision-section" });
  intentSection.appendChild(el("div", { className: "decision-label" }, "INTENT"));
  intentSection.appendChild(el("div", { className: "decision-intent" }, `"${pending.action.intent}"`));
  if (pending.action.session_context) {
    const ctx = el("div", { className: "session-context" });
    ctx.appendChild(el("span", { className: "context-label" }, "User request: "));
    ctx.appendChild(el("span", {}, pending.action.session_context.slice(0, 200)));
    intentSection.appendChild(ctx);
  }
  panel.appendChild(intentSection);

  // Decision Points / Flags
  if (pending.evaluation.points.length > 0) {
    const pointsSection = el("div", { className: "decision-section" });
    pointsSection.appendChild(el("div", { className: "decision-label" }, "FLAGS"));
    for (const p of pending.evaluation.points) {
      const icon = POINT_ICONS[p] ?? "\u26A0\uFE0F";
      const label = pending.evaluation.explanations[p] ?? POINT_LABELS[p] ?? p;
      const row = el("div", { className: "decision-point" });
      row.appendChild(el("span", { className: "point-icon" }, icon));
      row.appendChild(el("span", { className: "point-type" }, p.replace(/_/g, " ")));
      row.appendChild(el("span", { className: "point-desc" }, label));
      pointsSection.appendChild(row);
    }
    panel.appendChild(pointsSection);
  }

  // Reviewer analysis
  if (pending.reviewerLoading) {
    const reviewSection = el("div", { className: "decision-section reviewer-section" });
    reviewSection.appendChild(el("div", { className: "decision-label" }, "REVIEWER"));
    reviewSection.appendChild(el("div", { className: "reviewer-loading" }, "\u23F3 Analyzing..."));
    panel.appendChild(reviewSection);
  } else if (pending.reviewerAnalysis) {
    panel.appendChild(buildReviewerAnalysis(pending.reviewerAnalysis));
  }

  // File tabs with diffs — the main event
  const fileDiffs = pending.fileDiffs ?? [];
  if (fileDiffs.length > 0 || pending.action.files.length > 0) {
    panel.appendChild(buildFileDiffSection(pending, readOnly ? "preview" : "active", readOnly));
  } else if (pending.action.diff_preview) {
    // Fallback: raw diff preview
    const diffSection = el("div", { className: "decision-section" });
    diffSection.appendChild(el("div", { className: "decision-label" }, "DIFF"));
    diffSection.appendChild(buildDiffView(pending.action.diff_preview));
    panel.appendChild(diffSection);
  }

  // Action buttons
  if (!readOnly) {
    const actions = el("div", { className: "decision-actions" });
    const acceptBtn = el("button", { className: "btn accept-btn" }, "\u2713 Accept");
    acceptBtn.addEventListener("click", () => {
      vscode.postMessage({ command: "decision", data: { id: pending.action.id, decision: "accept" } });
    });
    const rejectBtn = el("button", { className: "btn reject-btn" }, "\u2717 Reject");
    rejectBtn.addEventListener("click", () => {
      vscode.postMessage({ command: "decision", data: { id: pending.action.id, decision: "reject" } });
    });
    const editBtn = el("button", { className: "btn secondary" }, "\u270F\uFE0F Reject with Note");
    editBtn.addEventListener("click", () => {
      vscode.postMessage({ command: "editPrompt", data: pending.action.id });
    });
    actions.appendChild(acceptBtn);
    actions.appendChild(rejectBtn);
    actions.appendChild(editBtn);
    panel.appendChild(actions);
  }

  return panel;
}

function buildPendingQueue(queue: NonNullable<DashboardState["pendingQueue"]>): HTMLElement {
  const section = el("div", { className: "queue-panel" });
  const active = queue[0];
  const waiting = queue.slice(1);

  const header = el("div", { className: "queue-header" });
  header.appendChild(el("div", { className: "queue-title" }, `Approvals in Queue: ${queue.length}`));
  if (active) {
    header.appendChild(el("div", { className: "queue-active" }, `Active: ${active.action.agent} · ${active.action.tool}`));
  }
  section.appendChild(header);

  if (waiting.length === 0) {
    section.appendChild(el("div", { className: "queue-empty" }, "No additional approvals waiting."));
    return section;
  }

  const selectableIds = new Set(waiting.map((item) => item.action.id));
  if (!selectedQueuedDecisionId || !selectableIds.has(selectedQueuedDecisionId)) {
    selectedQueuedDecisionId = waiting[0]?.action.id;
    activePreviewFileTab = 0;
  }

  const list = el("div", { className: "queue-list" });
  for (const item of waiting) {
    const isSelected = item.action.id === selectedQueuedDecisionId;
    const row = el("button", { className: `queue-item ${isSelected ? "selected" : ""}` });
    row.appendChild(el("span", { className: `severity-badge severity-${item.evaluation.severity}` }, item.evaluation.severity.toUpperCase()));
    row.appendChild(el("span", { className: "queue-item-main" }, `${item.action.agent} · ${item.action.tool}`));
    row.appendChild(el("span", { className: "queue-item-files" }, item.action.files.slice(0, 2).map(basename).join(", ")));
    row.addEventListener("click", () => {
      selectedQueuedDecisionId = item.action.id;
      activePreviewFileTab = 0;
      vscode.postMessage({ command: "requestState" });
    });
    list.appendChild(row);
    if (item.action.intent) {
      list.appendChild(el("div", { className: "queue-intent" }, item.action.intent));
    }
  }
  section.appendChild(list);

  const selected = waiting.find((item) => item.action.id === selectedQueuedDecisionId);
  if (selected) {
    section.appendChild(el("div", { className: "queue-preview-label" }, "Queued Item Preview"));
    section.appendChild(buildPendingDecision(selected, true));
  }
  return section;
}

function buildFileDiffSection(pending: PendingDecision, mode: "active" | "preview", readOnly = false): HTMLElement {
  const section = el("div", { className: "decision-section file-diff-section" });

  // File tab bar
  const fileDiffs = pending.fileDiffs ?? [];
  const files = fileDiffs.length > 0 ? fileDiffs : pending.action.files.map((f) => ({ path: f, diff: "", originalContent: undefined }));

  if (files.length === 0) return section;

  const tabBar = el("div", { className: "file-tab-bar" });
  const labelEl = el("div", { className: "decision-label", style: "margin-bottom: 8px;" }, "FILES & CHANGES");
  section.appendChild(labelEl);

  // Ensure activeFileTab is in range
  if (mode === "active") {
    if (activeFileTab >= files.length) activeFileTab = 0;
  } else if (activePreviewFileTab >= files.length) {
    activePreviewFileTab = 0;
  }

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const isActiveTab = mode === "active" ? i === activeFileTab : i === activePreviewFileTab;
    const tab = el("button", { className: `file-tab ${isActiveTab ? "active" : ""}` });

    // File icon based on diff content
    const hasChanges = !!f.diff;
    const icon = hasChanges ? "\u25CF " : "\u25CB ";
    tab.appendChild(el("span", { className: "file-tab-icon" }, icon));
    tab.appendChild(el("span", {}, basename(f.path)));

    const idx = i;
    tab.addEventListener("click", () => {
      if (mode === "active") activeFileTab = idx;
      else activePreviewFileTab = idx;
      vscode.postMessage({ command: "requestState" });
    });
    tabBar.appendChild(tab);
  }
  section.appendChild(tabBar);

  // Active file content
  const activeFile = files[mode === "active" ? activeFileTab : activePreviewFileTab];
  if (!activeFile) return section;

  // File path breadcrumb with actions
  const pathBar = el("div", { className: "file-path-bar" });
  pathBar.appendChild(el("span", { className: "file-full-path" }, activeFile.path));

  if (!readOnly) {
    const fileActions = el("div", { className: "file-actions" });
    const openBtn = el("button", { className: "btn-sm" }, "Open File");
    openBtn.addEventListener("click", () => vscode.postMessage({ command: "openFile", data: activeFile.path }));
    fileActions.appendChild(openBtn);

    const diffBtn = el("button", { className: "btn-sm" }, "Open Diff");
    diffBtn.addEventListener("click", () => vscode.postMessage({ command: "openDiff", data: activeFile.path }));
    fileActions.appendChild(diffBtn);
    pathBar.appendChild(fileActions);
  }
  section.appendChild(pathBar);

  // View mode tabs: Diff | Source
  const viewBar = el("div", { className: "view-tab-bar" });
  const diffKey = mode === "active" ? `source-${activeFileTab}` : `preview-source-${activePreviewFileTab}`;
  const showDiff = !expandedDiffs.has(diffKey);

  const diffTab = el("button", { className: `view-tab ${showDiff ? "active" : ""}` }, "Diff");
  diffTab.addEventListener("click", () => {
    expandedDiffs.delete(diffKey);
    vscode.postMessage({ command: "requestState" });
  });
  const sourceTab = el("button", { className: `view-tab ${!showDiff ? "active" : ""}` }, "Source (HEAD)");
  sourceTab.addEventListener("click", () => {
    expandedDiffs.add(diffKey);
    vscode.postMessage({ command: "requestState" });
  });
  viewBar.appendChild(diffTab);
  viewBar.appendChild(sourceTab);
  section.appendChild(viewBar);

  // Content
  if (showDiff) {
    if (activeFile.diff) {
      section.appendChild(buildDiffView(activeFile.diff));
    } else {
      section.appendChild(el("div", { className: "diff-empty" }, "No diff available for this file (new file or no staged changes)"));
    }
  } else {
    section.appendChild(buildSourceView(activeFile.originalContent ?? "", undefined));
  }

  return section;
}

function buildReviewerAnalysis(analysis: NonNullable<PendingDecision["reviewerAnalysis"]>): HTMLElement {
  const section = el("div", { className: "decision-section reviewer-section" });
  const headerRow = el("div", { className: "reviewer-header" });
  headerRow.appendChild(el("span", { className: "decision-label" }, `REVIEWER (${analysis.reviewerAgent})`));

  const confDots = analysis.confidence >= 0.8 ? "\u25CF\u25CF\u25CF" : analysis.confidence >= 0.5 ? "\u25CF\u25CF\u25CB" : "\u25CF\u25CB\u25CB";
  headerRow.appendChild(el("span", { className: "reviewer-confidence" }, confDots));

  const recClass = `rec-${analysis.recommendation}`;
  headerRow.appendChild(el("span", { className: `reviewer-rec ${recClass}` }, analysis.recommendation.toUpperCase()));
  section.appendChild(headerRow);

  const body = el("div", { className: "reviewer-body" });

  // Intent vs Action comparison
  if (analysis.understood_intent || analysis.actual_action) {
    const comparison = el("div", { className: "reviewer-comparison" });
    if (analysis.understood_intent) {
      comparison.appendChild(el("div", { className: "reviewer-sub" }, "Understood intent:"));
      comparison.appendChild(el("div", { className: "reviewer-item" }, analysis.understood_intent));
    }
    if (analysis.actual_action) {
      comparison.appendChild(el("div", { className: "reviewer-sub" }, "Actual action:"));
      comparison.appendChild(el("div", { className: "reviewer-item" }, analysis.actual_action));
    }
    body.appendChild(comparison);
  }

  if (analysis.divergences.length > 0) {
    body.appendChild(el("div", { className: "reviewer-sub" }, "Divergences:"));
    for (const d of analysis.divergences) {
      body.appendChild(el("div", { className: "reviewer-item warn" }, `\u26A0 ${d}`));
    }
  }

  if (analysis.risks.length > 0) {
    body.appendChild(el("div", { className: "reviewer-sub" }, "Risks:"));
    for (const r of analysis.risks) {
      body.appendChild(el("div", { className: "reviewer-item error" }, `\u2022 ${r}`));
    }
  }

  if (analysis.suggestion) {
    body.appendChild(el("div", { className: "reviewer-suggestion" }, `\u2192 ${analysis.suggestion}`));
  }

  section.appendChild(body);
  return section;
}

// --- Agent Panel ---

function buildAgentPanel(state: DashboardState): HTMLElement | null {
  if (!state.agentRunning && !state.agentKind) return null;
  const panel = el("div", { className: "agent-panel" });
  const statusLine = el("div", { className: "agent-status-line" });
  const dotCls = state.agentRunning ? (state.agentPaused ? "paused" : "running") : "done";
  statusLine.appendChild(el("span", { className: `agent-dot ${dotCls}` }));
  statusLine.appendChild(el("span", { className: "agent-kind" }, state.agentKind ?? ""));
  const statusText = state.agentRunning ? (state.agentPaused ? "paused" : "running") : "done";
  statusLine.appendChild(el("span", { className: "agent-meta" }, statusText));
  if (state.agentElapsed) statusLine.appendChild(el("span", { className: "agent-meta" }, `${Math.round(state.agentElapsed / 1000)}s`));
  if (state.agentTokens) statusLine.appendChild(el("span", { className: "agent-meta" }, `~${(state.agentTokens / 1000).toFixed(1)}k tok`));
  panel.appendChild(statusLine);

  if (state.agentRunning && state.agentContextPct !== undefined) {
    const barWrap = el("div", { className: "context-bar" });
    barWrap.appendChild(el("span", {}, `ctx ${state.agentContextPct}%`));
    const track = el("div", { className: "context-track" });
    track.appendChild(el("div", { className: "context-fill", style: `width: ${state.agentContextPct}%;` }));
    barWrap.appendChild(track);
    panel.appendChild(barWrap);
  }

  if (state.agentPrompt) {
    const prompt = state.agentPrompt.length > 80 ? state.agentPrompt.slice(0, 80) + "\u2026" : state.agentPrompt;
    panel.appendChild(el("div", { className: "agent-prompt" }, `"${prompt}"`));
  }
  return panel;
}

// --- Decisions History Tab ---

function buildDecisionsTab(decisions: RecentDecision[]): HTMLElement {
  const container = el("div", { className: "decisions-tab" });
  if (!decisions.length) {
    container.appendChild(el("div", { className: "empty-state" }, "No decisions recorded yet. Agent actions will appear here."));
    return container;
  }

  for (const d of decisions) {
    const isAccepted = d.human_decision === "accept" || d.human_decision === "auto_accept";
    const icon = isAccepted ? "\u2713" : "\u2717";
    const cls = isAccepted ? "accepted" : "rejected";

    const row = el("div", { className: `history-row ${cls}` });
    row.appendChild(el("span", { className: `history-icon ${cls}` }, icon));

    const info = el("div", { className: "history-info" });
    const topLine = el("div", { className: "history-top" });
    topLine.appendChild(el("span", { className: "history-decision" }, d.human_decision));
    topLine.appendChild(el("span", { className: `severity-badge severity-${d.severity}` }, d.severity));
    topLine.appendChild(el("span", { className: "history-agent" }, d.agent));
    topLine.appendChild(el("span", { className: "history-tool" }, d.tool));
    topLine.appendChild(el("span", { className: "history-time" }, timeAgo(d.ts)));
    info.appendChild(topLine);

    const bottomLine = el("div", { className: "history-bottom" });
    bottomLine.appendChild(el("span", { className: "history-intent" }, d.intent));
    info.appendChild(bottomLine);

    const filesLine = el("div", { className: "history-files-line" });
    for (const f of d.files.slice(0, 3)) {
      const fileEl = el("span", { className: "history-file-chip" });
      fileEl.textContent = basename(f);
      fileEl.title = f;
      fileEl.style.cursor = "pointer";
      fileEl.addEventListener("click", (e) => {
        e.stopPropagation();
        vscode.postMessage({ command: "openDiff", data: f });
      });
      filesLine.appendChild(fileEl);
    }
    if (d.files.length > 3) {
      filesLine.appendChild(el("span", { className: "history-file-more" }, `+${d.files.length - 3} more`));
    }
    info.appendChild(filesLine);

    row.appendChild(info);

    // Expandable detail
    const detail = el("div", { className: "history-detail hidden" });
    if (d.human_note) detail.appendChild(el("div", { className: "history-note" }, `Note: "${d.human_note}"`));

    // File links
    const fileLinks = el("div", { className: "history-file-links" });
    for (const f of d.files) {
      const link = el("div", { className: "history-file-link" });
      const openFile = el("span", { className: "link-action" }, basename(f));
      openFile.title = f;
      openFile.addEventListener("click", (e) => {
        e.stopPropagation();
        vscode.postMessage({ command: "openFile", data: f });
      });
      const openDiff = el("span", { className: "link-action link-diff" }, "diff");
      openDiff.addEventListener("click", (e) => {
        e.stopPropagation();
        vscode.postMessage({ command: "openDiff", data: f });
      });
      link.appendChild(el("span", {}, "\uD83D\uDCC4 "));
      link.appendChild(openFile);
      link.appendChild(el("span", { className: "link-sep" }, " | "));
      link.appendChild(openDiff);
      fileLinks.appendChild(link);
    }
    detail.appendChild(fileLinks);

    row.addEventListener("click", () => detail.classList.toggle("hidden"));
    container.appendChild(row);
    container.appendChild(detail);
  }
  return container;
}

// --- Files ---

function buildFiles(files: FileChange[]): HTMLElement | null {
  if (!files.length) return null;
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  const list = el("div", { className: "file-list" });
  for (const f of files) {
    const row = el("div", { className: "file-row" });
    const pathEl = el("span", { className: "file-path", title: "Click: diff \u00B7 Cmd+Click: open file" }, f.path);
    pathEl.style.cursor = "pointer";
    pathEl.addEventListener("click", (e) => {
      if ((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) {
        vscode.postMessage({ command: "openFileAtChange", data: f.path });
      } else {
        vscode.postMessage({ command: "openDiff", data: f.path });
      }
    });
    row.appendChild(pathEl);
    row.appendChild(el("span", { className: "file-add" }, `+${f.additions}`));
    row.appendChild(el("span", { className: "file-del" }, `-${f.deletions}`));
    list.appendChild(row);
  }
  const section = el("div", { className: "section" });
  const header = el("div", { className: "section-header" }, "Files ",
    el("span", { className: "count" }, `${files.length}`),
    el("span", { style: "color: var(--success);" }, ` +${totalAdd}`),
    el("span", { style: "color: var(--error);" }, ` -${totalDel}`));
  section.appendChild(header);
  section.appendChild(list);
  return section;
}

// --- Log ---

function buildLog(log: LogEntry[]): HTMLElement {
  const logDiv = el("div", { className: "log" });
  if (!log.length) {
    logDiv.appendChild(el("div", { className: "empty-state" }, "No events yet"));
  } else {
    for (const entry of log.slice(-60).reverse()) {
      const row = el("div", { className: "log-entry" });
      row.appendChild(el("span", { className: "log-time" }, entry.time));
      row.appendChild(el("span", { className: `log-msg ${entry.level}` }, entry.message));
      logDiv.appendChild(row);
    }
  }
  const section = el("div", { className: "section" });
  section.appendChild(el("div", { className: "section-header" }, "Log ",
    log.length ? el("span", { className: "count" }, `${log.length}`) : ""));
  section.appendChild(logDiv);
  return section;
}

// --- Actions bar ---

function buildActions(state: DashboardState): HTMLElement {
  const bar = el("div", { className: "actions" });
  const addBtn = (label: string, command: string, primary = false) => {
    const btn = el("button", { className: primary ? "btn" : "btn secondary" }, label);
    btn.addEventListener("click", () => vscode.postMessage({ command }));
    bar.appendChild(btn);
  };
  if (state.agentRunning) {
    if (state.agentPaused) addBtn("\u25B6 Resume", "resumeAgent");
    else addBtn("\u23F8 Pause", "pauseAgent");
    addBtn("\u2717 Kill", "killAgent");
  } else {
    addBtn("Run Agent", "runAgent", true);
  }
  addBtn("Rollback", "rollback");
  addBtn("Snapshot", "restoreSnapshot");
  return bar;
}

// --- Render ---

function renderToDOM(container: HTMLElement, state: DashboardState): void {
  while (container.firstChild) container.removeChild(container.firstChild);
  const dashboard = el("div", { className: "dashboard" });

  dashboard.appendChild(buildHeader(state));
  dashboard.appendChild(buildTabBar());

  if (activeTab === "decisions") {
    dashboard.appendChild(buildDecisionsTab(state.recentDecisions ?? []));
  } else {
    // Pending decision takes priority
    if (state.pendingDecision) {
      if (state.pendingQueue && state.pendingQueue.length > 0) {
        dashboard.appendChild(buildPendingQueue(state.pendingQueue));
      }
      dashboard.appendChild(buildPendingDecision(state.pendingDecision));
    } else {
      selectedQueuedDecisionId = undefined;
    }

    const agentPanel = buildAgentPanel(state);
    if (agentPanel) dashboard.appendChild(agentPanel);

    const files = buildFiles(state.files);
    if (files) dashboard.appendChild(files);

    dashboard.appendChild(buildLog(state.log));
    dashboard.appendChild(buildActions(state));
  }

  container.appendChild(dashboard);
}

// --- Keyboard shortcuts ---
document.addEventListener("keydown", (e) => {
  if (e.target !== document.body) return;
  const key = e.key.toLowerCase();
  if (key === "a") vscode.postMessage({ command: "runAgent" });
  else if (key === "j") { activeTab = "decisions"; vscode.postMessage({ command: "requestState" }); }
  else if (key === "d") { activeTab = "dashboard"; vscode.postMessage({ command: "requestState" }); }
});

// --- Message handler ---
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "state") {
    const app = document.getElementById("app");
    if (app) renderToDOM(app, msg.data);
  }
});

const appEl = document.getElementById("app");
if (appEl) {
  appEl.appendChild(el("div", { className: "empty-state", style: "padding: 40px; text-align: center;" }, "Loading\u2026"));
}
