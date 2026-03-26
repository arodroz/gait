# Spec — reviewer.ts

## Responsibility

The reviewer calls the *other* agent's API with a hardcoded adversarial prompt to produce a `ReviewerAnalysis`. This runs in parallel with showing the decision UI.

**Critical constraint:** The system prompt is hardcoded in source. It cannot be overridden by config, by the user, or by any agent. This is intentional — an agent must not be able to generate a permissive review prompt for itself.

## Types

```typescript
export interface ReviewerAnalysis {
  reviewerAgent: "claude" | "codex"
  reviewerModel: string
  understoodIntent: string      // what the reviewer thinks the human wanted
  actualAction: string          // what the agent actually did
  divergences: string[]         // list of specific divergences found
  risks: string[]               // list of risks, esp. in production context
  recommendation: "accept" | "reject" | "modify"
  suggestion?: string           // if recommendation === "modify": what to change
  confidence: "low" | "medium" | "high"
  durationMs: number
}

export interface ReviewerConfig {
  claudeApiKeyEnv: string
  codexApiKeyEnv: string
  timeoutMs: number
}
```

## Reviewer selection

```typescript
function selectReviewer(agentUnderReview: "claude" | "codex"): "claude" | "codex" {
  // Cross-review: Claude reviews Codex, Codex reviews Claude
  return agentUnderReview === "claude" ? "codex" : "claude"
}
```

If the reviewer agent's API key is not available (env var not set):
- Fall back to the same agent reviewing itself
- Log a warning: `"[hitlgate] Reviewer: OPENAI_API_KEY not set, Claude will self-review"`
- If neither API key is available: skip review entirely, return null

## Hardcoded system prompt

```typescript
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
- Never recommend accepting if a production file was modified unexpectedly`
```

## User prompt template

```typescript
function buildUserPrompt(
  action: PendingAction,
  points: DecisionPoint[],
  isProd: boolean
): string {
  return `USER REQUEST: ${action.session_context ?? "(not available)"}

AGENT (${action.agent}) STATED INTENT: ${action.intent ?? "(not stated)"}

FILES MODIFIED: ${action.files.join(', ')}
DETECTED ISSUES: ${points.join(', ') || "none"}
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
}`
}
```

## API call — Claude as reviewer

```typescript
async function reviewWithClaude(
  prompt: string,
  apiKeyEnv: string,
  timeoutMs: number
): Promise<Omit<ReviewerAnalysis, 'reviewerAgent' | 'reviewerModel' | 'durationMs'>> {
  const apiKey = process.env[apiKeyEnv]
  if (!apiKey) throw new Error(`${apiKeyEnv} not set`)
  
  const client = new Anthropic({ apiKey })
  
  const response = await Promise.race([
    client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: ADVERSARIAL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }]
    }),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error("reviewer timeout")), timeoutMs)
    )
  ])
  
  const text = (response as any).content[0].text
  return JSON.parse(text.replace(/```json\n?|```/g, '').trim())
}
```

## API call — Codex as reviewer

```typescript
async function reviewWithCodex(
  prompt: string,
  apiKeyEnv: string,
  timeoutMs: number
): Promise<Omit<ReviewerAnalysis, 'reviewerAgent' | 'reviewerModel' | 'durationMs'>> {
  const apiKey = process.env[apiKeyEnv]
  if (!apiKey) throw new Error(`${apiKeyEnv} not set`)
  
  const client = new OpenAI({ apiKey })
  
  const response = await Promise.race([
    client.chat.completions.create({
      model: "codex-mini-latest",
      max_tokens: 400,
      messages: [
        { role: "system", content: ADVERSARIAL_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    }),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error("reviewer timeout")), timeoutMs)
    )
  ])
  
  return JSON.parse((response as any).choices[0].message.content)
}
```

## Public `review()` function

```typescript
export async function review(
  action: PendingAction,
  points: DecisionPoint[],
  config: HitlConfig
): Promise<ReviewerAnalysis | null> {
  const start = Date.now()
  const reviewerAgent = selectReviewer(action.agent)
  const isProd = points.includes("prod_file")
  const prompt = buildUserPrompt(action, points, isProd)
  
  try {
    let result
    if (reviewerAgent === "claude") {
      result = await reviewWithClaude(
        prompt, 
        config.reviewer.claude_api_key_env,
        config.reviewer.timeout_ms
      )
    } else {
      result = await reviewWithCodex(
        prompt,
        config.reviewer.codex_api_key_env, 
        config.reviewer.timeout_ms
      )
    }
    
    return {
      ...result,
      reviewerAgent,
      reviewerModel: reviewerAgent === "claude" ? "claude-haiku-4-5-20251001" : "codex-mini-latest",
      durationMs: Date.now() - start
    }
  } catch (err) {
    // Never throw — reviewer failure is non-fatal
    console.warn(`[hitlgate] Reviewer failed: ${err}`)
    return null
  }
}
```

## Tests

Mock both API clients. Test:
- Claude reviewing Codex action
- Codex reviewing Claude action  
- Fallback when API key missing (self-review)
- Timeout handling (returns null, does not throw)
- JSON parse failure handling (malformed response → returns null)
- Adversarial recommendation in response (recommendation: "reject")
