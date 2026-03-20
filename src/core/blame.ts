import { run } from "./runner";

export interface BlameInfo {
  commitHash: string;
  author: string;
  date: string;
  summary: string;
  diff: string;
}

/**
 * Given an error with file:line references, blame the lines to identify
 * the commit that introduced the problem.
 * Uses run() which spawns git via child_process.spawn (no shell injection).
 */
export async function blameError(cwd: string, errorOutput: string): Promise<BlameInfo | null> {
  const refs = extractFileLineRefs(errorOutput);
  if (refs.length === 0) return null;

  const commits = new Map<string, number>();
  for (const ref of refs.slice(0, 5)) {
    const result = await run(
      "git", ["blame", "-L", `${ref.line},${ref.line}`, "--porcelain", ref.file],
      cwd, 10_000,
    );
    if (result.exitCode !== 0) continue;
    const hashMatch = result.stdout.match(/^([0-9a-f]{40})/);
    if (hashMatch && !hashMatch[1].startsWith("0000000")) {
      commits.set(hashMatch[1], (commits.get(hashMatch[1]) ?? 0) + 1);
    }
  }

  if (commits.size === 0) return null;
  const topHash = [...commits.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const logResult = await run(
    "git", ["log", "-1", "--pretty=format:%H|%an|%ar|%s", topHash], cwd, 5000,
  );
  if (logResult.exitCode !== 0) return null;
  const [hash, author, date, summary] = logResult.stdout.split("|");

  const diffResult = await run(
    "git", ["diff", `${topHash}~1..${topHash}`, "--", ...refs.map((r) => r.file)], cwd, 10_000,
  );

  return { commitHash: hash, author, date, summary, diff: diffResult.stdout.slice(0, 3000) };
}

/** Enhance a fix prompt with blame context */
export function enhancePromptWithBlame(prompt: string, blame: BlameInfo): string {
  return `${prompt}

## Root Cause

Introduced by commit \`${blame.commitHash.slice(0, 8)}\` (${blame.author}, ${blame.date}):
> ${blame.summary}

### Diff from that commit:
\`\`\`diff
${blame.diff}
\`\`\`

Focus on correcting the specific change from this commit.`;
}

function extractFileLineRefs(text: string): { file: string; line: number }[] {
  const refs: { file: string; line: number }[] = [];
  const seen = new Set<string>();
  const re = /(?:\.\/)?([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,4}):(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = `${m[1]}:${m[2]}`;
    if (!seen.has(key) && m[1].includes("/")) {
      seen.add(key);
      refs.push({ file: m[1], line: parseInt(m[2], 10) });
    }
  }
  return refs;
}
