/** Dashboard CSS — extracted from dashboard.ts for maintainability */
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
.header { display: flex; align-items: center; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
.header h1 { font-size: 1.15em; font-weight: 600; letter-spacing: -0.01em; }
.header .meta { color: var(--muted); font-size: 0.85em; }
.header .branch { color: var(--accent); font-weight: 500; font-size: 0.85em; background: var(--surface); padding: 2px 8px; border-radius: 4px; font-family: var(--vscode-editor-font-family, monospace); }
.header .stack-badge { background: var(--badge-bg); color: var(--badge-fg); padding: 1px 8px; border-radius: 3px; font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.header .status-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.header .status-dot.clean { background: var(--success); }
.header .status-dot.dirty { background: var(--warn); }
.header .spacer { flex: 1; }

/* Pipeline */
.pipeline { display: flex; align-items: center; gap: 0; margin-bottom: 20px; background: var(--surface); border-radius: 8px; padding: 12px 16px; border: 1px solid var(--border); }
.stage { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85em; transition: background 0.15s; position: relative; }
.stage:hover { background: var(--surface2); }
.stage .icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 0.75em; flex-shrink: 0; }
.stage.pending .icon { border: 1.5px solid var(--muted); color: var(--muted); }
.stage.passed .icon { background: var(--success); color: var(--bg); }
.stage.failed .icon { background: var(--error); color: var(--bg); }
.stage.running .icon { border: 1.5px solid var(--warn); color: var(--warn); }
.stage.skipped .icon { border: 1.5px dashed var(--muted); color: var(--muted); }
.stage .name { font-weight: 500; }
.stage .dur { color: var(--muted); font-size: 0.8em; }
.stage .fix-btn { font-size: 0.7em; padding: 1px 6px; border: 1px solid var(--error); border-radius: 3px; color: var(--error); cursor: pointer; background: transparent; font-family: inherit; margin-left: 4px; }
.stage .fix-btn:hover { background: var(--error); color: var(--bg); }
.connector { width: 24px; height: 1px; background: var(--border); flex-shrink: 0; }
.connector.done { background: var(--success); }
.connector.fail { background: var(--error); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.stage.running .icon { animation: pulse 1.2s ease-in-out infinite; }

/* Gate banner */
.gate-banner { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 8px; margin-bottom: 20px; font-weight: 500; font-size: 0.9em; }
.gate-banner .gate-icon { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.7em; flex-shrink: 0; }
.gate-banner.passed { background: color-mix(in srgb, var(--success) 10%, transparent); border: 1px solid color-mix(in srgb, var(--success) 30%, transparent); color: var(--success); }
.gate-banner.passed .gate-icon { background: var(--success); color: var(--bg); }
.gate-banner.failed { background: color-mix(in srgb, var(--error) 10%, transparent); border: 1px solid color-mix(in srgb, var(--error) 30%, transparent); color: var(--error); }
.gate-banner.failed .gate-icon { background: var(--error); color: var(--bg); }
.gate-banner .spacer { flex: 1; }
.gate-banner .gate-dur { font-weight: 400; opacity: 0.7; }

/* Sections */
.section { margin-bottom: 20px; }
.section-header { display: flex; align-items: center; gap: 8px; font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 10px; cursor: pointer; user-select: none; }
.section-header .count { background: var(--surface); padding: 0 6px; border-radius: 3px; font-size: 0.9em; }
.section-header .chevron { transition: transform 0.15s; }
.section-header.collapsed .chevron { transform: rotate(-90deg); }

/* Regressions */
.regressions { background: color-mix(in srgb, var(--error) 8%, transparent); border: 1px solid color-mix(in srgb, var(--error) 25%, transparent); border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; }
.regressions .reg-title { color: var(--error); font-weight: 600; font-size: 0.85em; margin-bottom: 8px; }
.regressions .reg-item { color: var(--error); font-size: 0.85em; padding: 2px 0; font-family: var(--vscode-editor-font-family); }

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

/* Review panel */
.review-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; }
.review-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; font-size: 0.85em; }
.review-label { color: var(--muted); }
.review-value { font-weight: 500; }

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
.log-empty { color: var(--muted); font-style: italic; padding: 20px 0; text-align: center; }

/* Files */
.file-list { font-family: var(--vscode-editor-font-family); font-size: 0.8em; }
.file-row { display: flex; gap: 12px; padding: 3px 0; line-height: 1.6; }
.file-path { flex: 1; color: var(--fg); opacity: 0.8; transition: opacity 0.1s; }
.file-path:hover { opacity: 1; color: var(--accent); text-decoration: underline; }
.file-open:hover { opacity: 1 !important; }
.file-add { color: var(--success); min-width: 32px; text-align: right; }
.file-del { color: var(--error); min-width: 32px; text-align: right; }

/* Actions */
.actions { display: flex; gap: 6px; flex-wrap: wrap; padding: 14px 0 4px; border-top: 1px solid var(--border); position: sticky; bottom: 0; background: var(--bg); }
.btn { padding: 5px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-family: inherit; font-weight: 500; transition: opacity 0.15s; }
.btn:hover { opacity: 0.85; }
.btn:active { opacity: 0.7; }
.btn.secondary { background: var(--surface); color: var(--fg); border: 1px solid var(--border); }
.btn.secondary:hover { background: var(--surface2); border-color: var(--muted); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn .kbd { font-size: 0.8em; opacity: 0.5; margin-left: 4px; font-family: var(--vscode-editor-font-family); }

/* Modal */
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; z-index: 100; backdrop-filter: blur(2px); }
.modal { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 24px; min-width: 380px; max-width: 480px; box-shadow: 0 16px 48px rgba(0,0,0,0.3); }
.modal h2 { font-size: 1em; margin-bottom: 16px; font-weight: 600; }
.modal .stage-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 0.85em; }
.modal .stage-row .icon { width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.65em; }
.modal .stage-row .dur { color: var(--muted); margin-left: auto; font-size: 0.8em; }
.modal .modal-result { margin-top: 16px; padding: 10px 14px; border-radius: 8px; font-weight: 600; font-size: 0.9em; }
.modal .modal-result.passed { background: color-mix(in srgb, var(--success) 12%, transparent); color: var(--success); }
.modal .modal-result.failed { background: color-mix(in srgb, var(--error) 12%, transparent); color: var(--error); }
.modal .modal-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
`;
