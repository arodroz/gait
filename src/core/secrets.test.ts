import { describe, it, expect } from "vitest";
import { scanDiff } from "./secrets";

describe("scanDiff", () => {
  it("finds AWS access keys", () => {
    const diff = `+++ b/config.go\n+const key = "AKIAIOSFODNN7EXAMPLE"\n`;
    const findings = scanDiff(diff);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.pattern === "AWS Access Key")).toBe(true);
  });

  it("finds private keys", () => {
    const diff = `+++ b/key.pem\n+-----BEGIN RSA PRIVATE KEY-----\n`;
    const findings = scanDiff(diff);
    expect(findings.some((f) => f.pattern === "Private Key")).toBe(true);
  });

  it("finds GitHub tokens", () => {
    const diff = `+++ b/.env\n+GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij\n`;
    const findings = scanDiff(diff);
    expect(findings.some((f) => f.pattern === "GitHub Token")).toBe(true);
  });

  it("returns empty for clean diff", () => {
    const diff = `+++ b/main.go\n+fmt.Println("hello world")\n`;
    expect(scanDiff(diff)).toEqual([]);
  });

  it("ignores removed lines", () => {
    const diff = `+++ b/config.go\n-const key = "AKIAIOSFODNN7EXAMPLE"\n`;
    expect(scanDiff(diff)).toEqual([]);
  });

  it("resets line numbers per file", () => {
    const diff = [
      "+++ b/file1.go",
      "+line1",
      "+line2",
      "+++ b/file2.go",
      "+AKIAIOSFODNN7EXAMPLE",
    ].join("\n");
    const findings = scanDiff(diff);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].file).toBe("file2.go");
    expect(findings[0].line).toBe(1); // reset per file, not 3
  });

  it("detects high entropy strings", () => {
    const diff = `+++ b/config.js\n+const token = "aK3x9mP2qR7vL5nY8wJ4bF6cT1dH0gU"\n`;
    const findings = scanDiff(diff);
    expect(findings.length).toBeGreaterThan(0);
  });
});
