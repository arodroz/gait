import { describe, it, expect } from "vitest";
import { detectLearnedPatterns } from "./learned-patterns";
import type { ActionRecord } from "./action-logger";

function makeRecord(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    id: `act_${Date.now()}`,
    ts: new Date().toISOString(),
    agent: "claude",
    session_id: "s1",
    tool: "Edit",
    files: ["src/foo.ts"],
    intent: "fix",
    decision_points: [],
    severity: "low",
    human_decision: "accept",
    ...overrides,
  };
}

describe("detectLearnedPatterns", () => {
  it("suggests path when rejected 3+ times", () => {
    const records = [
      makeRecord({ files: ["src/api/routes.ts"], human_decision: "reject" }),
      makeRecord({ files: ["src/api/auth.ts"], human_decision: "reject" }),
      makeRecord({ files: ["src/api/users.ts"], human_decision: "reject" }),
    ];
    const suggestions = detectLearnedPatterns(records);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].pattern).toBe("src/api/**");
    expect(suggestions[0].rejectionCount).toBe(3);
  });

  it("does not suggest for fewer than 3 rejections", () => {
    const records = [
      makeRecord({ files: ["src/api/routes.ts"], human_decision: "reject" }),
      makeRecord({ files: ["src/api/auth.ts"], human_decision: "reject" }),
    ];
    expect(detectLearnedPatterns(records)).toEqual([]);
  });

  it("ignores accepted records", () => {
    const records = [
      makeRecord({ files: ["src/api/routes.ts"], human_decision: "accept" }),
      makeRecord({ files: ["src/api/auth.ts"], human_decision: "accept" }),
      makeRecord({ files: ["src/api/users.ts"], human_decision: "accept" }),
    ];
    expect(detectLearnedPatterns(records)).toEqual([]);
  });

  it("handles empty records", () => {
    expect(detectLearnedPatterns([])).toEqual([]);
  });
});
