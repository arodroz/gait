import * as fs from "fs";
import * as path from "path";
import { detectStacks } from "./config";

const CONTEXT_FILE = "context.md";
const MEMORY_FILE = "memory.json";

export interface Correction {
  date: string;
  error: string;
  fix: string;
  source: "autofix" | "user" | "review";
}

export interface Pattern {
  category: string;
  rule: string;
  source: "init" | "user" | "learned";
}

export interface Memory {
  corrections: Correction[];
  patterns: Pattern[];
  never: string[];
}

/** Load context.md as string */
export function loadContext(gaitDir: string): string {
  const p = path.join(gaitDir, CONTEXT_FILE);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf-8");
}

/** Load structured memory */
export function loadMemory(gaitDir: string): Memory {
  const p = path.join(gaitDir, MEMORY_FILE);
  if (!fs.existsSync(p)) return { corrections: [], patterns: [], never: [] };
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return { corrections: [], patterns: [], never: [] };
  }
}

/** Save structured memory */
export function saveMemory(gaitDir: string, mem: Memory): void {
  fs.writeFileSync(path.join(gaitDir, MEMORY_FILE), JSON.stringify(mem, null, 2));
}

/** Add a correction (agent fix failed or was rejected) */
export function addCorrection(gaitDir: string, error: string, fix: string, source: Correction["source"] = "autofix"): void {
  const mem = loadMemory(gaitDir);
  mem.corrections.push({ date: new Date().toISOString().slice(0, 10), error: error.slice(0, 200), fix: fix.slice(0, 200), source });
  // Keep last 50 corrections
  if (mem.corrections.length > 50) mem.corrections = mem.corrections.slice(-50);
  saveMemory(gaitDir, mem);
}

/** Add a positive pattern (agent fix succeeded) */
export function addPattern(gaitDir: string, category: string, rule: string, source: Pattern["source"] = "learned"): void {
  const mem = loadMemory(gaitDir);
  // Don't duplicate
  if (mem.patterns.some((p) => p.rule === rule)) return;
  mem.patterns.push({ category, rule, source });
  saveMemory(gaitDir, mem);
}

/** Build a prompt prefix from context + memory */
export function buildPromptPrefix(gaitDir: string, maxTokens = 2000): string {
  const context = loadContext(gaitDir);
  const mem = loadMemory(gaitDir);
  const parts: string[] = [];

  if (context) {
    // Rough truncation: ~4 chars per token
    const maxChars = maxTokens * 4;
    parts.push("## Project Context");
    parts.push(context.slice(0, maxChars));
  }

  if (mem.never.length > 0) {
    parts.push("\n## Rules (never violate)");
    for (const rule of mem.never) parts.push(`- ${rule}`);
  }

  if (mem.patterns.length > 0) {
    parts.push("\n## Coding Patterns");
    for (const p of mem.patterns.slice(-10)) parts.push(`- [${p.category}] ${p.rule}`);
  }

  if (mem.corrections.length > 0) {
    parts.push("\n## Recent Corrections (learn from these)");
    for (const c of mem.corrections.slice(-5)) {
      parts.push(`- Error: ${c.error} → Fix: ${c.fix}`);
    }
  }

  return parts.join("\n");
}

/** Generate starter context.md from project config */
export function generateStarterContext(cwd: string, cfg: { project: { name: string; mode?: string } }): string {
  const stacks = detectStacks(cwd);
  const lines: string[] = [];

  lines.push(`# ${cfg.project.name}`);
  lines.push("");
  lines.push(`## Stack: ${stacks.join(", ") || "unknown"}`);
  lines.push("");
  lines.push(`## Mode: ${cfg.project.mode ?? "dev"}`);
  lines.push("");

  lines.push("## Conventions");
  lines.push("- Use conventional commits (feat:, fix:, chore:)");
  lines.push("- All agent actions are intercepted and reviewed");
  lines.push("- Do not commit secrets or API keys");
  lines.push("");
  lines.push("<!-- Add project-specific context below -->");

  return lines.join("\n");
}

/** Create default context.md and empty memory.json */
export function createDefaults(gaitDir: string, cwd: string, cfg: { project: { name: string; mode?: string } }): void {
  const contextPath = path.join(gaitDir, CONTEXT_FILE);
  if (!fs.existsSync(contextPath)) {
    fs.writeFileSync(contextPath, generateStarterContext(cwd, cfg));
  }
  const memoryPath = path.join(gaitDir, MEMORY_FILE);
  if (!fs.existsSync(memoryPath)) {
    saveMemory(gaitDir, { corrections: [], patterns: [], never: [] });
  }
}

/** Format memory for display */
export function formatMemory(mem: Memory): string {
  const lines: string[] = [];
  lines.push(`Corrections: ${mem.corrections.length}`);
  lines.push(`Patterns: ${mem.patterns.length}`);
  lines.push(`Rules: ${mem.never.length}`);

  if (mem.never.length > 0) {
    lines.push("\nNever:");
    for (const r of mem.never) lines.push(`  - ${r}`);
  }
  if (mem.patterns.length > 0) {
    lines.push("\nPatterns:");
    for (const p of mem.patterns.slice(-10)) lines.push(`  [${p.category}] ${p.rule}`);
  }
  if (mem.corrections.length > 0) {
    lines.push("\nRecent corrections:");
    for (const c of mem.corrections.slice(-5)) lines.push(`  ${c.date}: ${c.error} → ${c.fix}`);
  }
  return lines.join("\n");
}
