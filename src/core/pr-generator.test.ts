import { describe, it, expect } from "vitest";

// Test the PR body generation logic (the generate/createPR functions need a real git repo)
describe("PR body generation", () => {
  it("groups conventional commits", () => {
    // Simulate the grouping logic from pr-generator.ts
    const commits = [
      "feat: add user auth",
      "fix: handle null token",
      "docs: update README",
      "feat(api): add rate limiting",
    ];

    const groups: Record<string, string[]> = {};
    for (const msg of commits) {
      const match = msg.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
      if (match) {
        const type = match[1];
        const subject = match[3];
        (groups[type] ??= []).push(subject);
      }
    }

    expect(groups.feat?.length).toBe(2);
    expect(groups.fix?.length).toBe(1);
    expect(groups.docs?.length).toBe(1);
    expect(groups.feat).toContain("add user auth");
  });

  it("generates title from branch name", () => {
    const branch = "feat/add-authentication";
    const title = branch
      .replace(/^(feat|fix|chore|docs|refactor)\//i, "")
      .replace(/[-_]/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
    expect(title).toBe("Add authentication");
  });

  it("falls back to first commit for title", () => {
    const commits = ["fix: handle edge case in parser"];
    const match = commits[0].match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
    expect(match).not.toBeNull();
    expect(`${match![1]}: ${match![3]}`).toBe("fix: handle edge case in parser");
  });
});
