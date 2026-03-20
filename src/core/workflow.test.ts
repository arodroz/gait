import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseWorkflow, listWorkflows, createDefaults } from "./workflow";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-wf-"));
}

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
