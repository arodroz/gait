import type { PendingAction, ReviewerAnalysis } from "./action-logger";
import type { DecisionPointType } from "./decision-points";
import type { HitlConfig } from "./config";

// ── Hardcoded adversarial system prompt ──
// SECURITY: This prompt MUST NOT be configurable. It prevents an agent
// from generating a permissive review prompt for itself.

const ADVERSARIAL_SYSTEM_PROMPT = `You are a code review adversary. Your job is to assume the AI coding agent made an interpretation error. Be skeptical, direct, and concise.

Given: the original user request, what the agent claimed it would do, and what it actually did (as a diff), you must identify:
1. What the user most likely wanted
2. What the agent actually did
3. Specific divergences — even minor ones matter
4. Concrete risks, especially if production files are involved
5. Your recommendation: accept as-is, reject and redo, or modify (with a specific suggestion)

Rules:
- Maximum 200 words total
- No pleasantries, no hedging
- If you find no issues: say so plainly in one sentence, then accept
- Return only valid JSON matching the specified schema
- Never recommend accepting if a production file was modified unexpectedly`;

// ── Reviewer selection ──

function selectReviewer(agentUnderReview: "claude" | "codex"): "claude" | "codex" {
  return agentUnderReview === "claude" ? "codex" : "claude";
}

// ── User prompt builder ──

function buildUserPrompt(
  action: PendingAction,
  points: DecisionPointType[],
  isProd: boolean,
): string {
  return `USER REQUEST: ${action.session_context ?? "(not available)"}

AGENT (${action.agent}) STATED INTENT: ${action.intent ?? "(not stated)"}

FILES MODIFIED: ${action.files.join(", ")}
DETECTED ISSUES: ${points.join(", ") || "none"}
PRODUCTION FILES INVOLVED: ${isProd ? "YES" : "no"}

ACTUAL DIFF (first 150 lines):
\`\`\`diff
${action.diff_preview?.slice(0, 6000) ?? "(diff not available)"}
\`\`\`

Respond with this JSON schema exactly:
{
  "understoodIntent": "string",
  "actualAction": "string",
  "divergences": ["string"],
  "risks": ["string"],
  "recommendation": "accept" | "reject" | "modify",
  "suggestion": "string or null",
  "confidence": "low" | "medium" | "high"
}`;
}

// ── API calls ──

async function reviewWithClaude(
  prompt: string,
  apiKeyEnv: string,
  timeoutMs: number,
): Promise<ParsedReviewerResponse> {
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) throw new Error(`${apiKeyEnv} not set`);

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const timeout = rejectAfter(timeoutMs, "reviewer timeout");
  const response = await Promise.race([
    client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: ADVERSARIAL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
    timeout,
  ]);
  timeout.cancel();

  const block = (response as { content: Array<{ type: string; text?: string }> }).content[0];
  if (!block || block.type !== "text" || !block.text) {
    throw new Error("Reviewer returned empty or non-text response");
  }
  return parseReviewerResponse(block.text);
}

async function reviewWithCodex(
  prompt: string,
  apiKeyEnv: string,
  timeoutMs: number,
): Promise<ParsedReviewerResponse> {
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) throw new Error(`${apiKeyEnv} not set`);

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const timeout = rejectAfter(timeoutMs, "reviewer timeout");
  const response = await Promise.race([
    client.chat.completions.create({
      model: "codex-mini-latest",
      max_tokens: 400,
      messages: [
        { role: "system", content: ADVERSARIAL_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
    timeout,
  ]);
  timeout.cancel();

  const content = (response as { choices: Array<{ message: { content: string | null } }> }).choices[0]?.message?.content;
  if (!content) {
    throw new Error("Codex reviewer returned empty response");
  }
  return parseReviewerResponse(content);
}

// ── Public API ──

/**
 * Run a cross-agent review. Returns null on any failure (never throws).
 * The reviewer is always the *other* agent — Claude reviews Codex, Codex reviews Claude.
 */
export async function review(
  action: PendingAction,
  points: DecisionPointType[],
  cfg: HitlConfig,
): Promise<ReviewerAnalysis | null> {
  const start = Date.now();
  let reviewerAgent = selectReviewer(action.agent);
  const isProd = points.includes("prod_file");
  const prompt = buildUserPrompt(action, points, isProd);

  // Check if the selected reviewer's API key is available
  const reviewerKeyEnv = reviewerAgent === "claude"
    ? cfg.reviewer.claude_api_key_env
    : cfg.reviewer.codex_api_key_env;

  if (!process.env[reviewerKeyEnv]) {
    // Cross-agent review is the security guarantee — self-review weakens it.
    // Fall back to same-agent review only if available, but warn loudly.
    const selfKeyEnv = action.agent === "claude"
      ? cfg.reviewer.claude_api_key_env
      : cfg.reviewer.codex_api_key_env;

    if (!process.env[selfKeyEnv]) {
      console.warn("[hitlgate] Reviewer: no API keys available, skipping review");
      return null;
    }

    console.warn(
      `[hitlgate] WARNING: ${reviewerKeyEnv} not set — falling back to same-agent self-review. ` +
      `This weakens the adversarial review guarantee. Set ${reviewerKeyEnv} for cross-agent review.`,
    );
    reviewerAgent = action.agent;
  }

  try {
    let result: ParsedReviewerResponse;
    if (reviewerAgent === "claude") {
      result = await reviewWithClaude(prompt, cfg.reviewer.claude_api_key_env, cfg.reviewer.timeout_ms);
    } else {
      result = await reviewWithCodex(prompt, cfg.reviewer.codex_api_key_env, cfg.reviewer.timeout_ms);
    }

    return {
      reviewerAgent,
      model: reviewerAgent === "claude" ? "claude-haiku-4-5-20251001" : "codex-mini-latest",
      understood_intent: result.understoodIntent,
      actual_action: result.actualAction,
      divergences: result.divergences,
      risks: result.risks,
      recommendation: result.recommendation,
      suggestion: result.suggestion ?? undefined,
      confidence: mapConfidence(result.confidence),
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    console.warn(`[hitlgate] Reviewer failed: ${err}`);
    return null;
  }
}

// ── Helpers ──

interface ParsedReviewerResponse {
  understoodIntent: string;
  actualAction: string;
  divergences: string[];
  risks: string[];
  recommendation: "accept" | "reject" | "modify";
  suggestion?: string;
  confidence: string;
}

function parseReviewerResponse(text: string): ParsedReviewerResponse {
  const cleaned = text.replace(/```json\n?|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  return {
    understoodIntent: String(parsed.understoodIntent ?? ""),
    actualAction: String(parsed.actualAction ?? ""),
    divergences: Array.isArray(parsed.divergences) ? parsed.divergences.map(String) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
    recommendation: validateRecommendation(parsed.recommendation),
    suggestion: parsed.suggestion ? String(parsed.suggestion) : undefined,
    confidence: String(parsed.confidence ?? "medium"),
  };
}

function validateRecommendation(val: unknown): "accept" | "reject" | "modify" {
  if (val === "accept" || val === "reject" || val === "modify") return val;
  return "modify";
}

function mapConfidence(val: string): number {
  if (val === "high") return 0.9;
  if (val === "medium") return 0.6;
  return 0.3;
}

function rejectAfter(ms: number, reason: string): Promise<never> & { cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(reason)), ms);
  }) as Promise<never> & { cancel: () => void };
  promise.cancel = () => clearTimeout(handle);
  return promise;
}
