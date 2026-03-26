import * as fs from "fs";
import * as path from "path";
import { parse as parseToml } from "smol-toml";

export const DOT_DIR = ".gait";
export const CONFIG_FILE = "config.toml";

// ── HITL Config Schema ──

export type Severity = "low" | "medium" | "high";

export interface HitlConfig {
  project: {
    name: string;
    mode: "dev" | "prod";
  };
  agents: {
    claude_enabled: boolean;
    codex_enabled: boolean;
  };
  interception: {
    auto_accept_low: boolean;
    auto_accept_timeout_ms: number;
  };
  prod: {
    paths: string[];
  };
  reviewer: {
    enabled: boolean;
    on_severity: Severity[];
    claude_api_key_env: string;
    codex_api_key_env: string;
    timeout_ms: number;
  };
  decision_points: {
    interface_change: boolean;
    file_deleted: boolean;
    file_renamed: boolean;
    schema_change: boolean;
    cross_agent_conflict: boolean;
    intent_drift: boolean;
    public_api_change: boolean;
    cross_agent_conflict_window_s: number;
  };
  snapshots: {
    auto_snapshot: boolean;
    retention: string;
  };
  budget: {
    daily_limit_usd: number;  // 0 = unlimited
  };
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
    intent_drift: false,  // Not yet implemented (Phase 3) — enable when LLM-based drift detection is added
    public_api_change: true,
    cross_agent_conflict_window_s: 14400,
  },
  snapshots: { auto_snapshot: true, retention: "48h" },
  budget: { daily_limit_usd: 0 },
};

// ── Stack detection (used by preflight, dashboard, agents-md) ──

export type Stack = "go" | "python" | "typescript" | "swift";

const STACK_MANIFESTS: Record<string, Stack> = {
  "go.mod": "go",
  "pyproject.toml": "python",
  "setup.py": "python",
  "package.json": "typescript",
  "Package.swift": "swift",
};

export function detectStacks(dir: string): Stack[] {
  const seen = new Set<Stack>();
  for (const [manifest, stack] of Object.entries(STACK_MANIFESTS)) {
    if (fs.existsSync(path.join(dir, manifest))) {
      seen.add(stack);
    }
  }
  return [...seen];
}

// ── Deep merge utility ──

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ── Config loading ──

export function load(dir: string): HitlConfig {
  const configPath = path.join(dir, DOT_DIR, CONFIG_FILE);
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = parseToml(raw) as Record<string, unknown>;
  const merged = deepMerge(DEFAULT_CONFIG, parsed) as HitlConfig;
  return validateConfig(merged);
}

function validateConfig(cfg: HitlConfig): HitlConfig {
  // Ensure required string fields have values
  if (typeof cfg.project.name !== "string") cfg.project.name = "";
  if (cfg.project.mode !== "dev" && cfg.project.mode !== "prod") cfg.project.mode = "dev";
  // Ensure arrays are arrays
  if (!Array.isArray(cfg.prod.paths)) cfg.prod.paths = [];
  if (!Array.isArray(cfg.reviewer.on_severity)) cfg.reviewer.on_severity = ["medium", "high"];
  // Ensure numeric fields are numbers
  if (typeof cfg.interception.auto_accept_timeout_ms !== "number") cfg.interception.auto_accept_timeout_ms = 10000;
  if (typeof cfg.reviewer.timeout_ms !== "number") cfg.reviewer.timeout_ms = 8000;
  if (typeof cfg.decision_points.cross_agent_conflict_window_s !== "number") cfg.decision_points.cross_agent_conflict_window_s = 14400;
  return cfg;
}

export function save(dir: string, cfg: HitlConfig): void {
  const gaitDirPath = path.join(dir, DOT_DIR);
  fs.mkdirSync(gaitDirPath, { recursive: true });

  const template = `[project]
name = ${JSON.stringify(cfg.project.name)}
mode = ${JSON.stringify(cfg.project.mode)}   # "dev" | "prod" — prod disables auto-accept

[agents]
claude_enabled = ${cfg.agents.claude_enabled}
codex_enabled = ${cfg.agents.codex_enabled}

[interception]
auto_accept_low = ${cfg.interception.auto_accept_low}
auto_accept_timeout_ms = ${cfg.interception.auto_accept_timeout_ms}

[prod]
# File paths that require explicit human approval (glob patterns)
paths = ${JSON.stringify(cfg.prod.paths)}

[reviewer]
enabled = ${cfg.reviewer.enabled}
on_severity = ${JSON.stringify(cfg.reviewer.on_severity)}
claude_api_key_env = ${JSON.stringify(cfg.reviewer.claude_api_key_env)}
codex_api_key_env = ${JSON.stringify(cfg.reviewer.codex_api_key_env)}
timeout_ms = ${cfg.reviewer.timeout_ms}

[decision_points]
interface_change = ${cfg.decision_points.interface_change}
file_deleted = ${cfg.decision_points.file_deleted}
file_renamed = ${cfg.decision_points.file_renamed}
schema_change = ${cfg.decision_points.schema_change}
cross_agent_conflict = ${cfg.decision_points.cross_agent_conflict}
intent_drift = ${cfg.decision_points.intent_drift}   # Not yet implemented — Phase 3
public_api_change = ${cfg.decision_points.public_api_change}
cross_agent_conflict_window_s = ${cfg.decision_points.cross_agent_conflict_window_s}

[snapshots]
auto_snapshot = ${cfg.snapshots.auto_snapshot}
retention = ${JSON.stringify(cfg.snapshots.retention)}

[budget]
daily_limit_usd = ${cfg.budget.daily_limit_usd}   # 0 = unlimited
`;

  fs.writeFileSync(path.join(gaitDirPath, CONFIG_FILE), template);
}

export function saveMinimal(dir: string, projectName: string): void {
  const gaitDirPath = path.join(dir, DOT_DIR);
  fs.mkdirSync(gaitDirPath, { recursive: true });

  const template = `[project]
name = ${JSON.stringify(projectName)}
mode = "dev"   # change to "prod" for production repositories

[prod]
# Add paths that should require explicit human approval
# paths = ["src/api/**", "migrations/**"]

[reviewer]
enabled = true
# Requires ANTHROPIC_API_KEY and/or OPENAI_API_KEY in environment
`;

  fs.writeFileSync(path.join(gaitDirPath, CONFIG_FILE), template);
}

export function gaitDir(dir: string): string {
  return path.join(dir, DOT_DIR);
}

export function configExists(dir: string): boolean {
  return fs.existsSync(path.join(dir, DOT_DIR, CONFIG_FILE));
}
