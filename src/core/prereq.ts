import { run } from "./runner";
import * as os from "os";

export interface CheckResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function commandExists(name: string): Promise<CheckResult> {
  const result = await run("which", [name], os.tmpdir(), 5000);
  return {
    name,
    passed: result.exitCode === 0,
    error: result.exitCode !== 0 ? `${name} not found on PATH` : undefined,
  };
}

export async function envVarSet(name: string): Promise<CheckResult> {
  const val = process.env[name];
  return {
    name: `$${name}`,
    passed: !!val,
    error: !val ? `$${name} is not set` : undefined,
  };
}

export async function runDefaultChecks(stacks: string[]): Promise<CheckResult[]> {
  const checks: Promise<CheckResult>[] = [commandExists("git")];

  for (const stack of stacks) {
    switch (stack) {
      case "go":
        checks.push(commandExists("go"));
        break;
      case "python":
        checks.push(commandExists("python3"), commandExists("pip"));
        break;
      case "typescript":
        checks.push(commandExists("node"), commandExists("npm"));
        break;
      case "swift":
        checks.push(commandExists("swift"));
        break;
    }
  }

  return Promise.all(checks);
}
