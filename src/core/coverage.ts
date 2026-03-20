import { run } from "./runner";
import * as path from "path";

export interface UncoveredFunction {
  file: string;
  name: string;
}

/**
 * Detect new/modified functions without test coverage.
 * Runs the appropriate coverage tool per stack and cross-references
 * with changed files from git diff.
 */
export async function findUntested(
  cwd: string,
  changedFiles: string[],
  stack: string,
): Promise<UncoveredFunction[]> {
  if (changedFiles.length === 0) return [];

  const coverageData = await collectCoverage(cwd, stack);
  if (!coverageData) return [];

  // Cross-reference: find functions in changed files that have no coverage
  const uncovered: UncoveredFunction[] = [];
  for (const entry of coverageData) {
    const rel = path.relative(cwd, entry.file);
    if (changedFiles.some((f) => rel === f || rel.endsWith(f) || f.endsWith(rel))) {
      if (!entry.covered) {
        uncovered.push({ file: rel, name: entry.name });
      }
    }
  }
  return uncovered;
}

interface CoverageEntry {
  file: string;
  name: string;
  covered: boolean;
}

async function collectCoverage(cwd: string, stack: string): Promise<CoverageEntry[] | null> {
  switch (stack) {
    case "go": return collectGoCoverage(cwd);
    case "typescript": return collectTsCoverage(cwd);
    case "python": return collectPyCoverage(cwd);
    default: return null;
  }
}

async function collectGoCoverage(cwd: string): Promise<CoverageEntry[]> {
  // go test -coverprofile outputs per-function coverage
  const result = await run("go", ["test", "-coverprofile=/tmp/gait-cover.out", "./..."], cwd, 300_000);
  if (result.exitCode !== 0) return [];

  const toolResult = await run("go", ["tool", "cover", "-func=/tmp/gait-cover.out"], cwd, 30_000);
  if (toolResult.exitCode !== 0) return [];

  const entries: CoverageEntry[] = [];
  for (const line of toolResult.stdout.split("\n")) {
    // Format: "file.go:line:  funcName  percentage%"
    const match = line.match(/^(.+?):(\d+):\s+(\S+)\s+([\d.]+)%/);
    if (match) {
      entries.push({
        file: match[1],
        name: match[3],
        covered: parseFloat(match[4]) > 0,
      });
    }
  }
  return entries;
}

async function collectTsCoverage(cwd: string): Promise<CoverageEntry[]> {
  // vitest with json coverage reporter
  const result = await run(
    "npx", ["vitest", "run", "--coverage", "--coverage.reporter=json", "--coverage.reportsDirectory=/tmp/gait-ts-cov"],
    cwd, 300_000,
  );
  if (result.exitCode !== 0) return [];

  try {
    const fs = await import("fs");
    const data = JSON.parse(fs.readFileSync("/tmp/gait-ts-cov/coverage-final.json", "utf-8"));
    const entries: CoverageEntry[] = [];

    for (const [file, fileCov] of Object.entries(data) as [string, any][]) {
      const fnMap = fileCov.fnMap ?? {};
      const fnHits = fileCov.f ?? {};
      for (const [id, fn] of Object.entries(fnMap) as [string, any][]) {
        entries.push({
          file,
          name: fn.name || `anonymous@${fn.loc?.start?.line}`,
          covered: (fnHits[id] ?? 0) > 0,
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

async function collectPyCoverage(cwd: string): Promise<CoverageEntry[]> {
  // pytest-cov with json output
  const result = await run(
    "pytest", ["--cov", "--cov-report=json:/tmp/gait-py-cov.json"],
    cwd, 300_000,
  );
  if (result.exitCode !== 0) return [];

  try {
    const fs = await import("fs");
    const data = JSON.parse(fs.readFileSync("/tmp/gait-py-cov.json", "utf-8"));
    const entries: CoverageEntry[] = [];
    const files = data.files ?? {};

    for (const [file, fileCov] of Object.entries(files) as [string, any][]) {
      const missing = fileCov.missing_lines ?? [];
      entries.push({
        file,
        name: path.basename(file),
        covered: missing.length === 0,
      });
    }
    return entries;
  } catch {
    return [];
  }
}
