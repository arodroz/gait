import { describe, it, expect } from "vitest";
import { enhancePromptWithBlame, type BlameInfo } from "./blame";

describe("enhancePromptWithBlame", () => {
  it("appends blame context to prompt", () => {
    const blame: BlameInfo = {
      commitHash: "abc12345def67890",
      author: "Alice",
      date: "2 hours ago",
      summary: "refactor: extract helper function",
      diff: "+function helper() {}\n-function old() {}",
    };

    const result = enhancePromptWithBlame("Fix the lint error", blame);
    expect(result).toContain("Fix the lint error");
    expect(result).toContain("abc12345");
    expect(result).toContain("Alice");
    expect(result).toContain("2 hours ago");
    expect(result).toContain("extract helper function");
    expect(result).toContain("+function helper");
  });

  it("includes diff block", () => {
    const blame: BlameInfo = {
      commitHash: "1234567890abcdef",
      author: "Bob",
      date: "yesterday",
      summary: "fix: null check",
      diff: "- if (x)\n+ if (x != null)",
    };
    const result = enhancePromptWithBlame("", blame);
    expect(result).toContain("```diff");
    expect(result).toContain("+ if (x != null)");
  });
});
