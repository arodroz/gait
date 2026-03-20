import { run } from "./runner";
import * as git from "./git";
import * as semver from "./semver";

export interface PRSummary {
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  commits: number;
  filesChanged: number;
  additions: number;
  deletions: number;
}

/** Generate a PR summary from the current branch */
export async function generate(cwd: string, baseBranch = "main"): Promise<PRSummary> {
  const branch = await git.branch(cwd);

  // Commits since base
  const logResult = await run(
    "git", ["log", `${baseBranch}..HEAD`, "--pretty=format:%s"], cwd, 10_000,
  );
  const commitMsgs = logResult.exitCode === 0
    ? logResult.stdout.trim().split("\n").filter(Boolean)
    : [];

  // Diff stats
  const statResult = await run(
    "git", ["diff", "--stat", `${baseBranch}...HEAD`], cwd, 10_000,
  );
  const numstatResult = await run(
    "git", ["diff", "--numstat", `${baseBranch}...HEAD`], cwd, 10_000,
  );

  let filesChanged = 0, additions = 0, deletions = 0;
  if (numstatResult.exitCode === 0) {
    for (const line of numstatResult.stdout.trim().split("\n").filter(Boolean)) {
      const [add, del] = line.split("\t");
      additions += parseInt(add, 10) || 0;
      deletions += parseInt(del, 10) || 0;
      filesChanged++;
    }
  }

  // Generate title from branch name or first commit
  const title = generateTitle(branch, commitMsgs);

  // Generate body
  const body = generateBody(commitMsgs, filesChanged, additions, deletions);

  return {
    title,
    body,
    branch,
    baseBranch,
    commits: commitMsgs.length,
    filesChanged,
    additions,
    deletions,
  };
}

/** Create the PR via gh CLI */
export async function createPR(
  cwd: string,
  title: string,
  body: string,
  baseBranch: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  // Push first
  const pushResult = await run("git", ["push", "-u", "origin", "HEAD"], cwd, 30_000);
  if (pushResult.exitCode !== 0) {
    return { success: false, error: `Push failed: ${pushResult.stderr}` };
  }

  const prResult = await run(
    "gh", ["pr", "create", "--title", title, "--body", body, "--base", baseBranch],
    cwd, 30_000,
  );
  if (prResult.exitCode !== 0) {
    return { success: false, error: `gh pr create failed: ${prResult.stderr}` };
  }

  const url = prResult.stdout.trim();
  return { success: true, url };
}

function generateTitle(branch: string, commits: string[]): string {
  // Try to derive from branch name: feat/add-auth → Add auth
  const branchTitle = branch
    .replace(/^(feat|fix|chore|docs|refactor)\//i, "")
    .replace(/[-_]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

  if (branchTitle && branchTitle !== "main" && branchTitle !== "master") {
    return branchTitle;
  }

  // Fall back to first conventional commit
  if (commits.length > 0) {
    const cc = semver.parseConventional(commits[0]);
    if (cc) return `${cc.type}: ${cc.subject}`;
    return commits[0].slice(0, 70);
  }

  return "Update";
}

function generateBody(commits: string[], files: number, add: number, del: number): string {
  const lines: string[] = [];

  lines.push("## Summary\n");

  // Group by conventional commit type
  const groups: Record<string, string[]> = {};
  for (const msg of commits) {
    const cc = semver.parseConventional(msg);
    const type = cc?.type ?? "other";
    (groups[type] ??= []).push(cc?.subject ?? msg);
  }

  for (const [type, subjects] of Object.entries(groups)) {
    for (const s of subjects) {
      lines.push(`- **${type}**: ${s}`);
    }
  }

  lines.push(`\n## Changes\n`);
  lines.push(`${files} file(s) changed, +${add} -${del}\n`);

  lines.push(`## Test Plan\n`);
  lines.push(`- [ ] Gate passes locally`);
  lines.push(`- [ ] No regressions detected`);
  lines.push(`- [ ] Coverage check passes\n`);

  lines.push(`---\n`);
  lines.push(`Generated with [gait](https://github.com/arodroz/gait)`);

  return lines.join("\n");
}
