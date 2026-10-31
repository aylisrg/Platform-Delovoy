import { describe, expect, it } from "vitest";
import manifest from "../../../../../design/gazebos/asset-manifest.json";
import { GAZEBO_GALLERIES, getGazeboGallery } from "../gazebo-photos";
import { getGazeboWorkingHours } from "../gazebo-presentation";

describe("approved gazebo photos", () => {
  it("maps exactly the 15 source files, with the approved cover for each number", () => {
    const urls = GAZEBO_GALLERIES.flatMap((gallery) => gallery.photos.map((photo) => `public${photo.src}`));
    expect(urls).toEqual(manifest.photos.map((photo) => photo.target));
    expect(new Set(urls).size).toBe(15);
    expect(GAZEBO_GALLERIES.map((gallery) => gallery.cover)).toEqual([2, 3, 2, 2, 3]);
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
