import { run } from "./runner";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface UncoveredFunction {
  file: string;
  name: string;
}

/**
 * Detect new/modified functions without test coverage.
 * Runs the appropriate coverage tool per stack and cross-references
 * with changed files from git diff.
 * Returns uncovered functions, or empty array if coverage tool unavailable.
 */
export async function findUntested(
  cwd: string,
  changedFiles: string[],
  stack: string,
): Promise<{ uncovered: UncoveredFunction[]; error?: string }> {
  if (changedFiles.length === 0) return { uncovered: [] };

  const result = await collectCoverage(cwd, stack);
  if (result.error) return { uncovered: [], error: result.error };
  if (!result.entries.length) return { uncovered: [] };

  // Normalize all paths to relative for comparison
  const uncovered: UncoveredFunction[] = [];
  for (const entry of result.entries) {
    // Normalize entry.file to relative path from cwd
    let rel = entry.file;
    if (path.isAbsolute(rel)) {
      rel = path.relative(cwd, rel);
    }

    const isChanged = changedFiles.some((f) =>
      rel === f || rel.endsWith(f) || f.endsWith(rel),
    );
    if (isChanged && !entry.covered) {
      uncovered.push({ file: rel, name: entry.name });
    }
  }
  return { uncovered };
}

interface CoverageEntry {
  file: string;
  name: string;
  covered: boolean;
}

interface CollectResult {
  entries: CoverageEntry[];
  error?: string;
}

async function collectCoverage(cwd: string, stack: string): Promise<CollectResult> {
  switch (stack) {
    case "go": return collectGoCoverage(cwd);
    case "typescript": return collectTsCoverage(cwd);
    case "python": return collectPyCoverage(cwd);
    default: return { entries: [], error: `No coverage tool configured for stack: ${stack}` };
  }
}

async function collectGoCoverage(cwd: string): Promise<CollectResult> {
  const coverFile = path.join(os.tmpdir(), `gait-cover-${Date.now()}.out`);
  const result = await run("go", ["test", `-coverprofile=${coverFile}`, "./..."], cwd, 300_000);
  if (result.exitCode !== 0) {
    return { entries: [], error: `go test failed: ${result.stderr.slice(0, 200)}` };
  }

  const toolResult = await run("go", ["tool", "cover", `-func=${coverFile}`], cwd, 30_000);
  try { fs.unlinkSync(coverFile); } catch { /* cleanup best-effort */ }
  if (toolResult.exitCode !== 0) {
    return { entries: [], error: "go tool cover failed" };
  }

  const entries: CoverageEntry[] = [];
  for (const line of toolResult.stdout.split("\n")) {
    const match = line.match(/^(.+?):(\d+):\s+(\S+)\s+([\d.]+)%/);
    if (match) {
      entries.push({
        file: match[1],
        name: match[3],
        covered: parseFloat(match[4]) > 0,
      });
    }
  }
  return { entries };
}

async function collectTsCoverage(cwd: string): Promise<CollectResult> {
  const covDir = path.join(os.tmpdir(), `gait-ts-cov-${Date.now()}`);
  const result = await run(
    "npx", ["vitest", "run", "--coverage", "--coverage.reporter=json", `--coverage.reportsDirectory=${covDir}`],
    cwd, 300_000,
  );
  if (result.exitCode !== 0) {
    return { entries: [], error: `vitest coverage failed: ${result.stderr.slice(0, 200)}` };
  }

  const covFile = path.join(covDir, "coverage-final.json");
  if (!fs.existsSync(covFile)) {
    return { entries: [], error: "Coverage file not generated. Install @vitest/coverage-v8" };
  }

  try {
    const data = JSON.parse(fs.readFileSync(covFile, "utf-8"));
    const entries: CoverageEntry[] = [];

    for (const [file, fileCov] of Object.entries(data) as [string, Record<string, unknown>][]) {
      const fnMap = (fileCov.fnMap ?? {}) as Record<string, { name?: string; loc?: { start?: { line?: number } } }>;
      const fnHits = (fileCov.f ?? {}) as Record<string, number>;
      for (const [id, fn] of Object.entries(fnMap)) {
        entries.push({
          file, // absolute path — will be normalized in findUntested
          name: fn.name || `anonymous@${fn.loc?.start?.line ?? "?"}`,
          covered: (fnHits[id] ?? 0) > 0,
        });
      }
    }

    // Cleanup
    try { fs.rmSync(covDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    return { entries };
  } catch (err) {
    return { entries: [], error: `Failed to parse coverage JSON: ${err}` };
  }
}

async function collectPyCoverage(cwd: string): Promise<CollectResult> {
  const covFile = path.join(os.tmpdir(), `gait-py-cov-${Date.now()}.json`);
  const result = await run(
    "pytest", ["--cov", `--cov-report=json:${covFile}`],
    cwd, 300_000,
  );
  if (result.exitCode !== 0) {
    return { entries: [], error: `pytest-cov failed: ${result.stderr.slice(0, 200)}` };
  }

  if (!fs.existsSync(covFile)) {
    return { entries: [], error: "Coverage file not generated. Install pytest-cov" };
  }

  try {
    const data = JSON.parse(fs.readFileSync(covFile, "utf-8"));
    const entries: CoverageEntry[] = [];
    const files = (data.files ?? {}) as Record<string, { missing_lines?: number[] }>;

    for (const [file, fileCov] of Object.entries(files)) {
      const missing = fileCov.missing_lines ?? [];
      entries.push({
        file,
        name: path.basename(file),
        covered: missing.length === 0,
      });
    }

    try { fs.unlinkSync(covFile); } catch { /* best-effort */ }
    return { entries };
  } catch (err) {
    return { entries: [], error: `Failed to parse pytest coverage: ${err}` };
  }
}
