import { describe, expect, it } from "vitest";
import manifest from "../../../../../design/gazebos/asset-manifest.json";
import hashes from "../../../../../design/gazebos/asset-hashes.json";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GAZEBO_GALLERIES, getGazeboGallery } from "../gazebo-photos";
import { GAZEBO_CONTENT, GAZEBO_INCLUDED, getGazeboContent } from "../gazebo-content";
import { getGazeboWorkingHours } from "../gazebo-presentation";

describe("approved gazebo photos", () => {
  it("maps exactly the 59 source files, keeping the approved cover for each number", () => {
    const urls = GAZEBO_GALLERIES.flatMap((gallery) => gallery.photos.map((photo) => `public${photo.src}`));
    expect(urls).toEqual(manifest.photos.map((photo) => photo.target));
    expect(new Set(urls).size).toBe(59);
    expect(GAZEBO_GALLERIES.map((gallery) => gallery.photos.length)).toEqual([11, 12, 8, 10, 18]);
    expect(GAZEBO_GALLERIES.map((gallery) => gallery.cover)).toEqual([2, 3, 2, 2, 3]);
  });

  it("ships every catalogued photo as a file whose checksum matches the manifest", () => {
    for (const entry of hashes) {
      const bytes = readFileSync(join(process.cwd(), entry.path));
      expect(bytes.length, entry.path).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), entry.path).toBe(entry.sha256);
    }
    expect(hashes.map((entry) => entry.path)).toEqual(manifest.photos.map((photo) => photo.target));
  });

  it("previews only real, non-cover photos and gives every gazebo copy", () => {
    for (const gallery of GAZEBO_GALLERIES) {
      const numbers = gallery.photos.map((photo) => photo.number);
      expect(numbers).toContain(gallery.cover);
      expect(gallery.preview).toHaveLength(3);
      for (const number of gallery.preview) {
        expect(numbers).toContain(number);
        expect(number).not.toBe(gallery.cover);
      }
      expect(gallery.photos.some((photo) => photo.kind === "interior")).toBe(true);
      const content = getGazeboContent(gallery.number);
      expect(content?.summary.length).toBeGreaterThan(40);
      expect(content?.specs.length).toBeGreaterThan(0);
    }
  });

  it("keeps catalog copy free of unverifiable filler words", () => {
    const text = JSON.stringify([GAZEBO_CONTENT, GAZEBO_INCLUDED]).toLowerCase();
    for (const word of ["уют", "идеальн", "незабываем", "атмосфер", "комфорт", "уникальн", "лучш", "отличн", "прекрасн", "волшебн"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("matches the actual number, regardless of database order, and never guesses", () => {
    expect(getGazeboGallery("Беседка №5")?.number).toBe(5);
    expect(getGazeboGallery(" Беседка № 2 ")?.number).toBe(2);
    for (const name of ["Беседка №12", "Беседка №6", "Другая беседка", "Беседки №1 и №2"]) {
      expect(getGazeboGallery(name)).toBeUndefined();
    }
  });
});

describe("shared working hours", () => {
  const item = (from: unknown, to: unknown) => ({ metadata: { workingHours: { from, to } } });
  it("uses live metadata only when schedules agree", () => {
    expect(getGazeboWorkingHours([item("11:00", "22:30"), item("11:00", "22:30")])).toBe("11:00–22:30");
    expect(getGazeboWorkingHours([item("12:00", "20:00")])).toBe("12:00–20:00");
    expect(getGazeboWorkingHours([item("11:00", "22:30"), item("12:00", "20:00")])).toBeNull();
  });
  it("does not invent hours for missing or malformed data", () => {
    expect(getGazeboWorkingHours([])).toBeNull();
    expect(getGazeboWorkingHours([{ metadata: null }])).toBeNull();
    expect(getGazeboWorkingHours([item("25:00", "22:30")])).toBeNull();
    expect(getGazeboWorkingHours([item(11, "22:30")])).toBeNull();
  });
});
