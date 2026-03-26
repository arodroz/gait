import * as fs from "fs";
import * as path from "path";

const HITLGATE_TAG = "_hitlgate";

/**
 * Generate the hooks config object for .claude/settings.json.
 * The bridge path must be absolute.
 */
export function generateHooksConfig(bridgePath: string): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [
            {
              type: "command",
              command: `node "${bridgePath}"`,
              [HITLGATE_TAG]: true,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Install HITL-Gate hooks into .claude/settings.json.
 * Merges with existing settings — never removes non-HITL hooks.
 */
export async function installHooks(workspaceRoot: string, bridgePath: string): Promise<void> {
  const claudeDir = path.join(workspaceRoot, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  await fs.promises.mkdir(claudeDir, { recursive: true });

  // Read existing settings
  let existing: Record<string, any> = {};
  try {
    existing = JSON.parse(await fs.promises.readFile(settingsPath, "utf8"));
  } catch { /* no existing file — start fresh */ }

  const newConfig = generateHooksConfig(bridgePath);
  const merged = mergeHooksConfig(existing, newConfig);
  await fs.promises.writeFile(settingsPath, JSON.stringify(merged, null, 2));
}

/**
 * Check if HITL-Gate hooks are installed and point to the correct bridge path.
 */
export async function checkHooksInstalled(
  workspaceRoot: string,
  bridgePath: string,
): Promise<{ installed: boolean; stale: boolean }> {
  const settingsPath = path.join(workspaceRoot, ".claude", "settings.json");

  try {
    const raw = await fs.promises.readFile(settingsPath, "utf8");
    const settings = JSON.parse(raw);
    const preToolUse = settings?.hooks?.PreToolUse;

    if (!Array.isArray(preToolUse)) return { installed: false, stale: false };

    for (const entry of preToolUse) {
      const hooks = entry.hooks ?? [];
      for (const hook of hooks) {
        if (hook[HITLGATE_TAG]) {
          const installedPath = extractBridgePath(hook.command);
          if (installedPath === bridgePath) {
            return { installed: true, stale: false };
          }
          // Path exists in config but doesn't match current
          return { installed: true, stale: true };
        }
      }
    }

    return { installed: false, stale: false };
  } catch {
    return { installed: false, stale: false };
  }
}

/**
 * Remove HITL-Gate hooks from .claude/settings.json.
 */
export async function uninstallHooks(workspaceRoot: string): Promise<void> {
  const settingsPath = path.join(workspaceRoot, ".claude", "settings.json");

  try {
    const raw = await fs.promises.readFile(settingsPath, "utf8");
    const settings = JSON.parse(raw);

    if (settings?.hooks?.PreToolUse) {
      settings.hooks.PreToolUse = settings.hooks.PreToolUse
        .map((entry: any) => ({
          ...entry,
          hooks: (entry.hooks ?? []).filter((h: any) => !h[HITLGATE_TAG]),
        }))
        .filter((entry: any) => entry.hooks.length > 0);

      if (settings.hooks.PreToolUse.length === 0) {
        delete settings.hooks.PreToolUse;
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }

    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  } catch { /* no settings file to uninstall from */ }
}

// ── Helpers ──

function extractBridgePath(command: string): string {
  // command format: node "/path/to/hitlgate-bridge.js"
  const match = command.match(/node\s+"([^"]+)"/);
  return match?.[1] ?? "";
}

function mergeHooksConfig(
  existing: Record<string, any>,
  newConfig: Record<string, any>,
): Record<string, any> {
  const result = { ...existing };

  if (!result.hooks) result.hooks = {};
  if (!newConfig.hooks) return result;

  for (const [hookType, entries] of Object.entries(newConfig.hooks as Record<string, any[]>)) {
    if (!result.hooks[hookType]) {
      result.hooks[hookType] = entries;
      continue;
    }

    // Check if our hook already exists (tagged with _hitlgate)
    const existingEntries = result.hooks[hookType] as any[];
    let replaced = false;

    for (let i = 0; i < existingEntries.length; i++) {
      const hooks = existingEntries[i].hooks ?? [];
      const hasHitlgate = hooks.some((h: any) => h[HITLGATE_TAG]);
      if (hasHitlgate) {
        // Replace the whole entry
        existingEntries[i] = entries[0];
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      existingEntries.push(...entries);
    }
  }

  return result;
}
