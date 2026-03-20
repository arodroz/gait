import type { Config } from "./config";

export interface Profile {
  name: string;
  stages: string[];
  timeout: string;
}

/** Get a named profile from config, or build one from defaults */
export function getProfile(cfg: Config, name: string): Profile {
  const profiles = (cfg.pipeline as any).profiles as Record<string, { stages: string[]; timeout?: string }> | undefined;
  if (profiles?.[name]) {
    return {
      name,
      stages: profiles[name].stages,
      timeout: profiles[name].timeout ?? cfg.pipeline.timeout,
    };
  }

  // Built-in profiles
  switch (name) {
    case "quick":
      return { name: "quick", stages: ["lint"], timeout: "30s" };
    case "full":
      return { name: "full", stages: [...cfg.pipeline.stages], timeout: cfg.pipeline.timeout };
    default:
      return { name: "default", stages: [...cfg.pipeline.stages], timeout: cfg.pipeline.timeout };
  }
}

/** List available profile names */
export function listProfiles(cfg: Config): string[] {
  const names = ["quick", "full"];
  const custom = (cfg.pipeline as any).profiles as Record<string, unknown> | undefined;
  if (custom) {
    for (const k of Object.keys(custom)) {
      if (!names.includes(k)) names.push(k);
    }
  }
  return names;
}

/** Apply a profile to a config, returning a modified copy */
export function applyProfile(cfg: Config, profile: Profile): Config {
  return {
    ...cfg,
    pipeline: {
      ...cfg.pipeline,
      stages: profile.stages,
      timeout: profile.timeout,
    },
  };
}
