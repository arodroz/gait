import { describe, it, expect } from "vitest";
import { getProfile, listProfiles, applyProfile } from "./profiles";
import type { Config } from "./config";

const testCfg: Config = {
  project: { name: "test" },
  stacks: { ts: { Lint: "eslint", Test: "vitest", Typecheck: "tsc", Build: "esbuild" } },
  pipeline: { stages: ["lint", "typecheck", "test"], timeout: "300s" },
};

describe("getProfile", () => {
  it("returns quick profile", () => {
    const p = getProfile(testCfg, "quick");
    expect(p.stages).toEqual(["lint"]);
  });

  it("returns full profile with all stages", () => {
    const p = getProfile(testCfg, "full");
    expect(p.stages).toEqual(["lint", "typecheck", "test"]);
  });

  it("returns default as full", () => {
    const p = getProfile(testCfg, "unknown");
    expect(p.stages).toEqual(["lint", "typecheck", "test"]);
  });
});

describe("listProfiles", () => {
  it("includes quick and full", () => {
    expect(listProfiles(testCfg)).toContain("quick");
    expect(listProfiles(testCfg)).toContain("full");
  });
});

describe("applyProfile", () => {
  it("overrides pipeline stages", () => {
    const p = getProfile(testCfg, "quick");
    const applied = applyProfile(testCfg, p);
    expect(applied.pipeline.stages).toEqual(["lint"]);
    expect(applied.stacks).toEqual(testCfg.stacks); // stacks unchanged
  });
});
