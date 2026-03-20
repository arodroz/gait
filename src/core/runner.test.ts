import { describe, it, expect } from "vitest";
import { run, parseCommand } from "./runner";
import * as os from "os";

describe("run", () => {
  it("captures stdout from a successful command", async () => {
    const result = await run("echo", ["hello"], os.tmpdir());
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.timedOut).toBe(false);
  });

  it("captures exit code from a failing command", async () => {
    const result = await run("false", [], os.tmpdir());
    expect(result.exitCode).not.toBe(0);
  });

  it("returns nonzero exit for nonexistent binary", async () => {
    const result = await run("definitely_not_a_real_command_xyz", [], os.tmpdir());
    // shell: true returns 127 for command not found
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not found");
  });

  it("captures stderr", async () => {
    const result = await run("ls", ["--nonexistent-flag-xyz"], os.tmpdir());
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("times out long-running commands", async () => {
    const result = await run("sleep", ["10"], os.tmpdir(), 200);
    expect(result.timedOut).toBe(true);
    expect(result.duration).toBeLessThan(5000);
  });

  it("measures duration", async () => {
    const result = await run("echo", ["fast"], os.tmpdir());
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.duration).toBeLessThan(5000);
  });
});

describe("parseCommand", () => {
  it("splits simple command", () => {
    expect(parseCommand("go test ./...")).toEqual(["go", ["test", "./..."]]);
  });

  it("handles single command with no args", () => {
    expect(parseCommand("ls")).toEqual(["ls", []]);
  });

  it("handles empty string", () => {
    expect(parseCommand("")).toEqual(["", []]);
  });

  it("trims extra whitespace", () => {
    expect(parseCommand("  go   test  ")).toEqual(["go", ["test"]]);
  });
});
