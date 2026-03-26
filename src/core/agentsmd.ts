import type { HitlConfig, Stack } from "./config";
import type { ActionRecord } from "./action-logger";

/** Generate AGENTS.md content from HITL-Gate config and action history */
export function generate(cfg: HitlConfig, stacks: Stack[], recentActions?: ActionRecord[]): string {
  let out = `# ${cfg.project.name} — Agent Instructions\n\n`;
  out += `## HITL-Gate Active\n\n`;
  out += `This project uses HITL-Gate. All file modifications are intercepted, evaluated, and require human approval before taking effect.\n\n`;
  out += `## Mode: ${cfg.project.mode}\n\n`;

  if (cfg.project.mode === "prod") {
    out += `> **Production mode** — all agent actions require explicit human approval. No auto-accept.\n\n`;
  }

  if (cfg.prod.paths.length > 0) {
    out += `## Protected Paths\nThese paths trigger high-severity review and always require explicit approval:\n`;
    for (const p of cfg.prod.paths) out += `- \`${p}\`\n`;
    out += "\n";
  }

  if (stacks.length) {
    out += `## Stacks\n`;
    out += stacks.map((s) => `- ${s}`).join("\n") + "\n\n";
  }

  // Add rejection patterns from recent history
  if (recentActions && recentActions.length > 0) {
    const rejections = recentActions.filter((r) => r.human_decision === "reject");
    if (rejections.length > 0) {
      out += `## Known Rejection Patterns\n`;
      out += `The human has previously rejected these types of changes:\n`;

      const seen = new Set<string>();
      for (const r of rejections.slice(-10)) {
        const key = `${r.files.join(",")}:${r.intent.slice(0, 50)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out += `- ${r.files.join(", ")} — "${r.intent}"`;
        if (r.human_note) out += ` (note: ${r.human_note})`;
        out += "\n";
      }
      out += "\n";
    }
  }

  out += `## Conventions\n`;
  out += `- All actions are intercepted and evaluated before execution\n`;
  out += `- Modifying protected paths triggers high-severity review\n`;
  out += `- Keep changes focused and minimal to reduce review friction\n`;
  out += `- Use conventional commits (feat:, fix:, chore:, etc.)\n`;
  out += `- Do not commit secrets, API keys, or tokens\n`;

  return out;
}
