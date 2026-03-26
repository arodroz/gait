import { describe, it, expect } from "vitest";
import {
  detectInterfaceChange,
  detectPublicApiChange,
  detectFileDeleted,
  detectFileRenamed,
  detectSchemaChange,
  detectCrossAgentConflict,
  detectProdFile,
  computeSeverity,
  computePresentation,
  evaluate,
} from "./decision-points";
import type { PendingAction, ActionRecord } from "./action-logger";
import { DEFAULT_CONFIG } from "./config";

// ── Diff fixtures ──

const INTERFACE_CHANGE_DIFF = `--- a/src/api.ts
+++ b/src/api.ts
@@ -10,7 +10,7 @@
-export function getUser(id: string): User {
+export function getUser(id: string, includeRoles: boolean): User {
   return db.findUser(id);
 }`;

const PUBLIC_API_ADDED_DIFF = `--- a/src/api.ts
+++ b/src/api.ts
@@ -10,0 +11,3 @@
+export function deleteUser(id: string): void {
+  db.remove(id);
+}`;

const PUBLIC_API_REMOVED_DIFF = `--- a/src/api.ts
+++ b/src/api.ts
@@ -10,3 +10,0 @@
-export function getUser(id: string): User {
-  return db.findUser(id);
-}`;

const BODY_ONLY_DIFF = `--- a/src/api.ts
+++ b/src/api.ts
@@ -11,3 +11,3 @@
 export function getUser(id: string): User {
-  return db.findUser(id);
+  return db.findUser(id) ?? null;
 }`;

const FILE_DELETED_DIFF = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null`;

const FILE_RENAMED_DIFF = `diff --git a/src/old.ts b/src/new.ts
similarity index 95%
rename from src/old.ts
rename to src/new.ts`;

const SCHEMA_DDL_DIFF = `--- a/migrations/001.sql
+++ b/migrations/001.sql
@@ -0,0 +1,3 @@
+CREATE TABLE users (
+  id SERIAL PRIMARY KEY
+);`;

const NO_CHANGE_DIFF = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
-// old comment
+// new comment
 const x = 1;`;

// ── Detection tests ──

describe("detectInterfaceChange", () => {
  it("detects modified exported function signature", () => {
    expect(detectInterfaceChange(INTERFACE_CHANGE_DIFF).detected).toBe(true);
  });

  it("does not flag body-only changes", () => {
    expect(detectInterfaceChange(BODY_ONLY_DIFF).detected).toBe(false);
  });

  it("does not flag comment changes", () => {
    expect(detectInterfaceChange(NO_CHANGE_DIFF).detected).toBe(false);
  });

  it("returns false for undefined diff", () => {
    expect(detectInterfaceChange(undefined).detected).toBe(false);
  });
});

describe("detectPublicApiChange", () => {
  it("detects added export", () => {
    const r = detectPublicApiChange(PUBLIC_API_ADDED_DIFF);
    expect(r.detected).toBe(true);
    expect(r.explanation).toContain("added");
  });

  it("detects removed export", () => {
    const r = detectPublicApiChange(PUBLIC_API_REMOVED_DIFF);
    expect(r.detected).toBe(true);
    expect(r.explanation).toContain("removed");
  });

  it("does not flag modified export (same name)", () => {
    expect(detectPublicApiChange(INTERFACE_CHANGE_DIFF).detected).toBe(false);
  });
});

describe("detectFileDeleted", () => {
  it("detects deleted file mode header", () => {
    expect(detectFileDeleted(FILE_DELETED_DIFF).detected).toBe(true);
  });

  it("does not flag normal diff", () => {
    expect(detectFileDeleted(BODY_ONLY_DIFF).detected).toBe(false);
  });
});

describe("detectFileRenamed", () => {
  it("detects rename from/to headers", () => {
    const r = detectFileRenamed(FILE_RENAMED_DIFF);
    expect(r.detected).toBe(true);
    expect(r.explanation).toContain("old.ts");
    expect(r.explanation).toContain("new.ts");
  });

  it("does not flag normal diff", () => {
    expect(detectFileRenamed(BODY_ONLY_DIFF).detected).toBe(false);
  });
});

describe("detectSchemaChange", () => {
  it("detects schema file by path", () => {
    expect(detectSchemaChange(["migrations/001.sql"]).detected).toBe(true);
    expect(detectSchemaChange(["prisma/schema.prisma"]).detected).toBe(true);
    expect(detectSchemaChange(["schema.graphql"]).detected).toBe(true);
  });

  it("detects DDL in diff content", () => {
    expect(detectSchemaChange(["src/foo.ts"], SCHEMA_DDL_DIFF).detected).toBe(true);
  });

  it("does not flag normal files", () => {
    expect(detectSchemaChange(["src/api.ts"]).detected).toBe(false);
  });
});

