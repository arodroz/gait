import { run } from "./runner";

export interface FileStat {
  path: string;
  additions: number;
  deletions: number;
}

export interface Commit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

async function git(cwd: string, ...args: string[]) {
  return run("git", args, cwd, 30_000);
}

export async function branch(cwd: string): Promise<string> {
  const r = await git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  return r.stdout.trim();
}

export async function stagedFiles(cwd: string): Promise<string[]> {
  const r = await git(cwd, "diff", "--cached", "--name-only");
  return r.stdout.trim().split("\n").filter(Boolean);
}

export async function diff(cwd: string, cached = false): Promise<string> {
  const args = ["diff"];
  if (cached) args.push("--cached");
  const r = await git(cwd, ...args);
  return r.stdout;
}

export async function diffStat(cwd: string): Promise<FileStat[]> {
  const r = await git(cwd, "diff", "--numstat");
  return r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [add, del, path] = line.split("\t");
      return {
        path: path ?? "",
        additions: parseInt(add, 10) || 0,
        deletions: parseInt(del, 10) || 0,
      };
    });
}

export async function log(cwd: string, n = 10): Promise<Commit[]> {
  const r = await git(cwd, "log", `-${n}`, "--pretty=format:%H|%s|%an|%aI");
  return r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, author, date] = line.split("|");
      return { hash, subject, author, date };
    });
}

export async function isRepo(cwd: string): Promise<boolean> {
  try {
    const r = await git(cwd, "rev-parse", "--is-inside-work-tree");
    return r.stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function isClean(cwd: string): Promise<boolean> {
  const d = await diff(cwd);
  return d === "";
}
