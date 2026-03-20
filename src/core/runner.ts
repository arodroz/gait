import { spawn } from "child_process";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
}

export async function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeout = 300_000,
): Promise<RunResult> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    // Use shell mode so commands resolve via PATH and handle pipes/globs
    const fullCmd = args.length ? `${cmd} ${args.join(" ")}` : cmd;
    const proc = spawn(fullCmd, [], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        resolve({
          exitCode: -1,
          stdout,
          stderr: `command not found: ${cmd}`,
          duration: Date.now() - start,
          timedOut: false,
        });
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        duration: Date.now() - start,
        timedOut,
      });
    });

    if (timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, timeout);
    }
  });
}

/** Split a command string into [cmd, ...args] */
export function parseCommand(cmdStr: string): [string, string[]] {
  const parts = cmdStr.split(/\s+/).filter(Boolean);
  return [parts[0] ?? "", parts.slice(1)];
}
