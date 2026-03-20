export interface SecretFinding {
  pattern: string;
  match: string;
  line: number;
  file: string;
}

const PATTERNS: [string, RegExp][] = [
  ["AWS Access Key", /AKIA[0-9A-Z]{16}/],
  ["AWS Secret Key", /(?:aws_secret_access_key)\s*=\s*\S+/i],
  ["Generic API Key", /(?:api[_-]?key|apikey)\s*[:=]\s*["']?\S{20,}/i],
  ["Generic Secret", /(?:secret|password|passwd|token)\s*[:=]\s*["']?\S{8,}/i],
  ["Private Key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub Token", /gh[ps]_[A-Za-z0-9_]{36,}/],
  ["Bearer Token", /(?:bearer|token)\s+[A-Za-z0-9\-._~+/]{20,}/i],
];

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function scanDiff(diffText: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  let currentFile = "";
  let lineNum = 0;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      lineNum = 0;
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    lineNum++;
    const added = line.slice(1);

    for (const [name, re] of PATTERNS) {
      const m = added.match(re);
      if (m) {
        findings.push({
          pattern: name,
          match: m[0].slice(0, 40),
          line: lineNum,
          file: currentFile,
        });
      }
    }

    // Entropy check
    for (const word of added.split(/\s+/)) {
      if (word.length >= 20 && word.length <= 200 && shannonEntropy(word) > 4.5) {
        const alreadyCaught = findings.some(
          (f) => f.line === lineNum && f.file === currentFile,
        );
        if (!alreadyCaught) {
          findings.push({
            pattern: "High entropy string",
            match: word.slice(0, 40),
            line: lineNum,
            file: currentFile,
          });
        }
      }
    }
  }
  return findings;
}
