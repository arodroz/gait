export type BumpType = "none" | "patch" | "minor" | "major";

export interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: string;
}

export interface ConventionalCommit {
  type: string;
  scope: string;
  subject: string;
  breaking: boolean;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;
const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

export function parse(s: string): Version | null {
  const m = s.match(VERSION_RE);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    pre: m[4] ?? "",
  };
}

export function format(v: Version): string {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  return v.pre ? `${base}-${v.pre}` : base;
}

export function bump(v: Version, bt: BumpType): Version {
  switch (bt) {
    case "major": return { major: v.major + 1, minor: 0, patch: 0, pre: "" };
    case "minor": return { major: v.major, minor: v.minor + 1, patch: 0, pre: "" };
    case "patch": return { major: v.major, minor: v.minor, patch: v.patch + 1, pre: "" };
    default: return { ...v };
  }
}

export function parseConventional(msg: string): ConventionalCommit | null {
  const firstLine = msg.split("\n")[0];
  const m = firstLine.match(CONVENTIONAL_RE);
  if (!m) return null;
  return { type: m[1], scope: m[2] ?? "", subject: m[4], breaking: m[3] === "!" };
}

export function detectBump(commits: string[]): BumpType {
  let result: BumpType = "none";
  for (const msg of commits) {
    const cc = parseConventional(msg);
    if (!cc) continue;
    if (cc.breaking || msg.includes("BREAKING CHANGE")) return "major";
    if (cc.type === "feat") result = "minor";
    if (["fix", "perf", "refactor", "docs", "test", "chore"].includes(cc.type) && result === "none") {
      result = "patch";
    }
  }
  return result;
}

export function generateChangelog(version: string, commits: string[]): string {
  const groups: Record<string, string[]> = {};
  for (const msg of commits) {
    const cc = parseConventional(msg);
    if (!cc) {
      (groups["Other"] ??= []).push(msg);
      continue;
    }
    const label = typeLabel(cc.type);
    let desc = cc.subject;
    if (cc.scope) desc = `**${cc.scope}**: ${desc}`;
    if (cc.breaking) desc = `**BREAKING** ${desc}`;
    (groups[label] ??= []).push(desc);
  }

  const date = new Date().toISOString().slice(0, 10);
  let out = `## ${version} (${date})\n\n`;
  const order = ["Features", "Bug Fixes", "Performance", "Refactoring", "Documentation", "Tests", "Build", "Chores", "Other"];
  for (const section of order) {
    const items = groups[section];
    if (!items?.length) continue;
    out += `### ${section}\n\n`;
    for (const item of items) out += `- ${item}\n`;
    out += "\n";
  }
  return out;
}

function typeLabel(t: string): string {
  const map: Record<string, string> = {
    feat: "Features", fix: "Bug Fixes", perf: "Performance",
    refactor: "Refactoring", docs: "Documentation", test: "Tests",
    build: "Build", ci: "Build", chore: "Chores",
  };
  return map[t] ?? "Other";
}
