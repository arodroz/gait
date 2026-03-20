import * as fs from "fs";
import * as path from "path";
import { glob } from "./util-glob";

export interface Workspace {
  name: string;
  path: string;
  kind: "go" | "npm" | "python";
}

/** Detect monorepo workspaces */
export function detect(root: string): Workspace[] {
  const workspaces: Workspace[] = [];
  workspaces.push(...detectGoWorkspaces(root));
  workspaces.push(...detectNpmWorkspaces(root));
  workspaces.push(...detectPythonWorkspaces(root));
  return workspaces;
}

/** Filter to workspaces containing changed files */
export function affected(workspaces: Workspace[], changedFiles: string[]): Workspace[] {
  return workspaces.filter((ws) =>
    changedFiles.some((f) => f.startsWith(ws.path + "/") || f === ws.path),
  );
}

function detectGoWorkspaces(root: string): Workspace[] {
  const workFile = path.join(root, "go.work");
  if (!fs.existsSync(workFile)) return [];

  const content = fs.readFileSync(workFile, "utf-8");
  const workspaces: Workspace[] = [];
  let inUse = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "use (") { inUse = true; continue; }
    if (trimmed === ")") { inUse = false; continue; }
    if (trimmed.startsWith("use ")) {
      const dir = trimmed.slice(4).trim();
      workspaces.push({ name: path.basename(dir), path: dir, kind: "go" });
    }
    if (inUse && trimmed && !trimmed.startsWith("//")) {
      workspaces.push({ name: path.basename(trimmed), path: trimmed, kind: "go" });
    }
  }
  return workspaces;
}

function detectNpmWorkspaces(root: string): Workspace[] {
  const pkgFile = path.join(root, "package.json");
  if (!fs.existsSync(pkgFile)) return [];

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf-8"));
    if (!Array.isArray(pkg.workspaces)) return [];

    const workspaces: Workspace[] = [];
    for (const pattern of pkg.workspaces) {
      const matches = glob(root, pattern);
      for (const m of matches) {
        const rel = path.relative(root, m);
        workspaces.push({ name: path.basename(m), path: rel, kind: "npm" });
      }
    }
    return workspaces;
  } catch {
    return [];
  }
}

function detectPythonWorkspaces(root: string): Workspace[] {
  const workspaces: Workspace[] = [];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (fs.existsSync(path.join(root, entry.name, "pyproject.toml"))) {
        workspaces.push({ name: entry.name, path: entry.name, kind: "python" });
      }
    }
  } catch {
    // ignore
  }
  return workspaces;
}
