import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import manifest from "../../../../../design/ps-park/asset-manifest.json";
import {
  PS_PARK_GALLERY_COVER,
  PS_PARK_GALLERY_PREVIEWS,
  PS_PARK_PHOTOS,
  PS_PARK_TABLE_PHOTOS,
} from "../ps-park-photos";

const root = process.cwd();

describe("Play Park photos", () => {
  it("ships every catalogued photo with the manifest checksum, in Drive order", () => {
    expect(PS_PARK_PHOTOS.map((photo) => `public${photo.src}`)).toEqual(manifest.photos.map((entry) => entry.path));
    for (const entry of manifest.photos) {
      const bytes = readFileSync(join(root, entry.path));
      expect(bytes.length, entry.path).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), entry.path).toBe(entry.sha256);
    }
    expect(PS_PARK_PHOTOS).toHaveLength(10);
  });

  it("uses real indexes for the cover, previews and table cards", () => {
    expect(PS_PARK_PHOTOS[PS_PARK_GALLERY_COVER].caption).toBe("зал");
    for (const index of PS_PARK_GALLERY_PREVIEWS) {
      expect(PS_PARK_PHOTOS[index]).toBeDefined();
      expect(index).not.toBe(PS_PARK_GALLERY_COVER);
    }
    const srcs = PS_PARK_PHOTOS.map((photo) => photo.src);
    for (const src of PS_PARK_TABLE_PHOTOS) {
      expect(srcs).toContain(src);
      expect(PS_PARK_PHOTOS.find((photo) => photo.src === src)?.caption).toMatch(/игровое место|зал/);
    }
    expect(PS_PARK_PHOTOS.every((photo) => photo.caption.length > 0)).toBe(true);
  });

  it("leaves the home page photos untouched", () => {
    // landing services-section still points at the legacy shots; replacing or
    // deleting them would change the home page.
    const landing = readFileSync(join(root, "landing-delovoy-park.ru/components/services-section.tsx"), "utf8");
    const legacy = [...landing.matchAll(/\/media\/ps-park\/(IMG_\d+\.jpeg)/g)].map((match) => match[1]);
    expect(legacy.length).toBeGreaterThan(0);
    for (const file of legacy) expect(existsSync(join(root, "public/media/ps-park", file)), file).toBe(true);
  });
});
