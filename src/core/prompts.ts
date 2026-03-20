import * as fs from "fs";
import * as path from "path";

export interface PromptTemplate {
  name: string;
  description: string;
  variables: string[];
  body: string;
  path: string;
}

const PROMPTS_DIR = "prompts";

/** Parse a prompt template file with YAML-like frontmatter */
export function parseTemplate(filePath: string): PromptTemplate {
  const content = fs.readFileSync(filePath, "utf-8");
  const template: PromptTemplate = {
    name: path.basename(filePath, ".md"),
    description: "",
    variables: [],
    body: content,
    path: filePath,
  };

  // Parse frontmatter between --- markers
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    const fm = fmMatch[1];
    template.body = fmMatch[2].trim();

    for (const line of fm.split("\n")) {
      const [key, ...rest] = line.split(":");
      const val = rest.join(":").trim();
      switch (key.trim()) {
        case "name": template.name = val; break;
        case "description": template.description = val; break;
        case "variables":
          template.variables = val.replace(/[\[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
          break;
      }
    }
  }

  return template;
}

/** List all templates in .gait/prompts/ */
export function listTemplates(gaitDir: string): PromptTemplate[] {
  const dir = path.join(gaitDir, PROMPTS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseTemplate(path.join(dir, f)));
}

/** Interpolate variables into a template body */
export function interpolate(body: string, vars: Record<string, string>): string {
  let result = body;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

/** Create default prompt templates */
export function createDefaults(gaitDir: string): void {
  const dir = path.join(gaitDir, PROMPTS_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const defaults: Record<string, string> = {
    "fix-lint.md": `---
name: fix-lint
description: Fix linting errors
variables: [error, file, command]
---
The lint command \`{{command}}\` failed.

## Error
\`\`\`
{{error}}
\`\`\`

Fix ONLY the lint error. Do not refactor unrelated code. Make the minimal change needed.`,

    "fix-test.md": `---
name: fix-test
description: Fix failing tests
variables: [error, file, command]
---
The test command \`{{command}}\` failed.

## Error
\`\`\`
{{error}}
\`\`\`

Fix the failing test. Do not modify other tests. Do not change behavior — fix the test or the code it tests.`,

    "add-tests.md": `---
name: add-tests
description: Add tests for uncovered code
variables: [file, functions]
---
The following functions in \`{{file}}\` lack test coverage:

{{functions}}

Write tests for these functions. Follow existing test patterns in the project. Use the same test framework.`,

    "refactor.md": `---
name: refactor
description: Refactor code for clarity
variables: [file, instruction]
---
Refactor \`{{file}}\`:

{{instruction}}

Keep all existing behavior. Do not change public APIs. Run existing tests to verify nothing breaks.`,
  };

  for (const [filename, content] of Object.entries(defaults)) {
    const p = path.join(dir, filename);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, content);
    }
  }
}
