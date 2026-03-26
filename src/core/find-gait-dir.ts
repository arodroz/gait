import * as fs from "fs";
import * as path from "path";

/** Walk up from startDir looking for a .gait/config.toml */
export async function findGaitDir(startDir: string): Promise<string | null> {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, ".gait");
    try {
      await fs.promises.access(path.join(candidate, "config.toml"));
      return candidate;
    } catch { /* not here */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
