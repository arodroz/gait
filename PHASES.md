# HITL-Gate — Implementation Phases

Each phase is a self-contained unit of work. Complete and verify each phase before starting the next. Each phase ends with a working, committable state.

---

## Phase 0 — Fork cleanup

**Goal:** The project compiles, activates in VS Code, and does nothing except load config and show a status bar. All quality gate machinery is gone.

**Steps:**

1. Fork `arodroz/gait` into `hitlgate` (or keep name `gait` — owner decides)

2. Remove these files entirely:
   - `src/core/pipeline.ts`
   - `src/core/hooks.ts` (will be replaced)
   - `src/commands/gate.ts`
   - `src/commands/release.ts`
   - `src/commands/scripts.ts`

3. In `src/commands/agent.ts` — remove `cmdFixStage`, `cmdGenerateTests`, `cmdAuditDeps`. Keep `cmdRunAgent` stub (will be adapted later), `cmdCodeReview`, `cmdEditMemory`, `cmdViewMemory`, `cmdCostSummary`.

4. In `src/commands/misc.ts` — remove `cmdGenerateAgentsMd`. Keep `cmdSnapshot`, `cmdRestoreSnapshot`, `cmdRollback`, `cmdRecover`, `cmdPreflight`, `cmdSwitchProfile`, `cmdRunWorkflow` (stub).

5. In `src/extension.ts` — remove all registrations for deleted commands. Remove pipeline-related dashboard action handlers. Remove the `hookInterval` (pre-commit hook polling).

6. In `src/views/sidebar.ts` — remove `PipelineTreeProvider`. Add stub `DecisionsTreeProvider` (empty for now).

7. In `package.json`:
   - Remove commands: `gait.gate`, `gait.runLint`, `gait.runTest`, `gait.runTypecheck`, `gait.runBuild`, `gait.release`, `gait.installHook`, `gait.createPR`, `gait.runScript`, `gait.listScripts`, `gait.detectScripts`, `gait.auditDeps`, `gait.generateTestsForFile`, `gait.generateAgentsMd`, `gait.installAllHooks`, `gait.manageHooks`
   - Remove keybinding for `gait.gate`
   - Remove view `gait.pipeline` and `gait.scripts`
   - Add views: `gait.decisions` (name: "Decisions"), `gait.agents` (name: "Agents")
   - Update `displayName` to `"HITL-Gate — Human-in-the-Loop for AI Agents"`
   - Update `description`

8. In `src/state.ts` — remove pipeline-related fields, add new fields as specified in `ARCHITECTURE.md`

9. Update `config.ts` — replace pipeline config schema with HITL config schema (see `SPECS/config.md`)

10. Rename `.gait/config.toml` schema in `cmdInit`

**Verification:**
- `npm run compile` — zero errors
- `npm test` — passes (or no tests yet — acceptable)
- Press F5 — extension activates, shows "HITL-Gate" in activity bar, status bar shows project name

---

## Phase 1 — Action logging + IPC foundation

**Goal:** Claude Code can trigger a file write → extension detects it → logs it → writes decision (auto-accept for now) → bridge reads decision and exits. The plumbing works end-to-end.

**Steps:**

1. Implement `src/core/action-logger.ts` (see `SPECS/action-logger.md`)
   - `append(record: ActionRecord): Promise<void>`
   - `readRecent(n: number): Promise<ActionRecord[]>`
   - `findById(id: string): Promise<ActionRecord | null>`

2. Implement `src/bridge/hitlgate-bridge.ts` (see `SPECS/bridge.md`)
   - Reads stdin JSON (Claude Code hook payload)
   - Extracts: tool, files, intent (from `description` field in hook payload)
   - Writes `.gait/pending/<id>.json`
   - Polls `.gait/decisions/<id>.json` every 200ms, timeout 120s
   - Exit 0 = accept, exit 2 = reject

3. Implement `src/core/interceptor.ts` (see `SPECS/interceptor.md`)
   - `FileSystemWatcher` on `.gait/pending/**`
   - On new file: parse PendingAction, log it, write auto-accept decision
   - For now: always auto-accept (real evaluation comes in Phase 2)

