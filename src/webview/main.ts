/** Webview app — renders the Gait dashboard inside VS Code */

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

interface StageResult {
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  output: string;
  error: string;
  duration: number;
}

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

interface DashboardState {
  project: string;
  version: string;
  branch: string;
  stacks: string[];
  clean: boolean;
  stages: StageResult[];
  log: LogEntry[];
  files: FileChange[];
  pipelineRunning: boolean;
  lastGate?: { passed: boolean; duration: number };
  configuredStages: string[];
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
  regressions?: string[];
  flakyTests?: string[];
  coverage?: { file: string; name: string }[];
  coverageStatus?: "running" | "done" | "error";
  coverageError?: string;
  commitGateOpen?: boolean;
}

// Track collapsed sections
const collapsedSections = new Set<string>();

// --- Helpers ---

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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

// --- Builders ---

function buildHeader(state: DashboardState): HTMLElement {
  const header = el("div", { className: "header" });
  header.appendChild(el("h1", {}, state.project));
  header.appendChild(el("span", { className: `status-dot ${state.clean ? "clean" : "dirty"}` }));
  if (state.branch) {
    header.appendChild(el("span", { className: "branch" }, state.branch));
  }
  header.appendChild(el("span", { className: "spacer" }));
  for (const s of state.stacks) {
    header.appendChild(el("span", { className: "stack-badge" }, s));
  }
  return header;
}

function buildGateBanner(state: DashboardState): HTMLElement | null {
  if (!state.lastGate) return null;
  const passed = state.lastGate.passed;
  const cls = passed ? "passed" : "failed";
  const icon = el("span", { className: "gate-icon" }, passed ? "\u2713" : "\u2717");
  const label = passed ? "Gate passed" : "Gate blocked";
  const dur = el("span", { className: "gate-dur" }, `${(state.lastGate.duration / 1000).toFixed(1)}s`);
  const banner = el("div", { className: `gate-banner ${cls}` });
  banner.appendChild(icon);
  banner.appendChild(el("span", {}, label));
  banner.appendChild(el("span", { className: "spacer" }));
  banner.appendChild(dur);
  return banner;
}

function buildPipeline(stages: StageResult[]): HTMLElement {
  const container = el("div", { className: "pipeline" });
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];

    // Connector before (not for first)
    if (i > 0) {
      let connCls = "connector";
      const prev = stages[i - 1];
      if (prev.status === "passed") connCls += " done";
      else if (prev.status === "failed") connCls += " fail";
      container.appendChild(el("div", { className: connCls }));
    }

    const stage = el("div", { className: `stage ${s.status}` });

    // Status icon
    const icons: Record<string, string> = {
      pending: "", running: "\u25AA", passed: "\u2713", failed: "\u2717", skipped: "\u2013",
    };
    stage.appendChild(el("span", { className: "icon" }, icons[s.status] ?? ""));
    stage.appendChild(el("span", { className: "name" }, capitalize(s.name)));
    if (s.duration > 0) {
      stage.appendChild(el("span", { className: "dur" }, `${(s.duration / 1000).toFixed(1)}s`));
    }

    // Fix button for failed stages
    if (s.status === "failed") {
      const fix = el("button", { className: "fix-btn", title: "Click: fix with agent. Shift+click: auto-fix loop." }, "Fix");
      fix.addEventListener("click", (e) => {
        vscode.postMessage({ command: (e as MouseEvent).shiftKey ? "autofixStage" : "fixStage", data: s.name });
      });
      stage.appendChild(fix);
    } else {
      stage.addEventListener("click", () => vscode.postMessage({ command: "runStage", data: s.name }));
    }

    container.appendChild(stage);
  }
  return container;
}

function buildRegressions(state: DashboardState): HTMLElement | null {
  if (!state.regressions?.length) return null;
  const box = el("div", { className: "regressions" });
  box.appendChild(el("div", { className: "reg-title" },
    `${state.regressions.length} regression${state.regressions.length > 1 ? "s" : ""} detected`));
  for (const name of state.regressions.slice(0, 8)) {
    box.appendChild(el("div", { className: "reg-item" }, `\u2717 ${name}`));
  }
  if (state.regressions.length > 8) {
    box.appendChild(el("div", { className: "reg-item", style: "opacity: 0.6;" },
      `\u2026 and ${state.regressions.length - 8} more`));
  }
  if (state.flakyTests?.length) {
    box.appendChild(el("div", { style: "color: var(--warn); font-size: 0.8em; margin-top: 6px;" },
      `${state.flakyTests.length} flaky test${state.flakyTests.length > 1 ? "s" : ""} exempted`));
  }
  return box;
}

