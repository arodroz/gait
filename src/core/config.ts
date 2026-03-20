import * as fs from "fs";
import * as path from "path";
import { parse as parseToml } from "smol-toml";

export const DOT_DIR = ".gait";
export const CONFIG_FILE = "config.toml";
export const SCRIPTS_DIR = "scripts";

export type Stack = "go" | "python" | "typescript" | "swift";

export interface StackCommands {
  Lint: string;
  Test: string;
  Typecheck: string;
  Build: string;
}

export interface PipelineConfig {
  stages: string[];
  timeout: string;
  autofix?: boolean;
  autofix_max_attempts?: number;
  autofix_agent?: string;
}

export interface Config {
  project: { name: string };
  stacks: Record<string, StackCommands>;
  pipeline: PipelineConfig;
}

const STACK_MANIFESTS: Record<string, Stack> = {
  "go.mod": "go",
  "pyproject.toml": "python",
  "setup.py": "python",
  "package.json": "typescript",
  "Package.swift": "swift",
};

const DEFAULT_COMMANDS: Record<Stack, StackCommands> = {
  go: {
    Lint: "go vet ./...",
    Test: "go test ./...",
    Typecheck: "go vet ./...",
    Build: "go build ./...",
  },
  python: {
    Lint: "ruff check .",
    Test: "pytest",
    Typecheck: "mypy .",
    Build: "",
  },
  typescript: {
    Lint: "npx eslint .",
    Test: "npx vitest run",
    Typecheck: "npx tsc --noEmit",
    Build: "npm run build",
  },
  swift: {
    Lint: "swiftlint",
    Test: "swift test",
    Typecheck: "",
    Build: "swift build",
  },
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

export function defaultCommands(stack: Stack): StackCommands {
  return { ...DEFAULT_COMMANDS[stack] };
}

export function defaultConfig(projectName: string, stacks: Stack[]): Config {
  const stackMap: Record<string, StackCommands> = {};
  for (const s of stacks) {
    stackMap[s] = defaultCommands(s);
  }
  return {
    project: { name: projectName },
    stacks: stackMap,
    pipeline: {
      stages: ["lint", "typecheck", "test"],
      timeout: "300s",
    },
  };
}

export function load(dir: string): Config {
  const configPath = path.join(dir, DOT_DIR, CONFIG_FILE);
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = parseToml(raw) as Record<string, unknown>;

  if (!parsed.project || typeof parsed.project !== "object") {
    throw new Error("config.toml missing [project] section");
  }
  if (!parsed.stacks || typeof parsed.stacks !== "object") {
    throw new Error("config.toml missing [stacks] section");
  }
  if (!parsed.pipeline || typeof parsed.pipeline !== "object") {
    throw new Error("config.toml missing [pipeline] section");
  }

  const cfg = parsed as unknown as Config;
  // Ensure pipeline.timeout has a valid default
  if (!cfg.pipeline.timeout) cfg.pipeline.timeout = "300s";
  if (!cfg.pipeline.stages) cfg.pipeline.stages = [];

  return cfg;
}

export function save(dir: string, cfg: Config): void {
  const gaitDir = path.join(dir, DOT_DIR);
  fs.mkdirSync(gaitDir, { recursive: true });

  // Simple TOML serializer for our known structure
  let out = `[project]\nname = ${JSON.stringify(cfg.project.name)}\n\n`;
  for (const [stack, cmds] of Object.entries(cfg.stacks)) {
    out += `[stacks.${stack}]\n`;
    for (const [k, v] of Object.entries(cmds)) {
      if (v) out += `${k} = ${JSON.stringify(v)}\n`;
    }
    out += "\n";
  }
  out += `[pipeline]\nstages = ${JSON.stringify(cfg.pipeline.stages)}\ntimeout = ${JSON.stringify(cfg.pipeline.timeout)}\n`;

  fs.writeFileSync(path.join(gaitDir, CONFIG_FILE), out);
}

export function gaitDir(dir: string): string {
  return path.join(dir, DOT_DIR);
}

export function configExists(dir: string): boolean {
  return fs.existsSync(path.join(dir, DOT_DIR, CONFIG_FILE));
}
