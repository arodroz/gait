import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as config from "../core/config";
import * as prompts from "../core/prompts";
import * as workflow from "../core/workflow";
import * as memory from "../core/memory";
import { state } from "../state";
import { loadConfig } from "./helpers";

export async function cmdInit() {
  const projectName = path.basename(state.cwd);
  const alreadyInitialized = config.configExists(state.cwd);

  if (alreadyInitialized) {
    const action = await vscode.window.showQuickPick(
      [
        { label: "Re-initialize", description: "Overwrite config with fresh defaults (backs up existing)" },
        { label: "Cancel", description: "Do nothing" },
      ],
      { placeHolder: ".gait/ already exists. What would you like to do?" },
    );
    if (!action || action.label === "Cancel") return;
    const configPath = path.join(state.cwd, config.DOT_DIR, config.CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, configPath + ".backup." + Date.now());
      state.dashboard.addLog("Backed up config", "info");
    }
  }

  await doInit(projectName);
  vscode.commands.executeCommand("setContext", "gait.initialized", true);
  loadConfig();

  // Offer to install Claude Code hooks
  const install = await vscode.window.showInformationMessage(
    "Install Claude Code hooks? This lets HITL-Gate intercept agent actions.",
    "Install",
    "Later",
  );
  if (install === "Install") {
    await vscode.commands.executeCommand("gait.installClaudeHooks");
  }
}

async function doInit(projectName: string) {
  const gaitDirPath = path.join(state.cwd, config.DOT_DIR);

  // Create HITL data directories
  for (const sub of ["pending", "decisions", "diffs", "snapshots"]) {
    fs.mkdirSync(path.join(gaitDirPath, sub), { recursive: true });
  }

  // Write minimal config
  config.saveMinimal(state.cwd, projectName);

  // Update .gitignore inside .gait/
  const gitignorePath = path.join(gaitDirPath, ".gitignore");
  const gitignoreContent = [
    "pending/",
    "decisions/",
    "diffs/",
    "snapshots/",
    "actions.jsonl",
    "costs.json",
    "memory.json",
    ".lock",
  ].join("\n") + "\n";

  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, "utf-8");
    const toAdd = gitignoreContent.split("\n").filter((l) => l && !existing.includes(l));
    if (toAdd.length) fs.appendFileSync(gitignorePath, "\n" + toAdd.join("\n") + "\n");
  } else {
    fs.writeFileSync(gitignorePath, gitignoreContent);
  }

  // Create prompt templates and workflow defaults
  prompts.createDefaults(config.gaitDir(state.cwd));
  workflow.createDefaults(config.gaitDir(state.cwd));
  memory.createDefaults(config.gaitDir(state.cwd), state.cwd, config.load(state.cwd) as any);

  const stacks = config.detectStacks(state.cwd);
  const stackNames = stacks.join(", ") || "none detected";
  vscode.window.showInformationMessage(`HITL-Gate initialized! Stacks: ${stackNames}`);
}
