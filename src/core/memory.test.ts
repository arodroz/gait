import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadContext, loadMemory, saveMemory, addCorrection, addPattern, buildPromptPrefix, createDefaults, formatMemory } from "./memory";
import type { Config } from "./config";

function tmpDir(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "gait-mem-")); }

describe("memory", () => {
  it("returns empty for missing files", () => {
    const dir = tmpDir();
    expect(loadContext(dir)).toBe("");
    expect(loadMemory(dir)).toEqual({ corrections: [], patterns: [], never: [] });
  });

  it("saves and loads memory", () => {
    const dir = tmpDir();
    saveMemory(dir, { corrections: [], patterns: [{ category: "test", rule: "use vitest", source: "init" }], never: ["no any"] });
    const mem = loadMemory(dir);
    expect(mem.patterns.length).toBe(1);
    expect(mem.never).toContain("no any");
  });

  it("adds corrections with limit", () => {
    const dir = tmpDir();
    for (let i = 0; i < 60; i++) addCorrection(dir, `err${i}`, `fix${i}`);
    const mem = loadMemory(dir);
    expect(mem.corrections.length).toBe(50);
  });

  it("adds patterns without duplicates", () => {
    const dir = tmpDir();
    addPattern(dir, "style", "use const");
    addPattern(dir, "style", "use const");
    expect(loadMemory(dir).patterns.length).toBe(1);
  });

  it("builds prompt prefix", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "context.md"), "# My Project\nTypeScript app");
    saveMemory(dir, { corrections: [], patterns: [{ category: "test", rule: "use vitest", source: "init" }], never: ["no innerHTML"] });
    const prefix = buildPromptPrefix(dir);
    expect(prefix).toContain("My Project");
    expect(prefix).toContain("use vitest");
    expect(prefix).toContain("no innerHTML");
  });

  it("creates defaults", () => {
    const dir = tmpDir();
    const cfg: Config = { project: { name: "test" }, stacks: { typescript: { Lint: "eslint", Test: "vitest", Typecheck: "tsc", Build: "" } }, pipeline: { stages: ["lint", "test"], timeout: "30s" } };
    createDefaults(dir, tmpDir(), cfg);
    expect(fs.existsSync(path.join(dir, "context.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "memory.json"))).toBe(true);
  });

  it("formats memory for display", () => {
    const output = formatMemory({ corrections: [{ date: "2026-01-01", error: "err", fix: "fix", source: "autofix" }], patterns: [], never: ["no any"] });
    expect(output).toContain("Corrections: 1");
    expect(output).toContain("no any");
  });
});
