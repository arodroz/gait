import { describe, it, expect } from "vitest";
import { shouldBlock, formatFindings, type AuditFinding } from "./dep-audit";

describe("dep-audit", () => {
  it("blocks on critical when threshold is high", () => {
    const findings: AuditFinding[] = [
      { package: "lodash", severity: "critical", advisory: "Prototype pollution", fixAvailable: true },
    ];
    expect(shouldBlock(findings, "high")).toBe(true);
  });

  it("does not block on moderate when threshold is high", () => {
    const findings: AuditFinding[] = [
      { package: "axios", severity: "moderate", advisory: "SSRF", fixAvailable: false },
    ];
    expect(shouldBlock(findings, "high")).toBe(false);
  });

  it("blocks on moderate when threshold is moderate", () => {
    const findings: AuditFinding[] = [
      { package: "axios", severity: "moderate", advisory: "SSRF", fixAvailable: false },
    ];
    expect(shouldBlock(findings, "moderate")).toBe(true);
  });

  it("never blocks on none threshold", () => {
    expect(shouldBlock([{ package: "x", severity: "critical", advisory: "y", fixAvailable: false }], "none")).toBe(false);
  });

  it("handles empty findings", () => {
    expect(shouldBlock([], "critical")).toBe(false);
    expect(formatFindings([])).toBe("No vulnerabilities found.");
  });

  it("formats findings", () => {
    const findings: AuditFinding[] = [
      { package: "lodash", severity: "high", advisory: "Prototype pollution", fixAvailable: true },
    ];
    const output = formatFindings(findings);
    expect(output).toContain("[HIGH]");
    expect(output).toContain("lodash");
    expect(output).toContain("fix available");
  });
});