function buildAgentPanel(state: DashboardState): HTMLElement | null {
  if (!state.agentRunning && !state.agentKind) return null;
  const panel = el("div", { className: "agent-panel" });

  const statusLine = el("div", { className: "agent-status-line" });
  const dotCls = state.agentRunning ? (state.agentPaused ? "paused" : "running") : "done";
  statusLine.appendChild(el("span", { className: `agent-dot ${dotCls}` }));
  statusLine.appendChild(el("span", { className: "agent-kind" }, state.agentKind ?? ""));

  const statusText = state.agentRunning ? (state.agentPaused ? "paused" : "running") : "done";
  statusLine.appendChild(el("span", { className: "agent-meta" }, statusText));

  if (state.agentElapsed) {
    statusLine.appendChild(el("span", { className: "agent-meta" }, `${Math.round(state.agentElapsed / 1000)}s`));
  }
  if (state.agentTokens) {
    statusLine.appendChild(el("span", { className: "agent-meta" }, `~${(state.agentTokens / 1000).toFixed(1)}k tok`));
  }
  panel.appendChild(statusLine);

  // Context bar
  if (state.agentRunning && state.agentContextPct !== undefined) {
    const barWrap = el("div", { className: "context-bar" });
    barWrap.appendChild(el("span", {}, `ctx ${state.agentContextPct}%`));
    const track = el("div", { className: "context-track" });
    const fill = el("div", { className: "context-fill", style: `width: ${state.agentContextPct}%;` });
    track.appendChild(fill);
    barWrap.appendChild(track);
    panel.appendChild(barWrap);
  }

  if (state.agentPrompt) {
    const prompt = state.agentPrompt.length > 80 ? state.agentPrompt.slice(0, 80) + "\u2026" : state.agentPrompt;
    panel.appendChild(el("div", { className: "agent-prompt" }, `"${prompt}"`));
  }

  return panel;
}

function buildReview(state: DashboardState): HTMLElement | null {
  if (!state.review) return null;
  const r = state.review;
  const panel = el("div", { className: "review-panel" });
  panel.appendChild(el("div", { className: "section-header" },
    el("span", { className: "chevron" }, "\u25BE"),
    el("span", {}, "Post-task review"),
  ));

  const grid = el("div", { className: "review-grid" });
  grid.appendChild(el("span", { className: "review-label" }, "Task"));
  grid.appendChild(el("span", { className: "review-value" }, `"${r.taskDesc}"`));
  grid.appendChild(el("span", { className: "review-label" }, "Agent"));
  grid.appendChild(el("span", { className: "review-value" }, `${r.agentKind} \u00B7 ${(r.duration / 1000).toFixed(1)}s \u00B7 ${(r.tokens / 1000).toFixed(1)}k tokens`));
  grid.appendChild(el("span", { className: "review-label" }, "Changes"));
  grid.appendChild(el("span", { className: "review-value" }, `${r.filesChanged} file(s) +${r.additions} -${r.deletions}`));
  grid.appendChild(el("span", { className: "review-label" }, "Gate"));
  const gateVal = el("span", { className: "review-value", style: `color: var(--${r.gatePassed ? "success" : "error"});` },
    r.gatePassed ? "\u2713 Passed" : "\u2717 Failed");
  grid.appendChild(gateVal);

  panel.appendChild(grid);
  return panel;
}

/** Create a collapsible section with header + content body */
function collapsibleSection(id: string, labelParts: (Node | string)[], content: HTMLElement): HTMLElement {
  const section = el("div", { className: "section" });
  const isCollapsed = collapsedSections.has(id);

  const header = el("div", { className: `section-header${isCollapsed ? " collapsed" : ""}` });
  header.appendChild(el("span", { className: "chevron" }, isCollapsed ? "\u25B8" : "\u25BE"));
  for (const p of labelParts) {
    if (typeof p === "string") header.appendChild(el("span", {}, p));
    else header.appendChild(p);
  }
  header.addEventListener("click", () => {
    if (collapsedSections.has(id)) collapsedSections.delete(id);
    else collapsedSections.add(id);
    // Re-render by requesting state again
    vscode.postMessage({ command: "requestState" });
  });
  section.appendChild(header);

  if (!isCollapsed) section.appendChild(content);
  return section;
}

