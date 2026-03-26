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


