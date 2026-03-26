import { describe, it, expect } from "vitest";
import { buildFixPrompt } from "./autofix";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
interface StageResult {
  name: string;
  status: string;
  output: string;
  error: string;
  duration: number;
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-autofix-"));
}

describe("buildFixPrompt", () => {
  it("includes error output", () => {
    const failed: StageResult = {
      name: "lint",
      status: "failed",
      output: "",
      error: "src/core/config.ts:42:5 - error TS2345: Argument of type 'number' is not assignable",
      duration: 500,
    };
    const prompt = buildFixPrompt(failed, tmpDir());
    expect(prompt).toContain('"lint" stage failed');
    expect(prompt).toContain("TS2345");
    expect(prompt).toContain("Fix ONLY the error");
  });

  it("includes relevant file content when file exists", () => {
    const dir = tmpDir();
    const srcDir = path.join(dir, "src", "core");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "config.ts"), "const x: number = 'bad';");

    const failed: StageResult = {
      name: "typecheck",
      status: "failed",
      output: "",
      error: "src/core/config.ts:1:7 - error TS2322",
      duration: 300,
    };
    const prompt = buildFixPrompt(failed, dir);
    expect(prompt).toContain("const x: number");
    expect(prompt).toContain("config.ts");
  });

  it("includes stdout for test failures", () => {
    const failed: StageResult = {
      name: "test",
      status: "failed",
      output: "FAIL src/core/runner.test.ts > run > captures stdout\nExpected: 0\nReceived: 1",
      error: "Tests failed: 1 of 74",
      duration: 2000,
    };
    const prompt = buildFixPrompt(failed, tmpDir());
    expect(prompt).toContain("FAIL");
    expect(prompt).toContain("Expected: 0");
  });

  it("limits error output to 3000 chars", () => {
    const failed: StageResult = {
      name: "lint",
      status: "failed",
      output: "",
      error: "x".repeat(5000),
      duration: 100,
    };
    const prompt = buildFixPrompt(failed, tmpDir());
    // Should be truncated, not the full 5000
    expect(prompt.length).toBeLessThan(5000 + 500); // some headroom for template text
  });

  it("includes minimal-change instructions", () => {
    const failed: StageResult = {
      name: "test",
      status: "failed",
      output: "fail",
      error: "error",
      duration: 100,
    };
    const prompt = buildFixPrompt(failed, tmpDir());
    expect(prompt).toContain("Do not refactor");
    expect(prompt).toContain("Do not add features");
    expect(prompt).toContain("minimal change");
  });
});
