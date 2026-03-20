import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

export type AgentKind = "claude" | "codex";

export interface AgentSession {
  kind: AgentKind;
  prompt: string;
  process: ChildProcess | null;
  startTime: number;
  lines: number;
  paused: boolean;
  killed: boolean;
}

export interface AgentEvents {
  output: (line: string) => void;
  done: (exitCode: number, duration: number) => void;
  error: (err: string) => void;
}

export class AgentRunner extends EventEmitter {
  private session: AgentSession | null = null;

  get running(): boolean {
    return this.session !== null && !this.session.killed;
  }

  get currentSession(): AgentSession | null {
    return this.session;
  }

  async start(kind: AgentKind, prompt: string, cwd: string): Promise<void> {
    if (this.session?.process && !this.session.killed) {
      throw new Error("Agent already running");
    }

    const [cmd, args] = this.buildCommand(kind, prompt);

    const proc = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    this.session = {
      kind,
      prompt,
      process: proc,
      startTime: Date.now(),
      lines: 0,
      paused: false,
      killed: false,
    };

    let buffer = "";

    const processLine = (line: string) => {
      if (this.session) this.session.lines++;
      this.emit("output", line);
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      this.emit("output", `[stderr] ${chunk.toString().trimEnd()}`);
    });

    proc.on("close", (code) => {
      if (buffer) processLine(buffer);
      const duration = Date.now() - (this.session?.startTime ?? Date.now());
      this.emit("done", code ?? 0, duration);
      if (this.session) this.session.process = null;
    });

    proc.on("error", (err) => {
      this.emit("error", err.message);
      if (this.session) {
        this.session.process = null;
        this.session.killed = true;
      }
    });
  }

  pause(): boolean {
    if (!this.session?.process?.pid || this.session.paused) return false;
    try {
      process.kill(this.session.process.pid, "SIGSTOP");
      this.session.paused = true;
      return true;
    } catch {
      return false;
    }
  }

  resume(): boolean {
    if (!this.session?.process?.pid || !this.session.paused) return false;
    try {
      process.kill(this.session.process.pid, "SIGCONT");
      this.session.paused = false;
      return true;
    } catch {
      return false;
    }
  }

  kill(): boolean {
    if (!this.session?.process) return false;
    try {
      this.session.process.kill("SIGKILL");
      this.session.killed = true;
      this.session.paused = false;
      return true;
    } catch {
      return false;
    }
  }

  /** Estimated tokens (rough: ~20 tokens per output line) */
  estimateTokens(): number {
    return (this.session?.lines ?? 0) * 20;
  }

  /** Estimated context usage percentage (based on 200k token window) */
  estimateContextPct(): number {
    const tokens = this.estimateTokens();
    return Math.min(Math.round((tokens / 200_000) * 100), 100);
  }

  elapsed(): number {
    if (!this.session) return 0;
    return Date.now() - this.session.startTime;
  }

  private buildCommand(kind: AgentKind, prompt: string): [string, string[]] {
    const escaped = prompt.replace(/'/g, "'\\''");
    switch (kind) {
      case "claude":
        return ["claude", ["-p", `'${escaped}'`]];
      case "codex":
        return ["codex", [`'${escaped}'`]];
    }
  }
}
