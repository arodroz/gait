import * as fs from "fs";
import * as path from "path";

export type HookType = "pre-commit" | "pre-push" | "post-merge" | "post-checkout";

const HOOK_TEMPLATES: Record<HookType, string> = {
  "pre-commit": `#!/bin/sh
# Installed by gait — runs quality gate before every commit
GAIT_DIR="$(git rev-parse --show-toplevel)/.gait"
echo "[gait] Running commit gate..."
echo "gate" > "$GAIT_DIR/.hook-trigger"
TIMEOUT=300; ELAPSED=0
while [ ! -f "$GAIT_DIR/.hook-result" ] && [ $ELAPSED -lt $TIMEOUT ]; do sleep 1; ELAPSED=$((ELAPSED + 1)); done
if [ -f "$GAIT_DIR/.hook-result" ]; then
  RESULT=$(cat "$GAIT_DIR/.hook-result"); rm -f "$GAIT_DIR/.hook-result" "$GAIT_DIR/.hook-trigger"
  [ "$RESULT" = "pass" ] && exit 0 || { echo "[gait] Gate FAILED — commit blocked"; exit 1; }
else rm -f "$GAIT_DIR/.hook-trigger"; echo "[gait] Timed out"; exit 1; fi
`,

  "pre-push": `#!/bin/sh
# Installed by gait — runs full gate before push
GAIT_DIR="$(git rev-parse --show-toplevel)/.gait"
echo "[gait] Running pre-push gate..."
echo "push" > "$GAIT_DIR/.hook-trigger"
TIMEOUT=600; ELAPSED=0
while [ ! -f "$GAIT_DIR/.hook-result" ] && [ $ELAPSED -lt $TIMEOUT ]; do sleep 1; ELAPSED=$((ELAPSED + 1)); done
if [ -f "$GAIT_DIR/.hook-result" ]; then
  RESULT=$(cat "$GAIT_DIR/.hook-result"); rm -f "$GAIT_DIR/.hook-result" "$GAIT_DIR/.hook-trigger"
  [ "$RESULT" = "pass" ] && exit 0 || { echo "[gait] Push gate FAILED"; exit 1; }
else rm -f "$GAIT_DIR/.hook-trigger"; echo "[gait] Timed out"; exit 1; fi
`,

  "post-merge": `#!/bin/sh
# Installed by gait — verifies merge integrity
GAIT_DIR="$(git rev-parse --show-toplevel)/.gait"
echo "[gait] Running post-merge verification..."
echo "merge" > "$GAIT_DIR/.hook-trigger"
# Post-merge is advisory — don't block
sleep 2
`,

  "post-checkout": `#!/bin/sh
# Installed by gait — refreshes state for new branch
GAIT_DIR="$(git rev-parse --show-toplevel)/.gait"
# Only trigger on branch checkout (flag=1), not file checkout (flag=0)
if [ "$3" = "1" ]; then
  echo "[gait] Branch changed — refreshing..."
  echo "checkout" > "$GAIT_DIR/.hook-trigger"
fi
`,
};

const GAIT_MARKER = "Installed by gait";

/** Install a specific hook */
export function install(repoDir: string, hookType: HookType): { installed: boolean; message: string } {
  const hooksDir = path.join(repoDir, ".git", "hooks");
  if (!fs.existsSync(hooksDir)) {
    return { installed: false, message: ".git/hooks not found" };
  }

  const hookPath = path.join(hooksDir, hookType);
  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, "utf-8");
    if (content.includes(GAIT_MARKER)) return { installed: true, message: `${hookType} already installed` };
    return { installed: false, message: `${hookType} exists (not managed by gait)` };
  }

  fs.writeFileSync(hookPath, HOOK_TEMPLATES[hookType], { mode: 0o755 });
  return { installed: true, message: `${hookType} installed` };
}

/** Uninstall a specific hook */
export function uninstall(repoDir: string, hookType: HookType): boolean {
  const hookPath = path.join(repoDir, ".git", "hooks", hookType);
  if (!fs.existsSync(hookPath)) return false;
  const content = fs.readFileSync(hookPath, "utf-8");
  if (!content.includes(GAIT_MARKER)) return false;
  fs.unlinkSync(hookPath);
  return true;
}

/** Install all hooks */
export function installAll(repoDir: string): { results: { hook: HookType; installed: boolean; message: string }[] } {
  const hookTypes: HookType[] = ["pre-commit", "pre-push", "post-merge", "post-checkout"];
  const results = hookTypes.map((hook) => ({ hook, ...install(repoDir, hook) }));
  return { results };
}

/** Check which hooks are installed */
export function status(repoDir: string): { hook: HookType; installed: boolean; managedByGait: boolean }[] {
  const hookTypes: HookType[] = ["pre-commit", "pre-push", "post-merge", "post-checkout"];
  return hookTypes.map((hook) => {
    const hookPath = path.join(repoDir, ".git", "hooks", hook);
    if (!fs.existsSync(hookPath)) return { hook, installed: false, managedByGait: false };
    const content = fs.readFileSync(hookPath, "utf-8");
    return { hook, installed: true, managedByGait: content.includes(GAIT_MARKER) };
  });
}
