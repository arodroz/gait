import { run, type RunResult } from "./runner";
import type { Config } from "./config";
import { parseDuration } from "./util";

export type StageName = "lint" | "typecheck" | "test" | "build" | "review" | "audit" | string;
export type StageStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface StageResult {
  name: StageName;
  status: StageStatus;
  output: string;
  error: string;
  duration: number;
}

export interface PipelineResult {
  stages: StageResult[];
  passed: boolean;
  duration: number;
}

export interface PipelineCallbacks {
  onStageStart?: (name: StageName) => void;
  onStageComplete?: (result: StageResult) => void;
}

/** Run a single stage */
export async function runStage(
  name: StageName,
  cmd: string,
  cwd: string,
  timeout: number,
): Promise<StageResult> {
  if (!cmd) {
    return { name, status: "skipped", output: "", error: "", duration: 0 };
  }

  let result: RunResult;
  try {
    result = await run(cmd, [], cwd, timeout);
  } catch (err) {
    return {
      name,
      status: "failed",
      output: "",
      error: String(err),
      duration: 0,
    };
  }

  return {
    name,
    status: result.exitCode === 0 ? "passed" : "failed",
    output: result.stdout,
    error: result.timedOut ? `timed out after ${timeout}ms` : result.stderr,
    duration: result.duration,
  };
}

/** Run the full pipeline with early abort */
export async function runPipeline(
  cfg: Config,
  cwd: string,
  callbacks?: PipelineCallbacks,
): Promise<PipelineResult> {
  const start = Date.now();
  const timeout = parseDuration(cfg.pipeline.timeout);
  const commands = collectCommands(cfg);
  const results: StageResult[] = [];
  let allPassed = true;

  // Dependency order: lint and typecheck before test
  const ordered = topoSort(cfg.pipeline.stages as StageName[]);

  for (const name of ordered) {
    if (!allPassed && name === "test") {
      results.push({
        name,
        status: "skipped",
        output: "",
        error: "skipped due to earlier failure",
        duration: 0,
      });
      continue;
    }

    callbacks?.onStageStart?.(name);
    const result = await runStage(name, commands[name] ?? "", cwd, timeout);
    results.push(result);
    callbacks?.onStageComplete?.(result);

    if (result.status === "failed") {
      allPassed = false;
      // Skip remaining stages
      for (const remaining of ordered) {
        if (!results.some((r) => r.name === remaining)) {
          const skipped: StageResult = {
            name: remaining,
            status: "skipped",
            output: "",
            error: "skipped due to earlier failure",
            duration: 0,
          };
          results.push(skipped);
          callbacks?.onStageComplete?.(skipped);
        }
      }
      break;
    }
  }

  return { stages: results, passed: allPassed, duration: Date.now() - start };
}

function collectCommands(cfg: Config): Record<string, string> {
  const cmds: Record<string, string> = {};
  for (const stack of Object.values(cfg.stacks)) {
    if (stack.Lint) cmds.lint = stack.Lint;
    if (stack.Typecheck) cmds.typecheck = stack.Typecheck;
    if (stack.Test) cmds.test = stack.Test;
    if (stack.Build) cmds.build = stack.Build;
  }
  return cmds;
}

function topoSort(stages: StageName[]): StageName[] {
  // test depends on lint and typecheck
  const order: StageName[] = [];
  const set = new Set(stages);
  if (set.has("lint")) order.push("lint");
  if (set.has("typecheck")) order.push("typecheck");
  if (set.has("test")) order.push("test");
  if (set.has("build")) order.push("build");
  // Add any remaining
  for (const s of stages) {
    if (!order.includes(s)) order.push(s);
  }
  return order;
}
