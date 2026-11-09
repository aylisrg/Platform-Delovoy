import type { GalleryPhoto } from "@/components/public/photo-gallery/photo-gallery";

/**
 * Play Park photographs (Drive «БИЗНЕС - ПАРК ДЕЛОВОЙ», folder «Плей Парк»).
 * `photo-NN` is the source file `Игровая_NN.webp`; checksums live in
 * design/ps-park/. Every caption was assigned by looking at the photograph.
 *
 * The legacy public/media/ps-park/IMG_43xx.jpeg files are NOT replaced: the
 * home page (landing services-section) still uses them.
 */
const CAPTIONS = [
  "игровое место", // 01 — телевизор, столик с приставкой, диван
  "зал", // 02 — общий вид вдоль зала
  "зал", // 03
  "игровое место", // 04
  "приставка и геймпады", // 05 — два DualSense и пульт на столе
  "зал", // 06
  "игровое место", // 07 — телевизор с меню PS5, столик
  "приставка и геймпады", // 08 — PS5, геймпады, чайник и чашки
  "вход", // 09 — дверь с вывеской на фасаде
  "вход", // 10
] as const;

export const PS_PARK_PHOTOS: readonly GalleryPhoto[] = CAPTIONS.map((caption, index) => ({
  caption,
  src: `/media/ps-park/gallery/photo-${String(index + 1).padStart(2, "0")}.webp`,
}));

/** Wide view of the hall as the cover; previews: a gaming place, the gamepads, the entrance. */
export const PS_PARK_GALLERY_COVER = 1;
export const PS_PARK_GALLERY_PREVIEWS: readonly number[] = [6, 4, 8];

/**
 * Table cards show a gaming place (TV + console table + sofa). Which physical
 * table is in which shot is not known, so cards cycle through these — the
 * same convention the page used before.
 */
export const PS_PARK_TABLE_PHOTOS: readonly string[] = [0, 3, 6, 2].map((index) => PS_PARK_PHOTOS[index].src);
