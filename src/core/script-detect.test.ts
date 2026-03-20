import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { detectPatterns, isAlreadyScripted, suggestScript } from "./script-detect";
import { HistoryLogger } from "./history";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-detect-"));
}

describe("detectPatterns", () => {
  it("detects repeated stage runs", () => {
    const dir = tmpDir();
    const logger = new HistoryLogger(dir);

    // Log the same stage 5 times
    for (let i = 0; i < 5; i++) {
      logger.log("stage_run", { name: "lint", status: "passed" });
    }

    const patterns = detectPatterns(dir, 3);
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].count).toBe(5);
  });

  it("ignores infrequent commands", () => {
    const dir = tmpDir();
    const logger = new HistoryLogger(dir);
    logger.log("stage_run", { name: "build", status: "passed" });

    const patterns = detectPatterns(dir, 3);
    expect(patterns.length).toBe(0);
  });

  it("returns empty for no history", () => {
    expect(detectPatterns(tmpDir(), 3)).toEqual([]);
  });

  it("detects pipeline patterns", () => {
    const dir = tmpDir();
    const logger = new HistoryLogger(dir);
    for (let i = 0; i < 4; i++) {
      logger.log("pipeline_run", {
        passed: true,
        stages: [{ name: "lint" }, { name: "test" }],
      });
    }

    const patterns = detectPatterns(dir, 3);
    expect(patterns.some((p) => p.command.includes("pipeline"))).toBe(true);
  });
});

describe("isAlreadyScripted", () => {
  it("returns true when command exists in a script", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "lint.sh"), "#!/bin/bash\ngo vet ./...\n");
    expect(isAlreadyScripted(dir, "go vet ./...")).toBe(true);
  });

  it("returns false when command is not scripted", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "lint.sh"), "#!/bin/bash\neslint .\n");
    expect(isAlreadyScripted(dir, "go vet ./...")).toBe(false);
  });

  it("returns false for nonexistent dir", () => {
    expect(isAlreadyScripted("/nonexistent", "anything")).toBe(false);
  });
});

describe("suggestScript", () => {
  it("generates script suggestion from pattern", () => {
    const suggestion = suggestScript({
      command: "npm run test",
      count: 7,
      lastUsed: new Date().toISOString(),
    });
    expect(suggestion.filename).toBe("npm.sh");
    expect(suggestion.content).toContain("gait:name npm");
    expect(suggestion.content).toContain("ran 7 times");
    expect(suggestion.content).toContain("npm run test");
  });
});
