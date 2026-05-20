import { describe, it, expect, vi } from "vitest";
import { TaskQueue } from "../lib/queue";

describe("TaskQueue", () => {
  it("runs a single job immediately", async () => {
    const queue = new TaskQueue();
    const ran = vi.fn();
    await queue.run(async () => { ran(); });
    expect(ran).toHaveBeenCalledOnce();
  });

  it("serializes jobs — second starts after first completes", async () => {
    const queue = new TaskQueue();
    const order: number[] = [];

    let resolveFirst!: () => void;
    const first = new Promise<void>((res) => { resolveFirst = res; });

    const p1 = queue.run(async () => {
      order.push(1);
      await first;
      order.push(3);
    });

    // Enqueue second while first is still running
    const p2 = queue.run(async () => { order.push(4); });

    order.push(2);
    resolveFirst();

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("reports busy=true while running, false after", async () => {
    const queue = new TaskQueue();
    let busyDuring = false;

    await queue.run(async () => {
      busyDuring = queue.busy;
    });

    // drain() sets running=false after resolve() fires, so flush one microtask tick
    await Promise.resolve();

    expect(busyDuring).toBe(true);
    expect(queue.busy).toBe(false);
  });

  it("size reflects pending jobs in queue", async () => {
    const queue = new TaskQueue();

    let resolveFirst!: () => void;
    const first = new Promise<void>((res) => { resolveFirst = res; });

    queue.run(async () => { await first; });

    // These two are waiting
    queue.run(async () => undefined);
    queue.run(async () => undefined);

    expect(queue.size).toBe(2);
    resolveFirst();
  });

  it("propagates errors without blocking subsequent jobs", async () => {
    const queue = new TaskQueue();
    const second = vi.fn();

    await queue.run(async () => { throw new Error("boom"); }).catch(() => undefined);
    await queue.run(async () => { second(); });

    expect(second).toHaveBeenCalledOnce();
  });
});
