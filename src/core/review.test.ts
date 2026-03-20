import { describe, it, expect } from "vitest";
import { shouldBlock, parseFindings, type ReviewFinding } from "./review";

describe("shouldBlock", () => {
  it("blocks on error findings when blockOn=error", () => {
    const findings: ReviewFinding[] = [{ file: "a.ts", line: 1, severity: "error", message: "bug" }];
    expect(shouldBlock(findings, "error")).toBe(true);
  });

  it("does not block on warnings when blockOn=error", () => {
    const findings: ReviewFinding[] = [{ file: "a.ts", line: 1, severity: "warning", message: "style" }];
    expect(shouldBlock(findings, "error")).toBe(false);
  });

  it("blocks on warnings when blockOn=warning", () => {
    const findings: ReviewFinding[] = [{ file: "a.ts", line: 1, severity: "warning", message: "style" }];
    expect(shouldBlock(findings, "warning")).toBe(true);
  });

  it("never blocks when blockOn=none", () => {
    const findings: ReviewFinding[] = [{ file: "a.ts", line: 1, severity: "error", message: "critical" }];
    expect(shouldBlock(findings, "none")).toBe(false);
  });

  it("handles empty findings", () => {
    expect(shouldBlock([], "error")).toBe(false);
  });
});

describe("parseFindings", () => {
  it("parses valid JSON array", () => {
    const output = '[{"file":"a.ts","line":5,"severity":"error","message":"null deref"}]';
    const findings = parseFindings(output);
    expect(findings.length).toBe(1);
    expect(findings[0].file).toBe("a.ts");
    expect(findings[0].severity).toBe("error");
  });

  it("extracts JSON from surrounding text", () => {
    const output = `Here are the issues I found:
[{"file":"b.ts","line":10,"severity":"warning","message":"unused var","suggestion":"remove it"}]
That's all.`;
    const findings = parseFindings(output);
    expect(findings.length).toBe(1);
    expect(findings[0].suggestion).toBe("remove it");
  });

  it("returns empty for no JSON", () => {
    expect(parseFindings("No issues found.")).toEqual([]);
  });

  it("returns empty for malformed JSON", () => {
    expect(parseFindings("[{broken json")).toEqual([]);
  });

  it("returns empty array response", () => {
    expect(parseFindings("[]")).toEqual([]);
  });

  it("normalizes unknown severity to info", () => {
    const output = '[{"file":"c.ts","line":1,"severity":"banana","message":"test"}]';
    const findings = parseFindings(output);
    expect(findings[0].severity).toBe("info");
  });

  it("filters entries without message", () => {
    const output = '[{"file":"d.ts","line":1,"severity":"error","message":""},{"file":"e.ts","line":2,"severity":"error","message":"real"}]';
    const findings = parseFindings(output);
    expect(findings.length).toBe(1);
    expect(findings[0].file).toBe("e.ts");
  });
});
