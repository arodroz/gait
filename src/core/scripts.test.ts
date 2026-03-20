import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseScript, listScripts, generateScript, createDefaults, runScript } from "./scripts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-scripts-"));
}

describe("parseScript", () => {
  it("parses gait: metadata headers", () => {
    const dir = tmpDir();
    const content = `#!/usr/bin/env bash
# gait:name test
# gait:description Run all tests
# gait:expect exit:0
# gait:timeout 60s
# gait:depends lint, typecheck
set -euo pipefail
echo "testing"
`;
    const p = path.join(dir, "test.sh");
    fs.writeFileSync(p, content);

    const s = parseScript(p);
    expect(s.name).toBe("test");
    expect(s.description).toBe("Run all tests");
    expect(s.expect).toBe("exit:0");
    expect(s.timeout).toBe(60_000);
    expect(s.depends).toEqual(["lint", "typecheck"]);
  });

  it("uses filename as default name", () => {
    const dir = tmpDir();
    const p = path.join(dir, "build.sh");
    fs.writeFileSync(p, "#!/bin/bash\necho build");

    const s = parseScript(p);
    expect(s.name).toBe("build");
  });
});

describe("listScripts", () => {
  it("lists .sh files in directory", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "lint.sh"), "#!/bin/bash\n# gait:name lint\necho lint");
    fs.writeFileSync(path.join(dir, "test.sh"), "#!/bin/bash\n# gait:name test\necho test");
    fs.writeFileSync(path.join(dir, "readme.txt"), "not a script");

    const scripts = listScripts(dir);
    expect(scripts.length).toBe(2);
    expect(scripts.map((s) => s.name).sort()).toEqual(["lint", "test"]);
  });

  it("returns empty for nonexistent dir", () => {
    expect(listScripts("/nonexistent")).toEqual([]);
  });
});

describe("generateScript", () => {
  it("generates script with metadata", () => {
    const content = generateScript("lint", "Run linter", "eslint .", ["typecheck"]);
    expect(content).toContain("# gait:name lint");
    expect(content).toContain("# gait:description Run linter");
    expect(content).toContain("# gait:depends typecheck");
    expect(content).toContain("eslint .");
    expect(content).toContain("set -euo pipefail");
  });
});

describe("createDefaults", () => {
  it("creates script files for stacks", () => {
    const dir = tmpDir();
    createDefaults(dir, {
      go: { Lint: "go vet ./...", Test: "go test ./...", Typecheck: "", Build: "go build ./..." },
    });

    const files = fs.readdirSync(dir);
    expect(files).toContain("go_lint.sh");
    expect(files).toContain("go_test.sh");
    expect(files).toContain("go_build.sh");
    expect(files).not.toContain("go_typecheck.sh"); // empty command
  });
});

describe("runScript", () => {
  it("runs a passing script", async () => {
    const dir = tmpDir();
    const p = path.join(dir, "pass.sh");
    fs.writeFileSync(p, "#!/bin/bash\n# gait:name pass\necho ok", { mode: 0o755 });

    const script = parseScript(p);
    const result = await runScript(script, dir);
    expect(result.passed).toBe(true);
    expect(result.output.trim()).toBe("ok");
  });

  it("runs a failing script", async () => {
    const dir = tmpDir();
    const p = path.join(dir, "fail.sh");
    fs.writeFileSync(p, "#!/bin/bash\n# gait:name fail\nexit 1", { mode: 0o755 });

    const script = parseScript(p);
    const result = await runScript(script, dir);
    expect(result.passed).toBe(false);
  });
});
