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

interface PendingDecision {
  action: {
    id: string;
    agent: string;
    tool: string;
    files: string[];
    intent: string;
    diff_preview?: string;
  };
  evaluation: {
    points: string[];
    severity: string;
    explanations: Record<string, string>;
  };
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
  recentDecisions?: RecentDecision[];
}

const collapsedSections = new Set<string>();
let activeTab: "dashboard" | "decisions" = "dashboard";

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

// --- Pending Decision Panel ---

function buildPendingDecision(pending: PendingDecision): HTMLElement {
  const panel = el("div", { className: "decision-panel" });

  // Header
  const header = el("div", { className: "decision-header" });
  const sevClass = `severity-${pending.evaluation.severity}`;
  header.appendChild(el("span", { className: `severity-badge ${sevClass}` }, pending.evaluation.severity.toUpperCase()));
  header.appendChild(el("span", { className: "decision-agent" },
    `${pending.action.agent} \u00B7 ${pending.action.tool} \u00B7 ${pending.action.files.length} file(s)`));
  panel.appendChild(header);

  // Intent
  const intentSection = el("div", { className: "decision-section" });
  intentSection.appendChild(el("div", { className: "decision-label" }, "INTENT"));
  intentSection.appendChild(el("div", { className: "decision-intent" }, `"${pending.action.intent}"`));
  panel.appendChild(intentSection);

  // Files
  const filesSection = el("div", { className: "decision-section" });
  filesSection.appendChild(el("div", { className: "decision-label" }, "FILES"));
  for (const f of pending.action.files) {
    const row = el("div", { className: "decision-file" });
    row.appendChild(el("span", {}, `\uD83D\uDCC4 ${f}`));
    row.style.cursor = "pointer";
    row.addEventListener("click", () => vscode.postMessage({ command: "openDiff", data: f }));
    filesSection.appendChild(row);
  }
  panel.appendChild(filesSection);

  // Decision Points
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

  // Diff preview
  if (pending.action.diff_preview) {
    const diffSection = el("div", { className: "decision-section" });
    diffSection.appendChild(el("div", { className: "decision-label", style: "cursor: pointer;" }, "\u25B8 DIFF PREVIEW"));
    const diffPre = el("pre", { className: "diff-preview collapsed" });
    diffPre.textContent = pending.action.diff_preview.slice(0, 3000);
    diffSection.querySelector(".decision-label")?.addEventListener("click", () => {
      diffPre.classList.toggle("collapsed");
      const label = diffSection.querySelector(".decision-label");
      if (label) label.textContent = diffPre.classList.contains("collapsed") ? "\u25B8 DIFF PREVIEW" : "\u25BE DIFF PREVIEW";
    });
    // Fix: re-query after appending
    diffSection.appendChild(diffPre);
    const labelEl = diffSection.querySelector(".decision-label");
    if (labelEl) {
      labelEl.addEventListener("click", () => {
        diffPre.classList.toggle("collapsed");
        labelEl.textContent = diffPre.classList.contains("collapsed") ? "\u25B8 DIFF PREVIEW" : "\u25BE DIFF PREVIEW";
      });
    }
    panel.appendChild(diffSection);
  }

  // Action buttons
  const actions = el("div", { className: "decision-actions" });
  const acceptBtn = el("button", { className: "btn accept-btn" }, "\u2713 Accept");
  acceptBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "decision", data: { id: pending.action.id, decision: "accept" } });
  });
  const rejectBtn = el("button", { className: "btn reject-btn" }, "\u2717 Reject");
  rejectBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "decision", data: { id: pending.action.id, decision: "reject" } });
  });
  const editBtn = el("button", { className: "btn secondary" }, "\u270F\uFE0F Edit & Reject");
  editBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "editPrompt", data: pending.action.id });
  });
  actions.appendChild(acceptBtn);
  actions.appendChild(rejectBtn);
  actions.appendChild(editBtn);
  panel.appendChild(actions);

  return panel;
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
    row.appendChild(el("span", { className: "history-decision" }, d.human_decision));
    row.appendChild(el("span", { className: "history-agent" }, d.agent));
    row.appendChild(el("span", { className: "history-files" }, d.files.slice(0, 2).join(", ")));
    row.appendChild(el("span", { className: "history-time" }, timeAgo(d.ts)));

    // Expandable detail
    const detail = el("div", { className: "history-detail hidden" });
    detail.appendChild(el("div", {}, `Intent: ${d.intent}`));
    detail.appendChild(el("div", {}, `Severity: ${d.severity}`));
    if (d.human_note) detail.appendChild(el("div", {}, `Note: "${d.human_note}"`));

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
    const pathEl = el("span", { className: "file-path", title: "Click: diff" }, f.path);
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
      dashboard.appendChild(buildPendingDecision(state.pendingDecision));
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
