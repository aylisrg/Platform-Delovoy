/**
 * Approved photographs of the five numbered gazebos (Drive set «БИЗНЕС - ПАРК
 * ДЕЛОВОЙ», folders «Беседка 1…5»). `photo-NN` is the source file
 * `БеседкаX_NN.webp`; checksums live in design/gazebos/. Every `kind` below was
 * assigned by looking at the photograph — do not infer files from the VPS
 * inventory or add numbers that are not on disk.
 */
export type GazeboPhotoKind = "exterior" | "grill" | "interior" | "terrace" | "view";
export type GazeboPhoto = { number: number; src: string; kind: GazeboPhotoKind };
export type GazeboGalleryData = {
  number: number;
  /** Photo number shown large on the card (approved 2026-10-31). */
  cover: number;
  /** Photo numbers shown as card thumbnails: interior, grill and another angle. */
  preview: readonly number[];
  photos: readonly GazeboPhoto[];
};

export const GAZEBO_PHOTO_KIND_LABEL: Record<GazeboPhotoKind, string> = {
  exterior: "снаружи",
  grill: "мангальная зона",
  interior: "внутри",
  terrace: "терраса",
  view: "вид из окна",
};

const E = "exterior", G = "grill", I = "interior", T = "terrace", V = "view";

function gallery(number: number, cover: number, preview: readonly number[], kinds: readonly GazeboPhotoKind[]): GazeboGalleryData {
  return {
    number,
    cover,
    preview,
    photos: kinds.map((kind, index) => ({
      number: index + 1,
      kind,
      src: `/media/gazebos/gazebo-${number}/photo-${String(index + 1).padStart(2, "0")}.webp`,
    })),
  };
}

export const GAZEBO_GALLERIES: readonly GazeboGalleryData[] = [
  gallery(1, 2, [8, 4, 10], [E, E, E, G, E, I, I, I, I, I, I]),
  gallery(2, 3, [9, 4, 12], [E, E, E, E, E, E, E, I, I, I, V, I]),
  gallery(3, 2, [8, 3, 7], [E, E, G, E, G, E, I, I]),
  gallery(4, 2, [8, 5, 10], [E, E, E, E, G, E, I, I, I, I]),
  gallery(5, 3, [15, 7, 4], [E, E, E, G, E, T, T, T, I, I, I, I, I, I, I, I, I, E]),
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
