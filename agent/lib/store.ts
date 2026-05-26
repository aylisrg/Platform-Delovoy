import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";

export type TaskStatus = "queued" | "running" | "done" | "failed";

export interface AgentTask {
  id: string;
  chatId: number;
  prompt: string;
  status: TaskStatus;
  sessionId?: string;
  branch?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
}

interface State {
  tasks: AgentTask[];
  /** chatId (string key) → last sessionId for --resume */
  threads: Record<string, string>;
}

const MAX_TASKS = 50;

export function shortId(): string {
  return randomUUID().slice(0, 8);
}

export class AgentStore {
  private readonly path: string;
  private readonly logsDir: string;
  private state: State;

  constructor(workspace: string) {
    this.path = `${workspace}/.agent-state.json`;
    this.logsDir = `${workspace}/.agent-logs`;
    this.state = this.load();
    // Mark any tasks left in "running" state from a previous crashed session as failed
    for (const t of this.state.tasks) {
      if (t.status === "running") {
        t.status = "failed";
        t.finishedAt = new Date().toISOString();
      }
    }
    this.save();
    this.ensureLogsDir();
  }

  private load(): State {
    if (existsSync(this.path)) {
      try {
        return JSON.parse(readFileSync(this.path, "utf-8")) as State;
      } catch {
        // corrupt file — start fresh
      }
    }
    return { tasks: [], threads: {} };
  }

  private save() {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2));
  }

  private ensureLogsDir() {
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }

  logPath(taskId: string): string {
    return `${this.logsDir}/${taskId}.log`;
  }

  // --- Task CRUD ---

  createTask(chatId: number, prompt: string): AgentTask {
    const task: AgentTask = {
      id: shortId(),
      chatId,
      prompt,
      status: "queued",
    };
    this.state.tasks.unshift(task);
    if (this.state.tasks.length > MAX_TASKS) {
      this.state.tasks.length = MAX_TASKS;
    }
    this.save();
    return task;
  }

  updateTask(id: string, updates: Partial<AgentTask>) {
    const task = this.state.tasks.find((t) => t.id === id);
    if (task) {
      Object.assign(task, updates);
      this.save();
    }
  }

  getTask(id: string): AgentTask | undefined {
    return this.state.tasks.find((t) => t.id === id);
  }

  listTasks(chatId: number, limit = 10): AgentTask[] {
    return this.state.tasks
      .filter((t) => t.chatId === chatId)
      .slice(0, limit);
  }

  getQueuedTasks(): AgentTask[] {
    return [...this.state.tasks].filter((t) => t.status === "queued").reverse();
  }

  // --- Session (thread) continuity ---

  getSessionId(chatId: number): string | undefined {
    return this.state.threads[String(chatId)];
  }

  setSessionId(chatId: number, sessionId: string) {
    this.state.threads[String(chatId)] = sessionId;
    this.save();
  }

  clearSessionId(chatId: number) {
    delete this.state.threads[String(chatId)];
    this.save();
  }
}
