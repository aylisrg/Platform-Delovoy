import { spawn } from "child_process";

const WORKSPACE = process.env.AGENT_WORKSPACE || "/workspace";
const TASK_TIMEOUT_MS = 15 * 60 * 1000; // 15 min hard limit
const PROGRESS_INTERVAL_MS = 30 * 1000; // ping every 30s
const MAX_CHUNK = 4000; // Telegram message limit with some headroom

export type ChunkCallback = (chunk: string) => Promise<void>;

export async function runClaude(
  task: string,
  onChunk: ChunkCallback,
  onProgress: () => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      ["--print", task],
      {
        cwd: WORKSPACE,
        env: {
          ...process.env,
          // Prevent Claude Code from opening a browser for auth
          BROWSER: "none",
        },
      }
    );

    let buffer = "";
    let settled = false;

    const progressTimer = setInterval(() => {
      onProgress().catch(() => undefined);
    }, PROGRESS_INTERVAL_MS);

    const hardTimeout = setTimeout(() => {
      if (!settled) {
        proc.kill("SIGKILL");
        reject(new Error("Task timed out after 15 minutes"));
      }
    }, TASK_TIMEOUT_MS);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(progressTimer);
      clearTimeout(hardTimeout);
      if (err) reject(err);
      else resolve();
    };

    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      // Claude Code writes progress/status to stderr — ignore silently
      process.stderr.write(data);
    });

    proc.on("close", async (code) => {
      const output = buffer.trim();
      if (output) {
        // Split long output into Telegram-safe chunks
        for (let i = 0; i < output.length; i += MAX_CHUNK) {
          await onChunk(output.slice(i, i + MAX_CHUNK));
        }
      }
      if (code !== 0 && !output) {
        finish(new Error(`claude exited with code ${code}`));
      } else {
        finish();
      }
    });

    proc.on("error", (err) => {
      finish(err);
    });
  });
}
