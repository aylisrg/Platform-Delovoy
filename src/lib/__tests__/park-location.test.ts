import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PARK_LOCATION } from "../park-location";
import { buildYandexEmbedUrl } from "@/components/ui/yandex-map";

const root = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("PARK_LOCATION", () => {
  it("совпадает с карточкой организации «Деловой» в Яндекс Картах", () => {
    expect(PARK_LOCATION).toMatchObject({ orgId: "165904522406", lat: 55.516945, lon: 36.97852 });
    const url = buildYandexEmbedUrl(PARK_LOCATION.lat, PARK_LOCATION.lon, PARK_LOCATION.zoom, PARK_LOCATION.orgId);
    expect(url).toContain("pt=36.97852%2C55.516945%2Cpm2rdl");
  });

  it("карта /gazebos и карта главной берут точку из одной константы", () => {
    for (const f of [
      "src/components/public/gazebos/parking-section.tsx",
      "landing-delovoy-park.ru/components/contacts-section.tsx",
    ]) {
      const src = read(f);
      expect(src).toContain("PARK_LOCATION");
      expect(src).not.toMatch(/55\.519479|36\.978566/);
    }
  });
});
