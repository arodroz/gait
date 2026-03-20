import * as vscode from "vscode";
import * as config from "../core/config";
import * as git from "../core/git";
import * as secrets from "../core/secrets";
import * as monorepo from "../core/monorepo";
import * as impact from "../core/impact";
import * as depAudit from "../core/dep-audit";
import * as memory from "../core/memory";
import { runPipeline, runStage, type StageName, type StageResult } from "../core/pipeline";
import { getProfile, applyProfile } from "../core/profiles";
import { BaselineStore } from "../core/baseline";
import { FlakyTracker } from "../core/flaky";
import { findUntested } from "../core/coverage";
import { parseTestOutput } from "../core/test-parser";
import { buildFixPrompt, runAutofixLoop } from "../core/autofix";
import { blameError, enhancePromptWithBlame } from "../core/blame";
import { reviewDiff, shouldBlock as reviewShouldBlock } from "../core/review";
import { state, cap } from "../state";
import { logHistory, sendNotify, getStageCommand, getOutputChannel } from "./helpers";

export async function cmdGate(): Promise<boolean> {
  const cfg = state.cfg;
  if (!cfg) { vscode.window.showWarningMessage("Run 'Gait: Initialize Project' first."); return false; }

  const stages = cfg.pipeline.stages as StageName[];
  state.statusBar.resetAll(stages);
  state.pipelineTree.reset(stages);
  state.dashboard.resetStages(stages);
  state.dashboard.addLog("Pipeline started", "info");

  // Secret scan
  try {
    const stagedDiff = await git.diff(state.cwd, true);
    if (stagedDiff) {
      const findings = secrets.scanDiff(stagedDiff);
      if (findings.length > 0) {
        state.dashboard.addLog(`Secrets detected: ${findings.length} finding(s)`, "error");
        vscode.window.showErrorMessage(`Gait: ${findings.length} potential secret(s) in staged changes`);
        logHistory("secret_scan", { findings: findings.length });
        return false;
      }
    }
  } catch { /* no staged changes */ }

  // Apply profile
  const profile = getProfile(cfg, state.currentProfile);
  let effectiveCfg = applyProfile(cfg, profile);
  if (state.currentProfile !== "default" && state.currentProfile !== "full") {
    state.dashboard.addLog(`Profile: ${state.currentProfile} (${profile.stages.join(" → ")})`, "info");
  }

  // Monorepo scoping
  const workspaces = monorepo.detect(state.cwd);
  if (workspaces.length > 1 && !cfg.pipeline.autofix) {
    const changedFiles = (await git.diffStat(state.cwd).catch(() => [])).map((s) => s.path);
    const affectedWs = monorepo.affected(workspaces, changedFiles);
    if (affectedWs.length > 0 && affectedWs.length < workspaces.length) {
      effectiveCfg = JSON.parse(JSON.stringify(effectiveCfg)) as config.Config;
      const scopedTest = affectedWs.map((ws) => monorepo.scopedTestCommand(ws, "")).filter(Boolean).join(" && ");
      const scopedLint = affectedWs.map((ws) => monorepo.scopedLintCommand(ws, "")).filter(Boolean).join(" && ");
      for (const stack of Object.values(effectiveCfg.stacks)) {
        if (scopedTest && stack.Test) stack.Test = scopedTest;
        if (scopedLint && stack.Lint) stack.Lint = scopedLint;
      }
      state.dashboard.addLog(`Scoped to ${affectedWs.length} workspace(s): ${affectedWs.map((w) => w.name).join(", ")}`, "info");
    }
  }

  // Run pipeline
  const result = await runPipeline(effectiveCfg, state.cwd, {
    onStageStart: (name) => {
      state.statusBar.setStageStatus(name, "running");
      state.pipelineTree.refresh([{ name, status: "running", output: "", error: "", duration: 0 }]);
      state.dashboard.updateStage({ name, status: "running", output: "", error: "", duration: 0 });
      state.dashboard.addLog(`${cap(name)} started...`, "info");
    },
    onStageComplete: (r) => {
      state.statusBar.setStageStatus(r.name, r.status, r.duration);
      state.pipelineTree.refresh([r]);
      state.dashboard.updateStage(r);
      const dur = (r.duration / 1000).toFixed(1);
      if (r.status === "passed") state.dashboard.addLog(`${cap(r.name)} passed (${dur}s)`, "success");
      else if (r.status === "failed") state.dashboard.addLog(`${cap(r.name)} FAILED (${dur}s)`, "error");
    },
  });

  // Special stages: audit + review
  if (result.passed && cfg) {
    if (cfg.pipeline.stages.includes("audit")) {
      state.dashboard.addLog("Running dependency audit...", "info");
      const auditResult = await depAudit.audit(state.cwd, Object.keys(cfg.stacks));
      const auditStage: StageResult = { name: "audit", status: "passed", output: "", error: "", duration: auditResult.duration };
      if (auditResult.findings.length > 0) {
        const blockSev = (cfg.pipeline as any)?.audit?.block_severity ?? "high";
        if (depAudit.shouldBlock(auditResult.findings, blockSev)) {
          auditStage.status = "failed";
          auditStage.error = depAudit.formatFindings(auditResult.findings);
          result.passed = false;
        }
        state.dashboard.addLog(`Audit: ${auditResult.findings.length} finding(s)`, auditStage.status === "failed" ? "error" : "warn");
      } else {
        state.dashboard.addLog(`Audit passed`, "success");
      }
      result.stages.push(auditStage);
    }

    if (cfg.pipeline.stages.includes("review")) {
      state.dashboard.addLog("Running AI code review...", "info");
      const diff = await git.diff(state.cwd, true).catch(() => "") || await git.diff(state.cwd, false).catch(() => "");
      if (diff) {
        const changedFiles = (await git.diffStat(state.cwd).catch(() => [])).map((s) => s.path);
        const reviewCfg = (cfg as any).review ?? {};
        const reviewResult = await reviewDiff(state.cwd, config.gaitDir(state.cwd), diff, changedFiles, reviewCfg.agent ?? "claude",
          (line) => state.dashboard.addLog(`[review] ${line}`, "info"));
        const reviewStage: StageResult = { name: "review", status: "passed", output: "", error: "", duration: reviewResult.duration };
        if (reviewResult.findings.length > 0) {
          const blockOn = reviewCfg.block_on ?? "error";
          if (reviewShouldBlock(reviewResult.findings, blockOn)) {
            reviewStage.status = "failed";
            reviewStage.error = reviewResult.findings.map((f) => `[${f.severity}] ${f.file}:${f.line} ${f.message}`).join("\n");
            result.passed = false;
          }
          state.dashboard.addLog(`Review: ${reviewResult.findings.length} finding(s)`, reviewStage.status === "failed" ? "error" : "warn");
        } else {
          state.dashboard.addLog(`Review passed`, "success");
        }
        result.stages.push(reviewStage);
      }
    }
  }

  state.lastPipelineResult = result;
  state.statusBar.setGateStatus(result.passed, result.duration);
  state.pipelineTree.setGateResult(result.passed, result.duration);
  state.dashboard.setPipelineResult(result);

  const dur = (result.duration / 1000).toFixed(1);
  if (result.passed) {
    state.dashboard.addLog(`Pipeline PASSED (${dur}s)`, "success");
    vscode.window.showInformationMessage(`Gait: Pipeline passed (${dur}s)`);
    sendNotify("gate.passed", `Pipeline passed (${dur}s)`, { stages: result.stages.length });
  } else {
    const failedStages = result.stages.filter((s) => s.status === "failed");
    const failed = failedStages.map((s) => s.name);
    state.dashboard.addLog(`Pipeline FAILED [${failed.join(", ")}] (${dur}s)`, "error");
    vscode.window.showErrorMessage(`Gait: Pipeline failed — ${failed.join(", ")}`);
    sendNotify("gate.failed", `Pipeline failed: ${failed.join(", ")} (${dur}s)`, { failed });

    // Autofix
    if (cfg?.pipeline.autofix && failedStages.length > 0) {
      const agentKind = (cfg.pipeline.autofix_agent ?? "claude") as import("../core/agent").AgentKind;
      const maxAttempts = cfg.pipeline.autofix_max_attempts ?? 3;
      const autoBlame = await blameError(state.cwd, failedStages[0].error + "\n" + failedStages[0].output);
      const autoBlameCtx = autoBlame ? enhancePromptWithBlame("", autoBlame) : undefined;
      state.dashboard.addLog(`Autofix enabled — ${agentKind} (max ${maxAttempts})`, "info");
      const fixed = await runAutofixLoop(
        failedStages[0], state.cwd, agentKind, maxAttempts, () => cmdGate(),
        {
          onAttemptStart: (n, max) => { state.dashboard.addLog(`Autofix ${n}/${max}...`, "info"); state.dashboard.updateState({ agentRunning: true, agentKind, agentPaused: false }); },
          onAttemptEnd: (r) => { state.dashboard.updateState({ agentRunning: false }); state.dashboard.addLog(r.success ? `Fixed on attempt ${r.attempt}` : `Attempt ${r.attempt} failed`, r.success ? "success" : "warn"); },
          onAgentOutput: (line) => state.dashboard.addLog(`[autofix] ${line}`, "info"),
          onGateStart: () => state.dashboard.addLog("Re-running gate...", "info"),
          onGateResult: (passed) => { if (passed) state.dashboard.addLog("Gate passed after autofix!", "success"); },
        },
        getStageCommand(failedStages[0].name as StageName), autoBlameCtx,
      );
      if (!fixed) { memory.addCorrection(config.gaitDir(state.cwd), failedStages[0].error.slice(0, 200), "Autofix failed", "autofix"); }
      if (fixed) return true;
    }
  }

  logHistory("pipeline_run", { passed: result.passed, duration: result.duration, stages: result.stages.map((s) => ({ name: s.name, status: s.status, duration: s.duration })) });

  // Regression detection
  try {
    const branchName = await git.branch(state.cwd).catch(() => "main");
    const gaitDirPath = config.gaitDir(state.cwd);
    const baselineStore = new BaselineStore(gaitDirPath);
    const flakyTracker = new FlakyTracker(gaitDirPath);
    const stack = cfg ? Object.keys(cfg.stacks)[0] ?? "" : "";
    const testStage = result.stages.find((s) => s.name === "test");
    if (testStage && testStage.status !== "skipped") {
      const currentResults = parseTestOutput(testStage.output + "\n" + testStage.error, stack);
      if (currentResults.length > 0) {
        const report = baselineStore.diff(currentResults, branchName);
        for (const t of currentResults) flakyTracker.update(`${t.package}/${t.name}`, t.passed);
        flakyTracker.save();
        const flakyList = flakyTracker.flakyTests();
        const regressions = report.regressions.map((r) => `${r.package}/${r.name}`).filter((name) => !flakyTracker.isFlaky(name));
        if (regressions.length > 0) {
          state.dashboard.addLog(`${regressions.length} regression(s)`, "error");
          state.dashboard.updateState({ regressions, flakyTests: flakyList });
          sendNotify("regression.detected", `${regressions.length} regression(s)`, { regressions: regressions.slice(0, 5) });
        } else {
          state.dashboard.updateState({ regressions: [], flakyTests: flakyList });
        }
        if (report.newTests.length > 0) state.dashboard.addLog(`${report.newTests.length} new test(s)`, "info");
        if (testStage.status === "passed") baselineStore.save({ branch: branchName, tests: currentResults, updatedAt: "" });
      }
    }
  } catch { /* best-effort */ }

  // Impact analysis
  try {
    const gaitDirPath = config.gaitDir(state.cwd);
    const impactMap = impact.load(gaitDirPath);
    const changedFiles = (await git.diffStat(state.cwd).catch(() => [])).map((s) => s.path);
    if (impactMap && changedFiles.length > 0) {
      const affected = impact.affectedTests(impactMap, changedFiles);
      if (affected.isScoped) state.dashboard.addLog(`Impact: ${affected.files.length} test file(s) affected`, "info");
    }
  } catch { /* best-effort */ }

  // Coverage detection
  try {
    const stagedFiles = await git.stagedFiles(state.cwd).catch(() => [] as string[]);
    const changedFiles = stagedFiles.length > 0 ? stagedFiles : (await git.diffStat(state.cwd)).map((s) => s.path);
    if (changedFiles.length > 0 && cfg) {
      const stack = Object.keys(cfg.stacks)[0] ?? "";
      state.dashboard.addLog(`Running coverage analysis...`, "info");
      state.dashboard.updateState({ coverageStatus: "running" });
      const covResult = await findUntested(state.cwd, changedFiles, stack);
      if (covResult.error) {
        state.dashboard.addLog(`Coverage: ${covResult.error}`, "warn");
        state.dashboard.updateState({ coverageStatus: "error", coverageError: covResult.error, coverage: [] });
      } else if (covResult.uncovered.length > 0) {
        state.dashboard.addLog(`${covResult.uncovered.length} untested function(s)`, "warn");
        state.dashboard.updateState({ coverageStatus: "done", coverage: covResult.uncovered, coverageError: undefined });
      } else {
        state.dashboard.addLog(`Coverage: all tested`, "success");
        state.dashboard.updateState({ coverageStatus: "done", coverage: [], coverageError: undefined });
      }
    }
  } catch (err) { state.dashboard.addLog(`Coverage failed: ${err}`, "warn"); }

  return result.passed;
}

