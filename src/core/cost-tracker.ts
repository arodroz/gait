import * as fs from "fs";
import * as path from "path";

export interface SessionCost {
  timestamp: string;
  agentKind: string;
  prompt: string;
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number;
  duration: number;
}

export interface CostSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  sessions: number;
  budgetUsedPct: number;
  overBudget: boolean;
}

const COST_FILE = "costs.json";

// Rough pricing per 1k tokens (as of 2025)
const PRICING: Record<string, { input: number; output: number }> = {
  claude: { input: 0.003, output: 0.015 },   // Claude Sonnet-level
  codex: { input: 0.003, output: 0.012 },
};

export class CostTracker {
  private sessions: SessionCost[] = [];
  private filePath: string;

  constructor(gaitDir: string) {
    this.filePath = path.join(gaitDir, COST_FILE);
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      this.sessions = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
    } catch { /* corrupt file */ }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.sessions, null, 2));
  }

  /** Record a completed agent session */
  record(agentKind: string, prompt: string, tokensIn: number, tokensOut: number, duration: number): SessionCost {
    const pricing = PRICING[agentKind] ?? PRICING.claude;
    const cost = (tokensIn / 1000) * pricing.input + (tokensOut / 1000) * pricing.output;

    const session: SessionCost = {
      timestamp: new Date().toISOString(),
      agentKind,
      prompt: prompt.slice(0, 100),
      tokensIn,
      tokensOut,
      estimatedCost: Math.round(cost * 10000) / 10000,
      duration,
    };

    this.sessions.push(session);
    this.save();
    return session;
  }

  /** Estimate cost from output lines (rough: 20 tokens/line out, 500 tokens prompt in) */
  estimateFromLines(agentKind: string, prompt: string, outputLines: number, duration: number): SessionCost {
    const tokensIn = Math.max(prompt.length / 4, 500);
    const tokensOut = outputLines * 20;
    return this.record(agentKind, prompt, tokensIn, tokensOut, duration);
  }

  /** Get cost summary with budget check */
  summary(dailyBudget: number = 0): CostSummary {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStr = now.toISOString().slice(0, 7);

    let today = 0, thisWeek = 0, thisMonth = 0;

    for (const s of this.sessions) {
      const d = s.timestamp.slice(0, 10);
      const m = s.timestamp.slice(0, 7);
      if (d === todayStr) today += s.estimatedCost;
      if (new Date(s.timestamp) >= weekStart) thisWeek += s.estimatedCost;
      if (m === monthStr) thisMonth += s.estimatedCost;
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const budgetUsedPct = dailyBudget > 0 ? Math.round((today / dailyBudget) * 100) : 0;

    return {
      today: round(today),
      thisWeek: round(thisWeek),
      thisMonth: round(thisMonth),
      sessions: this.sessions.length,
      budgetUsedPct,
      overBudget: dailyBudget > 0 && today >= dailyBudget,
    };
  }

  /** Check if budget allows another session */
  canRun(dailyBudget: number): boolean {
    if (dailyBudget <= 0) return true;
    return this.summary(dailyBudget).today < dailyBudget;
  }
}
