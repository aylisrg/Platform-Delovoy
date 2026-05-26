import { spawn, execSync } from "child_process";
import { appendFileSync } from "fs";

const WORKSPACE = process.env.AGENT_WORKSPACE || "/workspace";
const TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const PROGRESS_INTERVAL_MS = 30 * 1000;
const MAX_CHUNK = 4000;

// Appended to every Claude Code session so it always knows project rules.
// Uses --append-system-prompt to layer on top of the CLAUDE.md auto-loaded from cwd.
const SYSTEM_PROMPT = `
Ты — автономный агент разработки Platform Delovoy на Hetzner.

Обязательные правила (соблюдай всегда, без исключений):
- Прочитай /workspace/CLAUDE.md перед любой задачей — там source of truth по модулям, RBAC, scope-guard и конвенциям кода.
- Перед реализацией фичи читай /workspace/docs/requirements/ (PRD).
- Перед архитектурными решениями читай /workspace/docs/architecture/ (ADR).
- Никогда не коммить напрямую в main. Создавай ветку: agent/<task-id>-<slug> (slug = 3–5 слов из задачи).
- После завершения работы: git push origin <branch> и открой PR в main (используй gh pr create).
- Тесты обязательны (Vitest). npm test должен быть зелёным перед push.
- Все мутации данных логируй в AuditLog согласно соглашениям CLAUDE.md.
- Если задача выходит за scope, непонятна или требует решений от владельца — задай уточняющий вопрос в ответе, не угадывай.
`.trim();

export interface RunResult {
  sessionId?: string;
  exitCode: number;
}

export type ChunkCallback = (chunk: string) => Promise<void>;

let currentProc: ReturnType<typeof spawn> | null = null;

/** Kill the currently running claude process (for /cancel). */
export function killCurrent(): boolean {
  if (currentProc) {
    currentProc.kill("SIGKILL");
    currentProc = null;
    return true;
  }
  return false;
}

function syncWorkspace() {
  try {
    execSync(
      "git fetch origin && git checkout main && git reset --hard origin/main",
      { cwd: WORKSPACE, timeout: 30_000, stdio: "pipe" }
    );
  } catch (err) {
    console.error("[Agent] git sync failed (non-fatal):", (err as Error).message);
  }
}

export async function runClaude(
  task: string,
  onChunk: ChunkCallback,
  onProgress: () => Promise<void>,
  options: { sessionId?: string; logPath?: string } = {}
): Promise<RunResult> {
  syncWorkspace();

  return new Promise((resolve, reject) => {
    const args: string[] = [
      "--print",
      "--dangerously-skip-permissions",
      "--output-format",
      "json",
      "--append-system-prompt",
      SYSTEM_PROMPT,
    ];

    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    }

    args.push(task);

    const proc = spawn("claude", args, {
      cwd: WORKSPACE,
      env: { ...process.env, BROWSER: "none" },
    });

    currentProc = proc;

    let buffer = "";
    let settled = false;

    const progressTimer = setInterval(() => {
      onProgress().catch(() => undefined);
    }, PROGRESS_INTERVAL_MS);

    const hardTimeout = setTimeout(() => {
      if (!settled) {
        proc.kill("SIGKILL");
        reject(new Error("Task timed out after 30 minutes"));
      }
    }, TASK_TIMEOUT_MS);

    const finish = (result?: RunResult, err?: Error) => {
      if (settled) return;
      settled = true;
      currentProc = null;
      clearInterval(progressTimer);
      clearTimeout(hardTimeout);
      if (err) reject(err);
      else resolve(result ?? { exitCode: 0 });
    };

    proc.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      buffer += chunk;
      if (options.logPath) {
        appendFileSync(options.logPath, chunk);
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      process.stderr.write(data);
      if (options.logPath) {
        appendFileSync(options.logPath, data);
      }
    });

    proc.on("close", async (code) => {
      const raw = buffer.trim();
      let text = raw;
      let capturedSessionId: string | undefined;

      // --output-format json → single JSON object with result + session_id
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed.result === "string") text = parsed.result;
        if (typeof parsed.session_id === "string") capturedSessionId = parsed.session_id;
      } catch {
        // plain text fallback — older CLI or parsing error
      }

      if (text) {
        for (let i = 0; i < text.length; i += MAX_CHUNK) {
          await onChunk(text.slice(i, i + MAX_CHUNK));
        }
      }

      const exitCode = code ?? 1;
      if (exitCode !== 0 && !text) {
        finish(undefined, new Error(`claude exited with code ${exitCode}`));
      } else {
        finish({ sessionId: capturedSessionId, exitCode });
      }
    });

    proc.on("error", (err) => finish(undefined, err));
  });
}
