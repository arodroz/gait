import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { list, latest, take, restore, prune } from "./snapshot";

vi.mock("./runner", () => ({
  run: vi.fn(),
}));

import { run } from "./runner";
const mockRun = vi.mocked(run);

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-snap-"));
}

describe("snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty list for fresh dir", () => {
    expect(list(tmpDir())).toEqual([]);
  });

  it("returns undefined for latest when no snapshots", () => {
    expect(latest(tmpDir())).toBeUndefined();
  });

  it("saves and loads snapshots from JSON", () => {
    const dir = tmpDir();
    const snapshotsPath = path.join(dir, "snapshots.json");
    const snaps = [
      { id: "gait-snap-1", timestamp: Date.now(), branch: "main", commitHash: "abc123" },
      { id: "gait-snap-2", timestamp: Date.now(), branch: "main", commitHash: "def456" },
    ];
    fs.writeFileSync(snapshotsPath, JSON.stringify(snaps));

    const loaded = list(dir);
    expect(loaded.length).toBe(2);
    expect(loaded[0].id).toBe("gait-snap-1");

    const lat = latest(dir);
    expect(lat?.id).toBe("gait-snap-2");
  });

  it("take() creates a snapshot with branch, hash, and tag", async () => {
    const dir = tmpDir();
    mockRun
      .mockResolvedValueOnce({ exitCode: 0, stdout: "main\n", stderr: "", duration: 10, timedOut: false }) // rev-parse --abbrev-ref
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\n", stderr: "", duration: 10, timedOut: false }) // rev-parse HEAD
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", duration: 10, timedOut: false }); // git tag

    const snap = await take("/fake/cwd", dir);
    expect(snap.branch).toBe("main");
    expect(snap.commitHash).toBe("abc123");
    expect(snap.id).toMatch(/^gait-snap-\d+$/);

    // Tag was created
    expect(mockRun).toHaveBeenCalledWith("git", ["tag", snap.id, "HEAD"], "/fake/cwd", 5000);

    // Snapshot persisted
    const loaded = list(dir);
    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe(snap.id);
  });

  it("restore() resets to tag and cleans", async () => {
    const dir = tmpDir();
    const snapId = "gait-snap-999";
    fs.writeFileSync(
      path.join(dir, "snapshots.json"),
      JSON.stringify([{ id: snapId, timestamp: Date.now(), branch: "main", commitHash: "abc" }]),
    );

    mockRun
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", duration: 10, timedOut: false }) // git reset --hard
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", duration: 10, timedOut: false }); // git clean -fd

    const result = await restore("/fake/cwd", dir, snapId);
    expect(result.success).toBe(true);
    expect(mockRun).toHaveBeenCalledWith("git", ["reset", "--hard", snapId], "/fake/cwd", 30000);
    expect(mockRun).toHaveBeenCalledWith("git", ["clean", "-fd"], "/fake/cwd", 30000);
  });

  it("restore() fails for unknown snapshot", async () => {
    const result = await restore("/fake/cwd", tmpDir(), "nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("restore() fails on reset error", async () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "snapshots.json"),
      JSON.stringify([{ id: "snap-1", timestamp: Date.now(), branch: "main", commitHash: "abc" }]),
    );

    mockRun.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "fatal: error", duration: 10, timedOut: false });

    const result = await restore("/fake/cwd", dir, "snap-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Reset failed");
  });

  it("prune() removes old snapshots and their tags", async () => {
    const dir = tmpDir();
    const old = Date.now() - 100_000;
    const recent = Date.now();
    fs.writeFileSync(
      path.join(dir, "snapshots.json"),
      JSON.stringify([
        { id: "old-snap", timestamp: old, branch: "main", commitHash: "aaa" },
        { id: "new-snap", timestamp: recent, branch: "main", commitHash: "bbb" },
      ]),
    );

    mockRun.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", duration: 10, timedOut: false }); // git tag -d

    const pruned = await prune("/fake/cwd", dir, 50_000); // 50s ago cutoff
    expect(pruned).toBe(1);
    expect(mockRun).toHaveBeenCalledWith("git", ["tag", "-d", "old-snap"], "/fake/cwd", 5000);

    const remaining = list(dir);
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe("new-snap");
  });
});