function buildCoverage(state: DashboardState): HTMLElement | null {
  if (!state.coverageStatus) return null;

  if (state.coverageStatus === "running") {
    const body = el("div", { style: "color: var(--muted); font-size: 0.85em; padding: 4px 0;" }, "Analyzing coverage...");
    return collapsibleSection("coverage", ["Coverage"], body);
  }

  if (state.coverageError) {
    const body = el("div", { style: "color: var(--warn); font-size: 0.85em;" }, state.coverageError);
    return collapsibleSection("coverage", [
      "Coverage",
      el("span", { className: "count", style: "color: var(--warn);" }, "!"),
    ], body);
  }

  const items = state.coverage ?? [];
  if (items.length === 0 && state.coverageStatus === "done") {
    const body = el("div", { style: "color: var(--success); font-size: 0.85em;" }, "\u2713 All changed functions are tested");
    return collapsibleSection("coverage", ["Coverage"], body);
  }

  const body = el("div", { style: "font-family: var(--vscode-editor-font-family); font-size: 0.8em;" });
  for (const item of items.slice(0, 10)) {
    body.appendChild(el("div", { style: "color: var(--warn); padding: 2px 0;" },
      `\u25CB ${item.file}:${item.name}`));
  }
  if (items.length > 10) {
    body.appendChild(el("div", { style: "color: var(--muted);" }, `\u2026 and ${items.length - 10} more`));
  }
  return collapsibleSection("coverage", [
    "Coverage",
    el("span", { className: "count", style: "color: var(--warn);" }, `${items.length}`),
  ], body);
}

function buildFiles(files: FileChange[]): HTMLElement | null {
  if (!files.length) return null;
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  const list = el("div", { className: "file-list" });
  for (const f of files) {
    const row = el("div", { className: "file-row" });
    row.appendChild(el("span", { className: "file-path" }, f.path));
    row.appendChild(el("span", { className: "file-add" }, `+${f.additions}`));
    row.appendChild(el("span", { className: "file-del" }, `-${f.deletions}`));
    list.appendChild(row);
  }
  return collapsibleSection("files", [
    "Files",
    el("span", { className: "count" }, `${files.length}`),
    el("span", { style: "color: var(--success); font-size: 1em;" }, `+${totalAdd}`),
    el("span", { style: "color: var(--error); font-size: 1em;" }, `-${totalDel}`),
  ], list);
}

function buildLog(log: LogEntry[]): HTMLElement {
  const logDiv = el("div", { className: "log" });
  if (!log.length) {
    logDiv.appendChild(el("div", { className: "log-empty" }, "No events yet"));
  } else {
    for (const entry of log.slice(-60).reverse()) {
      const row = el("div", { className: "log-entry" });
      row.appendChild(el("span", { className: "log-time" }, entry.time.split(":").slice(0, 3).join(":")));
      row.appendChild(el("span", { className: `log-msg ${entry.level}` }, entry.message));
      logDiv.appendChild(row);
    }
  }
  const labelParts: (Node | string)[] = ["Log"];
  if (log.length) labelParts.push(el("span", { className: "count" }, `${log.length}`));
  return collapsibleSection("log", labelParts, logDiv);
}

function buildActions(state: DashboardState): HTMLElement {
  const bar = el("div", { className: "actions" });

  const addBtn = (label: string, command: string, primary = false, kbd?: string) => {
    const btn = el("button", { className: primary ? "btn" : "btn secondary" }, label);
    if (kbd) btn.appendChild(el("span", { className: "kbd" }, kbd));
    if (state.pipelineRunning) btn.setAttribute("disabled", "true");
    btn.addEventListener("click", () => vscode.postMessage({ command }));
    bar.appendChild(btn);
  };

  addBtn("Run Gate", "gate", true, "G");

  const stages = state.configuredStages ?? [];
  if (stages.includes("lint")) addBtn("Lint", "lint", false, "L");
  if (stages.includes("test")) addBtn("Test", "test", false, "T");
  if (stages.includes("typecheck")) addBtn("Typecheck", "typecheck");
  if (stages.includes("build")) addBtn("Build", "build");

  // Agent controls
  if (state.agentRunning) {
    if (state.agentPaused) addBtn("\u25B6 Resume", "resumeAgent");
    else addBtn("\u23F8 Pause", "pauseAgent");
    addBtn("\u2717 Kill", "killAgent");
  } else {
    addBtn("Agent", "runAgent", false, "A");
  }

  addBtn("Rollback", "rollback");
  addBtn("Release", "release");
  return bar;
}

