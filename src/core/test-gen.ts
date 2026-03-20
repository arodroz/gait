import { AgentRunner } from "./agent";
import { buildPromptPrefix } from "./memory";
import { run } from "./runner";
import * as fs from "fs";
import * as path from "path";

export interface TestGenResult {
  file: string;
  testFile: string;
  content: string;
  passed: boolean;
  error?: string;
}

/** Generate tests for uncovered functions in a file */
export async function generateTests(
  cwd: string,
  gaitDir: string,
  sourceFile: string,
  uncoveredFunctions: string[],
  testCmd: string,
  agentKind: "claude" | "codex" = "claude",
  onOutput?: (line: string) => void,
): Promise<TestGenResult> {
  const sourceContent = fs.readFileSync(path.join(cwd, sourceFile), "utf-8");
  const memory = buildPromptPrefix(gaitDir);

  // Find existing test patterns
  const testPatterns = findTestPatterns(cwd, sourceFile);

  const prompt = `Write tests for these untested functions in \`${sourceFile}\`:

${uncoveredFunctions.map((f) => `- \`${f}\``).join("\n")}

## Source file
\`\`\`
${sourceContent.slice(0, 5000)}
\`\`\`

${testPatterns ? `## Existing test patterns in this project\n\`\`\`\n${testPatterns}\n\`\`\`\n` : ""}
${memory ? `## Project Context\n${memory}\n` : ""}
## Rules
- Follow the EXACT same test framework and patterns used in this project
- Do not modify the source file
- Write thorough tests covering edge cases
- Output ONLY the test file content, no explanation`;

  const agent = new AgentRunner();
  const lines: string[] = [];

  agent.on("output", (line: string) => {
    lines.push(line);
    onOutput?.(line);
  });

  await new Promise<void>((resolve) => {
    agent.on("done", () => resolve());
    agent.on("error", () => resolve());
    agent.start(agentKind, prompt, cwd).catch(() => resolve());
  });

  // Extract code from agent output (between ``` markers or raw)
  const raw = lines.join("\n");
  const content = extractCode(raw);

  // Determine test file path
  const testFile = guessTestFile(sourceFile);
  const testPath = path.join(cwd, testFile);

  // Write test file
  const existingContent = fs.existsSync(testPath) ? fs.readFileSync(testPath, "utf-8") : "";
  if (existingContent) {
    // Append to existing test file
    fs.writeFileSync(testPath, existingContent + "\n\n" + content);
  } else {
    fs.writeFileSync(testPath, content);
  }

  // Verify tests pass
  const testResult = await run(testCmd, [], cwd, 120_000);
  const passed = testResult.exitCode === 0;

  if (!passed) {
    // Revert the test file
    if (existingContent) {
      fs.writeFileSync(testPath, existingContent);
    } else {
      fs.unlinkSync(testPath);
    }
  }

  return {
    file: sourceFile,
    testFile,
    content,
    passed,
    error: passed ? undefined : testResult.stderr.slice(0, 500),
  };
}

/** Find existing test file content for style reference */
function findTestPatterns(cwd: string, sourceFile: string): string {
  const testFile = guessTestFile(sourceFile);
  const testPath = path.join(cwd, testFile);
  if (fs.existsSync(testPath)) {
    const content = fs.readFileSync(testPath, "utf-8");
    return content.slice(0, 2000);
  }

  // Find any test file in the same directory
  const dir = path.dirname(path.join(cwd, sourceFile));
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter((f) => f.includes(".test.") || f.includes("_test.") || f.includes(".spec."));
  if (files.length > 0) {
    return fs.readFileSync(path.join(dir, files[0]), "utf-8").slice(0, 2000);
  }
  return "";
}

function guessTestFile(sourceFile: string): string {
  if (sourceFile.endsWith(".ts")) return sourceFile.replace(/\.ts$/, ".test.ts");
  if (sourceFile.endsWith(".py")) return sourceFile.replace(/\.py$/, "_test.py");
  if (sourceFile.endsWith(".go")) return sourceFile.replace(/\.go$/, "_test.go");
  return sourceFile + ".test";
}

function extractCode(output: string): string {
  // Try to find code between ``` markers
  const codeMatch = output.match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (codeMatch) return codeMatch[1].trim();

  // If no markers, filter out non-code lines
  return output
    .split("\n")
    .filter((l) => !l.startsWith("Here") && !l.startsWith("I ") && !l.startsWith("This"))
    .join("\n")
    .trim();
}
