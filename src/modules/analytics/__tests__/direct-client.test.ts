import { describe, it, expect, vi, beforeEach } from "vitest";
import { DirectClient } from "../direct-client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("DirectClient", () => {
  let client: DirectClient;

  beforeEach(() => {
    client = new DirectClient("test-token", "test-login");
    mockFetch.mockReset();
  });

  it("parses TSV report into CampaignStats", async () => {
    const tsvResponse = [
      "CampaignId\tCampaignName\tCampaignStatus\tImpressions\tClicks\tCtr\tCost\tAvgCpc",
      "123\tBeседки\tACCEPTED\t1000\t50\t5.0\t1500.50\t30.01",
      "456\tОфисы\tDRAFT\t500\t20\t4.0\t600.00\t30.00",
    ].join("\n");

    mockFetch.mockResolvedValueOnce({
      status: 200,
      text: async () => tsvResponse,
    });

    const result = await client.getCampaignStats("2026-04-01", "2026-04-15");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      campaignId: 123,
      campaignName: "Beседки",
      status: "ACCEPTED",
      impressions: 1000,
      clicks: 50,
      ctr: 5.0,
      cost: 1500.50,
      avgCpc: 30.01,
    });
  });

  it("retries on HTTP 201/202", async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 201,
        headers: new Map([["retryIn", "1"]]),
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () => "CampaignId\tCampaignName\tCampaignStatus\tImpressions\tClicks\tCtr\tCost\tAvgCpc",
      });

    const result = await client.getCampaignStats("2026-04-01", "2026-04-15");
    expect(result).toHaveLength(0); // Only header, no data rows
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 400,
      text: async () => "Bad Request",
    });

    await expect(
      client.getCampaignStats("2026-04-01", "2026-04-15")
    ).rejects.toThrow("YANDEX_DIRECT_ERROR");
  });
});
