import { run } from "./runner";

export interface FileDiff {
  file: string;
  hunks: string;
}

/**
 * Poll git diff and return per-file diffs.
 * Called periodically while agent is running to show live changes.
 */
export async function getCurrentDiffs(cwd: string): Promise<FileDiff[]> {
  const result = await run("git", ["diff", "--no-color"], cwd, 10_000);
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];

  return parseDiffOutput(result.stdout);
}

/** Also include untracked new files */
export async function getUntrackedFiles(cwd: string): Promise<string[]> {
  const result = await run("git", ["ls-files", "--others", "--exclude-standard"], cwd, 5000);
  if (result.exitCode !== 0) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}

function parseDiffOutput(output: string): FileDiff[] {
  const diffs: FileDiff[] = [];
  const files = output.split(/^diff --git /m).filter(Boolean);

  for (const fileBlock of files) {
    const headerMatch = fileBlock.match(/a\/(.+?) b\//);
    if (!headerMatch) continue;

    diffs.push({
      file: headerMatch[1],
      hunks: fileBlock.slice(0, 2000), // cap per-file diff
    });
  }

  return diffs;
}
