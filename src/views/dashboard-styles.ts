/** Dashboard CSS for HITL-Gate */
export const DASHBOARD_CSS = `
:root {
  --bg: var(--vscode-editor-background);
  --fg: var(--vscode-editor-foreground);
  --border: var(--vscode-panel-border, #2d2d2d);
  --muted: var(--vscode-descriptionForeground);
  --accent: var(--vscode-textLink-foreground);
  --success: var(--vscode-testing-iconPassed, #3fb950);
  --error: var(--vscode-testing-iconFailed, #f85149);
  --warn: var(--vscode-editorWarning-foreground, #d29922);
  --badge-bg: var(--vscode-badge-background);
  --badge-fg: var(--vscode-badge-foreground);
  --btn-bg: var(--vscode-button-background);
  --btn-fg: var(--vscode-button-foreground);
  --btn-hover: var(--vscode-button-hoverBackground);
  --input-bg: var(--vscode-input-background);
  --surface: var(--vscode-editorWidget-background, #1e1e1e);
  --surface2: var(--vscode-editor-inactiveSelectionBackground, #262626);
  --hitlgate-claude: #6495ED;
  --hitlgate-codex: #50B478;
  --hitlgate-accept: #4CAF50;
  --hitlgate-reject: #f44336;
  --hitlgate-modify: #FF9800;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family, 'Inter', -apple-system, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  color: var(--fg);
  background: var(--bg);
  padding: 0;
  line-height: 1.5;
}
.dashboard { padding: 20px 24px; max-width: 900px; }

/* Header */
.header { display: flex; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 0; }
.header h1 { font-size: 1.15em; font-weight: 600; letter-spacing: -0.01em; }
.header .header-icon { font-size: 1.2em; }
.header .branch { color: var(--accent); font-weight: 500; font-size: 0.85em; background: var(--surface); padding: 2px 8px; border-radius: 4px; font-family: var(--vscode-editor-font-family, monospace); }
.header .stack-badge { background: var(--badge-bg); color: var(--badge-fg); padding: 1px 8px; border-radius: 3px; font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.header .status-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.header .status-dot.clean { background: var(--success); }
.header .status-dot.dirty { background: var(--warn); }
.header .spacer { flex: 1; }

/* Tab bar */
.tab-bar { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
.tab { background: none; border: none; color: var(--muted); padding: 10px 20px; font-size: 0.85em; font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent; font-family: inherit; }
.tab:hover { color: var(--fg); }
.tab.active { color: var(--fg); border-bottom-color: var(--accent); }

/* Decision panel */
.decision-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0; margin-bottom: 20px; overflow: hidden; }
.queue-panel { background: color-mix(in srgb, var(--accent) 6%, var(--surface)); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
.queue-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.queue-title { font-size: 0.85em; font-weight: 700; letter-spacing: 0.3px; }
.queue-active { color: var(--muted); font-size: 0.8em; }
.queue-empty { color: var(--muted); font-size: 0.82em; font-style: italic; }
.queue-list { display: flex; flex-direction: column; gap: 6px; }
.queue-item { display: flex; align-items: center; gap: 8px; width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; color: var(--fg); cursor: pointer; text-align: left; }
.queue-item:hover { border-color: var(--accent); }
.queue-item.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.queue-item-main { font-size: 0.84em; font-weight: 600; }
.queue-item-files { color: var(--muted); font-size: 0.8em; font-family: var(--vscode-editor-font-family, monospace); }
.queue-intent { color: var(--muted); font-size: 0.8em; margin: -2px 0 4px 92px; font-style: italic; }
.queue-preview-label { color: var(--muted); font-size: 0.72em; font-weight: 700; letter-spacing: 0.5px; margin: 14px 0 8px; text-transform: uppercase; }
.queue-readonly { margin-left: auto; font-size: 0.68em; font-weight: 700; letter-spacing: 0.5px; color: var(--muted); }
.decision-header { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border); background: var(--surface2); }
.severity-badge { padding: 3px 10px; border-radius: 4px; font-size: 0.7em; font-weight: 700; letter-spacing: 0.5px; }
.severity-low { background: color-mix(in srgb, var(--success) 20%, transparent); color: var(--success); }
.severity-medium { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
.severity-high { background: color-mix(in srgb, var(--error) 20%, transparent); color: var(--error); }
.decision-agent { color: var(--muted); font-size: 0.85em; }

.decision-section { padding: 14px 20px; border-bottom: 1px solid var(--border); }
.decision-section:last-child { border-bottom: none; }
.decision-label { font-size: 0.7em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 8px; }
.decision-intent { font-style: italic; color: var(--fg); font-size: 0.9em; }
.decision-file { padding: 4px 0; font-family: var(--vscode-editor-font-family); font-size: 0.85em; color: var(--fg); }
.decision-file:hover { color: var(--accent); }

/* Decision points */
.decision-point { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 0.85em; }
.point-icon { width: 20px; text-align: center; flex-shrink: 0; }
.point-type { font-weight: 600; color: var(--fg); min-width: 140px; }
.point-desc { color: var(--muted); flex: 1; }

/* Reviewer */
.reviewer-section { background: color-mix(in srgb, var(--accent) 5%, transparent); }
.reviewer-header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.reviewer-confidence { color: var(--accent); font-size: 0.9em; letter-spacing: 2px; }
.reviewer-rec { padding: 2px 8px; border-radius: 3px; font-size: 0.7em; font-weight: 700; letter-spacing: 0.5px; }
.rec-accept { background: color-mix(in srgb, var(--hitlgate-accept) 20%, transparent); color: var(--hitlgate-accept); }
.rec-reject { background: color-mix(in srgb, var(--hitlgate-reject) 20%, transparent); color: var(--hitlgate-reject); }
.rec-modify { background: color-mix(in srgb, var(--hitlgate-modify) 20%, transparent); color: var(--hitlgate-modify); }
.reviewer-loading { color: var(--muted); font-style: italic; font-size: 0.85em; }
.reviewer-body { font-size: 0.85em; }
.reviewer-sub { color: var(--muted); font-weight: 600; font-size: 0.8em; margin-top: 8px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px; }
.reviewer-item { padding: 3px 0; }
.reviewer-item.warn { color: var(--warn); }
.reviewer-item.error { color: var(--error); }
.reviewer-suggestion { color: var(--accent); margin-top: 8px; font-style: italic; }

/* Diff viewer */
.diff-container { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin-top: 8px; max-height: 500px; overflow-y: auto; }
.diff-table { width: 100%; border-collapse: collapse; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.8em; line-height: 1.65; }
.diff-line td { padding: 0 8px; white-space: pre; }
.diff-linenum { color: var(--muted); opacity: 0.5; min-width: 36px; text-align: right; user-select: none; border-right: 1px solid var(--border); padding-right: 6px !important; font-size: 0.85em; }
.diff-code { width: 100%; padding-left: 10px !important; }
.diff-add { background: color-mix(in srgb, var(--success) 12%, transparent); }
.diff-add .diff-code { color: var(--success); }
.diff-del { background: color-mix(in srgb, var(--error) 12%, transparent); }
.diff-del .diff-code { color: var(--error); }
.diff-context { }
.diff-header-cell { color: var(--muted); font-weight: 600; padding: 6px 10px !important; background: var(--surface2); font-size: 0.85em; border-bottom: 1px solid var(--border); }
.diff-range-cell { color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); padding: 4px 10px !important; font-size: 0.85em; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.diff-empty { color: var(--muted); font-style: italic; padding: 20px; text-align: center; }

/* Source code viewer */
.source-container { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin-top: 8px; max-height: 500px; overflow-y: auto; }
.source-table { width: 100%; border-collapse: collapse; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.8em; line-height: 1.65; }
.source-line td { padding: 0 8px; white-space: pre; }
.source-linenum { color: var(--muted); opacity: 0.5; min-width: 36px; text-align: right; user-select: none; border-right: 1px solid var(--border); padding-right: 6px !important; font-size: 0.85em; }
.source-code { width: 100%; padding-left: 10px !important; }
.source-line.highlight { background: color-mix(in srgb, var(--warn) 15%, transparent); }
.source-truncated { color: var(--muted); font-style: italic; padding: 8px 12px; border-top: 1px solid var(--border); font-size: 0.8em; }

/* File tabs */
.file-diff-section { padding-bottom: 0 !important; }
.file-tab-bar { display: flex; gap: 0; overflow-x: auto; border-bottom: 1px solid var(--border); margin-bottom: 0; }
.file-tab { background: none; border: none; color: var(--muted); padding: 7px 14px; font-size: 0.8em; font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent; font-family: var(--vscode-editor-font-family, monospace); display: flex; align-items: center; gap: 4px; white-space: nowrap; transition: color 0.1s; }
.file-tab:hover { color: var(--fg); background: color-mix(in srgb, var(--fg) 5%, transparent); }
.file-tab.active { color: var(--fg); border-bottom-color: var(--accent); }
.file-tab-icon { font-size: 0.7em; }

/* File path bar */
.file-path-bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
.file-full-path { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.8em; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-actions { display: flex; gap: 4px; flex-shrink: 0; }
.btn-sm { padding: 2px 8px; background: var(--surface2); color: var(--fg); border: 1px solid var(--border); border-radius: 3px; cursor: pointer; font-size: 0.72em; font-family: inherit; transition: background 0.1s; }
.btn-sm:hover { background: var(--surface); border-color: var(--muted); }

/* View mode tabs */
.view-tab-bar { display: flex; gap: 0; margin-bottom: 0; }
.view-tab { background: none; border: 1px solid var(--border); border-bottom: none; color: var(--muted); padding: 4px 12px; font-size: 0.75em; cursor: pointer; font-family: inherit; transition: background 0.1s; }
.view-tab:first-child { border-radius: 4px 0 0 0; }
.view-tab:last-child { border-radius: 0 4px 0 0; }
.view-tab.active { color: var(--fg); background: var(--surface); }
.view-tab:hover { color: var(--fg); }

/* Session context */
.session-context { margin-top: 8px; padding: 8px 12px; background: var(--surface2); border-radius: 4px; font-size: 0.8em; line-height: 1.5; }
.context-label { color: var(--muted); font-weight: 600; font-size: 0.85em; }

/* Legacy fallback */
.diff-preview { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-family: var(--vscode-editor-font-family); font-size: 0.8em; line-height: 1.6; overflow-x: auto; max-height: 300px; overflow-y: auto; white-space: pre; }
.diff-preview.collapsed { max-height: 0; padding: 0; border: none; overflow: hidden; }

/* Decision action buttons */
.decision-actions { display: flex; gap: 8px; padding: 16px 20px; border-top: 1px solid var(--border); }
.accept-btn { background: var(--hitlgate-accept) !important; color: white !important; }
.accept-btn:hover { opacity: 0.85; }
.reject-btn { background: var(--hitlgate-reject) !important; color: white !important; }
.reject-btn:hover { opacity: 0.85; }

/* Agent panel */
.agent-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; }
.agent-status-line { display: flex; align-items: center; gap: 10px; font-size: 0.9em; }
.agent-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.agent-dot.running { background: var(--success); animation: pulse 1.5s infinite; }
.agent-dot.paused { background: var(--warn); }
.agent-dot.done { background: var(--muted); }
.agent-kind { font-weight: 600; }
.agent-meta { color: var(--muted); font-size: 0.8em; }
.agent-prompt { color: var(--muted); font-style: italic; font-size: 0.85em; margin-top: 6px; }
.context-bar { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 0.8em; color: var(--muted); font-family: var(--vscode-editor-font-family); }
.context-track { flex: 1; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
.context-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

/* Sections */
.section { margin-bottom: 20px; }
.section-header { display: flex; align-items: center; gap: 8px; font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 10px; }
.section-header .count { background: var(--surface); padding: 0 6px; border-radius: 3px; font-size: 0.9em; }

/* Log */
.log { max-height: 280px; overflow-y: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.8em; line-height: 1.7; }
.log::-webkit-scrollbar { width: 4px; }
.log::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.log-entry { display: flex; gap: 12px; padding: 1px 0; }
.log-time { color: var(--muted); min-width: 60px; opacity: 0.6; }
.log-msg { color: var(--muted); }
.log-msg.success { color: var(--success); }
.log-msg.error { color: var(--error); }
.log-msg.warn { color: var(--warn); }
.log-msg.info { color: var(--fg); opacity: 0.7; }

/* Files */
.file-list { font-family: var(--vscode-editor-font-family); font-size: 0.8em; }
.file-row { display: flex; gap: 12px; padding: 3px 0; line-height: 1.6; }
.file-path { flex: 1; color: var(--fg); opacity: 0.8; transition: opacity 0.1s; }
.file-path:hover { opacity: 1; color: var(--accent); text-decoration: underline; }
.file-add { color: var(--success); min-width: 32px; text-align: right; }
.file-del { color: var(--error); min-width: 32px; text-align: right; }

/* Actions */
.actions { display: flex; gap: 6px; flex-wrap: wrap; padding: 14px 0 4px; border-top: 1px solid var(--border); position: sticky; bottom: 0; background: var(--bg); }
.btn { padding: 5px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-family: inherit; font-weight: 500; transition: opacity 0.15s; }
.btn:hover { opacity: 0.85; }
.btn:active { opacity: 0.7; }
.btn.secondary { background: var(--surface); color: var(--fg); border: 1px solid var(--border); }
.btn.secondary:hover { background: var(--surface2); border-color: var(--muted); }

/* Decisions history tab */
.decisions-tab { padding: 4px 0; }
.history-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85em; transition: background 0.1s; border: 1px solid transparent; }
.history-row:hover { background: var(--surface); border-color: var(--border); }
.history-icon { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.7em; flex-shrink: 0; margin-top: 2px; }
.history-icon.accepted { background: var(--success); color: var(--bg); }
.history-icon.rejected { background: var(--error); color: var(--bg); }
.history-info { flex: 1; min-width: 0; }
.history-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.history-bottom { margin-top: 3px; }
.history-decision { font-weight: 600; min-width: 70px; }
.history-agent { color: var(--muted); font-size: 0.85em; }
.history-tool { color: var(--muted); font-size: 0.85em; font-family: var(--vscode-editor-font-family, monospace); }
.history-intent { color: var(--fg); opacity: 0.7; font-size: 0.85em; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-time { color: var(--muted); font-size: 0.8em; white-space: nowrap; margin-left: auto; }
.history-files-line { display: flex; gap: 4px; margin-top: 5px; flex-wrap: wrap; }
.history-file-chip { background: var(--surface2); border: 1px solid var(--border); padding: 1px 8px; border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.8em; color: var(--fg); transition: border-color 0.1s, color 0.1s; }
.history-file-chip:hover { border-color: var(--accent); color: var(--accent); }
.history-file-more { color: var(--muted); font-size: 0.8em; padding: 1px 4px; }
.history-detail { padding: 8px 16px 12px 44px; font-size: 0.8em; color: var(--muted); line-height: 1.8; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.history-detail.hidden { display: none; }
.history-note { color: var(--warn); margin-bottom: 6px; }
.history-file-links { display: flex; flex-direction: column; gap: 4px; }
.history-file-link { display: flex; align-items: center; gap: 6px; font-family: var(--vscode-editor-font-family, monospace); }
.link-action { cursor: pointer; color: var(--accent); transition: opacity 0.1s; }
.link-action:hover { opacity: 0.7; text-decoration: underline; }
.link-diff { font-size: 0.85em; opacity: 0.7; }
.link-sep { color: var(--muted); opacity: 0.4; }

/* Empty state */
.empty-state { color: var(--muted); font-style: italic; padding: 40px 0; text-align: center; }
`;
