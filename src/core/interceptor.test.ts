import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Interceptor, type WebviewPendingData } from "./interceptor";
import { ActionLogger, type PendingAction } from "./action-logger";
import { DEFAULT_CONFIG } from "./config";
import { review } from "./reviewer";

let mockEvaluation = {
  points: [] as string[],
  severity: "medium",
  explanations: {} as Record<string, string>,
  presentation: "panel",
  requires_cross_review: false,
};

let mockDiffOutput = "";
let mockShowFileOutput = "";

vi.mock("vscode", () => ({
  workspace: {
    createFileSystemWatcher: vi.fn(),
    RelativePattern: class RelativePattern {
      constructor(_base: string, _pattern: string) {}
    },
  },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInputBox: vi.fn(),
  },
}));

vi.mock("./decision-points", () => ({
  DECISION_POINT_LABELS: {},
  evaluate: vi.fn(async () => mockEvaluation),
}));

vi.mock("./reviewer", () => ({
  review: vi.fn(async () => null),
}));

vi.mock("./git", () => ({
  diffFiles: vi.fn(async () => mockDiffOutput),
  showFile: vi.fn(async () => mockShowFileOutput),
}));

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-interceptor-"));
}

function makeAction(id: string, overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id,
    agent: "codex",
    session_id: `sess_${id}`,
    tool: "Edit",
    files: ["src/foo.ts"],
    intent: "fix bug",
    ts: new Date().toISOString(),
    ...overrides,
  };
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(check: () => boolean, attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (check()) return;
    await tick();
  }
  throw new Error("condition not met");
}

describe("Interceptor", () => {
  beforeEach(() => {
    mockEvaluation = {
      points: [],
      severity: "medium",
      explanations: {},
      presentation: "panel",
      requires_cross_review: false,
    };
    mockDiffOutput = "";
    mockShowFileOutput = "";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("preserves existing diff previews when git diff is empty", async () => {
    const gaitDir = tmpDir();
    const logger = new ActionLogger(gaitDir);
    let shown: WebviewPendingData | undefined;
    const interceptor = new Interceptor("/workspace", gaitDir, DEFAULT_CONFIG, logger, undefined, (pendingData) => {
      shown = pendingData;
      setTimeout(() => interceptor.resolveWebviewDecision(pendingData.action.id, "accept"), 0);
    });

    const action = makeAction("act_1", {
      diff_preview: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n",
    });

    const result = await interceptor.processAction(action);

    expect(result.decision.decision).toBe("accept");
    expect(action.diff_preview).toContain("+new");
    expect(shown?.action.diff_preview).toContain("+new");
  });

  it("queues webview approvals so a second action waits for the first", async () => {
    const gaitDir = tmpDir();
    const logger = new ActionLogger(gaitDir);
    const shownIds: string[] = [];
    const interceptor = new Interceptor("/workspace", gaitDir, DEFAULT_CONFIG, logger, undefined, (pendingData) => {
      shownIds.push(pendingData.action.id);
    });

    const first = interceptor.processAction(makeAction("act_1"));
    await waitFor(() => shownIds.length === 1);
    expect(shownIds).toEqual(["act_1"]);

    const second = interceptor.processAction(makeAction("act_2"));
    await tick();
    expect(shownIds).toEqual(["act_1"]);

    interceptor.resolveWebviewDecision("act_1", "accept");
    await tick();
    expect(shownIds).toEqual(["act_1", "act_2"]);

    interceptor.resolveWebviewDecision("act_2", "accept");

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.decision.decision).toBe("accept");
    expect(secondResult.decision.decision).toBe("accept");
  });

  it("does not replay stale reviewer updates over the next queued approval", async () => {
    mockEvaluation = {
      points: ["prod_file"],
      severity: "high",
      explanations: { prod_file: "Production file" },
      presentation: "modal",
      requires_cross_review: true,
    };

    let resolveReview!: (value: {
      reviewerAgent: "claude" | "codex";
      model: string;
      understood_intent: string;
      actual_action: string;
      divergences: string[];
      risks: string[];
      recommendation: "accept" | "reject" | "modify";
      confidence: number;
      duration_ms: number;
    } | null) => void;

    vi.mocked(review).mockImplementationOnce(async () => await new Promise((resolve) => {
      resolveReview = resolve;
    })).mockResolvedValueOnce(null);

    const gaitDir = tmpDir();
    const logger = new ActionLogger(gaitDir);
    const shownStates: Array<{ id: string; loading: boolean; hasReview: boolean }> = [];
    const interceptor = new Interceptor("/workspace", gaitDir, DEFAULT_CONFIG, logger, undefined, (pendingData) => {
      shownStates.push({
        id: pendingData.action.id,
        loading: !!pendingData.reviewerLoading,
        hasReview: !!pendingData.reviewerAnalysis,
      });
    });

    const first = interceptor.processAction(makeAction("act_1"));
    await waitFor(() => shownStates.length === 1);
    expect(shownStates[0]).toEqual({ id: "act_1", loading: true, hasReview: false });

    const second = interceptor.processAction(makeAction("act_2"));
    await tick();
    interceptor.resolveWebviewDecision("act_1", "accept");
    await waitFor(() => shownStates.some((s) => s.id === "act_2"));

    resolveReview({
      reviewerAgent: "claude",
      model: "claude-test",
      understood_intent: "fix bug",
      actual_action: "edited src/foo.ts",
      divergences: [],
      risks: [],
      recommendation: "accept",
      confidence: 0.9,
      duration_ms: 10,
    });
    await tick();

    const act2States = shownStates.filter((s) => s.id === "act_2");
    expect(act2States.length).toBeGreaterThanOrEqual(1);
    expect(shownStates.filter((s) => s.id === "act_1" && s.hasReview)).toHaveLength(0);
    expect(shownStates[shownStates.length - 1]?.id).toBe("act_2");

    interceptor.resolveWebviewDecision("act_2", "accept");
    await Promise.all([first, second]);
  });
});
