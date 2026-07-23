import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_HEARTBEAT_FILE,
  getHeartbeatFile,
  heartbeatAgeMs,
  writeHeartbeat,
} from "../heartbeat";

let cleanupDirs: string[] = [];

afterEach(async () => {
  delete process.env.BOT_HEARTBEAT_FILE;
  await Promise.all(cleanupDirs.map((d) => rm(d, { recursive: true, force: true })));
  cleanupDirs = [];
});

async function tmpFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hb-"));
  cleanupDirs.push(dir);
  return join(dir, "bot-healthy");
}

describe("bot heartbeat", () => {
  it("writes a fresh mark and reports a small age", async () => {
    const file = await tmpFile();
    const ok = await writeHeartbeat(file);
    expect(ok).toBe(true);
    const age = await heartbeatAgeMs(file);
    expect(age).not.toBeNull();
    expect(age as number).toBeGreaterThanOrEqual(0);
    expect(age as number).toBeLessThan(5_000);
  });

  it("returns null age when the file does not exist", async () => {
    const file = await tmpFile();
    expect(await heartbeatAgeMs(file)).toBeNull();
  });

  it("never throws on unwritable path, returns false", async () => {
    const ok = await writeHeartbeat("/nonexistent-dir/deep/bot-healthy");
    expect(ok).toBe(false);
  });

  it("resolves the file from BOT_HEARTBEAT_FILE with a sane default", () => {
    expect(getHeartbeatFile()).toBe(DEFAULT_HEARTBEAT_FILE);
    process.env.BOT_HEARTBEAT_FILE = "/custom/hb";
    expect(getHeartbeatFile()).toBe("/custom/hb");
  });
});
