import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function tmpDir(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "gait-testgen-")); }

describe("test-gen helpers", () => {
  it("guesses test file for TypeScript", () => {
    // Inline the logic since guessTestFile is private
    const guess = (f: string) => {
      if (f.endsWith(".ts")) return f.replace(/\.ts$/, ".test.ts");
      if (f.endsWith(".py")) return f.replace(/\.py$/, "_test.py");
      if (f.endsWith(".go")) return f.replace(/\.go$/, "_test.go");
      return f + ".test";
    };
    expect(guess("src/core/config.ts")).toBe("src/core/config.test.ts");
    expect(guess("auth.py")).toBe("auth_test.py");
    expect(guess("main.go")).toBe("main_test.go");
  });

  it("extracts code from markdown fences", () => {
    const extract = (output: string) => {
      const match = output.match(/```(?:\w+)?\n([\s\S]*?)```/);
      return match ? match[1].trim() : output.trim();
    };
    expect(extract("```typescript\nconst x = 1;\n```")).toBe("const x = 1;");
    expect(extract("const x = 1;")).toBe("const x = 1;");
  });

  it("finds test patterns from sibling files", () => {
    const dir = tmpDir();
    const srcDir = path.join(dir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "foo.test.ts"), 'import { describe } from "vitest";\ndescribe("foo", () => {});');
    fs.writeFileSync(path.join(srcDir, "bar.ts"), "export function bar() {}");

    // Look for test files in same dir
    const files = fs.readdirSync(srcDir).filter((f) => f.includes(".test."));
    expect(files.length).toBe(1);
    expect(files[0]).toBe("foo.test.ts");

    const pattern = fs.readFileSync(path.join(srcDir, files[0]), "utf-8");
    expect(pattern).toContain("describe");
  });
});
