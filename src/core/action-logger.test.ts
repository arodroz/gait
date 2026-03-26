import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ActionLogger, type ActionRecord } from "./action-logger";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-logger-"));
}

function makeRecord(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: new Date().toISOString(),
    agent: "claude",
    session_id: "sess_001",
    tool: "Edit",
    files: ["src/foo.ts"],
    intent: "fix a bug",
    decision_points: [],
    severity: "low",
    human_decision: "accept",
    ...overrides,
  };
}

describe("ActionLogger", () => {
  it("append + readRecent round-trip", async () => {
    const dir = tmpDir();
    const logger = new ActionLogger(dir);
    const record = makeRecord({ id: "act_001" });
    await logger.append(record);

    const records = await logger.readRecent();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("act_001");
    expect(records[0].agent).toBe("claude");
  });

  it("readRecent returns last N records", async () => {
    const dir = tmpDir();
    const logger = new ActionLogger(dir);

    for (let i = 0; i < 10; i++) {
      await logger.append(makeRecord({ id: `act_${i}` }));
    }

    const last3 = await logger.readRecent(3);
    expect(last3).toHaveLength(3);
    expect(last3[0].id).toBe("act_7");
    expect(last3[2].id).toBe("act_9");
  });

  it("readRecent returns empty for missing file", async () => {
    const dir = tmpDir();
    const logger = new ActionLogger(dir);
    const records = await logger.readRecent();
    expect(records).toEqual([]);
  });

  it("findById finds existing record", async () => {
    const dir = tmpDir();
    const logger = new ActionLogger(dir);

    for (let i = 0; i < 5; i++) {
      await logger.append(makeRecord({ id: `act_${i}` }));
    }

    const found = await logger.findById("act_3");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("act_3");
  });

  it("findById returns null for missing record", async () => {
    const dir = tmpDir();
    const logger = new ActionLogger(dir);
    await logger.append(makeRecord({ id: "act_001" }));

    const found = await logger.findById("act_999");
    expect(found).toBeNull();
  });

  it("query filters by field", async () => {
    const dir = tmpDir();
    const logger = new ActionLogger(dir);

    await logger.append(makeRecord({ id: "act_1", agent: "claude", severity: "low" }));
    await logger.append(makeRecord({ id: "act_2", agent: "codex", severity: "high" }));
    await logger.append(makeRecord({ id: "act_3", agent: "claude", severity: "high" }));

    const claudeOnly = await logger.query({ agent: "claude" });
    expect(claudeOnly).toHaveLength(2);

    const highOnly = await logger.query({ severity: "high" });
    expect(highOnly).toHaveLength(2);

    const claudeHigh = await logger.query({ agent: "claude", severity: "high" });
    expect(claudeHigh).toHaveLength(1);
    expect(claudeHigh[0].id).toBe("act_3");
  });

  it("skips corrupted lines gracefully", async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, "actions.jsonl");
    const good = makeRecord({ id: "act_good" });
    fs.writeFileSync(filePath, JSON.stringify(good) + "\n{broken json\n" + JSON.stringify(makeRecord({ id: "act_ok" })) + "\n");

    const logger = new ActionLogger(dir);
    const records = await logger.readRecent();
    expect(records).toHaveLength(2);
    expect(records[0].id).toBe("act_good");
    expect(records[1].id).toBe("act_ok");
  });

  it("concurrent appends don't lose records", async () => {
    const dir = tmpDir();
    const logger = new ActionLogger(dir);
    const promises: Promise<void>[] = [];

    for (let i = 0; i < 20; i++) {
      promises.push(logger.append(makeRecord({ id: `act_${i}` })));
    }
    await Promise.all(promises);

    const records = await logger.readRecent();
    expect(records).toHaveLength(20);
  });

  it("storeDiff writes patch file", async () => {
    const dir = tmpDir();
    const logger = new ActionLogger(dir);
    const patch = "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new\n";

    const ref = await logger.storeDiff("act_001", patch);
    expect(ref).toBe(".gait/diffs/act_001.patch");

    const content = fs.readFileSync(path.join(dir, "diffs", "act_001.patch"), "utf8");
    expect(content).toBe(patch);
  });
});
