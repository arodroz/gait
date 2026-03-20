import * as fs from "fs";
import * as path from "path";
import { run } from "./runner";
import type { Stack } from "./config";

export interface SetupResult {
  created: string[];
  installed: string[];
  skipped: string[];
}

/**
 * Ensure linter tooling is configured for detected stacks.
 * Creates config files and installs deps if missing.
 */
export async function ensureLinterSetup(cwd: string, stacks: Stack[]): Promise<SetupResult> {
  const result: SetupResult = { created: [], installed: [], skipped: [] };

  for (const stack of stacks) {
    switch (stack) {
      case "typescript":
        await setupTypeScript(cwd, result);
        break;
      case "go":
        await setupGo(cwd, result);
        break;
      case "python":
        await setupPython(cwd, result);
        break;
      case "swift":
        await setupSwift(cwd, result);
        break;
    }
  }

  return result;
}

async function setupTypeScript(cwd: string, result: SetupResult): Promise<void> {
  // ESLint config — skip if any eslint config already exists and is non-trivial
  if (hasExistingEslintConfig(cwd)) {
    result.skipped.push("eslint (existing config found)");
  } else {
    const configFile = path.join(cwd, "eslint.config.js");
    writeEslintConfig(configFile);
    result.created.push("eslint.config.js");
  }

  // Install deps if missing
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const needed: string[] = [];
    if (!allDeps["eslint"]) needed.push("eslint");
    if (!allDeps["@typescript-eslint/eslint-plugin"]) needed.push("@typescript-eslint/eslint-plugin");
    if (!allDeps["@typescript-eslint/parser"]) needed.push("@typescript-eslint/parser");
    if (!allDeps["@vitest/coverage-v8"] && allDeps["vitest"]) needed.push("@vitest/coverage-v8");

    if (needed.length > 0) {
      const installResult = await run("npm", ["install", "-D", ...needed], cwd, 60_000);
      if (installResult.exitCode === 0) {
        result.installed.push(...needed);
      }
    }
  }
}

function hasExistingEslintConfig(cwd: string): boolean {
  const names = [
    ".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yml",
    "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs",
  ];
  for (const n of names) {
    const p = path.join(cwd, n);
    if (!fs.existsSync(p)) continue;
    // Treat empty/stub files as "no config"
    const content = fs.readFileSync(p, "utf-8").trim();
    if (content.length > 30) return true;
  }
  return false;
}

function writeEslintConfig(configPath: string): void {
  fs.writeFileSync(configPath, `const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");

module.exports = [
  {
    files: ["src/**/*.ts", "**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "eqeqeq": ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
];
`);
}

async function setupGo(cwd: string, result: SetupResult): Promise<void> {
  const configFile = path.join(cwd, ".golangci.yml");
  if (fs.existsSync(configFile)) {
    result.skipped.push(".golangci.yml (already exists)");
    return;
  }

  fs.writeFileSync(configFile, `run:
  timeout: 5m

linters:
  enable:
    - errcheck
    - govet
    - staticcheck
    - unused
    - gosimple
    - ineffassign

linters-settings:
  errcheck:
    check-blank: true
`);
  result.created.push(".golangci.yml");
}

async function setupPython(cwd: string, result: SetupResult): Promise<void> {
  const ruffConfig = path.join(cwd, "ruff.toml");
  const pyproject = path.join(cwd, "pyproject.toml");

  if (fs.existsSync(ruffConfig)) {
    result.skipped.push("ruff.toml (already exists)");
    return;
  }

  // Check if ruff config is in pyproject.toml
  if (fs.existsSync(pyproject)) {
    const content = fs.readFileSync(pyproject, "utf-8");
    if (content.includes("[tool.ruff]")) {
      result.skipped.push("ruff (configured in pyproject.toml)");
      return;
    }
  }

  fs.writeFileSync(ruffConfig, `# Ruff linter configuration
line-length = 100

[lint]
select = ["E", "F", "W", "I", "N", "UP"]
ignore = ["E501"]

[lint.isort]
known-first-party = []
`);
  result.created.push("ruff.toml");
}

async function setupSwift(cwd: string, result: SetupResult): Promise<void> {
  const configFile = path.join(cwd, ".swiftlint.yml");
  if (fs.existsSync(configFile)) {
    result.skipped.push(".swiftlint.yml (already exists)");
    return;
  }

  fs.writeFileSync(configFile, `disabled_rules:
  - trailing_whitespace
  - line_length

opt_in_rules:
  - empty_count
  - closure_spacing

excluded:
  - .build
  - Packages
`);
  result.created.push(".swiftlint.yml");
}
