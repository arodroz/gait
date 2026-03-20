import * as fs from "fs";
import * as path from "path";

interface FlakyRecord {
  flipCount: number;
  lastPassed: boolean;
  isFlaky: boolean;
}

const FLAKY_THRESHOLD = 3;

export class FlakyTracker {
  private path: string;
  private tests: Map<string, FlakyRecord> = new Map();

  constructor(gaitDir: string) {
    this.path = path.join(gaitDir, "flaky.json");
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.path)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.path, "utf-8"));
      for (const [k, v] of Object.entries(data)) {
        this.tests.set(k, v as FlakyRecord);
      }
    } catch {
      // corrupt file, start fresh
    }
  }

  update(key: string, passed: boolean): void {
    const rec = this.tests.get(key);
    if (!rec) {
      this.tests.set(key, { flipCount: 0, lastPassed: passed, isFlaky: false });
      return;
    }
    if (rec.lastPassed !== passed) {
      rec.flipCount++;
      rec.lastPassed = passed;
      if (rec.flipCount >= FLAKY_THRESHOLD) {
        rec.isFlaky = true;
      }
    }
  }

  isFlaky(key: string): boolean {
    return this.tests.get(key)?.isFlaky ?? false;
  }

  flakyTests(): string[] {
    return [...this.tests.entries()].filter(([, v]) => v.isFlaky).map(([k]) => k);
  }

  save(): void {
    const obj: Record<string, FlakyRecord> = {};
    for (const [k, v] of this.tests) obj[k] = v;
    fs.writeFileSync(this.path, JSON.stringify(obj, null, 2));
  }
}
