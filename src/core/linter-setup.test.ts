import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ensureLinterSetup } from "./linter-setup";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-linter-"));
}

describe("ensureLinterSetup", () => {
  it("creates eslint config for typescript stack", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      devDependencies: { eslint: "^10.0.0", "@typescript-eslint/parser": "^8.0.0", "@typescript-eslint/eslint-plugin": "^8.0.0" },
    }));

    const result = await ensureLinterSetup(dir, ["typescript"]);
    expect(result.created).toContain("eslint.config.js");
    expect(fs.existsSync(path.join(dir, "eslint.config.js"))).toBe(true);

    const content = fs.readFileSync(path.join(dir, "eslint.config.js"), "utf-8");
    expect(content).toContain("@typescript-eslint");
  });

  it("skips if eslint config already exists", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "eslint.config.js"), "module.exports = [{ rules: { semi: 'error' } }];");

    const result = await ensureLinterSetup(dir, ["typescript"]);
    expect(result.skipped.some((s) => s.includes("already configured"))).toBe(true);
  });

  it("creates golangci config for go stack", async () => {
    const dir = tmpDir();
    const result = await ensureLinterSetup(dir, ["go"]);
    expect(result.created).toContain(".golangci.yml");
    expect(fs.existsSync(path.join(dir, ".golangci.yml"))).toBe(true);
  });

  it("creates ruff config for python stack", async () => {
    const dir = tmpDir();
    const result = await ensureLinterSetup(dir, ["python"]);
    expect(result.created).toContain("ruff.toml");
  });

  it("creates swiftlint config for swift stack", async () => {
    const dir = tmpDir();
    const result = await ensureLinterSetup(dir, ["swift"]);
    expect(result.created).toContain(".swiftlint.yml");
  });

  it("handles multiple stacks", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      devDependencies: { eslint: "^10.0.0", "@typescript-eslint/parser": "^8.0.0", "@typescript-eslint/eslint-plugin": "^8.0.0" },
    }));

    const result = await ensureLinterSetup(dir, ["typescript", "python"]);
    expect(result.created).toContain("eslint.config.js");
    expect(result.created).toContain("ruff.toml");
  });
});
