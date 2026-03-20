import { run } from "./runner";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface RecoveryItem {
  type: "worktree" | "lockfile" | "tempdir" | "trigger";
  path: string;
  cleaned: boolean;
}

export async function recover(cwd: string, gaitDir: string): Promise<RecoveryItem[]> {
  const items: RecoveryItem[] = [];

  // Stale worktrees
  const wtResult = await run("git", ["worktree", "list", "--porcelain"], cwd, 10_000);
  if (wtResult.exitCode === 0) {
    for (const line of wtResult.stdout.split("\n")) {
      if (line.startsWith("worktree ") && line.includes("gait-rollback")) {
        const wtPath = line.slice(9);
        try {
          await run("git", ["worktree", "remove", wtPath, "--force"], cwd, 30_000);
          items.push({ type: "worktree", path: wtPath, cleaned: true });
        } catch {
          items.push({ type: "worktree", path: wtPath, cleaned: false });
        }
      }
    }
  }

  // Lock files
  const lockPath = path.join(gaitDir, ".lock");
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
    items.push({ type: "lockfile", path: lockPath, cleaned: true });
  }

  // Hook trigger/result files
  for (const file of [".hook-trigger", ".hook-result"]) {
    const p = path.join(gaitDir, file);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      items.push({ type: "trigger", path: p, cleaned: true });
    }
  }

  // Temp directories
  try {
    const tmpBase = os.tmpdir();
    const entries = fs.readdirSync(tmpBase);
    for (const entry of entries) {
      if (entry.startsWith("gait-rollback-")) {
        const full = path.join(tmpBase, entry);
        fs.rmSync(full, { recursive: true, force: true });
        items.push({ type: "tempdir", path: full, cleaned: true });
      }
    }
  } catch {
    // ignore
  }

  return items;
}
