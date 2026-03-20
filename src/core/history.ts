import * as fs from "fs";
import * as path from "path";

export type ActionKind = "pipeline_run" | "stage_run" | "agent_session" | "commit" | "rollback" | "secret_scan";

export interface Entry {
  timestamp: string;
  kind: ActionKind;
  data: Record<string, unknown>;
}

export class HistoryLogger {
  private dir: string;

  constructor(gaitDir: string) {
    this.dir = path.join(gaitDir, "history");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  log(kind: ActionKind, data: Record<string, unknown>): void {
    const entry: Entry = {
      timestamp: new Date().toISOString(),
      kind,
      data,
    };
    const filename = new Date().toISOString().slice(0, 10) + ".jsonl";
    fs.appendFileSync(path.join(this.dir, filename), JSON.stringify(entry) + "\n");
  }

  read(date: string): Entry[] {
    const filepath = path.join(this.dir, `${date}.jsonl`);
    if (!fs.existsSync(filepath)) return [];
    return fs.readFileSync(filepath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}
