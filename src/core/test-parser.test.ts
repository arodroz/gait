import { describe, it, expect } from "vitest";
import { parseTestOutput } from "./test-parser";

describe("parseTestOutput", () => {
  describe("vitest", () => {
    it("parses file-level results", () => {
      const output = `
 ✓ src/core/config.test.ts (5 tests)
 ✓ src/core/runner.test.ts (10 tests)
 × src/core/broken.test.ts (2 tests)

 Test Files  2 passed | 1 failed (3)
 Tests  15 passed | 2 failed (17)
`;
      const results = parseTestOutput(output, "typescript");
      expect(results.length).toBe(3);
      expect(results.filter((r) => r.passed).length).toBe(2);
      expect(results.find((r) => r.name.includes("broken"))?.passed).toBe(false);
    });

    it("parses summary fallback", () => {
      const output = `
 Test Files  16 passed (16)
      Tests  121 passed (121)
`;
      const results = parseTestOutput(output, "typescript");
      expect(results.length).toBe(121);
      expect(results.every((r) => r.passed)).toBe(true);
    });
  });

  describe("go", () => {
    it("parses individual test results", () => {
      const output = `
--- PASS: TestFoo (0.01s)
--- PASS: TestBar (0.02s)
--- FAIL: TestBroken (0.00s)
`;
      const results = parseTestOutput(output, "go");
      expect(results.length).toBe(3);
      expect(results.filter((r) => r.passed).length).toBe(2);
      expect(results.find((r) => r.name === "TestBroken")?.passed).toBe(false);
    });

    it("parses package-level results", () => {
      const output = `
ok  	github.com/foo/bar	1.234s
FAIL	github.com/foo/broken	0.567s
`;
      const results = parseTestOutput(output, "go");
      expect(results.length).toBe(2);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
    });
  });

  describe("pytest", () => {
    it("parses test results", () => {
      const output = `
tests/test_auth.py::test_login PASSED
tests/test_auth.py::test_logout PASSED
tests/test_api.py::test_create FAILED
`;
      const results = parseTestOutput(output, "python");
      expect(results.length).toBe(3);
      expect(results.filter((r) => r.passed).length).toBe(2);
    });
  });

  describe("generic", () => {
    it("returns empty for unrecognizable output", () => {
      const results = parseTestOutput("some random output", "unknown");
      expect(results.length).toBe(0);
    });
  });
});
