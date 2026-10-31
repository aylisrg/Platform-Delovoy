import type { ImageProps } from "next/image";

/** Fixture adapter only: real React gallery/CSS, no Next image optimizer or photos. */
export default function FixtureImage({ src, alt, fill, priority, sizes, onError, className }: ImageProps) {
  const url = typeof src === "string" ? src : "src" in src ? src.src : src.default.src;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Deliberate fixture adapter; requests receive labeled SVG test data.
    <img src={url} alt={alt} className={className} sizes={sizes} onError={onError}
      loading={priority ? "eager" : "lazy"}
      style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : undefined} />
  );
}
