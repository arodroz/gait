import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { list, latest } from "./snapshot";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-snap-"));
}

describe("snapshot", () => {
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
});
