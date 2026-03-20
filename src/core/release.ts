import { run } from "./runner";
import * as semver from "./semver";
import * as git from "./git";

export interface ReleaseInfo {
  currentVersion: string;
  bumpType: semver.BumpType;
  nextVersion: string;
  changelog: string;
  commitCount: number;
}

/** Analyze what the next release would look like */
export async function analyzeRelease(cwd: string): Promise<ReleaseInfo> {
  // Get current version from latest tag
  const tagResult = await run("git", ["describe", "--tags", "--abbrev=0"], cwd, 10_000);
  const currentTag = tagResult.exitCode === 0 ? tagResult.stdout.trim() : "v0.0.0";
  const currentVersion = currentTag.replace(/^v/, "");

  // Get commits since tag
  const logResult = await run(
    "git", ["log", `${currentTag}..HEAD`, "--pretty=format:%s"],
    cwd, 10_000,
  );
  let commits: string[] = [];

  if (tagResult.exitCode !== 0) {
    // No tags exist — use all commits as the first release
    const recentCommits = await git.log(cwd, 50);
    commits = recentCommits.map((c) => c.subject);
  } else if (logResult.exitCode === 0) {
    commits = logResult.stdout.trim().split("\n").filter(Boolean);
  }

  // Nothing to release if HEAD is already tagged
  if (commits.length === 0) {
    return {
      currentVersion,
      bumpType: "none",
      nextVersion: currentVersion,
      changelog: "",
      commitCount: 0,
    };
  }

  const bumpType = semver.detectBump(commits);
  const parsed = semver.parse(currentVersion) ?? { major: 0, minor: 0, patch: 0, pre: "" };
  const effectiveBump = bumpType === "none" ? "patch" : bumpType;
  const next = semver.bump(parsed, effectiveBump);
  const nextVersion = semver.format(next);
  const changelog = semver.generateChangelog(`v${nextVersion}`, commits);

  return {
    currentVersion,
    bumpType: effectiveBump,
    nextVersion,
    changelog,
    commitCount: commits.length,
  };
}

/** Execute the release: tag + optional push */
export async function executeRelease(
  cwd: string,
  version: string,
  push: boolean,
): Promise<{ success: boolean; error?: string }> {
  const tag = `v${version}`;

  // Create annotated tag
  const tagResult = await run("git", ["tag", "-a", tag, "-m", `Release ${tag}`], cwd, 10_000);
  if (tagResult.exitCode !== 0) {
    return { success: false, error: `Tag failed: ${tagResult.stderr}` };
  }

  if (push) {
    const pushResult = await run("git", ["push", "origin", tag], cwd, 30_000);
    if (pushResult.exitCode !== 0) {
      return { success: false, error: `Push failed: ${pushResult.stderr}` };
    }
  }

  return { success: true };
}