function buildCommitGateModal(state: DashboardState): HTMLElement | null {
  if (!state.commitGateOpen || !state.lastGate) return null;
  const overlay = el("div", { className: "modal-overlay" });
  const modal = el("div", { className: "modal" });
  overlay.appendChild(modal);
  modal.appendChild(el("h2", {}, "Commit Gate"));

  for (const s of state.stages) {
    const row = el("div", { className: "stage-row" });
    const colors: Record<string, string> = { passed: "var(--success)", failed: "var(--error)", running: "var(--warn)" };
    const icons: Record<string, string> = { passed: "\u2713", failed: "\u2717", skipped: "\u2013", running: "\u25AA", pending: "" };
    const icon = el("span", { className: "icon", style: `background: ${colors[s.status] ?? "var(--muted)"}; color: var(--bg);` }, icons[s.status] ?? "");
    row.appendChild(icon);
    row.appendChild(el("span", {}, capitalize(s.name)));
    if (s.duration > 0) row.appendChild(el("span", { className: "dur" }, `${(s.duration / 1000).toFixed(1)}s`));
    modal.appendChild(row);
  }

  const passed = state.lastGate.passed;
  const dur = (state.lastGate.duration / 1000).toFixed(1);
  modal.appendChild(el("div", { className: `modal-result ${passed ? "passed" : "failed"}` },
    `${passed ? "\u2713 Passed" : "\u2717 Blocked"} (${dur}s)`));

  const actions = el("div", { className: "modal-actions" });
  if (passed) {
    const commitBtn = el("button", { className: "btn" }, "Commit");
    commitBtn.addEventListener("click", () => vscode.postMessage({ command: "commitGateApprove" }));
    actions.appendChild(commitBtn);
  }
  const cancelBtn = el("button", { className: "btn secondary" }, passed ? "Cancel" : "Close");
  cancelBtn.addEventListener("click", () => vscode.postMessage({ command: "commitGateClose" }));
  actions.appendChild(cancelBtn);
  modal.appendChild(actions);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) vscode.postMessage({ command: "commitGateClose" });
  });
  return overlay;
}

// --- Render ---

function renderToDOM(container: HTMLElement, state: DashboardState): void {
  while (container.firstChild) container.removeChild(container.firstChild);

  const dashboard = el("div", { className: "dashboard" });

  dashboard.appendChild(buildHeader(state));

  const banner = buildGateBanner(state);
  if (banner) dashboard.appendChild(banner);

  const regressions = buildRegressions(state);
  if (regressions) dashboard.appendChild(regressions);

  if (state.stages.length) dashboard.appendChild(buildPipeline(state.stages));

  const agentPanel = buildAgentPanel(state);
  if (agentPanel) dashboard.appendChild(agentPanel);

  const review = buildReview(state);
  if (review) dashboard.appendChild(review);

  const coverage = buildCoverage(state);
  if (coverage) dashboard.appendChild(coverage);

  const files = buildFiles(state.files);
  if (files) dashboard.appendChild(files);

  dashboard.appendChild(buildLog(state.log));
  dashboard.appendChild(buildActions(state));

  container.appendChild(dashboard);

  const modal = buildCommitGateModal(state);
  if (modal) container.appendChild(modal);
}

// --- Keyboard shortcuts ---
document.addEventListener("keydown", (e) => {
  if (e.target !== document.body) return;
  const key = e.key.toLowerCase();
  if (key === "g") vscode.postMessage({ command: "gate" });
  else if (key === "l") vscode.postMessage({ command: "lint" });
  else if (key === "t") vscode.postMessage({ command: "test" });
  else if (key === "a") vscode.postMessage({ command: "runAgent" });
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
  appEl.appendChild(el("div", { className: "log-empty", style: "padding: 40px; text-align: center;" }, "Loading\u2026"));
}
