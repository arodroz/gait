import { describe, it, expect } from "vitest";
import { generate } from "./agentsmd";
import type { HitlConfig, Stack } from "./config";
import { DEFAULT_CONFIG } from "./config";

describe("generate", () => {
  it("generates AGENTS.md with project name", () => {
    const cfg: HitlConfig = { ...DEFAULT_CONFIG, project: { name: "myapp", mode: "dev" } };
    const result = generate(cfg, ["go"] as Stack[]);

    expect(result).toContain("myapp");
    expect(result).toContain("conventional commits");
    expect(result).toContain("- go");
  });

  it("includes prod mode warning", () => {
    const cfg: HitlConfig = { ...DEFAULT_CONFIG, project: { name: "prod-app", mode: "prod" } };
    const result = generate(cfg, []);
    expect(result).toContain("Production mode");
    expect(result).toContain("explicit human approval");
  });

  it("lists protected paths", () => {
    const cfg: HitlConfig = { ...DEFAULT_CONFIG, project: { name: "test", mode: "dev" }, prod: { paths: ["src/api/**", "migrations/**"] } };
    const result = generate(cfg, []);
    expect(result).toContain("src/api/**");
    expect(result).toContain("migrations/**");
  });

  it("includes rejection patterns from history", () => {
    const cfg: HitlConfig = { ...DEFAULT_CONFIG, project: { name: "test", mode: "dev" } };
    const actions = [
      {
        id: "act_001", ts: new Date().toISOString(), agent: "claude" as const,
        session_id: "s1", tool: "Edit", files: ["src/db/schema.ts"],
        intent: "modify schema", decision_points: [], severity: "high" as const,
        human_decision: "reject" as const, human_note: "too broad",
      },
    ];
    const result = generate(cfg, [], actions);
    expect(result).toContain("Rejection Patterns");
    expect(result).toContain("src/db/schema.ts");
    expect(result).toContain("too broad");
  });
});
