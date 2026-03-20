import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { HistoryLogger } from "./history";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-history-"));
}

describe("HistoryLogger", () => {
  it("logs and reads back entries", () => {
    const dir = tmpDir();
    const logger = new HistoryLogger(dir);

    logger.log("pipeline_run", { passed: true, duration: 1234 });
    logger.log("stage_run", { name: "lint", status: "passed" });

    const date = new Date().toISOString().slice(0, 10);
    const entries = logger.read(date);
    expect(entries.length).toBe(2);
    expect(entries[0].kind).toBe("pipeline_run");
    expect(entries[0].data.passed).toBe(true);
    expect(entries[1].kind).toBe("stage_run");
  });

  it("returns empty for non-existent date", () => {
    const logger = new HistoryLogger(tmpDir());
    expect(logger.read("2099-01-01")).toEqual([]);
  });

  it("creates history directory", () => {
    const dir = tmpDir();
    const histDir = path.join(dir, "history");
    expect(fs.existsSync(histDir)).toBe(false);

    new HistoryLogger(dir);
    expect(fs.existsSync(histDir)).toBe(true);
  });

  it("appends to same file for same day", () => {
    const dir = tmpDir();
    const logger = new HistoryLogger(dir);

    logger.log("commit", { hash: "abc" });
    logger.log("commit", { hash: "def" });

    const date = new Date().toISOString().slice(0, 10);
    const entries = logger.read(date);
    expect(entries.length).toBe(2);
  });
});
