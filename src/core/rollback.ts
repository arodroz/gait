import { run } from "./runner";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

export interface RollbackSimulation {
  commitHash: string;
  commitSubject: string;
  filesAffected: number;
  testOutput: string;
  testsPassed: boolean;
  canRevert: boolean;
  error?: string;
}

/** List recent commits for the rollback picker */
export async function recentCommits(cwd: string, n = 10): Promise<{ hash: string; subject: string; date: string }[]> {
  const result = await run("git", ["log", `--max-count=${n}`, "--pretty=format:%H|%s|%ar"], cwd, 10_000);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, date] = line.split("|");
      return { hash, subject, date };
    });
}

/** Simulate a revert in a temp worktree, run tests, report impact */
export async function simulateRollback(
  cwd: string,
  commitHash: string,
  testCmd: string,
  onProgress?: (msg: string) => void,
): Promise<RollbackSimulation> {
  const tmpDir = path.join(os.tmpdir(), `gait-rollback-${commitHash.slice(0, 8)}-${Date.now()}`);

  try {
    // Get commit subject
    const logResult = await run("git", ["log", "--format=%s", "-1", commitHash], cwd, 10_000);
    const subject = logResult.stdout.trim();

    // Create worktree
    onProgress?.("Creating worktree...");
    const wtResult = await run("git", ["worktree", "add", tmpDir, "HEAD"], cwd, 30_000);
    if (wtResult.exitCode !== 0) {
      return {
        commitHash, commitSubject: subject, filesAffected: 0,
        testOutput: "", testsPassed: false, canRevert: false,
        error: `Failed to create worktree: ${wtResult.stderr}`,
      };
    }

    // Revert the commit in worktree
    onProgress?.("Reverting commit...");
    const revertResult = await run("git", ["revert", "--no-commit", commitHash], tmpDir, 30_000);
    if (revertResult.exitCode !== 0) {
      return {
        commitHash, commitSubject: subject, filesAffected: 0,
        testOutput: revertResult.stderr, testsPassed: false, canRevert: false,
        error: "Revert has conflicts — manual resolution needed",
      };
    }

    // Count affected files
    const statResult = await run("git", ["diff", "--cached", "--stat"], tmpDir, 10_000);
    const filesAffected = statResult.stdout.trim().split("\n").filter(Boolean).length;

    // Run tests
    let testsPassed = true;
    let testOutput = "";
    if (testCmd) {
      onProgress?.("Running tests in worktree...");
      const testResult = await run(testCmd, [], tmpDir, 300_000);
      testsPassed = testResult.exitCode === 0;
      testOutput = testResult.stdout + testResult.stderr;
    }

    return {
      commitHash,
      commitSubject: subject,
      filesAffected,
      testOutput,
      testsPassed,
      canRevert: testsPassed,
    };
  } finally {
    // Cleanup
    try {
      await run("git", ["worktree", "remove", tmpDir, "--force"], cwd, 30_000);
    } catch {
      // Best-effort cleanup
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

/** Actually apply the revert */
export async function applyRevert(cwd: string, commitHash: string): Promise<{ success: boolean; error?: string }> {
  const result = await run("git", ["revert", commitHash, "--no-edit"], cwd, 30_000);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr };
  }
  return { success: true };
}
