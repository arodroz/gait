import { describe, it, expect } from "vitest";

// Test the diff parsing logic by importing internal-ish behavior
// getCurrentDiffs requires a git repo, so we test the output parsing pattern
describe("diff-watcher output parsing", () => {
  it("counts additions and deletions from hunk content", () => {
    const hunks = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,5 @@
 const a = 1;
+const b = 2;
+const c = 3;
-const old = 0;
 const d = 4;`;

    const adds = (hunks.match(/^\+[^+]/gm) || []).length;
    const dels = (hunks.match(/^-[^-]/gm) || []).length;
    expect(adds).toBe(2);
    expect(dels).toBe(1);
  });

  it("handles empty hunks", () => {
    const hunks = "";
    const adds = (hunks.match(/^\+[^+]/gm) || []).length;
    const dels = (hunks.match(/^-[^-]/gm) || []).length;
    expect(adds).toBe(0);
    expect(dels).toBe(0);
  });
});
