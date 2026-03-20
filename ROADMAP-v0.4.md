# gait — Roadmap v0.4.0

> 5 features focused on making agents smarter and the gate more comprehensive.

---

## Dependency Order

```
1. Agent Memory ──────────┐
                          ├── 2. AI Code Review (uses memory for context)
                          ├── 3. Auto Test Generation (uses memory for patterns)
4. Dependency Audit ──────┘ (independent)
5. Git Hooks Suite ───────── (independent, builds on existing hook infra)
```

Build order: Memory first (everything else benefits from it), then Code Review and Test Gen in parallel, Dependency Audit and Hooks Suite are independent.

---

## Feature 1: Agent Memory

**Why first**: Every agent session starts from zero. Memory makes agents 10x more effective by carrying project context, past mistakes, and coding patterns across sessions.

**What**:
- `.gait/context.md` — human-readable project context, auto-prepended to every agent prompt
- `.gait/memory.json` — structured memory: corrections, patterns, "never do this" rules
- On agent start: context is loaded and prepended to the prompt
- On fix rejection (user clicks Fix then agent's change fails gate): the error is saved as a correction
- On fix success: the pattern is saved as a positive example
- Command: "Gait: Edit Agent Memory" — opens context.md for editing
- Command: "Gait: View Memory" — shows structured memory in output channel
- `gait init` creates a starter context.md from detected stacks, config, and project structure

**Files**: `src/core/memory.ts`

**Schema**:
```json
{
  "corrections": [
    { "date": "2026-03-20", "error": "Agent used innerHTML", "fix": "Use safe DOM builders", "source": "autofix" }
  ],
  "patterns": [
    { "category": "testing", "rule": "Use vitest, not jest", "source": "init" },
    { "category": "style", "rule": "No default exports", "source": "user" }
  ],
  "never": [
    "Do not modify package-lock.json directly",
    "Do not use any type — use unknown instead"
  ]
}
```

**Integration points**:
- `cmdRunAgent()` — prepend context + memory summary to prompt
- `cmdFixStage()` — prepend context to fix prompt
- `runAutofixLoop()` — on failure, save correction to memory
- `runWorkflow()` — prepend context to each agent step
- `doFullInit()` — generate starter context.md
- New dashboard section: "Memory" with correction count and last update

**Config**:
```toml
[agent]
use_memory = true
max_context_tokens = 2000
```

---

## Feature 2: AI Code Review

**Why**: Lint catches syntax, tests catch behavior, but neither catches logic errors, security mistakes, or architectural problems. An agent review pass fills this gap.

**What**:
- New pipeline stage: `review` — runs after test, before commit
- Sends the staged diff to an agent with a structured review prompt
- Agent returns findings as structured JSON: `{ file, line, severity, message, suggestion }`
- Findings displayed in dashboard as a dedicated "Review" section
- Severity levels: `error` (blocks commit), `warning` (logged), `info` (suggestion)
- Gate blocks if any `error`-severity findings
- Findings also pushed to VS Code's Diagnostics API (squiggly lines in editor)
- Prompt includes: diff, project memory/context, file contents for changed files

**Files**: `src/core/review.ts`

**Prompt structure**:
```
Review this diff for bugs, security issues, and logic errors.

## Project Context
{{memory}}

## Diff
{{staged_diff}}

## Changed Files
{{file_contents}}

Respond as JSON array: [{ "file": "...", "line": N, "severity": "error|warning|info", "message": "...", "suggestion": "..." }]
```

**Config**:
```toml
[pipeline]
stages = ["lint", "typecheck", "test", "review"]

[review]
agent = "claude"
block_on = "error"     # "error", "warning", or "none"
max_findings = 20
```

**Depends on**: #1 (memory provides project context for better reviews)

---

## Feature 3: Auto Test Generation

**Why**: Coverage detection finds untested functions but can't fix them. This closes the loop: detect → generate → verify → commit.

**What**:
- After coverage detection, if untested functions are found:
  - Dashboard shows "Generate Tests" button next to each uncovered function
  - Click → builds a prompt with: function source, existing test patterns (from same file's test), project memory
  - Agent writes tests following existing style
  - Auto-gate verifies the new tests pass
  - If tests pass, they're staged; if not, logged as failed
- Also available as a standalone command: "Gait: Generate Tests for File"
  - Opens file picker, runs coverage, generates tests for uncovered functions
- Prompt template in `.gait/prompts/generate-tests.md` (customizable)
- Batch mode: generate tests for all uncovered functions at once

**Files**: `src/core/test-gen.ts`

**Prompt structure**:
```
Write tests for these untested functions in `{{file}}`:

{{function_signatures}}

## Existing test patterns
Here's how tests are written in this project:
{{sample_tests}}

## Project Context
{{memory}}

Follow the exact same test framework, style, and patterns. Do not change the source code.
```

**Config**:
```toml
[coverage]
auto_generate_tests = false    # true = generate after every gate
generate_agent = "claude"
```

**Depends on**: #1 (memory provides test style patterns)

---

## Feature 4: Dependency Audit Gate

**Why**: `npm audit` / `go mod verify` / `pip-audit` catch known vulnerabilities, but developers forget to run them. Making it a gate stage means every commit is checked.

**What**:
- New pipeline stage: `audit`
- Auto-detects and runs the right tool per stack:
  - **TypeScript**: `npm audit --json`
  - **Go**: `go mod verify` + `govulncheck ./...`
  - **Python**: `pip-audit --format=json`
  - **Swift**: (no standard tool — skip)
- Parses JSON output into structured findings: `{ package, severity, advisory, fixAvailable }`
- Severity threshold: block on `critical`/`high`, warn on `moderate`, ignore `low`
- Dashboard section: "Dependencies" with finding count and severity breakdown
- Auto-fix: if `fixAvailable` is true, offer "Fix" button that runs `npm audit fix` / `go get -u`
- Gate respects threshold: only blocks if findings exceed configured severity

**Files**: `src/core/dep-audit.ts`

**Config**:
```toml
[pipeline]
stages = ["lint", "typecheck", "test", "audit"]

[audit]
block_severity = "high"    # "critical", "high", "moderate", "low", "none"
auto_fix = false
```

**Independent** — no dependencies on other features.

---

## Feature 5: Git Hooks Suite

**Why**: Pre-commit alone isn't enough. Pre-push should run full gate + coverage. Post-merge should verify the merge didn't break anything. Post-checkout should refresh baselines.

**What**:
- Extend `hooks.ts` to support multiple hook types:
  - **pre-commit**: runs gate with commit profile (existing, enhanced)
  - **pre-push**: runs full gate + coverage check + regression check
  - **post-merge**: auto-runs gate to verify merge integrity, warns on failure
  - **post-checkout**: refreshes baseline for new branch, prunes old snapshots
- Command: "Gait: Install All Hooks" — installs all four in one go
- Command: "Gait: Manage Hooks" — shows which hooks are installed, toggle on/off
- Each hook is independently installable/removable
- Hooks are lightweight shell scripts that signal the VS Code extension (same trigger pattern as pre-commit)
- Fallback: if VS Code is not running, hooks run `npx tsc --noEmit` directly (degraded mode)

**Files**: `src/core/hooks.ts` (extend existing), `src/core/hook-scripts.ts` (templates)

**Config**:
```toml
[hooks]
pre_commit = true
pre_push = true
post_merge = true
post_checkout = true
pre_push_profile = "full"
```

**Independent** — builds on existing hook infrastructure.

---

## Build Sequence

### Sprint 1: Agent Memory
1. `memory.ts` — load/save context.md + memory.json
2. Wire into cmdRunAgent, cmdFixStage, runAutofixLoop, runWorkflow
3. Generate starter context.md on init
4. Commands: Edit Memory, View Memory
5. Dashboard: Memory section
6. Tests

### Sprint 2a: AI Code Review
1. `review.ts` — review agent prompt builder, finding parser
2. New "review" pipeline stage type
3. Dashboard: Review findings section
4. VS Code Diagnostics integration
5. Config: block_on severity
6. Tests

### Sprint 2b: Auto Test Generation (parallel with 2a)
1. `test-gen.ts` — prompt builder, test runner
2. Dashboard: "Generate Tests" button on uncovered functions
3. Command: Generate Tests for File
4. Batch mode
5. Tests

### Sprint 3a: Dependency Audit (parallel with 3b)
1. `dep-audit.ts` — npm/go/python audit runners, JSON parsers
2. New "audit" pipeline stage
3. Dashboard: Dependencies section
4. Auto-fix for fixable vulnerabilities
5. Tests

### Sprint 3b: Git Hooks Suite (parallel with 3a)
1. Extend `hooks.ts` with pre-push, post-merge, post-checkout
2. `hook-scripts.ts` — shell script templates per hook
3. Commands: Install All Hooks, Manage Hooks
4. Degraded mode (run without VS Code)
5. Tests

---

## Estimated Totals

| # | Feature | New files | Tests | Complexity |
|---|---------|-----------|-------|------------|
| 1 | Agent Memory | 1 | ~8 | Medium |
| 2 | AI Code Review | 1 | ~6 | High |
| 3 | Auto Test Generation | 1 | ~6 | High |
| 4 | Dependency Audit | 1 | ~8 | Medium |
| 5 | Git Hooks Suite | 1 (+extend) | ~8 | Medium |
| **Total** | | **5 new** | **~36** | |
