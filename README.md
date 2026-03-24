<p align="center">
  <img src="https://img.shields.io/badge/gait-quality%20gate-7C3AED?style=for-the-badge&logo=shield&logoColor=white" alt="gait" />
</p>

<h3 align="center">Quality gate and pilot for AI coding agents</h3>

<p align="center">
  <a href="https://code.visualstudio.com"><img src="https://img.shields.io/badge/VS%20Code-1.85%2B-007ACC?style=flat-square&logo=visualstudiocode" alt="VS Code" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6B7280?style=flat-square" alt="license" /></a>
</p>

---

> **This is an experimental personal project — not production-ready.**
>
> I'm building this in my spare time to explore ideas around AI agent
> guardrails. Expect rough edges, half-finished features, breaking changes,
> and long stretches with no updates. There are no guarantees of stability,
> support, or maintenance.
>
> Feel free to look around, steal ideas, or open issues — just know what
> you're getting into.

---

## What it does

gait is a VS Code extension that tries to add quality gates around AI coding agents — linting, testing, typechecking, build verification, and more.

**Gate** — runs your pipeline stages (lint, typecheck, test, audit, review) in dependency order with early abort.

**Agents** — launch Claude or Codex from VS Code with token tracking, pause/resume/kill, and auto-gate after sessions.

**Autofix** — when a stage fails, an agent gets the error + source + blame context and attempts a fix.

**Memory** — agents accumulate project context (conventions, past corrections) across sessions.

**Workflows** — define multi-step agent pipelines in YAML.

...and a bunch of other stuff in various states of completeness.

---

## Quick Start

```bash
git clone https://github.com/arodroz/gait.git && cd gait
npm install && npm run compile
# Press F5 in VS Code to launch Extension Host
```

Then:

```
Cmd+Shift+P → Gait: Initialize Project
Cmd+Shift+G → Run Quality Gate
```

---

## Development

```bash
npm install              # dependencies
npm run compile          # build extension + webview
npm run lint             # tsc + eslint
npm test                 # tests
npm run watch            # rebuild on change
```

---

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built with Claude &middot; <a href="https://github.com/arodroz/gait">github.com/arodroz/gait</a></sub>
</p>
