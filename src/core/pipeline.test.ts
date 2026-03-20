import { describe, it, expect } from "vitest";
import { runStage, runPipeline, type StageName, type StageResult } from "./pipeline";
import * as os from "os";
import type { Config } from "./config";

describe("runStage", () => {
  it("passes on exit 0", async () => {
    const result = await runStage("lint", "true", os.tmpdir(), 10_000);
    expect(result.status).toBe("passed");
    expect(result.name).toBe("lint");
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("fails on exit non-zero", async () => {
    const result = await runStage("test", "false", os.tmpdir(), 10_000);
    expect(result.status).toBe("failed");
  });

  it("skips empty command", async () => {
    const result = await runStage("build", "", os.tmpdir(), 10_000);
    expect(result.status).toBe("skipped");
  });

  it("captures stdout", async () => {
    const result = await runStage("test", "echo hello", os.tmpdir(), 10_000);
    expect(result.status).toBe("passed");
    expect(result.output.trim()).toBe("hello");
  });

  it("fails on command not found", async () => {
    const result = await runStage("lint", "nonexistent_cmd_xyz", os.tmpdir(), 10_000);
    expect(result.status).toBe("failed");
  });
});

function testConfig(overrides?: Partial<Config>): Config {
  return {
    project: { name: "test" },
    stacks: {
      test: {
        Lint: "true",
        Test: "true",
        Typecheck: "true",
        Build: "",
      },
    },
    pipeline: { stages: ["lint", "typecheck", "test"], timeout: "30s" },
    ...overrides,
  };
}

describe("runPipeline", () => {
  it("runs all stages and passes", async () => {
    const result = await runPipeline(testConfig(), os.tmpdir());
    expect(result.passed).toBe(true);
    expect(result.stages.length).toBe(3);
    expect(result.stages.every((s) => s.status === "passed")).toBe(true);
  });

  it("aborts on first failure and skips rest", async () => {
    const cfg = testConfig({
      stacks: {
        test: { Lint: "false", Test: "true", Typecheck: "true", Build: "" },
      },
    });
    const result = await runPipeline(cfg, os.tmpdir());
    expect(result.passed).toBe(false);

    const lint = result.stages.find((s) => s.name === "lint");
    expect(lint?.status).toBe("failed");

    // test should be skipped since lint failed (test depends on lint)
    const test = result.stages.find((s) => s.name === "test");
    expect(test?.status).toBe("skipped");
  });

  it("fires callbacks for every stage including skipped", async () => {
    const cfg = testConfig({
      stacks: {
        test: { Lint: "false", Test: "true", Typecheck: "true", Build: "" },
      },
    });
    const started: StageName[] = [];
    const completed: StageResult[] = [];

    await runPipeline(cfg, os.tmpdir(), {
      onStageStart: (name) => started.push(name),
      onStageComplete: (r) => completed.push(r),
    });

    // Every stage in pipeline should have a completed callback
    expect(completed.length).toBe(3);
    expect(completed.map((c) => c.name)).toContain("lint");
    expect(completed.map((c) => c.name)).toContain("typecheck");
    expect(completed.map((c) => c.name)).toContain("test");
  });

  it("handles empty pipeline", async () => {
    const cfg = testConfig({ pipeline: { stages: [], timeout: "30s" } });
    const result = await runPipeline(cfg, os.tmpdir());
    expect(result.passed).toBe(true);
    expect(result.stages.length).toBe(0);
  });

  it("skips stages with empty commands", async () => {
    const cfg = testConfig({
      stacks: {
        test: { Lint: "true", Test: "", Typecheck: "", Build: "" },
      },
    });
    const result = await runPipeline(cfg, os.tmpdir());
    expect(result.passed).toBe(true);
    const typecheck = result.stages.find((s) => s.name === "typecheck");
    expect(typecheck?.status).toBe("skipped");
  });
});
