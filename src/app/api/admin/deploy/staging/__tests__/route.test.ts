import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));

import { POST } from "../route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockAuditCreate = (
  prisma as unknown as { auditLog: { create: ReturnType<typeof vi.fn> } }
).auditLog.create;

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  vi.stubEnv("GITHUB_DISPATCH_TOKEN", "ghp_testtoken");
  vi.stubEnv("GITHUB_REPO_OWNER", "aylisrg");
  vi.stubEnv("GITHUB_REPO_NAME", "platform-delovoy");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

function req(body: unknown = {}) {
  return new Request("http://localhost/api/admin/deploy/staging", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/deploy/staging", () => {
  it("401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("403 for MANAGER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "MANAGER" } });
    const res = await POST(req());
    expect(res.status).toBe(403);
  });

  it("returns 500 when GITHUB_DISPATCH_TOKEN missing", async () => {
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "");
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "SUPERADMIN" } });
    const res = await POST(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("GITHUB_TOKEN_MISSING");
  });

  it("422 on invalid sha", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "SUPERADMIN" } });
    const res = await POST(req({ sha: "zzz" }));
    expect(res.status).toBe(422);
  });

  it("202 on successful dispatch + writes AuditLog", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "SUPERADMIN", name: "Super" },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => "",
    });

    const res = await POST(req({ sha: "abc1234" }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.status).toBe("triggered");
    expect(body.data.workflowUrl).toContain(
      "github.com/aylisrg/platform-delovoy"
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("workflows/deploy-staging.yml/dispatches");
    expect(init.headers.Authorization).toBe("Bearer ghp_testtoken");
    expect(JSON.parse(init.body).inputs.sha).toBe("abc1234");

    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        action: "deploy.staging.trigger",
      }),
    });
  });

  it("502 when GitHub API returns error", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "SUPERADMIN" } });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "forbidden",
    });

    const res = await POST(req({ sha: "abc1234" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("GITHUB_API_ERROR");
  });
});
