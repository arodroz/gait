import type { Config, Stack } from "./config";

/** Generate AGENTS.md content from gait config */
export function generate(cfg: Config, stacks: Stack[]): string {
  let out = `# ${cfg.project.name} — Agent Instructions\n\n`;
  out += `## Build & Test\n\`\`\`bash\n`;

  for (const [stack, cmds] of Object.entries(cfg.stacks)) {
    if (cmds.Build) out += `# Build (${stack})\n${cmds.Build}\n\n`;
    if (cmds.Test) out += `# Test (${stack})\n${cmds.Test}\n\n`;
    if (cmds.Lint) out += `# Lint (${stack})\n${cmds.Lint}\n\n`;
    if (cmds.Typecheck) out += `# Typecheck (${stack})\n${cmds.Typecheck}\n\n`;
  }

  out += `\`\`\`\n\n`;
  out += `## Quality Gate\n`;
  out += `Pipeline stages: ${cfg.pipeline.stages.join(" → ")}\n`;
  out += `Timeout: ${cfg.pipeline.timeout}\n\n`;
  out += `Before committing, run the full pipeline to ensure nothing breaks.\n\n`;

  if (stacks.length) {
    out += `## Stacks\n`;
    out += stacks.map((s) => `- ${s}`).join("\n") + "\n\n";
  }

  out += `## Conventions\n`;
  out += `- Run the quality gate before every commit\n`;
  out += `- Use conventional commits (feat:, fix:, chore:, etc.)\n`;
  out += `- Do not commit secrets, API keys, or tokens\n`;

  return out;
}
