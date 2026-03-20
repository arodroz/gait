import type { TestResult } from "./baseline";

/**
 * Parse test output into structured TestResult array.
 * Supports Go, vitest/jest, and pytest output formats.
 * Pure string parsing — no shell or process execution.
 */
export function parseTestOutput(output: string, stack: string): TestResult[] {
  switch (stack) {
    case "go": return parseGoTestOutput(output);
    case "typescript": return parseVitestOutput(output);
    case "python": return parsePytestOutput(output);
    default: return parseGenericOutput(output);
  }
}

/** Parse `go test ./...` output */
function parseGoTestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const testRe = /^---\s+(PASS|FAIL):\s+(\S+)\s+\(([^)]+)\)/gm;
  let m;
  while ((m = testRe.exec(output)) !== null) {
    results.push({
      package: "",
      name: m[2],
      passed: m[1] === "PASS",
      duration: m[3],
    });
  }

  if (results.length === 0) {
    const pkgRe = /^(ok|FAIL)\s+(\S+)\s+([0-9.]+s)/gm;
    while ((m = pkgRe.exec(output)) !== null) {
      results.push({
        package: m[2],
        name: m[2],
        passed: m[1] === "ok",
        duration: m[3],
      });
    }
  }

  return results;
}

/** Parse vitest/jest output */
function parseVitestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];

  // File-level: "✓ src/core/config.test.ts (5 tests)" or "× src/core/foo.test.ts"
  const fileRe = /([✓×✗])\s+(\S+\.test\.\S+)/gm;
  let m;
  while ((m = fileRe.exec(output)) !== null) {
    results.push({
      package: "",
      name: m[2],
      passed: m[1] === "✓",
      duration: "",
    });
  }

  // Individual test level: " ✓ module > test name 3ms" or " × module > test name"
  if (results.length === 0) {
    const testRe = /^\s*([✓×✗])\s+(.+?)(?:\s+(\d+(?:\.\d+)?(?:ms|s)))?$/gm;
    while ((m = testRe.exec(output)) !== null) {
      results.push({
        package: "",
        name: m[2].trim(),
        passed: m[1] === "✓",
        duration: m[3] ?? "",
      });
    }
  }

  // Fallback: summary "Test Files  16 passed (16)" + "Tests  121 passed (121)"
  if (results.length === 0) {
    const passedMatch = output.match(/Tests\s+(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);
    const passed = parseInt(passedMatch?.[1] ?? "0", 10);
    const failed = parseInt(failedMatch?.[1] ?? "0", 10);
    for (let i = 0; i < passed; i++) {
      results.push({ package: "", name: `test_${i + 1}`, passed: true });
    }
    for (let i = 0; i < failed; i++) {
      results.push({ package: "", name: `failed_${i + 1}`, passed: false });
    }
  }

  return results;
}

/** Parse pytest output */
function parsePytestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const pytestRe = /^(\S+::[\w]+)\s+(PASSED|FAILED|ERROR)/gm;
  let m;
  while ((m = pytestRe.exec(output)) !== null) {
    results.push({
      package: "",
      name: m[1],
      passed: m[2] === "PASSED",
    });
  }
  return results;
}

/** Generic fallback */
function parseGenericOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const re = /\b(PASS|FAIL|passed|failed)\b.*?(\S+\.(?:test|spec)\.\S+)/gm;
  let m;
  while ((m = re.exec(output)) !== null) {
    results.push({
      package: "",
      name: m[2],
      passed: m[1].toLowerCase().startsWith("pass"),
    });
  }
  return results;
}
