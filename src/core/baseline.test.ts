import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { BaselineStore } from "./baseline";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-baseline-"));
}

describe("BaselineStore", () => {
  it("returns empty baseline for new branch", () => {
    const store = new BaselineStore(tmpDir());
    const b = store.load("main");
    expect(b.branch).toBe("main");
    expect(b.tests).toEqual([]);
  });

  it("round-trips save and load", () => {
    const dir = tmpDir();
    const store = new BaselineStore(dir);
    store.save({
      branch: "main",
      tests: [
        { package: "pkg", name: "TestFoo", passed: true },
        { package: "pkg", name: "TestBar", passed: true },
      ],
      updatedAt: "",
    });

    const loaded = store.load("main");
    expect(loaded.tests.length).toBe(2);
    expect(loaded.updatedAt).toBeTruthy();
  });

  it("detects regressions", () => {
    const dir = tmpDir();
    const store = new BaselineStore(dir);

    // Save baseline with passing test
    store.save({
      branch: "main",
      tests: [{ package: "pkg", name: "TestFoo", passed: true }],
      updatedAt: "",
    });

    // Current: TestFoo now fails
    const report = store.diff(
      [{ package: "pkg", name: "TestFoo", passed: false }],
      "main",
    );
    expect(report.regressions.length).toBe(1);
    expect(report.hasFailures).toBe(true);
    expect(report.passed.length).toBe(0);
  });

  it("detects new tests", () => {
    const dir = tmpDir();
    const store = new BaselineStore(dir);

    const report = store.diff(
      [{ package: "pkg", name: "TestNew", passed: true }],
      "main",
    );
    expect(report.newTests.length).toBe(1);
    expect(report.regressions.length).toBe(0);
  });

  it("reports passing tests", () => {
    const dir = tmpDir();
    const store = new BaselineStore(dir);
    store.save({
      branch: "main",
      tests: [{ package: "pkg", name: "TestFoo", passed: true }],
      updatedAt: "",
    });

    const report = store.diff(
      [{ package: "pkg", name: "TestFoo", passed: true }],
      "main",
    );
    expect(report.passed.length).toBe(1);
    expect(report.hasFailures).toBe(false);
  });

  it("sanitizes branch names in filenames", () => {
    const dir = tmpDir();
    const store = new BaselineStore(dir);
    store.save({
      branch: "feat/my-branch",
      tests: [{ package: "p", name: "T", passed: true }],
      updatedAt: "",
    });

    // Should create a file with sanitized name
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f.includes("feat_my-branch"))).toBe(true);
  });
});
