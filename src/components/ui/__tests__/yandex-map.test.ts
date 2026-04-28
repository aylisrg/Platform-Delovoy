import { describe, it, expect } from "vitest";
import {
  buildYandexEmbedUrl,
  buildYandexOpenUrl,
} from "@/components/ui/yandex-map";

describe("buildYandexEmbedUrl — без orgId (pin по координатам)", () => {
  it("encodes lon,lat with %2C separator and includes zoom + pm-маркер", () => {
    const url = buildYandexEmbedUrl(55.516945, 36.978520, 17);

    expect(url).toContain("https://yandex.ru/map-widget/v1/");
    expect(url).toContain("ll=36.97852%2C55.516945");
    expect(url).toContain("z=17");
    expect(url).toContain("pt=36.97852%2C55.516945%2Cpm2rdl");
    expect(url).toContain("l=map");
    expect(url).toContain("lang=ru_RU");
    expect(url).not.toContain("oid=");
  });

  it("does not contain shortlink path (avoid expiring shortcodes)", () => {
    const url = buildYandexEmbedUrl(55.5, 36.9, 16);
    expect(url).not.toContain("/maps/-/");
  });
});

describe("buildYandexEmbedUrl — с orgId (карточка организации)", () => {
  it("includes oid= AND pt= (oid сам по себе маркер не рисует — нужен явный pt)", () => {
    const url = buildYandexEmbedUrl(55.516945, 36.978520, 17, "165904522406");

    expect(url).toContain("oid=165904522406");
    expect(url).toContain("pt=36.97852%2C55.516945%2Cpm2rdl");
    expect(url).toContain("ll=36.97852%2C55.516945");
    expect(url).toContain("z=17");
  });
});

describe("buildYandexOpenUrl", () => {
  it("без orgId — открывает yandex.ru/maps в режиме построения маршрута", () => {
    const url = buildYandexOpenUrl(55.516945, 36.978520, 17);

    expect(url).toContain("https://yandex.ru/maps/");
    expect(url).not.toContain("/maps/org/");
    expect(url).toContain("mode=routes");
    expect(url).toContain("rtext=~55.516945%2C36.97852");
    expect(url).toContain("rtt=auto");
  });

  it("c orgId — открывает страницу организации /maps/org/<id>/", () => {
    const url = buildYandexOpenUrl(55.516945, 36.978520, 17, "145969813767");

    expect(url).toBe(
      "https://yandex.ru/maps/org/145969813767/?ll=36.97852%2C55.516945&z=17",
    );
    expect(url).not.toContain("mode=routes");
  });
});
