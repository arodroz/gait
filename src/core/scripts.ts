import * as fs from "fs";
import * as path from "path";
import { run } from "./runner";

export interface Script {
  path: string;
  name: string;
  description: string;
  expect: string;
  timeout: number; // ms
  depends: string[];
}

/** Parse gait: metadata headers from a script file */
export function parseScript(filePath: string): Script {
  const content = fs.readFileSync(filePath, "utf-8");
  const script: Script = {
    path: filePath,
    name: path.basename(filePath, path.extname(filePath)),
    description: "",
    expect: "exit:0",
    timeout: 120_000,
    depends: [],
  };

  for (const line of content.split("\n")) {
    if (!line.startsWith("# gait:")) continue;
    const rest = line.slice(7);
    const spaceIdx = rest.indexOf(" ");
    if (spaceIdx < 0) continue;
    const key = rest.slice(0, spaceIdx).trim();
    const val = rest.slice(spaceIdx + 1).trim();

    switch (key) {
      case "name": script.name = val; break;
      case "description": script.description = val; break;
      case "expect": script.expect = val; break;
      case "timeout": {
        const m = val.match(/^(\d+)(ms|s|m)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          script.timeout = m[2] === "ms" ? n : m[2] === "s" ? n * 1000 : n * 60_000;
        }
        break;
      }
      case "depends":
        script.depends = val.split(",").map((s) => s.trim()).filter(Boolean);
        break;
    }
  }

  return script;
}

/** List all scripts in .gait/scripts/ */
export function listScripts(scriptsDir: string): Script[] {
  if (!fs.existsSync(scriptsDir)) return [];
  return fs.readdirSync(scriptsDir)
    .filter((f) => f.endsWith(".sh"))
    .map((f) => parseScript(path.join(scriptsDir, f)));
}

/** Run a script and return pass/fail */
export async function runScript(
  script: Script,
  cwd: string,
): Promise<{ passed: boolean; output: string; error: string; duration: number }> {
  const result = await run("bash", [script.path], cwd, script.timeout);
  const expectExit = script.expect === "exit:0" ? 0 : parseInt(script.expect.split(":")[1] ?? "0", 10);
  return {
    passed: result.exitCode === expectExit,
    output: result.stdout,
    error: result.stderr,
    duration: result.duration,
  };
}

/** Generate a default script file content */
export function generateScript(name: string, description: string, command: string, depends: string[] = []): string {
  let out = "#!/usr/bin/env bash\n";
  out += `# gait:name ${name}\n`;
  out += `# gait:description ${description}\n`;
  out += "# gait:expect exit:0\n";
  out += "# gait:timeout 120s\n";
  if (depends.length) out += `# gait:depends ${depends.join(", ")}\n`;
  out += "set -euo pipefail\n\n";
  out += command + "\n";
  return out;
}

/** Create default scripts for detected stacks */
export function createDefaults(scriptsDir: string, stacks: Record<string, { Lint: string; Test: string; Typecheck: string; Build: string }>): void {
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const [stack, cmds] of Object.entries(stacks)) {
    if (cmds.Lint) write(scriptsDir, `${stack}_lint.sh`, generateScript("lint", `Run ${stack} linter`, cmds.Lint));
    if (cmds.Test) write(scriptsDir, `${stack}_test.sh`, generateScript("test", `Run ${stack} tests`, cmds.Test, ["lint"]));
    if (cmds.Typecheck) write(scriptsDir, `${stack}_typecheck.sh`, generateScript("typecheck", `Run ${stack} type checker`, cmds.Typecheck));
    if (cmds.Build) write(scriptsDir, `${stack}_build.sh`, generateScript("build", `Build ${stack} project`, cmds.Build));
  }
}

function write(dir: string, filename: string, content: string): void {
  fs.writeFileSync(path.join(dir, filename), content, { mode: 0o755 });
}
