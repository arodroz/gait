import { describe, it, expect } from "vitest";
import { shouldBlock, type ReviewFinding } from "./review";

describe("review", () => {
  it("blocks on error findings when blockOn=error", () => {
    const findings: ReviewFinding[] = [
      { file: "a.ts", line: 1, severity: "error", message: "bug" },
    ];
    expect(shouldBlock(findings, "error")).toBe(true);
  });

  it("does not block on warnings when blockOn=error", () => {
    const findings: ReviewFinding[] = [
      { file: "a.ts", line: 1, severity: "warning", message: "style" },
    ];
    expect(shouldBlock(findings, "error")).toBe(false);
  });

  it("blocks on warnings when blockOn=warning", () => {
    const findings: ReviewFinding[] = [
      { file: "a.ts", line: 1, severity: "warning", message: "style" },
    ];
    expect(shouldBlock(findings, "warning")).toBe(true);
  });

  it("never blocks when blockOn=none", () => {
    const findings: ReviewFinding[] = [
      { file: "a.ts", line: 1, severity: "error", message: "critical" },
    ];
    expect(shouldBlock(findings, "none")).toBe(false);
  });

  it("handles empty findings", () => {
    expect(shouldBlock([], "error")).toBe(false);
  });
});
