import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ActionLogger, type PendingAction, type DecisionResult, type ActionRecord, type ReviewerAnalysis } from "./action-logger";
import type { HitlConfig } from "./config";
import { evaluate, type EvaluationResult, DECISION_POINT_LABELS } from "./decision-points";
import { review } from "./reviewer";
import { diffFiles, showFile } from "./git";

/** Per-file diff info sent to the webview */
export interface FileDiffInfo {
  path: string;
  diff: string;
  originalContent?: string;
}

/**
 * Interceptor — watches .gait/pending/ for new action files,
 * evaluates decision points, shows the appropriate UI, and writes decisions.
 */
export class Interceptor {
  private watcher: vscode.FileSystemWatcher | undefined;
  private processing = new Set<string>();
  private pendingResolvers = new Map<string, (decision: DecisionResult) => void>();
  private webviewDecisionQueue: Promise<void> = Promise.resolve();
  private activeWebviewActionId: string | undefined;
  private webviewQueue: WebviewPendingData[] = [];

  constructor(
    private readonly workspaceRoot: string,
    private readonly gaitDir: string,
    private readonly config: HitlConfig,
    private readonly logger: ActionLogger,
    private readonly onDecisionCallback?: (action: PendingAction, result: DecisionResult, evaluation: EvaluationResult) => void,
    private readonly onShowInWebview?: (pendingData: WebviewPendingData) => void,
    private readonly onQueueChange?: (queue: WebviewPendingData[]) => void,
  ) {}

  /** Called from extension.ts when the webview sends a decision back */
  resolveWebviewDecision(id: string, decision: "accept" | "reject" | "edit", note?: string): void {
    const resolver = this.pendingResolvers.get(id);
    if (resolver) {
      if (this.activeWebviewActionId === id) {
        this.activeWebviewActionId = undefined;
      }
      resolver({ id, decision, note, ts: new Date().toISOString() });
      this.pendingResolvers.delete(id);
    }
  }

  start(): vscode.Disposable {
    const pendingDir = path.join(this.gaitDir, "pending");
    fs.mkdirSync(pendingDir, { recursive: true });

    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(pendingDir, "*.json"),
    );

    this.watcher.onDidCreate((uri) => this.onPendingFile(uri));

