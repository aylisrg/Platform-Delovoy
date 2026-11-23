import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/modules/ps-park/online-settings", () => ({ setOnlineBookingEnabled: vi.fn() }));

import { auth } from "@/lib/auth";
import { setOnlineBookingEnabled } from "@/modules/ps-park/online-settings";
import { PATCH } from "../route";

const offerHash = "a".repeat(64);

function request(body: unknown) {
  return new NextRequest("http://localhost/api/ps-park/settings/online-booking", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "owner", role: "SUPERADMIN" } } as never);
});

describe("PATCH /api/ps-park/settings/online-booking", () => {
  it("passes the reviewed offer hash to activation", async () => {
    vi.mocked(setOnlineBookingEnabled).mockResolvedValue({ onlineBookingEnabled: true, changed: true });
    const response = await PATCH(request({ enabled: true, offerHash }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { onlineBookingEnabled: true } });
    expect(setOnlineBookingEnabled).toHaveBeenCalledWith("owner", true, offerHash);
  });

  it("allows the owner to disable checkout without an offer", async () => {
    vi.mocked(setOnlineBookingEnabled).mockResolvedValue({ onlineBookingEnabled: false, changed: true });
    expect((await PATCH(request({ enabled: false }))).status).toBe(200);
    expect(setOnlineBookingEnabled).toHaveBeenCalledWith("owner", false, undefined);
  });

  it("rejects a manager and a missing offer hash before updating settings", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "manager", role: "MANAGER" } } as never);
    expect((await PATCH(request({ enabled: false }))).status).toBe(403);
    expect((await PATCH(request({ enabled: true }))).status).toBe(422);
    expect(setOnlineBookingEnabled).not.toHaveBeenCalled();
  });

  it("reports a stale offer as a conflict", async () => {
    vi.mocked(setOnlineBookingEnabled).mockRejectedValue(new Error("PUBLISHED_OFFER_MISMATCH"));
    const response = await PATCH(request({ enabled: true, offerHash }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "PUBLISHED_OFFER_MISMATCH" } });
  });
});
