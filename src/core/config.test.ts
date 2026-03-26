import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { detectStacks, save, load, configExists, saveMinimal, DEFAULT_CONFIG } from "./config";

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

describe("save and load (HitlConfig)", () => {
  it("round-trips config through TOML", () => {
    const dir = tmpDir();
    const cfg = { ...DEFAULT_CONFIG, project: { name: "test-project", mode: "dev" as const } };
    save(dir, cfg);

    expect(configExists(dir)).toBe(true);

    const loaded = load(dir);
    expect(loaded.project.name).toBe("test-project");
    expect(loaded.project.mode).toBe("dev");
    expect(loaded.agents.claude_enabled).toBe(true);
    expect(loaded.interception.auto_accept_timeout_ms).toBe(10000);
    expect(loaded.reviewer.enabled).toBe(true);
    expect(loaded.decision_points.interface_change).toBe(true);
    expect(loaded.snapshots.retention).toBe("48h");
  });

  it("deep-merges partial config over defaults", () => {
    const dir = tmpDir();
    const gaitDir = path.join(dir, ".gait");
    fs.mkdirSync(gaitDir, { recursive: true });
    fs.writeFileSync(path.join(gaitDir, "config.toml"), `[project]\nname = "partial"\nmode = "prod"\n`);

    const loaded = load(dir);
    expect(loaded.project.name).toBe("partial");
    expect(loaded.project.mode).toBe("prod");
    // Defaults should fill in missing sections
    expect(loaded.agents.claude_enabled).toBe(true);
    expect(loaded.reviewer.timeout_ms).toBe(8000);
  });

  it("throws on missing config file", () => {
    const dir = tmpDir();
    expect(() => load(dir)).toThrow();
  });
});

describe("saveMinimal", () => {
  it("creates a minimal config and loads with defaults", () => {
    const dir = tmpDir();
    saveMinimal(dir, "my-project");

    expect(configExists(dir)).toBe(true);

    const loaded = load(dir);
    expect(loaded.project.name).toBe("my-project");
    expect(loaded.project.mode).toBe("dev");
    expect(loaded.reviewer.enabled).toBe(true);
    // All defaults should be present
    expect(loaded.decision_points.file_deleted).toBe(true);
  });
});
