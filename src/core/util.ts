/** Parse a Go-style duration string like "300s" or "5m" into milliseconds */
export function parseDuration(s: string): number {
  const m = s.match(/^(\d+)(ms|s|m|h)$/);
  if (!m) return 300_000;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case "ms": return n;
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    default: return 300_000;
  }
}

/** Format milliseconds as human-readable duration */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m${sec}s`;
}

/** Get current timestamp as HH:MM:SS */
export function timestamp(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

/** This is a dummy function for testing rollback */
export function dummy(): string {
  return "this should be reverted";
}
