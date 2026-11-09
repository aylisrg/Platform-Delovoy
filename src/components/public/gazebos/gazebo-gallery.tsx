"use client";

import { PhotoGallery } from "@/components/public/photo-gallery/photo-gallery";
import { GAZEBO_PHOTO_KIND_LABEL, type GazeboGalleryData } from "./gazebo-photos";

/** Gazebo card gallery: numbered photos from gazebo-photos.ts → the shared viewer. */
export function GazeboGallery({ name, gallery, priority = false }: {
  name: string; gallery: GazeboGalleryData; priority?: boolean;
}) {
  const indexOf = (number: number) => gallery.photos.findIndex((photo) => photo.number === number);
  return (
    <PhotoGallery
      name={name}
      photos={gallery.photos.map((photo) => ({ src: photo.src, caption: GAZEBO_PHOTO_KIND_LABEL[photo.kind] }))}
      cover={Math.max(0, indexOf(gallery.cover))}
      previews={gallery.preview.map(indexOf)}
      badge={`№${gallery.number}`}
      priority={priority}
    />
  );
}
