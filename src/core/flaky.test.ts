import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FlakyTracker } from "./flaky";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-flaky-"));
}

describe("FlakyTracker", () => {
  it("starts with no flaky tests", () => {
    const tracker = new FlakyTracker(tmpDir());
    expect(tracker.isFlaky("pkg/TestFoo")).toBe(false);
    expect(tracker.flakyTests()).toEqual([]);
  });

  it("marks test as flaky after threshold flips", () => {
    const dir = tmpDir();
    const tracker = new FlakyTracker(dir);

    tracker.update("pkg/TestFoo", true);
    tracker.update("pkg/TestFoo", false); // flip 1
    tracker.update("pkg/TestFoo", true);  // flip 2
    tracker.update("pkg/TestFoo", false); // flip 3 — threshold
    expect(tracker.isFlaky("pkg/TestFoo")).toBe(true);
  });

  it("does not mark stable test as flaky", () => {
    const tracker = new FlakyTracker(tmpDir());
    tracker.update("pkg/TestBar", true);
    tracker.update("pkg/TestBar", true);
    tracker.update("pkg/TestBar", true);
    expect(tracker.isFlaky("pkg/TestBar")).toBe(false);
  });

  it("persists across save/load", () => {
    const dir = tmpDir();
    const t1 = new FlakyTracker(dir);
    t1.update("pkg/T", true);
    t1.update("pkg/T", false);
    t1.update("pkg/T", true);
    t1.update("pkg/T", false);
    t1.update("pkg/T", true);
    t1.save();

    const t2 = new FlakyTracker(dir);
    expect(t2.isFlaky("pkg/T")).toBe(true);
  });
});
