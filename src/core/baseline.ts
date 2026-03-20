import * as fs from "fs";
import * as path from "path";

export interface TestResult {
  package: string;
  name: string;
  passed: boolean;
  duration?: string;
}

export interface Baseline {
  branch: string;
  tests: TestResult[];
  updatedAt: string;
}

export interface RegressionReport {
  passed: TestResult[];
  regressions: TestResult[];
  newTests: TestResult[];
  hasFailures: boolean;
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class BaselineStore {
  constructor(private gaitDir: string) {}

  private filePath(branch: string): string {
    return path.join(this.gaitDir, `baseline_${sanitizeBranch(branch)}.json`);
  }

  load(branch: string): Baseline {
    const p = this.filePath(branch);
    if (!fs.existsSync(p)) {
      return { branch, tests: [], updatedAt: "" };
    }
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }

  save(baseline: Baseline): void {
    baseline.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.filePath(baseline.branch), JSON.stringify(baseline, null, 2));
  }

  diff(current: TestResult[], branch: string): RegressionReport {
    const base = this.load(branch);
    const baseMap = new Map<string, TestResult>();
    for (const t of base.tests) {
      baseMap.set(`${t.package}/${t.name}`, t);
    }

    const passed: TestResult[] = [];
    const regressions: TestResult[] = [];
    const newTests: TestResult[] = [];

    for (const t of current) {
      const key = `${t.package}/${t.name}`;
      const prev = baseMap.get(key);

      if (!prev) {
        newTests.push(t);
      } else if (t.passed) {
        passed.push(t);
      } else if (prev.passed) {
        regressions.push(t);
      }
    }

    return { passed, regressions, newTests, hasFailures: regressions.length > 0 };
  }
}
