<p align="center">
  <img src="https://img.shields.io/badge/HITL--Gate-human--in--the--loop-7C3AED?style=for-the-badge&logo=shield&logoColor=white" alt="HITL-Gate" />
</p>

<h3 align="center">Human-in-the-Loop interception for AI coding agents</h3>

<p align="center">
  <a href="https://code.visualstudio.com"><img src="https://img.shields.io/badge/VS%20Code-1.85%2B-007ACC?style=flat-square&logo=visualstudiocode" alt="VS Code" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6B7280?style=flat-square" alt="license" /></a>
</p>

---

> **This is an experimental personal project — not production-ready.**
>
> I'm building this in my spare time to explore ideas around AI agent
> guardrails. Expect rough edges, breaking changes, and long stretches
> with no updates. There are no guarantees of stability, support, or
> maintenance.
>
> Feel free to look around, steal ideas, or open issues — just know what
> you're getting into.

---

## What it does

HITL-Gate is a VS Code extension that intercepts AI agent actions **before** they write files, evaluates their severity, and presents the human with the right level of decision support at the right time.

> The agent proposes. The human decides. Never surprised by what the code became.

**Intercept** — Claude Code and Codex actions are caught via hooks before file writes. Each action is evaluated against 7 detection types (interface change, file deleted, schema change, prod file, cross-agent conflict, public API change, file renamed).

**Evaluate** — Actions are scored by severity (low / medium / high). Low-severity actions show a toast notification with auto-accept. Medium-severity opens a decision panel. High-severity shows a blocking modal requiring explicit approval.

**Review** — On medium/high severity, a cross-agent adversarial reviewer analyzes the action (Claude reviews Codex, Codex reviews Claude) with a hardcoded skeptical prompt that cannot be overridden.

**Decide** — The human accepts, rejects, or rejects-with-note. Every decision is logged to an append-only JSONL audit trail. Gutter decorations show which agent modified each line.

**Learn** — Rejection patterns are detected automatically and surfaced as config suggestions. The decisions journal provides filterable history and markdown export.

---

## Quick start

```bash
git clone https://github.com/arodroz/gait.git && cd gait
npm install && npm run compile
# Press F5 in VS Code to launch Extension Host
```

Then:

```
Cmd+Shift+P → HITL-Gate: Initialize Project
Cmd+Shift+P → HITL-Gate: Install Claude Code Hooks
Cmd+Shift+D → Open Dashboard
```

---

## How it works

```
Claude Code / Codex
        │
        ▼
  hitlgate-bridge        ← PreToolUse hook (file-based IPC)
        │
  .gait/pending/<id>.json
        │
        ▼
  Interceptor             ← VS Code FileSystemWatcher
        │
  decision-points.evaluate()
        │
  ┌─────┼─────┐
  low  med  high          ← severity → presentation
  │     │     │
 toast panel modal        ← human decides
        │
  .gait/decisions/<id>.json
        │
  bridge reads → exit 0 (accept) or exit 2 (reject)
        │
  actions.jsonl           ← append-only audit log
```

---

## Key commands

| Command | Description |
|---------|-------------|
| `HITL-Gate: Initialize Project` | Set up `.gait/` config and directories |
| `HITL-Gate: Install Claude Code Hooks` | Wire Claude Code's PreToolUse hook |
| `HITL-Gate: Open Dashboard` | Webview with pending decisions, logs, history |
| `HITL-Gate: Run Agent` | Launch Claude or Codex with snapshot + tracking |
| `HITL-Gate: Run Codex Task` | Run Codex CLI with interception |
| `HITL-Gate: Open Decisions Journal` | Browse/filter decision history |
| `HITL-Gate: AI Code Review` | Run AI review on current diff |
| `HITL-Gate: Generate AGENTS.md` | Generate agent guidance with rejection patterns |

---

## Config

`.gait/config.toml` — created by `Initialize Project`:

```toml
[project]
name = "my-project"
mode = "dev"   # "prod" disables auto-accept entirely

[prod]
paths = ["src/api/**", "migrations/**"]  # high-severity globs

[reviewer]
enabled = true
# Requires ANTHROPIC_API_KEY and/or OPENAI_API_KEY in environment
```

---

## Development

```bash
npm install              # dependencies
npm run compile          # build extension + webview + bridge
npm run lint             # tsc + eslint
npm test                 # vitest (242 tests)
npm run watch            # rebuild on change
```

---

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built with Claude &middot; <a href="https://github.com/arodroz/gait">github.com/arodroz/gait</a></sub>
</p>
