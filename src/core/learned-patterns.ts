import type { ActionRecord } from "./action-logger";

export interface PatternSuggestion {
  pattern: string;
  reason: string;
  rejectionCount: number;
}

/**
 * Scan recent decisions for repeated rejection patterns.
 * If the same decision point was rejected 3+ times for similar file paths,
 * suggest adding those paths to `prod_paths` in config.
 */
export function detectLearnedPatterns(records: ActionRecord[]): PatternSuggestion[] {
  // Count rejections by file path prefix
  const rejectionsByPath = new Map<string, number>();

  for (const record of records) {
    if (record.human_decision !== "reject") continue;

    for (const file of record.files) {
      // Extract directory prefix (e.g., "src/api/" from "src/api/routes.ts")
      const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
      if (!dir) continue;

      const key = `${dir}**`;
      rejectionsByPath.set(key, (rejectionsByPath.get(key) ?? 0) + 1);
    }
  }

  const suggestions: PatternSuggestion[] = [];

  for (const [pattern, count] of rejectionsByPath) {
    if (count >= 3) {
      suggestions.push({
        pattern,
        reason: `Rejected ${count} times in recent history`,
        rejectionCount: count,
      });
    }
  }

  return suggestions.sort((a, b) => b.rejectionCount - a.rejectionCount);
}

/**
 * Format suggestions for display.
 */
export function formatSuggestions(suggestions: PatternSuggestion[]): string {
  if (suggestions.length === 0) return "";
  const lines = ["Consider adding these paths to [prod] paths in .gait/config.toml:"];
  for (const s of suggestions) {
    lines.push(`  "${s.pattern}" — ${s.reason}`);
  }
  return lines.join("\n");
}
