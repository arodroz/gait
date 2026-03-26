import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseWorkflow, listWorkflows, createDefaults, runWorkflow, type Workflow } from "./workflow";

vi.mock("./runner", () => ({
  run: vi.fn(),
}));

vi.mock("./agent", () => ({
  AgentRunner: class MockAgent {
    private handlers: Record<string, Function> = {};
    on(event: string, handler: Function) { this.handlers[event] = handler; return this; }
    async start(_kind: string, _prompt: string, _cwd: string) {
      this.handlers.output?.("line 1");
      this.handlers.done?.(0, 1000);
    }
  },
}));

import { run } from "./runner";
const mockRun = vi.mocked(run);

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-wf-"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseWorkflow", () => {
  it("parses a workflow yaml", () => {
    const dir = tmpDir();
    const p = path.join(dir, "test.yaml");
    fs.writeFileSync(p, `name: my-workflow
description: Test workflow
steps:
  - agent: claude
    prompt: "Do the thing"
  - gate
    profile: quick
  - command: npm test
`);
    const wf = parseWorkflow(p);
    expect(wf.name).toBe("my-workflow");
    expect(wf.steps.length).toBe(3);
    expect(wf.steps[0].type).toBe("agent");
    expect(wf.steps[0].agent).toBe("claude");
    expect(wf.steps[0].prompt).toBe("Do the thing");
    expect(wf.steps[1].type).toBe("gate");
    expect(wf.steps[1].profile).toBe("quick");
    expect(wf.steps[2].type).toBe("command");
    expect(wf.steps[2].command).toBe("npm test");
  });
});

describe("createDefaults", () => {
  it("creates example workflow", () => {
    const dir = tmpDir();
    createDefaults(dir);
    const files = fs.readdirSync(path.join(dir, "workflows"));
    expect(files).toContain("implement-and-test.yaml");
  });
});

describe("listWorkflows", () => {
  it("lists workflows", () => {
    const dir = tmpDir();
    createDefaults(dir);
    const wfs = listWorkflows(dir);
    expect(wfs.length).toBe(1);
    expect(wfs[0].name).toBe("implement-and-test");
  });

  it("returns empty for no workflows dir", () => {
    expect(listWorkflows(tmpDir())).toEqual([]);
  });
});

describe("runWorkflow", () => {
  it("runs agent and command steps sequentially", async () => {
    mockRun.mockResolvedValue({ exitCode: 0, stdout: "ok\n", stderr: "", duration: 100, timedOut: false });

    const wf: Workflow = {
      name: "test-wf",
      description: "",
      steps: [
        { type: "agent", agent: "claude", prompt: "Fix bug" },
        { type: "command", command: "npm test" },
      ],
      path: "/fake",
    };

    const steps: string[] = [];
    const progress = await runWorkflow(wf, "/fake/cwd", { task: "test" }, {
      onStepStart: (step, _total, desc) => steps.push(`start:${step}:${desc}`),
      onStepDone: (step, passed) => steps.push(`done:${step}:${passed}`),
      onAgentOutput: () => {},
      runGate: async () => true,
    });

    expect(progress.status).toBe("passed");
    expect(progress.stepResults.length).toBe(2);
    expect(progress.stepResults[0].type).toBe("agent");
    expect(progress.stepResults[0].passed).toBe(true);
    expect(progress.stepResults[1].type).toBe("command");
    expect(progress.stepResults[1].passed).toBe(true);
    expect(steps).toContain("start:1:claude: Fix bug");
    expect(steps).toContain("done:2:true");
  });

  it("stops on failed command step", async () => {
    mockRun.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "FAIL", duration: 100, timedOut: false });

    const wf: Workflow = {
      name: "fail-wf",
      description: "",
      steps: [
        { type: "command", command: "npm test" },
        { type: "command", command: "npm build" },
      ],
      path: "/fake",
    };

    const progress = await runWorkflow(wf, "/fake/cwd", {}, {
      onStepStart: () => {},
      onStepDone: () => {},
      onAgentOutput: () => {},
      runGate: async () => true,
    });

    expect(progress.status).toBe("failed");
    expect(progress.stepResults.length).toBe(1); // stopped after first failure
  });

  it("stops on failed gate step", async () => {
    const wf: Workflow = {
      name: "gate-fail",
      description: "",
      steps: [{ type: "gate", profile: "strict" }],
      path: "/fake",
    };

    const progress = await runWorkflow(wf, "/fake/cwd", {}, {
      onStepStart: () => {},
      onStepDone: () => {},
      onAgentOutput: () => {},
      runGate: async () => false,
    });

    expect(progress.status).toBe("failed");
    expect(progress.stepResults[0].output).toBe("Gate failed");
  });

  it("handles agent step with missing prompt", async () => {
    const wf: Workflow = {
      name: "no-prompt",
      description: "",
      steps: [{ type: "agent", agent: "claude" }],
      path: "/fake",
    };

    const progress = await runWorkflow(wf, "/fake/cwd", {}, {
      onStepStart: () => {},
      onStepDone: () => {},
      onAgentOutput: () => {},
      runGate: async () => true,
    });

    expect(progress.status).toBe("failed");
    expect(progress.stepResults[0].output).toBe("Missing agent or prompt");
  });
});
