import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { load, save, affectedTests, scopedTestCommand, type ImpactMap } from "./impact";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-impact-"));
}

describe("impact map", () => {
  it("returns null for missing file", () => {
    expect(load(tmpDir())).toBeNull();
  });

  it("round-trips save and load", () => {
    const dir = tmpDir();
    const map: ImpactMap = {
      sourceToTests: { "src/foo.ts": ["src/foo.test.ts"] },
      updatedAt: new Date().toISOString(),
    };
    save(dir, map);
    const loaded = load(dir);
    expect(loaded?.sourceToTests["src/foo.ts"]).toEqual(["src/foo.test.ts"]);
  });
});

describe("affectedTests", () => {
  const map: ImpactMap = {
    sourceToTests: {
      "src/core/config.ts": ["src/core/config.test.ts"],
      "src/core/runner.ts": ["src/core/runner.test.ts"],
    },
    updatedAt: "",
  };

  it("finds affected tests for changed files", () => {
    const result = affectedTests(map, ["src/core/config.ts"]);
    expect(result.isScoped).toBe(true);
    expect(result.files).toEqual(["src/core/config.test.ts"]);
  });

  it("returns unscoped when file has no mapping", () => {
    const result = affectedTests(map, ["src/core/unknown.ts"]);
    expect(result.isScoped).toBe(false);
  });

  it("returns unscoped for null map", () => {
    const result = affectedTests(null, ["src/foo.ts"]);
    expect(result.isScoped).toBe(false);
  });

  it("finds tests via convention (foo.ts → foo.test.ts)", () => {
    const mapWithConvention: ImpactMap = {
      sourceToTests: { "src/core/util.test.ts": [] },
      updatedAt: "",
    };
    const result = affectedTests(mapWithConvention, ["src/core/util.ts"]);
    expect(result.isScoped).toBe(true);
    expect(result.files).toContain("src/core/util.test.ts");
  });
});

describe("scopedTestCommand", () => {
  it("builds vitest command for specific files", () => {
    const cmd = scopedTestCommand(["src/core/config.test.ts", "src/core/runner.test.ts"], "typescript");
    expect(cmd).toContain("vitest run");
    expect(cmd).toContain("config.test.ts");
    expect(cmd).toContain("runner.test.ts");
  });

  it("builds go test command", () => {
    const cmd = scopedTestCommand(["internal/config/config_test.go"], "go");
    expect(cmd).toContain("go test");
    expect(cmd).toContain("./internal/config/...");
  });

  it("builds pytest command", () => {
    const cmd = scopedTestCommand(["tests/test_auth.py"], "python");
    expect(cmd).toContain("pytest");
    expect(cmd).toContain("test_auth.py");
  });

  it("returns null for empty list", () => {
    expect(scopedTestCommand([], "typescript")).toBeNull();
  });
});
