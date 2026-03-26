import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Interceptor } from "./interceptor";
import { ActionLogger } from "./action-logger";
import { DEFAULT_CONFIG } from "./config";

const { showWarningMessage, showInputBox } = vi.hoisted(() => ({
  showWarningMessage: vi.fn(),
  showInputBox: vi.fn(),
}));

vi.mock("vscode", () => ({
  workspace: {
    createFileSystemWatcher: vi.fn(),
    RelativePattern: class RelativePattern {
      constructor(_base: string, _pattern: string) {}
    },
  },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage,
    showInputBox,
  },
}));

vi.mock("./decision-points", () => ({
  DECISION_POINT_LABELS: {},
  evaluate: vi.fn(async () => ({
    points: [],
    severity: "medium",
    explanations: {},
    presentation: "panel",
    requires_cross_review: false,
  })),
}));

vi.mock("./reviewer", () => ({
  review: vi.fn(async () => null),
}));

vi.mock("./git", () => ({
  diffFiles: vi.fn(async () => ""),
  showFile: vi.fn(async () => ""),
}));

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gait-interceptor-fallback-"));
}

describe("Interceptor fallback flows", () => {
  beforeEach(() => {
    showWarningMessage.mockReset();
    showInputBox.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes a reject-with-note decision when processing a pending file without webview", async () => {
    const gaitDir = tmpDir();
    const logger = new ActionLogger(gaitDir);
    const interceptor = new Interceptor("/workspace", gaitDir, DEFAULT_CONFIG, logger);

    showWarningMessage.mockResolvedValue("Reject with Note");
    showInputBox.mockResolvedValue("Scope changes to the new route only");

    const pendingPath = path.join(gaitDir, "pending", "act_1.json");
    await fs.promises.mkdir(path.dirname(pendingPath), { recursive: true });
    await fs.promises.writeFile(pendingPath, JSON.stringify({
      id: "act_1",
      agent: "claude",
      session_id: "sess_1",
      tool: "Edit",
      files: ["src/foo.ts"],
      intent: "fix bug",
      ts: new Date().toISOString(),
    }));

    await (interceptor as unknown as { onPendingFile: (uri: { fsPath: string }) => Promise<void> }).onPendingFile({ fsPath: pendingPath });

    const decision = JSON.parse(await fs.promises.readFile(path.join(gaitDir, "decisions", "act_1.json"), "utf8")) as {
      decision: string;
      note?: string;
    };
    expect(decision.decision).toBe("reject");
    expect(decision.note).toBe("Scope changes to the new route only");
  });
});