describe("detectCrossAgentConflict", () => {
  const action: PendingAction = {
    id: "act_001", agent: "claude", session_id: "s1",
    tool: "Edit", files: ["src/api.ts"], intent: "fix bug", ts: new Date().toISOString(),
  };

  it("detects conflict with other agent on same file", () => {
    const recent: ActionRecord[] = [{
      id: "act_000", ts: new Date(Date.now() - 60000).toISOString(), agent: "codex",
      session_id: "s0", tool: "Edit", files: ["src/api.ts"], intent: "add feature",
      decision_points: [], severity: "low", human_decision: "accept",
    }];
    expect(detectCrossAgentConflict(action, recent, 14400).detected).toBe(true);
  });

  it("ignores same agent on same file", () => {
    const recent: ActionRecord[] = [{
      id: "act_000", ts: new Date(Date.now() - 60000).toISOString(), agent: "claude",
      session_id: "s0", tool: "Edit", files: ["src/api.ts"], intent: "add feature",
      decision_points: [], severity: "low", human_decision: "accept",
    }];
    expect(detectCrossAgentConflict(action, recent, 14400).detected).toBe(false);
  });

  it("ignores rejected actions", () => {
    const recent: ActionRecord[] = [{
      id: "act_000", ts: new Date(Date.now() - 60000).toISOString(), agent: "codex",
      session_id: "s0", tool: "Edit", files: ["src/api.ts"], intent: "add feature",
      decision_points: [], severity: "low", human_decision: "reject",
    }];
    expect(detectCrossAgentConflict(action, recent, 14400).detected).toBe(false);
  });

  it("ignores actions outside time window", () => {
    const recent: ActionRecord[] = [{
      id: "act_000", ts: new Date(Date.now() - 20 * 3600 * 1000).toISOString(), agent: "codex",
      session_id: "s0", tool: "Edit", files: ["src/api.ts"], intent: "add feature",
      decision_points: [], severity: "low", human_decision: "accept",
    }];
    expect(detectCrossAgentConflict(action, recent, 14400).detected).toBe(false);
  });
});

describe("detectProdFile", () => {
  it("detects file matching prod path glob", () => {
    expect(detectProdFile(["src/api/routes.ts"], ["src/api/**"]).detected).toBe(true);
  });

  it("does not flag non-matching files", () => {
    expect(detectProdFile(["src/utils/format.ts"], ["src/api/**"]).detected).toBe(false);
  });

  it("matches config file patterns", () => {
    expect(detectProdFile(["webpack.config.ts"], ["*.config.ts"]).detected).toBe(true);
  });

  it("returns false when no prod paths configured", () => {
    expect(detectProdFile(["src/api/routes.ts"], []).detected).toBe(false);
  });
});

// ── Severity tests ──

describe("computeSeverity", () => {
  it("returns low for no points in dev mode", () => {
    expect(computeSeverity([], "dev")).toBe("low");
  });

  it("returns medium for no points in prod mode", () => {
    expect(computeSeverity([], "prod")).toBe("medium");
  });

  it("returns medium for single medium-weight point", () => {
    expect(computeSeverity(["interface_change"], "dev")).toBe("medium");
  });

  it("returns high for single high-weight point", () => {
    expect(computeSeverity(["file_deleted"], "dev")).toBe("high");
  });

  it("returns high for 2+ medium-weight points", () => {
    expect(computeSeverity(["interface_change", "schema_change"], "dev")).toBe("high");
  });

  it("elevates medium to high in prod mode", () => {
    expect(computeSeverity(["interface_change"], "prod")).toBe("high");
  });

  it("returns low for file_renamed in dev", () => {
    expect(computeSeverity(["file_renamed"], "dev")).toBe("low");
  });
});

// ── Presentation tests ──

describe("computePresentation", () => {
  it("low severity in dev → notification", () => {
    expect(computePresentation("low", "dev")).toBe("notification");
  });

  it("medium severity in dev → panel", () => {
    expect(computePresentation("medium", "dev")).toBe("panel");
  });

  it("high severity in dev → modal", () => {
    expect(computePresentation("high", "dev")).toBe("modal");
  });

  it("low severity in prod → panel", () => {
    expect(computePresentation("low", "prod")).toBe("panel");
  });

  it("medium severity in prod → modal", () => {
    expect(computePresentation("medium", "prod")).toBe("modal");
  });
});

// ── Full evaluate test ──

describe("evaluate", () => {
  it("evaluates action with interface change", async () => {
    const action: PendingAction = {
      id: "act_001", agent: "claude", session_id: "s1", tool: "Edit",
      files: ["src/api.ts"], intent: "update api", diff_preview: INTERFACE_CHANGE_DIFF,
      ts: new Date().toISOString(),
    };
    const result = await evaluate(action, DEFAULT_CONFIG, []);
    expect(result.points).toContain("interface_change");
    expect(result.severity).toBe("medium");
    expect(result.presentation).toBe("panel");
  });

  it("evaluates action with prod file", async () => {
    const cfg = { ...DEFAULT_CONFIG, prod: { paths: ["src/api/**"] } };
    const action: PendingAction = {
      id: "act_001", agent: "claude", session_id: "s1", tool: "Edit",
      files: ["src/api/routes.ts"], intent: "update routes",
      ts: new Date().toISOString(),
    };
    const result = await evaluate(action, cfg, []);
    expect(result.points).toContain("prod_file");
    expect(result.severity).toBe("high");
    expect(result.presentation).toBe("modal");
  });

  it("returns low severity for benign action", async () => {
    const action: PendingAction = {
      id: "act_001", agent: "claude", session_id: "s1", tool: "Edit",
      files: ["src/utils.ts"], intent: "fix typo", diff_preview: BODY_ONLY_DIFF,
      ts: new Date().toISOString(),
    };
    const result = await evaluate(action, DEFAULT_CONFIG, []);
    expect(result.points).toEqual([]);
    expect(result.severity).toBe("low");
    expect(result.presentation).toBe("notification");
  });
});
