import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as config from "../core/config";
import * as scripts from "../core/scripts";
import * as prompts from "../core/prompts";
import * as workflow from "../core/workflow";
import * as memory from "../core/memory";
import { ensureLinterSetup } from "../core/linter-setup";
import { state } from "../state";
import { loadConfig } from "./helpers";

export async function cmdInit() {
  const stacks = config.detectStacks(state.cwd);
  const projectName = path.basename(state.cwd);
  const alreadyInitialized = config.configExists(state.cwd);

  if (alreadyInitialized) {
    const action = await vscode.window.showQuickPick(
      [
        { label: "Re-initialize", description: "Overwrite config with fresh defaults (backs up existing)" },
        { label: "Merge", description: "Keep existing config, add missing stacks and scripts only" },
        { label: "Cancel", description: "Do nothing" },
      ],
      { placeHolder: ".gait/ already exists. What would you like to do?" },
    );
    if (!action || action.label === "Cancel") return;
    if (action.label === "Re-initialize") {
      const configPath = path.join(state.cwd, config.DOT_DIR, config.CONFIG_FILE);
      if (fs.existsSync(configPath)) {
        fs.copyFileSync(configPath, configPath + ".backup." + Date.now());
        state.dashboard.addLog("Backed up config", "info");
      }
      await doFullInit(stacks, projectName);
    } else {
      await doMergeInit(stacks);
    }
  } else {
    await doFullInit(stacks, projectName);
  }

  vscode.commands.executeCommand("setContext", "gait.initialized", true);
  loadConfig();
}

async function doFullInit(stacks: config.Stack[], projectName: string) {
  const newCfg = config.defaultConfig(projectName, stacks);
  config.save(state.cwd, newCfg);

  const gitignorePath = path.join(state.cwd, config.DOT_DIR, ".gitignore");
  const gitignoreContent = "baseline_*.json\ncoverage.json\nflaky.json\nhistory/\n.hook-trigger\n.hook-result\n.lock\ncosts.json\nimpact-map.json\nsnapshots.json\nmemory.json\n";
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, "utf-8");
    const toAdd = gitignoreContent.split("\n").filter((l) => l && !existing.includes(l));
    if (toAdd.length) fs.appendFileSync(gitignorePath, "\n" + toAdd.join("\n") + "\n");
  } else {
    fs.mkdirSync(path.join(state.cwd, config.DOT_DIR), { recursive: true });
    fs.writeFileSync(gitignorePath, gitignoreContent);
  }

  const scriptsDir = path.join(state.cwd, config.DOT_DIR, config.SCRIPTS_DIR);
  fs.mkdirSync(scriptsDir, { recursive: true });
  const existing = fs.readdirSync(scriptsDir);
  for (const [stack, cmds] of Object.entries(newCfg.stacks)) {
    const write = (name: string, content: string) => { if (!existing.includes(name)) fs.writeFileSync(path.join(scriptsDir, name), content, { mode: 0o755 }); };
    if (cmds.Lint) write(`${stack}_lint.sh`, scripts.generateScript("lint", `Run ${stack} linter`, cmds.Lint));
    if (cmds.Test) write(`${stack}_test.sh`, scripts.generateScript("test", `Run ${stack} tests`, cmds.Test, ["lint"]));
    if (cmds.Typecheck) write(`${stack}_typecheck.sh`, scripts.generateScript("typecheck", `Run ${stack} type checker`, cmds.Typecheck));
    if (cmds.Build) write(`${stack}_build.sh`, scripts.generateScript("build", `Build ${stack} project`, cmds.Build));
  }

  prompts.createDefaults(config.gaitDir(state.cwd));
  workflow.createDefaults(config.gaitDir(state.cwd));
  memory.createDefaults(config.gaitDir(state.cwd), state.cwd, newCfg);

  const linterResult = await ensureLinterSetup(state.cwd, stacks);
  const msgs: string[] = [];
  if (linterResult.created.length) msgs.push(`Linter: ${linterResult.created.join(", ")}`);
  if (linterResult.installed.length) msgs.push(`Installed: ${linterResult.installed.join(", ")}`);

  const stackNames = stacks.join(", ") || "none detected";
  const details = msgs.length ? ` | ${msgs.join("; ")}` : "";
  vscode.window.showInformationMessage(`Gait initialized! Stacks: ${stackNames}${details}`);
}

async function doMergeInit(stacks: config.Stack[]) {
  const existing = config.load(state.cwd);
  let added = 0;
  for (const stack of stacks) {
    if (!existing.stacks[stack]) { existing.stacks[stack] = config.defaultCommands(stack); added++; }
  }
  if (added > 0) {
    config.save(state.cwd, existing);
    state.dashboard.addLog(`Merged ${added} new stack(s)`, "success");
  }

  const scriptsDir = path.join(state.cwd, config.DOT_DIR, config.SCRIPTS_DIR);
  fs.mkdirSync(scriptsDir, { recursive: true });
  const existingScripts = fs.readdirSync(scriptsDir);
  let scriptsAdded = 0;
  for (const [stack, cmds] of Object.entries(existing.stacks)) {
    const write = (name: string, content: string) => { if (!existingScripts.includes(name)) { fs.writeFileSync(path.join(scriptsDir, name), content, { mode: 0o755 }); scriptsAdded++; } };
    if (cmds.Lint) write(`${stack}_lint.sh`, scripts.generateScript("lint", `Run ${stack} linter`, cmds.Lint));
    if (cmds.Test) write(`${stack}_test.sh`, scripts.generateScript("test", `Run ${stack} tests`, cmds.Test, ["lint"]));
    if (cmds.Typecheck) write(`${stack}_typecheck.sh`, scripts.generateScript("typecheck", `Run ${stack} type checker`, cmds.Typecheck));
    if (cmds.Build) write(`${stack}_build.sh`, scripts.generateScript("build", `Build ${stack} project`, cmds.Build));
  }

  const newStacks = stacks.filter((s) => !existing.stacks[s]);
  if (newStacks.length) await ensureLinterSetup(state.cwd, newStacks);
  vscode.window.showInformationMessage(`Gait merge: ${added} stack(s), ${scriptsAdded} script(s)`);
}
