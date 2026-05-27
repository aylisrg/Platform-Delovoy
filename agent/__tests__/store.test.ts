import { describe, it, expect, beforeEach } from "vitest";
import { AgentStore } from "../lib/store";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpDir: string;
let store: AgentStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agent-store-test-"));
  store = new AgentStore(tmpDir);
});

// No afterEach cleanup — tmpdir is ephemeral and test isolation is sufficient.

describe("AgentStore", () => {
  it("creates a task with queued status and generated id", () => {
    const task = store.createTask(123, "fix the bug");
    expect(task.id).toHaveLength(8);
    expect(task.status).toBe("queued");
    expect(task.prompt).toBe("fix the bug");
    expect(task.chatId).toBe(123);
  });

  it("persists tasks across instances (survives restart)", () => {
    store.createTask(1, "task one");
    store.createTask(1, "task two");

    const reloaded = new AgentStore(tmpDir);
    const tasks = reloaded.listTasks(1);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].prompt).toBe("task two"); // newest first
  });

  it("updates task status and fields", () => {
    const task = store.createTask(1, "do stuff");
    store.updateTask(task.id, { status: "running", branch: "agent/abc-fix" });

    const updated = store.getTask(task.id);
    expect(updated?.status).toBe("running");
    expect(updated?.branch).toBe("agent/abc-fix");
  });

  it("lists only tasks for the given chatId", () => {
    store.createTask(111, "chat 111 task");
    store.createTask(222, "chat 222 task");

    expect(store.listTasks(111)).toHaveLength(1);
    expect(store.listTasks(222)).toHaveLength(1);
    expect(store.listTasks(999)).toHaveLength(0);
  });

  it("keeps queued tasks as queued on restart", () => {
    const task = store.createTask(1, "pending work");
    expect(task.status).toBe("queued");

    const reloaded = new AgentStore(tmpDir);
    expect(reloaded.getTask(task.id)?.status).toBe("queued");
  });

  it("marks running tasks as failed on construction (crash recovery)", () => {
    const task = store.createTask(1, "some task");
    store.updateTask(task.id, { status: "running" });

    // Simulate crash + restart
    const reloaded = new AgentStore(tmpDir);
    const recovered = reloaded.getTask(task.id);
    expect(recovered?.status).toBe("failed");
  });

  it("returns queued tasks in creation order (oldest first)", () => {
    const t1 = store.createTask(1, "first");
    const t2 = store.createTask(1, "second");

    const queued = store.getQueuedTasks();
    expect(queued[0].id).toBe(t1.id);
    expect(queued[1].id).toBe(t2.id);
  });

  it("stores and retrieves session id per chatId", () => {
    store.setSessionId(42, "session-abc");
    expect(store.getSessionId(42)).toBe("session-abc");
    expect(store.getSessionId(99)).toBeUndefined();
  });

  it("clears session id", () => {
    store.setSessionId(42, "session-abc");
    store.clearSessionId(42);
    expect(store.getSessionId(42)).toBeUndefined();
  });

  it("caps stored tasks at 50", () => {
    for (let i = 0; i < 55; i++) {
      store.createTask(1, `task ${i}`);
    }
    expect(store.listTasks(1, 100)).toHaveLength(50);
  });

  it("returns logPath as deterministic path inside .agent-logs/", () => {
    const p = store.logPath("abc123");
    expect(p).toContain(".agent-logs");
    expect(p).toContain("abc123.log");
  });
});
