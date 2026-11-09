import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), get: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/webapp-auth", () => ({ verifyWebAppToken: mocks.verify }));
vi.mock("@/modules/notifications/service", () => ({ getUserPreferences: mocks.get, updateUserPreferences: mocks.update }));

import { PUT } from "../route";

const put = (body: unknown) =>
  new NextRequest("http://localhost/api/webapp/preferences", { method: "PUT", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ id: "u1" });
  mocks.update.mockResolvedValue({ enableBooking: true, enableOrder: true, enableReminder: true, preferredChannel: "AUTO", enableWeeklyTips: false });
});

describe("PUT /api/webapp/preferences — подсказки недели", () => {
  it("сохраняет отписку и возвращает её", async () => {
    const res = await PUT(put({ enableWeeklyTips: false }));
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("u1", { enableWeeklyTips: false });
    expect((await res.json()).data.enableWeeklyTips).toBe(false);
  });

  it("422 на не-boolean, без записи", async () => {
    const res = await PUT(put({ enableWeeklyTips: "off" }));
    expect(res.status).toBe(422);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("401 без токена Mini App", async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await PUT(put({ enableWeeklyTips: true }))).status).toBe(401);
  });
});
