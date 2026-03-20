import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { install, uninstall, installAll, status } from "./hook-scripts";

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gait-hooks-"));
  fs.mkdirSync(path.join(dir, ".git", "hooks"), { recursive: true });
  return dir;
}

describe("hook-scripts", () => {
  it("installs a single hook", () => {
    const dir = tmpRepo();
    const result = install(dir, "pre-push");
    expect(result.installed).toBe(true);
    expect(fs.existsSync(path.join(dir, ".git", "hooks", "pre-push"))).toBe(true);
  });

  it("reports already installed for gait hook", () => {
    const dir = tmpRepo();
    install(dir, "pre-push");
    const result = install(dir, "pre-push");
    expect(result.installed).toBe(true);
    expect(result.message).toContain("already");
  });

  it("refuses to overwrite non-gait hook", () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, ".git", "hooks", "pre-push"), "#!/bin/sh\ncustom", { mode: 0o755 });
    const result = install(dir, "pre-push");
    expect(result.installed).toBe(false);
    expect(result.message).toContain("not managed");
  });

  it("uninstalls gait hook", () => {
    const dir = tmpRepo();
    install(dir, "post-merge");
    expect(uninstall(dir, "post-merge")).toBe(true);
    expect(fs.existsSync(path.join(dir, ".git", "hooks", "post-merge"))).toBe(false);
  });

  it("refuses to uninstall non-gait hook", () => {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, ".git", "hooks", "post-merge"), "#!/bin/sh\nother", { mode: 0o755 });
    expect(uninstall(dir, "post-merge")).toBe(false);
  });

  it("installs all hooks", () => {
    const dir = tmpRepo();
    const { results } = installAll(dir);
    expect(results.length).toBe(4);
    expect(results.every((r) => r.installed)).toBe(true);
  });

  it("reports status correctly", () => {
    const dir = tmpRepo();
    install(dir, "pre-commit");
    fs.writeFileSync(path.join(dir, ".git", "hooks", "pre-push"), "#!/bin/sh\ncustom", { mode: 0o755 });

    const st = status(dir);
    const preCommit = st.find((s) => s.hook === "pre-commit")!;
    expect(preCommit.installed).toBe(true);
    expect(preCommit.managedByGait).toBe(true);

    const prePush = st.find((s) => s.hook === "pre-push")!;
    expect(prePush.installed).toBe(true);
    expect(prePush.managedByGait).toBe(false);

    const postMerge = st.find((s) => s.hook === "post-merge")!;
    expect(postMerge.installed).toBe(false);
  });
});
