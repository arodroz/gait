import * as fs from "fs";
import * as path from "path";
import { AgentRunner, type AgentKind } from "./agent";
import { run } from "./runner";
import { interpolate } from "./prompts";

export interface WorkflowStep {
  type: "agent" | "command" | "gate";
  agent?: AgentKind;
  prompt?: string;
  command?: string;
  profile?: string;
}

export interface Workflow {
  name: string;
  description: string;
  steps: WorkflowStep[];
  path: string;
}

export interface WorkflowProgress {
  currentStep: number;
  totalSteps: number;
  status: "running" | "passed" | "failed" | "aborted";
  stepResults: { step: number; type: string; passed: boolean; output: string }[];
}

/** Parse a workflow YAML file (simple line-based parser) */
export function parseWorkflow(filePath: string): Workflow {
  const content = fs.readFileSync(filePath, "utf-8");
  const workflow: Workflow = {
    name: path.basename(filePath, path.extname(filePath)),
    description: "",
    steps: [],
    path: filePath,
  };

  let inSteps = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("name:")) {
      workflow.name = trimmed.slice(5).trim();
    } else if (trimmed.startsWith("description:")) {
      workflow.description = trimmed.slice(12).trim();
    } else if (trimmed === "steps:") {
      inSteps = true;
    } else if (inSteps && trimmed.startsWith("- agent:")) {
      const agent = trimmed.slice(8).trim() as AgentKind;
      workflow.steps.push({ type: "agent", agent });
    } else if (inSteps && trimmed.startsWith("prompt:")) {
      const last = workflow.steps[workflow.steps.length - 1];
      if (last) last.prompt = trimmed.slice(7).trim().replace(/^["']|["']$/g, "");
    } else if (inSteps && trimmed.startsWith("- command:")) {
      workflow.steps.push({ type: "command", command: trimmed.slice(10).trim() });
    } else if (inSteps && trimmed.startsWith("- gate")) {
      const profileMatch = trimmed.match(/profile:\s*(\w+)/);
      workflow.steps.push({ type: "gate", profile: profileMatch?.[1] });
    } else if (inSteps && trimmed.startsWith("profile:") && workflow.steps.length > 0) {
      // Attach profile to the previous step (gate)
      const last = workflow.steps[workflow.steps.length - 1];
      if (last.type === "gate") {
        last.profile = trimmed.slice(8).trim();
      }
    }
  }

  return workflow;
}

/** List workflows in .gait/workflows/ */
export function listWorkflows(gaitDir: string): Workflow[] {
  const dir = path.join(gaitDir, "workflows");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => parseWorkflow(path.join(dir, f)));
}

/** Run a workflow step by step */
export async function runWorkflow(
  workflow: Workflow,
  cwd: string,
  vars: Record<string, string>,
  callbacks: {
    onStepStart: (step: number, total: number, desc: string) => void;
    onStepDone: (step: number, passed: boolean, output: string) => void;
    onAgentOutput: (line: string) => void;
    runGate: (profile?: string) => Promise<boolean>;
  },
): Promise<WorkflowProgress> {
  const progress: WorkflowProgress = {
    currentStep: 0,
    totalSteps: workflow.steps.length,
    status: "running",
    stepResults: [],
  };

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    progress.currentStep = i + 1;

    const desc = step.type === "agent"
      ? `${step.agent}: ${step.prompt?.slice(0, 50) ?? "..."}`
      : step.type === "gate"
        ? `gate (${step.profile ?? "default"})`
        : step.command ?? "command";

    callbacks.onStepStart(i + 1, workflow.steps.length, desc);

    let passed = false;
    let output = "";

    switch (step.type) {
      case "agent": {
        if (!step.agent || !step.prompt) {
          output = "Missing agent or prompt";
          break;
        }
        const prompt = interpolate(step.prompt, vars);
        const agent = new AgentRunner();
        const lines: string[] = [];
        agent.on("output", (line: string) => {
          lines.push(line);
          callbacks.onAgentOutput(line);
        });

        await new Promise<void>((resolve) => {
          agent.on("done", () => resolve());
          agent.on("error", () => resolve());
          agent.start(step.agent!, prompt, cwd).catch(() => resolve());
        });

        output = lines.join("\n").slice(0, 1000);
        passed = true; // Agent completing = success (gate checks correctness)
        break;
      }

      case "command": {
        if (!step.command) break;
        const cmd = interpolate(step.command, vars);
        const result = await run(cmd, [], cwd, 300_000);
        passed = result.exitCode === 0;
        output = (result.stdout + result.stderr).slice(0, 1000);
        break;
      }

      case "gate": {
        passed = await callbacks.runGate(step.profile);
        output = passed ? "Gate passed" : "Gate failed";
        break;
      }
    }

    progress.stepResults.push({ step: i + 1, type: step.type, passed, output });
    callbacks.onStepDone(i + 1, passed, output);

    if (!passed) {
      progress.status = "failed";
      return progress;
    }
  }

  progress.status = "passed";
  return progress;
}

/** Create default example workflow */
export function createDefaults(gaitDir: string): void {
  const dir = path.join(gaitDir, "workflows");
  fs.mkdirSync(dir, { recursive: true });

  const example = `name: implement-and-test
description: Agent implements a feature, then writes tests
steps:
  - agent: claude
    prompt: "{{task}}"
  - gate
    profile: quick
  - agent: claude
    prompt: "Write tests for the changes you just made"
  - gate
    profile: full
`;

  const p = path.join(dir, "implement-and-test.yaml");
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, example);
  }
}
