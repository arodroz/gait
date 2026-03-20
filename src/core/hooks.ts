import * as fs from "fs";
import * as path from "path";

const PRE_COMMIT_HOOK = `#!/bin/sh
# Installed by gait — runs quality gate before every commit
# To bypass: git commit --no-verify
echo "[gait] Running quality gate..."
# Signal VS Code extension to run gate via a marker file
GAIT_DIR="$(git rev-parse --show-toplevel)/.gait"
echo "gate" > "$GAIT_DIR/.hook-trigger"
# Wait for result (max 5 minutes)
TIMEOUT=300
ELAPSED=0
while [ ! -f "$GAIT_DIR/.hook-result" ] && [ $ELAPSED -lt $TIMEOUT ]; do
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done
if [ -f "$GAIT_DIR/.hook-result" ]; then
  RESULT=$(cat "$GAIT_DIR/.hook-result")
  rm -f "$GAIT_DIR/.hook-result" "$GAIT_DIR/.hook-trigger"
  if [ "$RESULT" = "pass" ]; then
    echo "[gait] Gate passed"
    exit 0
  else
    echo "[gait] Gate FAILED — commit blocked"
    exit 1
  fi
else
  rm -f "$GAIT_DIR/.hook-trigger"
  echo "[gait] Gate timed out — commit blocked"
  exit 1
fi
`;

export function installPreCommitHook(repoDir: string): { installed: boolean; message: string } {
  const hooksDir = path.join(repoDir, ".git", "hooks");
  if (!fs.existsSync(hooksDir)) {
    return { installed: false, message: ".git/hooks not found — is this a git repository?" };
  }

  const hookPath = path.join(hooksDir, "pre-commit");

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf-8");
    if (existing.includes("Installed by gait")) {
      return { installed: true, message: "Pre-commit hook already installed" };
    }
    return { installed: false, message: "Pre-commit hook already exists (not managed by gait). Back it up first." };
  }

  fs.writeFileSync(hookPath, PRE_COMMIT_HOOK, { mode: 0o755 });
  return { installed: true, message: "Pre-commit hook installed" };
}

export function uninstallPreCommitHook(repoDir: string): boolean {
  const hookPath = path.join(repoDir, ".git", "hooks", "pre-commit");
  if (!fs.existsSync(hookPath)) return false;
  const content = fs.readFileSync(hookPath, "utf-8");
  if (!content.includes("Installed by gait")) return false;
  fs.unlinkSync(hookPath);
  return true;
}

/** Check if the hook trigger file exists (set by pre-commit hook) */
export function checkHookTrigger(gaitDir: string): boolean {
  return fs.existsSync(path.join(gaitDir, ".hook-trigger"));
}

/** Write hook result so the pre-commit hook can read it */
export function writeHookResult(gaitDir: string, passed: boolean): void {
  fs.writeFileSync(path.join(gaitDir, ".hook-result"), passed ? "pass" : "fail");
  // Clean up trigger
  const triggerPath = path.join(gaitDir, ".hook-trigger");
  if (fs.existsSync(triggerPath)) fs.unlinkSync(triggerPath);
}
