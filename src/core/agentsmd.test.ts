import { describe, it, expect } from "vitest";
import { generate } from "./agentsmd";
import type { Config, Stack } from "./config";

describe("generate", () => {
  it("generates AGENTS.md with commands", () => {
    const cfg: Config = {
      project: { name: "myapp" },
      stacks: {
        go: { Lint: "go vet ./...", Test: "go test ./...", Typecheck: "", Build: "go build ./..." },
      },
      pipeline: { stages: ["lint", "test"], timeout: "300s" },
    };
    const result = generate(cfg, ["go"] as Stack[]);

    expect(result).toContain("myapp");
    expect(result).toContain("go test ./...");
    expect(result).toContain("go vet ./...");
    expect(result).toContain("lint → test");
    expect(result).toContain("conventional commits");
  });

  it("lists detected stacks", () => {
    const cfg: Config = {
      project: { name: "test" },
      stacks: {},
      pipeline: { stages: [], timeout: "30s" },
    };
    const result = generate(cfg, ["go", "typescript"] as Stack[]);
    expect(result).toContain("- go");
    expect(result).toContain("- typescript");
  });
});
