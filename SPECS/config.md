# Spec — config.toml schema

## Full schema with defaults

```toml
[project]
name = "my-project"
mode = "dev"          # "dev" | "prod"
                      # prod: auto-accept disabled, all actions require explicit decision

[agents]
claude_enabled = true
codex_enabled = false  # opt-in — requires codex CLI installed

[interception]
# Severity thresholds for each presentation level
# low    → toast notification (auto-accept after timeout)
# medium → panel opens, human must decide
# high   → blocking modal, explicit accept required
auto_accept_low = true
auto_accept_timeout_ms = 10000   # how long before low-severity auto-accepts

# Override: in prod mode, these are ignored — everything requires explicit decision

[prod]
# File paths considered production — triggers high severity + modal
# Glob patterns relative to workspace root
paths = [
  "src/api/**",
  "src/db/**",
  "migrations/**",
  "*.config.ts",
  "*.config.js"
]

[reviewer]
enabled = true
# Which severity levels trigger a cross-agent review
on_severity = ["medium", "high"]
# API keys read from environment — never stored here
claude_api_key_env = "ANTHROPIC_API_KEY"
codex_api_key_env = "OPENAI_API_KEY"
# Max time to wait for reviewer before showing UI without analysis
timeout_ms = 8000

[decision_points]
# Toggle individual detection types
# Set to false to reduce noise if a detector produces too many false positives
interface_change = true
file_deleted = true
file_renamed = true
schema_change = true
cross_agent_conflict = true
intent_drift = true          # requires LLM call — set false to save tokens
public_api_change = true

# How long back to look for cross-agent conflicts (seconds)
cross_agent_conflict_window_s = 14400   # 4 hours

[snapshots]
auto_snapshot = true           # take snapshot before each agent session
retention = "48h"              # prune snapshots older than this
```

## TypeScript interface

```typescript
export interface HitlConfig {
  project: {
    name: string
    mode: "dev" | "prod"
  }
  agents: {
    claude_enabled: boolean
    codex_enabled: boolean
  }
  interception: {
    auto_accept_low: boolean
    auto_accept_timeout_ms: number
  }
  prod: {
    paths: string[]
  }
  reviewer: {
    enabled: boolean
    on_severity: Array<"low" | "medium" | "high">
    claude_api_key_env: string
    codex_api_key_env: string
    timeout_ms: number
  }
  decision_points: {
    interface_change: boolean
    file_deleted: boolean
    file_renamed: boolean
    schema_change: boolean
    cross_agent_conflict: boolean
    intent_drift: boolean
    public_api_change: boolean
    cross_agent_conflict_window_s: number
  }
  snapshots: {
    auto_snapshot: boolean
    retention: string
  }
}

export const DEFAULT_CONFIG: HitlConfig = {
  project: { name: "", mode: "dev" },
  agents: { claude_enabled: true, codex_enabled: false },
  interception: { auto_accept_low: true, auto_accept_timeout_ms: 10000 },
  prod: { paths: [] },
  reviewer: {
    enabled: true,
    on_severity: ["medium", "high"],
    claude_api_key_env: "ANTHROPIC_API_KEY",
    codex_api_key_env: "OPENAI_API_KEY",
    timeout_ms: 8000,
  },
  decision_points: {
    interface_change: true,
    file_deleted: true,
    file_renamed: true,
    schema_change: true,
    cross_agent_conflict: true,
    intent_drift: true,
    public_api_change: true,
    cross_agent_conflict_window_s: 14400,
  },
  snapshots: { auto_snapshot: true, retention: "48h" },
}
```

## Loading

`config.ts` already handles TOML loading via `smol-toml`. Replace the existing schema validation with the new `HitlConfig` interface. Deep-merge loaded values over `DEFAULT_CONFIG` so missing keys always have defaults.

```typescript
export function loadConfig(cwd: string): HitlConfig {
  const raw = fs.readFileSync(path.join(cwd, '.gait', 'config.toml'), 'utf8')
  const parsed = parse(raw)  // smol-toml
  return deepMerge(DEFAULT_CONFIG, parsed) as HitlConfig
}
```

## Init template

When `gait.init` creates `.gait/config.toml`, write a minimal template with comments:

```toml
[project]
name = "my-project"
mode = "dev"   # change to "prod" for production repositories

[prod]
# Add paths that should require explicit human approval
# paths = ["src/api/**", "migrations/**"]

[reviewer]
enabled = true
# Requires ANTHROPIC_API_KEY and/or OPENAI_API_KEY in environment
```