4. Implement `src/agents/claude-hooks.ts`
   - `generateHooksConfig(gaitDir: string): object` — returns the JSON for `.claude/settings.json`
   - `installHooks(workspaceRoot: string): Promise<void>` — writes/merges `.claude/settings.json`
   - `checkHooksInstalled(workspaceRoot: string): Promise<boolean>`

5. Add command `gait.installClaudeHooks` — calls `installHooks`, shows confirmation message

6. Wire interceptor into `extension.ts` `activate()`

7. Update `cmdInit` to:
   - Create `.gait/pending/` and `.gait/decisions/` directories
   - Add entries to `.gitignore`
   - Install Claude hooks automatically (with user confirmation)

8. Build the bridge as a separate entry point in esbuild:
   ```
   esbuild src/bridge/hitlgate-bridge.ts --bundle --outfile=out/hitlgate-bridge.js --platform=node --format=cjs
   ```
   Update `package.json` scripts accordingly.

**Verification:**
- Run `gait.init` on a test project
- Verify `.claude/settings.json` exists with correct hooks
- Simulate a hook call: `echo '{"tool":"Edit","files":["foo.ts"],"description":"test"}' | node out/hitlgate-bridge.js`
- Verify `.gait/pending/act_<id>.json` appears
- Verify `.gait/decisions/act_<id>.json` appears within 1s (auto-accept)
- Verify `actions.jsonl` has a new line
- Bridge exits 0

---

## Phase 2 — Decision points + three-level UI

**Goal:** Actions are evaluated, severity is computed, and the right UI is shown. Human can accept, reject, or skip. This is the first usable version.

**Steps:**

1. Implement `src/core/decision-points.ts` (see `SPECS/decision-points.md`)
   - All DetectionPoint types
   - `evaluate(action: PendingAction, config: HitlConfig): Promise<EvaluationResult>`
   - Unit tests for each detection type

2. Implement `src/views/decorations.ts` (see `SPECS/decorations.md`)
   - Two decoration types (Claude gutter icon, Codex gutter icon)
   - `applyDecorations(editor, records)` — reads recent actions.jsonl, marks lines
   - Clears decorations on new commit

3. Implement `src/commands/decision.ts`
   - `cmdAccept(actionId: string)`
   - `cmdReject(actionId: string, note?: string)`
   - `cmdEditPrompt(actionId: string)` — opens input box, stores edited note

4. Update `src/core/interceptor.ts` — replace auto-accept with real evaluation:
   - Call `decision-points.evaluate()`
   - Based on severity: show notification / open panel / show modal
   - Write decision file only after human responds (or auto-accept timeout for low)

5. Implement the three presentation levels in the interceptor:

   **Low severity — notification:**
   ```typescript
   vscode.window.showInformationMessage(
     `[${action.agent}] ${action.intent} — ${action.files.join(', ')}`,
     'View', 'Undo'
   )
   // Auto-accept after 10s if no interaction
   ```

   **Medium severity — panel:**
   - Call `state.dashboard.open()`
   - Send `{ command: 'showDecision', data: { action, evaluation } }` to webview
   - Panel shows intent, decision points, diff preview, Accept/Reject buttons
   - Wait for webview message `{ command: 'decision', data: { id, decision } }`

   **High severity — modal:**
   ```typescript
   const choice = await vscode.window.showWarningMessage(
     `⚠️ High-severity action — ${action.agent} wants to modify ${action.files.join(', ')}`,
     { modal: true },
     'Accept', 'Reject', 'View Details'
   )
   ```

6. Update `DashboardPanel` webview (`src/webview/main.ts`) — add decision UI section:
   - Shows pending action details
   - Intent, files, decision points with icons and descriptions
   - Diff preview (collapsible)
   - Accept / Reject / Edit Prompt buttons
   - Reviewer analysis section (placeholder for Phase 3)

7. Update `DecisionsTreeProvider` in sidebar — shows recent decisions (last 20) with status icons

**Verification:**
- Trigger a low-severity action → notification appears → auto-accepts after 10s
- Trigger a medium-severity action → panel opens → Accept button writes decision → bridge exits 0
- Trigger a high-severity action → modal appears → Reject → bridge exits 2, Claude Code shows rejection message
- Gutter decorations appear on files modified by accepted actions
- Decisions tree shows history

