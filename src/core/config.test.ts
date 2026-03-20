import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { detectStacks, defaultConfig, save, load, configExists } from "./config";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-test-"));
}

describe("detectStacks", () => {
  it("detects nothing in empty dir", () => {
    const dir = tmpDir();
    expect(detectStacks(dir)).toEqual([]);
  });

  it("detects go from go.mod", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "go.mod"), "module test");
    expect(detectStacks(dir)).toContain("go");
  });

  it("detects typescript from package.json", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    expect(detectStacks(dir)).toContain("typescript");
  });

  it("detects python from pyproject.toml", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "pyproject.toml"), "");
    expect(detectStacks(dir)).toContain("python");
  });

  it("detects multiple stacks", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "go.mod"), "module test");
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const stacks = detectStacks(dir);
    expect(stacks).toContain("go");
    expect(stacks).toContain("typescript");
    expect(stacks.length).toBe(2);
  });
});

describe("defaultConfig", () => {
  it("creates config with detected stacks", () => {
    const cfg = defaultConfig("myproject", ["go"]);
    expect(cfg.project.name).toBe("myproject");
    expect(cfg.stacks.go).toBeDefined();
    expect(cfg.stacks.go.Test).toBe("go test ./...");
    expect(cfg.pipeline.stages).toEqual(["lint", "typecheck", "test"]);
  });

  it("creates config with no stacks", () => {
    const cfg = defaultConfig("empty", []);
    expect(cfg.stacks).toEqual({});
  });
});

describe("save and load", () => {
  it("round-trips config through TOML", () => {
    const dir = tmpDir();
    const cfg = defaultConfig("test", ["go"]);
    save(dir, cfg);

    expect(configExists(dir)).toBe(true);

    const loaded = load(dir);
    expect(loaded.project.name).toBe("test");
    expect(loaded.stacks.go.Test).toBe("go test ./...");
    expect(loaded.pipeline.stages).toEqual(["lint", "typecheck", "test"]);
  });

  it("throws on missing config", () => {
    const dir = tmpDir();
    expect(() => load(dir)).toThrow();
  });

  it("throws on invalid config missing sections", () => {
    const dir = tmpDir();
    const gaitDir = path.join(dir, ".gait");
    fs.mkdirSync(gaitDir, { recursive: true });
    fs.writeFileSync(path.join(gaitDir, "config.toml"), "[other]\nfoo = 1\n");
    expect(() => load(dir)).toThrow("missing");
  });
});
