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

/** Simple sleep helper */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll for a decision file written by the VS Code extension */
export async function pollForDecision(
  gaitDir: string,
  id: string,
  timeoutMs = 120000,
  intervalMs = 200,
): Promise<{ id: string; decision: string; note?: string; ts: string }> {
  const decisionPath = path.join(gaitDir, "decisions", `${id}.json`);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const raw = await fs.promises.readFile(decisionPath, "utf8");
      const decision = JSON.parse(raw);
      await fs.promises.unlink(decisionPath).catch(() => {});
      return decision;
    } catch {
      await sleep(intervalMs);
    }
  }

  return { id, decision: "reject", note: "timeout", ts: new Date().toISOString() };
}
