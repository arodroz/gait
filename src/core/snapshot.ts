import { run } from "./runner";
import * as fs from "fs";
import * as path from "path";

export interface Snapshot {
  id: string;
  timestamp: number;
  branch: string;
  commitHash: string;
  stashRef?: string;
}

const SNAPSHOTS_FILE = "snapshots.json";

/** Take a snapshot of the current working tree before agent runs */
export async function take(cwd: string, gaitDir: string): Promise<Snapshot> {
  const branchResult = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd, 5000);
  const hashResult = await run("git", ["rev-parse", "HEAD"], cwd, 5000);
  const id = `gait-snap-${Date.now()}`;

  // Stash any uncommitted changes (including untracked)
  const stashResult = await run("git", ["stash", "push", "-u", "-m", id], cwd, 30_000);
  let stashRef: string | undefined;

  if (stashResult.exitCode === 0 && !stashResult.stdout.includes("No local changes")) {
    // Get the stash ref
    const listResult = await run("git", ["stash", "list", "--max-count=1"], cwd, 5000);
    stashRef = listResult.stdout.trim().split(":")[0]; // e.g., "stash@{0}"
    // Immediately pop — we just wanted to record it, not leave the tree clean
    await run("git", ["stash", "pop"], cwd, 30_000);
  }

  const snapshot: Snapshot = {
    id,
    timestamp: Date.now(),
    branch: branchResult.stdout.trim(),
    commitHash: hashResult.stdout.trim(),
    stashRef,
  };

  // Also create a lightweight tag as a restore point
  await run("git", ["tag", id, "HEAD"], cwd, 5000);

  saveSnapshot(gaitDir, snapshot);
  return snapshot;
}

/** Restore working tree to a snapshot state */
export async function restore(cwd: string, gaitDir: string, snapshotId: string): Promise<{ success: boolean; error?: string }> {
  const snapshots = loadSnapshots(gaitDir);
  const snap = snapshots.find((s) => s.id === snapshotId);
  if (!snap) return { success: false, error: `Snapshot ${snapshotId} not found` };

  // Hard reset to the tagged commit
  const resetResult = await run("git", ["reset", "--hard", snapshotId], cwd, 30_000);
  if (resetResult.exitCode !== 0) {
    return { success: false, error: `Reset failed: ${resetResult.stderr}` };
  }

  // Clean untracked files that the agent may have created
  await run("git", ["clean", "-fd"], cwd, 30_000);

  return { success: true };
}

/** List all snapshots */
export function list(gaitDir: string): Snapshot[] {
  return loadSnapshots(gaitDir);
}

/** Get the most recent snapshot */
export function latest(gaitDir: string): Snapshot | undefined {
  const all = loadSnapshots(gaitDir);
  return all[all.length - 1];
}

/** Prune snapshots older than maxAge and remove their tags */
export async function prune(cwd: string, gaitDir: string, maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const all = loadSnapshots(gaitDir);
  const keep: Snapshot[] = [];
  let pruned = 0;

  for (const snap of all) {
    if (snap.timestamp < cutoff) {
      await run("git", ["tag", "-d", snap.id], cwd, 5000);
      pruned++;
    } else {
      keep.push(snap);
    }
  }

  saveSnapshots(gaitDir, keep);
  return pruned;
}

function snapshotsPath(gaitDir: string): string {
  return path.join(gaitDir, SNAPSHOTS_FILE);
}

function loadSnapshots(gaitDir: string): Snapshot[] {
  const p = snapshotsPath(gaitDir);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function saveSnapshot(gaitDir: string, snap: Snapshot): void {
  const all = loadSnapshots(gaitDir);
  all.push(snap);
  saveSnapshots(gaitDir, all);
}

function saveSnapshots(gaitDir: string, snapshots: Snapshot[]): void {
  fs.writeFileSync(snapshotsPath(gaitDir), JSON.stringify(snapshots, null, 2));
}
