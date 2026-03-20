import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { installPreCommitHook, uninstallPreCommitHook, checkHookTrigger, writeHookResult } from "./hooks";

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gait-hook-"));
  fs.mkdirSync(path.join(dir, ".git", "hooks"), { recursive: true });
  return dir;
}

describe("installPreCommitHook", () => {
  it("installs hook in empty hooks dir", () => {
    const dir = tmpRepo();
    const result = installPreCommitHook(dir);
    expect(result.installed).toBe(true);
    expect(fs.existsSync(path.join(dir, ".git", "hooks", "pre-commit"))).toBe(true);
  });

  it("reports already installed for gait hook", () => {
    const dir = tmpRepo();
    installPreCommitHook(dir);
    const result = installPreCommitHook(dir);
    expect(result.installed).toBe(true);
    expect(result.message).toContain("already");
  });

  it("refuses to overwrite non-gait hook", () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho custom", { mode: 0o755 });
    const result = installPreCommitHook(dir);
    expect(result.installed).toBe(false);
  });

  it("fails without .git/hooks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gait-norepo-"));
    const result = installPreCommitHook(dir);
    expect(result.installed).toBe(false);
  });
});

describe("uninstallPreCommitHook", () => {
  it("removes gait hook", () => {
    const dir = tmpRepo();
    installPreCommitHook(dir);
    expect(uninstallPreCommitHook(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, ".git", "hooks", "pre-commit"))).toBe(false);
  });

  it("refuses to remove non-gait hook", () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho other", { mode: 0o755 });
    expect(uninstallPreCommitHook(dir)).toBe(false);
  });
});

describe("hook trigger/result", () => {
  it("checks trigger and writes result", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gait-trigger-"));
    expect(checkHookTrigger(dir)).toBe(false);

    fs.writeFileSync(path.join(dir, ".hook-trigger"), "gate");
    expect(checkHookTrigger(dir)).toBe(true);

    writeHookResult(dir, true);
    expect(fs.readFileSync(path.join(dir, ".hook-result"), "utf-8")).toBe("pass");
    expect(checkHookTrigger(dir)).toBe(false); // trigger cleaned up
  });
});
