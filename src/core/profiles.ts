export interface Profile {
  name: string;
  stages: string[];
  timeout: string;
}

/** Get a named profile — simplified for HITL-Gate (no pipeline profiles) */
export function getProfile(_cfg: unknown, name: string): Profile {
  switch (name) {
    case "quick":
      return { name: "quick", stages: [], timeout: "30s" };
    default:
      return { name: "default", stages: [], timeout: "300s" };
  }
}

/** List available profile names */
export function listProfiles(_cfg: unknown): string[] {
  return ["quick", "default"];
}