    return this.watcher;
  }

  private async onPendingFile(uri: vscode.Uri): Promise<void> {
    const filename = path.basename(uri.fsPath);
    if (this.processing.has(filename)) return;
    this.processing.add(filename);

    try {
      const action = await this.readPendingAction(uri.fsPath);
      if (!action) return;

      const { decision, evaluation } = await this.processAction(action);
      await this.writeDecision(decision);
      await this.logAction(action, decision, evaluation);
      this.onDecisionCallback?.(action, decision, evaluation);
    } catch (err) {
      // SECURITY: Never auto-accept on error — reject and surface the failure.
      const id = filename.replace(".json", "");
      const fallback: DecisionResult = {
        id,
        decision: "reject",
        note: `interceptor error — action rejected for safety: ${err}`,
        ts: new Date().toISOString(),
      };
      await this.writeDecision(fallback).catch(() => {});
      console.error(`[hitlgate] Interceptor error processing ${filename}:`, err);
    } finally {
      this.processing.delete(filename);
    }
  }

  private async readPendingAction(filePath: string): Promise<PendingAction | null> {
    // Retry loop to handle partially-written files
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * attempt));
        const raw = await fs.promises.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        // Validate required fields
        if (
          typeof parsed.id !== "string" ||
          (parsed.agent !== "claude" && parsed.agent !== "codex") ||
          typeof parsed.tool !== "string" ||
          !Array.isArray(parsed.files) ||
          typeof parsed.ts !== "string"
        ) {
          console.warn(`[hitlgate] Invalid pending action schema: ${filePath}`);
          return null;
        }
        return parsed as PendingAction;
      } catch {
        if (attempt === 2) return null;
      }
    }
    return null;
  }

  async processAction(action: PendingAction): Promise<{ decision: DecisionResult; evaluation: EvaluationResult }> {
    const recentActions = await this.logger.readRecent(200);
    const evaluation = await evaluate(action, this.config, recentActions);

    // Capture diffs for the affected files
    const fileDiffs = await this.captureFileDiffs(action.files);
    // Preserve bridge-captured diffs for pre-approval flows when git diff is still empty.
    const combinedDiff = fileDiffs.map((f) => f.diff).filter(Boolean).join("\n");
    if (combinedDiff) {
      action.diff_preview = combinedDiff;
    }

    // Fire reviewer in parallel for medium/high severity (non-blocking)
    let reviewerPromise: Promise<ReviewerAnalysis | null> | null = null;
    if (evaluation.requires_cross_review) {
      reviewerPromise = review(action, evaluation.points, this.config);
    }

    let decision: DecisionResult;
    const useWebview = evaluation.presentation === "panel" || evaluation.presentation === "modal";

    if (useWebview && this.onShowInWebview) {
      decision = await this.enqueueWebviewDecision(action, evaluation, fileDiffs, reviewerPromise);
    } else {
      switch (evaluation.presentation) {
        case "notification":
          decision = await this.showNotificationDecision(action, evaluation);
          break;
        case "panel":
          decision = await this.showPanelDecision(action, evaluation);
          break;
        case "modal":
          decision = await this.showModalDecision(action, evaluation, reviewerPromise);
          break;
        default:
          decision = { id: action.id, decision: "accept", ts: new Date().toISOString() };
      }
    }

    // If reviewer was in flight and human already decided, capture the result for logging
    if (reviewerPromise) {
      const reviewResult = await reviewerPromise.catch(() => null);
      if (reviewResult) {
        decision.reviewer_analysis = reviewResult;
      }
    }

    return { decision, evaluation };
  }

  private async showNotificationDecision(
    action: PendingAction,
    _evaluation: EvaluationResult,
  ): Promise<DecisionResult> {
    const filesLabel = action.files.slice(0, 2).join(", ") +
      (action.files.length > 2 ? ` +${action.files.length - 2}` : "");
    const label = `[${action.agent}] ${action.intent || action.tool} — ${filesLabel}`;

    // In prod mode, never auto-accept
    if (this.config.project.mode === "prod") {
      const choice = await vscode.window.showInformationMessage(label, "Accept", "Reject");
      return {
        id: action.id,
        decision: choice === "Accept" ? "accept" : "reject",
        ts: new Date().toISOString(),
      };
    }

    if (!this.config.interception.auto_accept_low) {
      const choice = await vscode.window.showInformationMessage(label, "Accept", "Reject");
      return {
        id: action.id,
        decision: choice === "Accept" ? "accept" : "reject",
        ts: new Date().toISOString(),
      };
    }

    // Auto-accept with timeout
    const notifPromise = vscode.window.showInformationMessage(label, "View", "Reject");
    const autoAcceptPromise = new Promise<"auto_accept">((resolve) => {
      setTimeout(() => resolve("auto_accept"), this.config.interception.auto_accept_timeout_ms);
    });

    const result = await Promise.race([notifPromise, autoAcceptPromise]);

    if (result === "Reject") {
      return { id: action.id, decision: "reject", ts: new Date().toISOString() };
    }

    return {
      id: action.id,
      decision: "accept",
      note: result === "auto_accept" ? "auto-accepted (low severity, timeout)" : undefined,
      ts: new Date().toISOString(),
    };
  }

  private async showPanelDecision(
    action: PendingAction,
    evaluation: EvaluationResult,
  ): Promise<DecisionResult> {
    const pointsDesc = evaluation.points
      .map((p) => `• ${DECISION_POINT_LABELS[p]}`)
      .join("\n");

    const filesLabel = action.files.join(", ");
    const message = [
      `${action.agent === "claude" ? "Claude" : "Codex"} — ${action.intent || action.tool}`,
      `Files: ${filesLabel}`,
      `Severity: ${evaluation.severity.toUpperCase()}`,
      pointsDesc ? `\nFlags:\n${pointsDesc}` : "",
    ].filter(Boolean).join("\n");

    const choice = await vscode.window.showWarningMessage(
      message,
      "Accept",
      "Reject",
      "Reject with Note",
    );

    if (choice === "Reject with Note") {
      const note = await vscode.window.showInputBox({
        prompt: "Add a note for the agent",
        placeHolder: "Scope changes to new route only",
      });
      return { id: action.id, decision: "reject", note, ts: new Date().toISOString() };
    }

    return {
      id: action.id,
      decision: choice === "Accept" ? "accept" : "reject",
      ts: new Date().toISOString(),
    };
  }

  private async showModalDecision(
    action: PendingAction,
    evaluation: EvaluationResult,
    reviewerPromise?: Promise<ReviewerAnalysis | null> | null,
  ): Promise<DecisionResult> {
    // Wait briefly for reviewer (max 3s for modal — user is waiting)
    let reviewerSummary = "";
    if (reviewerPromise) {
      const reviewResult = await Promise.race([
        reviewerPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]).catch(() => null);
      if (reviewResult) {
        reviewerSummary = `\n\nReviewer (${reviewResult.reviewerAgent}): ${reviewResult.recommendation.toUpperCase()}` +
          (reviewResult.divergences.length > 0 ? ` — ${reviewResult.divergences[0]}` : "");
      }
    }

    const pointsDesc = evaluation.points
      .map((p) => `• ${DECISION_POINT_LABELS[p]}`)
      .join("\n");

    const message = [
      `⚠️ High-severity action`,
      `${action.agent === "claude" ? "Claude" : "Codex"} wants to modify: ${action.files.join(", ")}`,
      `Intent: ${action.intent || "(not stated)"}`,
      pointsDesc ? `\nFlags:\n${pointsDesc}` : "",
      reviewerSummary,
    ].filter(Boolean).join("\n");

    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      "Accept",
      "Reject",
    );

    return {
      id: action.id,
      decision: choice === "Accept" ? "accept" : "reject",
      ts: new Date().toISOString(),
    };
  }

  private async writeDecision(decision: DecisionResult): Promise<void> {
    const decisionsDir = path.join(this.gaitDir, "decisions");
    await fs.promises.mkdir(decisionsDir, { recursive: true });
    const filePath = path.join(decisionsDir, `${decision.id}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(decision, null, 2));
  }

  private async logAction(
    action: PendingAction,
    decision: DecisionResult,
    evaluation: EvaluationResult,
  ): Promise<void> {
    const record: ActionRecord = {
      id: action.id,
      ts: action.ts,
      agent: action.agent,
      session_id: action.session_id,
      tool: action.tool,
      files: action.files,
      intent: action.intent,
      decision_points: evaluation.points.map((p) => ({
        type: p,
        description: evaluation.explanations[p] ?? DECISION_POINT_LABELS[p],
      })),
      severity: evaluation.severity,
      human_decision: decision.note?.startsWith("auto-accepted")
        ? "auto_accept"
        : decision.decision === "edit" ? "edit"
        : decision.decision === "accept" ? "accept" : "reject",
      human_note: decision.note,
      reviewer_agent: decision.reviewer_analysis?.reviewerAgent,
      reviewer_analysis: decision.reviewer_analysis,
      duration_ms: Date.now() - new Date(action.ts).getTime(),
    };

    // Store diff for future reference
    if (action.diff_preview) {
      record.diff_ref = await this.logger.storeDiff(action.id, action.diff_preview);
    }

    await this.logger.append(record);
  }

  private async captureFileDiffs(files: string[]): Promise<FileDiffInfo[]> {
    const results: FileDiffInfo[] = [];
    for (const file of files) {
      try {
        const fileDiff = await diffFiles(this.workspaceRoot, [file]);
        const original = await showFile(this.workspaceRoot, file);
        results.push({ path: file, diff: fileDiff, originalContent: original || undefined });
      } catch {
        results.push({ path: file, diff: "" });
      }
    }
    return results;
  }

  private async showWebviewDecision(
    actionId: string,
    pendingData: WebviewPendingData,
    reviewerPromise?: Promise<ReviewerAnalysis | null> | null,
  ): Promise<DecisionResult> {
    // Push to webview
    this.activeWebviewActionId = actionId;
    this.onShowInWebview!(pendingData);

    // Start reviewer in background and update webview when done
    if (reviewerPromise) {
      reviewerPromise.then((result) => {
        this.updateQueuedPendingData(actionId, {
          reviewerAnalysis: result ?? undefined,
          reviewerLoading: false,
        });
        if (this.activeWebviewActionId !== actionId) return;
        this.onShowInWebview!(this.getQueuedPendingData(actionId) ?? pendingData);
      }).catch(() => {
        this.updateQueuedPendingData(actionId, { reviewerLoading: false });
        if (this.activeWebviewActionId !== actionId) return;
        this.onShowInWebview!(this.getQueuedPendingData(actionId) ?? pendingData);
      });
    }

    // Wait for human decision from webview
    return new Promise<DecisionResult>((resolve) => {
      this.pendingResolvers.set(actionId, resolve);
    });
  }

  private async enqueueWebviewDecision(
    action: PendingAction,
    evaluation: EvaluationResult,
    fileDiffs: FileDiffInfo[],
    reviewerPromise?: Promise<ReviewerAnalysis | null> | null,
  ): Promise<DecisionResult> {
    const pendingData = this.createPendingData(action, evaluation, fileDiffs, !!reviewerPromise);
    this.pushWebviewQueueItem(pendingData);
    let releaseQueue: (() => void) | undefined;
    const prior = this.webviewDecisionQueue;
    this.webviewDecisionQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await prior.catch(() => {});
    try {
      return await this.showWebviewDecision(action.id, pendingData, reviewerPromise);
    } finally {
      this.removeWebviewQueueItem(action.id);
      releaseQueue?.();
    }
  }

  private createPendingData(
    action: PendingAction,
    evaluation: EvaluationResult,
    fileDiffs: FileDiffInfo[],
    reviewerLoading: boolean,
  ): WebviewPendingData {
    return {
      action: {
        id: action.id,
        agent: action.agent,
        tool: action.tool,
        files: action.files,
        intent: action.intent,
        diff_preview: action.diff_preview,
        session_context: action.session_context,
      },
      evaluation: {
        points: evaluation.points,
        severity: evaluation.severity,
        explanations: evaluation.explanations,
      },
      fileDiffs: fileDiffs.map((f) => ({
        path: f.path,
        diff: f.diff,
        originalContent: f.originalContent,
      })),
      reviewerAnalysis: null,
      reviewerLoading,
    };
  }

  private pushWebviewQueueItem(pendingData: WebviewPendingData): void {
    this.webviewQueue.push(pendingData);
    this.onQueueChange?.([...this.webviewQueue]);
  }

  private removeWebviewQueueItem(actionId: string): void {
    this.webviewQueue = this.webviewQueue.filter((item) => item.action.id !== actionId);
    this.onQueueChange?.([...this.webviewQueue]);
  }

  private getQueuedPendingData(actionId: string): WebviewPendingData | undefined {
    return this.webviewQueue.find((item) => item.action.id === actionId);
  }

  private updateQueuedPendingData(actionId: string, partial: Partial<WebviewPendingData>): void {
    this.webviewQueue = this.webviewQueue.map((item) => (
      item.action.id === actionId ? { ...item, ...partial } : item
    ));
    this.onQueueChange?.([...this.webviewQueue]);
  }
}

/** Data structure sent to the webview for rich decision UI */
export interface WebviewPendingData {
  action: {
    id: string;
    agent: string;
    tool: string;
    files: string[];
    intent: string;
    diff_preview?: string;
    session_context?: string;
  };
  evaluation: {
    points: string[];
    severity: string;
    explanations: Record<string, string>;
  };
  fileDiffs: Array<{
    path: string;
    diff: string;
    originalContent?: string;
  }>;
  reviewerAnalysis?: ReviewerAnalysis | null;
  reviewerLoading?: boolean;
}
