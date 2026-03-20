import * as fs from "fs";
import * as path from "path";

export interface ImpactMap {
  /** Map from source file → test files that cover it */
  sourceToTests: Record<string, string[]>;
  updatedAt: string;
}

const IMPACT_FILE = "impact-map.json";

/** Load the impact map from .gait/ */
export function load(gaitDir: string): ImpactMap | null {
  const p = path.join(gaitDir, IMPACT_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/** Save the impact map */
export function save(gaitDir: string, map: ImpactMap): void {
  fs.writeFileSync(path.join(gaitDir, IMPACT_FILE), JSON.stringify(map, null, 2));
}

/**
 * Build impact map from Istanbul/v8 coverage JSON.
 * Maps each source file to the test files that exercise it.
 */
export function buildFromCoverage(coverageJson: Record<string, unknown>): ImpactMap {
  const sourceToTests: Record<string, string[]> = {};

  for (const [file, data] of Object.entries(coverageJson)) {
    const fileCov = data as { s?: Record<string, number>; statementMap?: Record<string, unknown> };
    const statements = fileCov.s ?? {};
    const hasCoverage = Object.values(statements).some((v) => (v as number) > 0);

    if (hasCoverage) {
      // This source file is covered — but by which tests?
      // In per-test coverage runs, the key would tell us.
      // For now, mark it as "covered by full suite" — we'll refine with per-test runs.
      if (!sourceToTests[file]) sourceToTests[file] = [];
    }
  }

  return { sourceToTests, updatedAt: new Date().toISOString() };
}

/**
 * Given changed files, find the minimal set of test files to run.
 * Falls back to "all" if no mapping exists.
 */
export function affectedTests(map: ImpactMap | null, changedFiles: string[]): { files: string[]; isScoped: boolean } {
  if (!map) return { files: [], isScoped: false };

  const testSet = new Set<string>();
  let unmapped = false;

  for (const file of changedFiles) {
    // Normalize path
    const tests = findTests(map, file);
    if (tests.length > 0) {
      for (const t of tests) testSet.add(t);
    } else {
      // Changed file has no mapping — run everything
      unmapped = true;
    }
  }

  if (unmapped) return { files: [], isScoped: false };
  return { files: [...testSet], isScoped: true };
}

function findTests(map: ImpactMap, file: string): string[] {
  // Try exact match first, then suffix match
  if (map.sourceToTests[file]) return map.sourceToTests[file];

  for (const [source, tests] of Object.entries(map.sourceToTests)) {
    if (source.endsWith(file) || file.endsWith(source)) return tests;
  }

  // Convention: source file → test file (foo.ts → foo.test.ts)
  const testVariants = [
    file.replace(/\.ts$/, ".test.ts"),
    file.replace(/\.ts$/, ".spec.ts"),
    file.replace(/\.py$/, "_test.py"),
    file.replace(/\.py$/, ".test.py"),
    file.replace(/\.go$/, "_test.go"),
  ];

  for (const variant of testVariants) {
    if (map.sourceToTests[variant]) return [variant];
  }

  return [];
}

/**
 * Build a scoped vitest command that runs only specific test files.
 */
export function scopedTestCommand(testFiles: string[], stack: string): string | null {
  if (testFiles.length === 0) return null;

  switch (stack) {
    case "typescript":
      return `npx vitest run ${testFiles.join(" ")}`;
    case "go":
      // Go doesn't support individual test files easily, use package paths
      const pkgs = [...new Set(testFiles.map((f) => "./" + path.dirname(f) + "/..."))];
      return `go test ${pkgs.join(" ")}`;
    case "python":
      return `pytest ${testFiles.join(" ")}`;
    default:
      return null;
  }
}