export async function cmdRunStage(name: StageName) {
  const cfg = state.cfg;
  if (!cfg) { vscode.window.showWarningMessage("Run 'Gait: Initialize Project' first."); return; }
  const keyMap: Record<string, keyof config.StackCommands> = { lint: "Lint", test: "Test", typecheck: "Typecheck", build: "Build" };
  let cmd = "";
  for (const stack of Object.values(cfg.stacks)) { const key = keyMap[name]; if (key && stack[key]) { cmd = stack[key]; break; } }
  if (!cmd) { vscode.window.showWarningMessage(`No command for '${name}'`); return; }

  state.statusBar.setStageStatus(name, "running");
  state.dashboard.updateStage({ name, status: "running", output: "", error: "", duration: 0 });
  state.dashboard.addLog(`${cap(name)} started...`, "info");

  const result = await runStage(name, cmd, state.cwd, 300_000);
  state.statusBar.setStageStatus(name, result.status, result.duration);
  state.pipelineTree.refresh([result]);
  state.dashboard.updateStage(result);

  const dur = (result.duration / 1000).toFixed(1);
  if (result.status === "passed") { state.dashboard.addLog(`${cap(name)} passed (${dur}s)`, "success"); }
  else {
    state.dashboard.addLog(`${cap(name)} FAILED (${dur}s)`, "error");
    if (result.error) { const ch = getOutputChannel(`Gait: ${cap(name)}`); ch.clear(); ch.appendLine(result.error); if (result.output) ch.appendLine(result.output); ch.show(true); }
  }
}
