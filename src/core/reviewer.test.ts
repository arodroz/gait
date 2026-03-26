import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { review } from "./reviewer";
import type { PendingAction } from "./action-logger";
import { DEFAULT_CONFIG } from "./config";

// Mock the SDK imports
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{
          type: "text",
          text: JSON.stringify({
            understoodIntent: "Fix a bug in the API",
            actualAction: "Modified the API route handler",
            divergences: ["Also modified auth middleware"],
            risks: ["Auth change affects all routes"],
            recommendation: "modify",
            suggestion: "Scope changes to new route only",
            confidence: "high",
          }),
        }],
      }),
    };
    constructor(_opts: { apiKey: string }) {}
  },
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: JSON.stringify({
                understoodIntent: "Add a new endpoint",
                actualAction: "Added endpoint and modified schema",
                divergences: [],
                risks: ["Schema change may require migration"],
                recommendation: "accept",
                suggestion: null,
                confidence: "medium",
              }),
            },
          }],
        }),
      },
    };
    constructor(_opts: { apiKey: string }) {}
  },
}));

const baseAction: PendingAction = {
  id: "act_001",
  agent: "claude",
  session_id: "sess_001",
  tool: "Edit",
  files: ["src/api/routes.ts"],
  intent: "Fix bug in user endpoint",
  diff_preview: "--- a/src/api/routes.ts\n+++ b/src/api/routes.ts\n@@ -10 +10 @@\n-old\n+new\n",
  session_context: "Fix the bug in the user endpoint",
  ts: new Date().toISOString(),
};

describe("reviewer", () => {
  let origAnthropicKey: string | undefined;
  let origOpenaiKey: string | undefined;

  beforeEach(() => {
    origAnthropicKey = process.env.ANTHROPIC_API_KEY;
    origOpenaiKey = process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
  });

  afterEach(() => {
    if (origAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = origAnthropicKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (origOpenaiKey !== undefined) process.env.OPENAI_API_KEY = origOpenaiKey;
    else delete process.env.OPENAI_API_KEY;
  });

  it("Claude action reviewed by Codex (cross-review)", async () => {
    const result = await review(baseAction, [], DEFAULT_CONFIG);
    expect(result).not.toBeNull();
    expect(result!.reviewerAgent).toBe("codex");
    expect(result!.model).toBe("codex-mini-latest");
    expect(result!.recommendation).toBe("accept");
    expect(result!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("Codex action reviewed by Claude (cross-review)", async () => {
    const codexAction = { ...baseAction, agent: "codex" as const };
    const result = await review(codexAction, [], DEFAULT_CONFIG);
    expect(result).not.toBeNull();
    expect(result!.reviewerAgent).toBe("claude");
    expect(result!.model).toBe("claude-haiku-4-5-20251001");
    expect(result!.recommendation).toBe("modify");
    expect(result!.divergences).toContain("Also modified auth middleware");
  });

  it("falls back to self-review when cross API key missing", async () => {
    delete process.env.OPENAI_API_KEY;
    // Claude action, normally reviewed by Codex, but OPENAI key missing → Claude self-reviews
    const result = await review(baseAction, [], DEFAULT_CONFIG);
    expect(result).not.toBeNull();
    expect(result!.reviewerAgent).toBe("claude");
  });

  it("returns null when no API keys available", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const result = await review(baseAction, [], DEFAULT_CONFIG);
    expect(result).toBeNull();
  });

  it("includes prod_file flag in prompt context", async () => {
    const result = await review(baseAction, ["prod_file"], DEFAULT_CONFIG);
    expect(result).not.toBeNull();
  });

  it("maps confidence string to number", async () => {
    const result = await review({ ...baseAction, agent: "codex" as const }, [], DEFAULT_CONFIG);
    expect(result).not.toBeNull();
    // Claude mock returns confidence: "high" → 0.9
    expect(result!.confidence).toBe(0.9);
  });
});
