import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const installedVhostHash = "e6f0147b2778f3686b032f3c944de6ae63cb2972b6a496c2a4595536629c6989";

const workflow = readFileSync(resolve(".github/workflows/deploy.yml"), "utf8");
const block = workflow.match(/# ps-park-release-target-begin([\s\S]*?)# ps-park-release-target-end/)?.[1];
if (!block) throw new Error("RELEASE_TARGET_GUARD_MISSING");
const directory = mkdtempSync(join(tmpdir(), "ps-release-target-test-"));
const shim = `#!/usr/bin/env bash
set -eu
case "\${0##*/}:$*" in
  'cat:/opt/delovoy-park/ACTIVE_SLOT') [ "$SLOT" != missing ] || exit 2; printf '%s' "$SLOT" ;;
  'cat:/etc/nginx/conf.d/delovoy-upstream.conf') printf '%s' "$UPSTREAM" ;;
  'cmp:-s infra/nginx/delovoy-park.conf /etc/nginx/sites-enabled/delovoy-park') [ "$VHOST" = match ] ;;
  'sha256sum:infra/nginx/edge/delovoy-edge.conf') echo 'canonical-edge  source' ;;
  'sha256sum:/etc/nginx/sites-enabled/delovoy-park') printf '%s  installed\n' "$VHOST_HASH" ;;
  'docker:exec delovoy-edge sha256sum /etc/nginx/conf.d/delovoy-edge.conf') printf '%s  installed\n' "$EDGE" ;;
  'docker:inspect --format {{.State.Running}} delovoy-app'|'docker:inspect --format {{.State.Running}} delovoy-app-b') printf '%s' "$RUNNING" ;;
  'docker:inspect --format {{.Id}} delovoy-app'|'docker:inspect --format {{.Id}} delovoy-app-b') printf '%s' "$CONTAINER_ID" ;;
  'docker:port delovoy-app 3000/tcp'|'docker:port delovoy-app-b 3000/tcp') [ "$BINDING" != unavailable ] || exit 3; printf '%s' "$BINDING" ;;
  *) echo UNEXPECTED_COMMAND >&2; exit 4 ;;
esac
`;
for (const command of ["cat", "cmp", "sha256sum", "docker"]) {
  writeFileSync(join(directory, command), shim, { mode: 0o755 });
}
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function run(overrides: Record<string, string> = {}, after = "") {
  return spawnSync("bash", ["-c", `set -euo pipefail\n${block}\n${after}\necho ALLOW_ACTIVATION`], {
    encoding: "utf8",
    env: {
      PATH: `${directory}:${process.env.PATH}`, DEPLOY_MODE: "bluegreen", APP_CONT: "delovoy-app",
      SLOT: "a", UPSTREAM: "upstream delovoy_app {\n server 127.0.0.1:3000;\n keepalive 32;\n}",
      BINDING: "127.0.0.1:3000", RUNNING: "true", CONTAINER_ID: "active-container-id",
      VHOST: "match", VHOST_HASH: "unknown", EDGE: "canonical-edge", ...overrides,
    },
  });
}

describe("production Play Park release target guard from actual workflow", () => {
  it("pins the observed public revision with identical routing and only the older referrer header", () => {
    const canonical = readFileSync(resolve("infra/nginx/delovoy-park.conf"), "utf8");
    const withoutReferrerMap = canonical.replace(/# Трекинг-редирект[^]*?(?=log_format delovoy_perf)/, "")
      .replace("Referrer-Policy $delovoy_referrer_policy always;", 'Referrer-Policy "strict-origin-when-cross-origin" always;');
    expect(createHash("sha256").update(withoutReferrerMap).digest("hex")).toBe(installedVhostHash);
    expect(block).toContain(installedVhostHash);
  });
  it("accepts only the fingerprinted deployed revision when canonical differs", () => {
    const result = run({ VHOST: "different", VHOST_HASH: installedVhostHash }, "verify_ps_park_release_target");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PS_PARK_RELEASE_VHOST_VERIFIED c9198fd");
  });
  it("accepts the verified active slot a and stable repeat", () => {
    const result = run({}, "verify_ps_park_release_target");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.match(/PS_PARK_RELEASE_TARGET_VERIFIED/g)).toHaveLength(2);
    expect(result.stdout).toContain("ALLOW_ACTIVATION");
  });
  it("accepts the verified active slot b", () => {
    const result = run({ SLOT: "b", APP_CONT: "delovoy-app-b", BINDING: "127.0.0.1:3001",
      UPSTREAM: "upstream delovoy_app { server 127.0.0.1:3001; keepalive 32; }" });
    expect(result.status, result.stderr).toBe(0);
  });
  it.each([
    { DEPLOY_MODE: "legacy" }, { SLOT: "missing" }, { SLOT: "unknown" }, { APP_CONT: "delovoy-app-b" },
    { VHOST: "different" }, { EDGE: "different" }, { RUNNING: "false" }, { CONTAINER_ID: "" },
    { UPSTREAM: "upstream delovoy_app { server 127.0.0.1:3001; keepalive 32; }" },
    { UPSTREAM: "upstream delovoy_app { server 127.0.0.1:3000; server 127.0.0.1:3001; keepalive 32; }" },
    { BINDING: "0.0.0.0:3000" }, { BINDING: "127.0.0.1:3001" },
    { BINDING: "127.0.0.1:3000\n0.0.0.0:3000" }, { BINDING: "unavailable" },
  ])("blocks activation for a mismatched target: %j", overrides => {
    const result = run(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("ALLOW_ACTIVATION");
  });
  it.each([
    "SLOT=b", "VHOST=different", "EDGE=different", "CONTAINER_ID=replaced", "BINDING=127.0.0.1:3001",
  ])("detects identity/routing change at the final check: %s", change => {
    const result = run({}, `${change}\nverify_ps_park_release_target`);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("ALLOW_ACTIVATION");
  });
});
