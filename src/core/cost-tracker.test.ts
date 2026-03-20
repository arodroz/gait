import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CostTracker } from "./cost-tracker";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-cost-"));
}

describe("CostTracker", () => {
  it("records a session and tracks cost", () => {
    const tracker = new CostTracker(tmpDir());
    tracker.record("claude", "fix lint", 1000, 2000, 5000);
    const summary = tracker.summary();
    expect(summary.today).toBeGreaterThan(0);
    expect(summary.sessions).toBe(1);
  });

  it("estimates from output lines", () => {
    const tracker = new CostTracker(tmpDir());
    tracker.estimateFromLines("claude", "fix test", 100, 10_000);
    const summary = tracker.summary();
    expect(summary.today).toBeGreaterThan(0);
  });

  it("enforces daily budget", () => {
    const dir = tmpDir();
    const tracker = new CostTracker(dir);
    // Record a huge session
    tracker.record("claude", "big task", 100_000, 200_000, 60_000);
    expect(tracker.canRun(0.01)).toBe(false); // $0.01 budget
    expect(tracker.canRun(1000)).toBe(true); // $1000 budget
  });

  it("persists across instances", () => {
    const dir = tmpDir();
    const t1 = new CostTracker(dir);
    t1.record("claude", "test", 500, 1000, 3000);

    const t2 = new CostTracker(dir);
    expect(t2.summary().sessions).toBe(1);
  });

  it("reports budget percentage", () => {
    const tracker = new CostTracker(tmpDir());
    tracker.record("claude", "test", 1000, 2000, 5000);
    const summary = tracker.summary(0.001); // tiny budget so percentage is visible
    expect(summary.budgetUsedPct).toBeGreaterThan(0);
    // overBudget is true since the cost exceeds $0.001
    expect(summary.overBudget).toBe(true);
  });
});
