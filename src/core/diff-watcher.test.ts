import { describe, it, expect } from "vitest";
import { parseDiffOutput } from "./diff-watcher";

describe("diff-watcher", () => {
  it("parses a single-file diff", () => {
    const output = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,5 @@
 const a = 1;
+const b = 2;
+const c = 3;
-const old = 0;
 const d = 4;`;

    const result = parseDiffOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("src/foo.ts");
    expect(result[0].hunks).toContain("+const b = 2;");
    expect(result[0].hunks).toContain("-const old = 0;");
  });

  it("parses multiple files", () => {
    const output = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-foo
+bar`;

    const result = parseDiffOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe("src/a.ts");
    expect(result[1].file).toBe("src/b.ts");
  });

  it("returns empty array for empty input", () => {
    expect(parseDiffOutput("")).toEqual([]);
  });

  it("caps hunks at 2000 chars per file", () => {
    const longLine = "+" + "x".repeat(3000);
    const output = `diff --git a/big.ts b/big.ts
--- a/big.ts
+++ b/big.ts
@@ -1 +1 @@
${longLine}`;

    const result = parseDiffOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].hunks.length).toBeLessThanOrEqual(2000);
  });
});
