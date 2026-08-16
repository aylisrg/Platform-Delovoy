import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/booking/checkin", () => ({
  findAutoNoShowCandidates: vi.fn(),
}));
vi.mock("@/modules/ps-park/service", () => {
  class PSBookingError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    markNoShow: vi.fn(),
    getNoShowThresholdMinutes: vi.fn(),
    PSBookingError,
  };
});
vi.mock("@/modules/gazebos/service", () => {
  class BookingError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    markNoShow: vi.fn(),
    getNoShowThresholdMinutes: vi.fn(),
    BookingError,
  };
});

import { findAutoNoShowCandidates } from "@/modules/booking/checkin";
import {
  markNoShow as markNoShowPS,
  getNoShowThresholdMinutes as getPSThreshold,
  PSBookingError,
} from "@/modules/ps-park/service";
import {
  markNoShow as markNoShowGazebos,
  getNoShowThresholdMinutes as getGazebosThreshold,
  BookingError,
} from "@/modules/gazebos/service";
import { GET } from "../route";

const mockedFind = vi.mocked(findAutoNoShowCandidates);
const mockedMarkPS = vi.mocked(markNoShowPS);
const mockedMarkGazebos = vi.mocked(markNoShowGazebos);
const mockedGetPSThreshold = vi.mocked(getPSThreshold);
const mockedGetGazebosThreshold = vi.mocked(getGazebosThreshold);

function makeReq(token: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/cron/no-show", {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  mockedGetPSThreshold.mockResolvedValue(30);
  mockedGetGazebosThreshold.mockResolvedValue(30);
  mockedFind.mockResolvedValue([]);
  mockedMarkPS.mockResolvedValue(undefined as never);
  mockedMarkGazebos.mockResolvedValue(undefined as never);
});

describe("GET /api/cron/no-show", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockedFind).not.toHaveBeenCalled();
  });

  it("returns 401 when token is wrong", async () => {
    const res = await GET(makeReq("wrong"));
    expect(res.status).toBe(401);
    expect(mockedFind).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq("anything"));
    expect(res.status).toBe(401);
    expect(mockedFind).not.toHaveBeenCalled();
  });

  it("happy path: marks candidates NO_SHOW for both modules", async () => {
    mockedFind.mockImplementation(async (moduleSlug: string) =>
      moduleSlug === "ps-park" ? ["b-ps-1"] : ["b-gz-1", "b-gz-2"]
    );
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockedMarkPS).toHaveBeenCalledWith("b-ps-1", "cron", "auto");
    expect(mockedMarkGazebos).toHaveBeenCalledTimes(2);
    expect(body.data.modules["ps-park"]).toEqual({ processed: 1, errors: [] });
    expect(body.data.modules.gazebos).toEqual({ processed: 2, errors: [] });
  });

  it("captures a per-candidate PSBookingError instead of failing the whole request", async () => {
    mockedFind.mockImplementation(async (moduleSlug: string) =>
      moduleSlug === "ps-park" ? ["b-ps-1"] : []
    );
    mockedMarkPS.mockRejectedValueOnce(new PSBookingError("ALREADY_CHECKED_IN", "already checked in"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.modules["ps-park"]).toEqual({
      processed: 0,
      errors: ["b-ps-1: already checked in"],
    });
  });

  it("captures a per-candidate BookingError (gazebos) too", async () => {
    mockedFind.mockImplementation(async (moduleSlug: string) =>
      moduleSlug === "gazebos" ? ["b-gz-1"] : []
    );
    mockedMarkGazebos.mockRejectedValueOnce(new BookingError("NOT_CONFIRMED", "not confirmed"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.modules.gazebos.errors).toEqual(["b-gz-1: not confirmed"]);
  });

  it("captures unknown (non-Error) rejections with a generic message", async () => {
    mockedFind.mockImplementation(async (moduleSlug: string) =>
      moduleSlug === "ps-park" ? ["b-ps-1"] : []
    );
    mockedMarkPS.mockRejectedValueOnce("not an Error instance");
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.modules["ps-park"].errors).toEqual(["b-ps-1: unknown error"]);
  });
});
