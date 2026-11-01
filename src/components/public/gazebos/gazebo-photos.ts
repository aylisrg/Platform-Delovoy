/** Only the 15 approved photographs. Do not infer files from the VPS inventory. */
export type GazeboPhoto = { number: number; src: string };
export type GazeboGalleryData = {
  number: number;
  cover: number;
  photos: readonly GazeboPhoto[];
};

function gallery(number: number, cover: number): GazeboGalleryData {
  return {
    number,
    cover,
    photos: [1, 2, 3].map((photo) => ({
      number: photo,
      src: `/media/gazebos/gazebo-${number}/photo-${String(photo).padStart(2, "0")}.webp`,
    })),
  };
}

export const GAZEBO_GALLERIES: readonly GazeboGalleryData[] = [
  gallery(1, 2), gallery(2, 3), gallery(3, 2), gallery(4, 2), gallery(5, 3),
];

/** Match the actual resource name, never its position in a database response. */
export function getGazeboGallery(name: string): GazeboGalleryData | undefined {
  const match = name.trim().match(/^Беседка\s*№\s*([1-5])$/iu);
  return match ? GAZEBO_GALLERIES.find((item) => item.number === Number(match[1])) : undefined;
}

export function getGazeboAnchor(resource: { id: string; name: string }): string {
  const gallery = getGazeboGallery(resource.name);
  return gallery ? `gazebo-${gallery.number}` : `gazebo-resource-${resource.id}`;
}
