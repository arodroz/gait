import { run } from "./runner";
import * as fs from "fs";
import * as path from "path";

export interface AuditFinding {
  package: string;
  severity: "critical" | "high" | "moderate" | "low" | "info";
  advisory: string;
  fixAvailable: boolean;
  fixCommand?: string;
}

export interface AuditResult {
  findings: AuditFinding[];
  error?: string;
  duration: number;
}

const SEVERITY_LEVELS: Record<string, number> = {
  critical: 4, high: 3, moderate: 2, low: 1, info: 0,
};

/**
 * Run dependency audit for detected stacks.
 * All commands are executed via run() which uses child_process.spawn (no shell injection).
 */
export async function audit(cwd: string, stacks: string[]): Promise<AuditResult> {
  const start = Date.now();
  const allFindings: AuditFinding[] = [];

  for (const stack of stacks) {
    const result = await auditStack(cwd, stack);
    if (result.error) return { findings: allFindings, error: result.error, duration: Date.now() - start };
    allFindings.push(...result.findings);
  }

  return { findings: allFindings, duration: Date.now() - start };
}

export function shouldBlock(findings: AuditFinding[], blockSeverity: string): boolean {
  if (blockSeverity === "none") return false;
  const threshold = SEVERITY_LEVELS[blockSeverity] ?? 3;
  return findings.some((f) => (SEVERITY_LEVELS[f.severity] ?? 0) >= threshold);
}

export async function autoFix(cwd: string, stacks: string[]): Promise<{ fixed: number; errors: string[] }> {
  let fixed = 0;
  const errors: string[] = [];
  for (const stack of stacks) {
    switch (stack) {
      case "typescript": {
        const r = await run("npm", ["audit", "fix"], cwd, 60_000);
        if (r.exitCode === 0) fixed++; else errors.push(r.stderr.slice(0, 200));
        break;
      }
      case "go": {
        const r = await run("go", ["get", "-u", "./..."], cwd, 120_000);
        if (r.exitCode === 0) fixed++; else errors.push(r.stderr.slice(0, 200));
        break;
      }
      case "python": {
        const r = await run("pip-audit", ["--fix"], cwd, 60_000);
        if (r.exitCode === 0) fixed++; else errors.push(r.stderr.slice(0, 200));
        break;
      }
    }
  }
  return { fixed, errors };
}

async function auditStack(cwd: string, stack: string): Promise<AuditResult> {
  switch (stack) {
    case "typescript": return auditNpm(cwd);
    case "go": return auditGo(cwd);
    case "python": return auditPython(cwd);
    default: return { findings: [], duration: 0 };
  }
}

async function auditNpm(cwd: string): Promise<AuditResult> {
  if (!fs.existsSync(path.join(cwd, "package-lock.json")) && !fs.existsSync(path.join(cwd, "package.json"))) {
    return { findings: [], duration: 0 };
  }
  const result = await run("npm", ["audit", "--json"], cwd, 60_000);
  if (!result.stdout) return { findings: [], duration: result.duration };
  try {
    const data = JSON.parse(result.stdout);
    const findings: AuditFinding[] = [];
    const vulns = data.vulnerabilities ?? {};
    for (const [pkg, info] of Object.entries(vulns) as [string, Record<string, unknown>][]) {
      findings.push({
        package: pkg,
        severity: normalizeSeverity(String(info.severity ?? "info")),
        advisory: String((info.via as unknown[])?.[0] ?? "Vulnerability"),
        fixAvailable: !!info.fixAvailable,
      });
    }
    return { findings, duration: result.duration };
  } catch {
    return { findings: [], error: "Failed to parse npm audit output", duration: result.duration };
  }
}

async function auditGo(cwd: string): Promise<AuditResult> {
  if (!fs.existsSync(path.join(cwd, "go.mod"))) return { findings: [], duration: 0 };
  const result = await run("go", ["mod", "verify"], cwd, 30_000);
  if (result.exitCode !== 0) {
    return {
      findings: [{ package: "modules", severity: "high", advisory: "Module verification failed", fixAvailable: false }],
      duration: result.duration,
    };
  }
  return { findings: [], duration: result.duration };
}

async function auditPython(cwd: string): Promise<AuditResult> {
  if (!fs.existsSync(path.join(cwd, "pyproject.toml")) && !fs.existsSync(path.join(cwd, "requirements.txt"))) {
    return { findings: [], duration: 0 };
  }
  const result = await run("pip-audit", ["--format=json"], cwd, 60_000);
  if (result.exitCode !== 0 || !result.stdout) return { findings: [], duration: result.duration };
  try {
    const data = JSON.parse(result.stdout);
    const findings: AuditFinding[] = [];
    for (const dep of (data.dependencies ?? []) as Record<string, unknown>[]) {
      for (const v of (dep.vulns ?? []) as Record<string, unknown>[]) {
        findings.push({
          package: String(dep.name ?? ""),
          severity: "moderate",
          advisory: String(v.id ?? "Vulnerability"),
          fixAvailable: !!((v.fix_versions as string[])?.length),
        });
      }
    }
    return { findings, duration: result.duration };
  } catch {
    return { findings: [], error: "Failed to parse pip-audit output", duration: result.duration };
  }
}

function normalizeSeverity(s: string): AuditFinding["severity"] {
  const map: Record<string, AuditFinding["severity"]> = {
    critical: "critical", high: "high", moderate: "moderate", medium: "moderate", low: "low",
  };
  return map[s.toLowerCase()] ?? "info";
}

export function formatFindings(findings: AuditFinding[]): string {
  if (!findings.length) return "No vulnerabilities found.";
  return findings.map((f) => `[${f.severity.toUpperCase()}] ${f.package}: ${f.advisory}${f.fixAvailable ? " (fix available)" : ""}`).join("\n");
}