---

## Phase 3 — Cross-agent reviewer

**Goal:** On medium/high severity actions, the reviewer agent analyzes the action and its output is shown in the decision UI before the human decides.

**Steps:**

1. Add dependencies:
   ```bash
   npm install @anthropic-ai/sdk openai
   ```

2. Implement `src/core/reviewer.ts` (see `SPECS/reviewer.md`)
   - `review(action: PendingAction, points: DecisionPoint[], config: ReviewerConfig): Promise<ReviewerAnalysis>`
   - Hardcoded adversarial system prompt (see spec)
   - Model selection: Claude reviews Codex, Codex reviews Claude
   - Graceful degradation: if reviewer API fails, proceed without review (log warning)
   - Timeout: 8s max — if exceeded, proceed without review

3. Wire reviewer into `interceptor.ts`:
   - Fire reviewer call in parallel with showing the UI
   - If review arrives before human decides: update panel with analysis
   - If human decides before review arrives: cancel review call, log that review was skipped

4. Update decision UI in webview to display reviewer analysis:
   - Reviewer name + model
   - Understood intent vs actual action
   - Divergences list (each as a warning chip)
   - Risks list
   - Recommendation badge (Accept / Reject / Modify) with confidence indicator
   - Suggestion text if recommendation is "modify"

5. Add reviewer config to `config.toml` schema:
   ```toml
   [reviewer]
   enabled = true
   on_severity = ["medium", "high"]
   claude_api_key_env = "ANTHROPIC_API_KEY"   # reads from env
   codex_api_key_env = "OPENAI_API_KEY"
   timeout_ms = 8000
   ```

   API keys are never stored in config files — always read from environment variables.

6. Add `gait.codeReview` command (already exists in fork) — manually trigger review on current file's last action

**Verification:**
- Trigger a medium-severity action
- Panel opens, shows "Reviewing..." spinner
- Within 8s, reviewer analysis appears
- Recommendation is visible before human decides
- If ANTHROPIC_API_KEY is not set: panel shows "Reviewer unavailable" gracefully, human can still decide

---

## Phase 4 — Codex bridge + decisions journal

**Goal:** Codex is fully integrated. Decision history is browsable. The system works symmetrically for both agents.

**Steps:**

1. Implement `src/agents/codex-bridge.ts` (see `SPECS/codex-bridge.md`)
   - Wraps `codex` CLI invocation
   - Intercepts `--approval-mode=suggest` confirmation prompts
   - Converts to PendingAction format and routes through same interceptor
   - Handles Codex-specific output parsing

2. Add command `gait.runCodex` — opens input box for task, runs codex via bridge

3. Implement decisions journal view in webview:
   - Full-screen panel mode: list of all decisions
   - Filterable by: agent, decision (accept/reject), date, file, severity
   - Click on a decision → shows full details: intent, reviewer analysis, human note, diff
   - Export as markdown report

4. Add `gait.openJournal` command

5. Implement learned patterns (lightweight):
   - Scan last 50 decisions on project open
   - If same decision point rejected 3+ times for same file path pattern: suggest adding to `prod_paths` in config
   - Surface as a "suggestion" notification, not automatic

6. Write `AGENTS.md` generation (`gait.generateAgentsMd` — exists in fork):
   - Reads config + recent action patterns
   - Generates guidance file for agents working on this project
   - Includes: prod paths, known rejection patterns, project conventions

**Verification:**
- Run a Codex task via `gait.runCodex`
- Action appears in pending, goes through same evaluation flow
- Reviewer is Claude (reviewing Codex)
- Journal shows actions from both agents
- Filter by agent works

---

## Cross-phase: testing expectations

Every new module must have tests. Use Vitest. Mock VS Code API with `vitest-mock-extended` or manual mocks.

Minimum coverage per module:
- `decision-points.ts` — test every DecisionPoint type with real diff fixtures
- `action-logger.ts` — test append, read, concurrent writes
- `interceptor.ts` — test file watcher trigger, timeout handling
- `reviewer.ts` — test with mocked API responses, test timeout/failure handling
- `hitlgate-bridge.ts` — test as Node script with mocked filesystem

Test fixtures go in `src/tests/fixtures/` — include sample diffs for each decision point type.
