"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "./photo-gallery.module.css";

/** One photograph: `caption` says what it shows («зал», «мангальная зона») and builds the alt text. */
export type GalleryPhoto = { src: string; caption: string };

function Photo({ photo, name, sizes, priority = false, decorative = false }: {
  photo: GalleryPhoto; name: string; sizes: string; priority?: boolean;
  /** The surrounding button already names the photo; avoid announcing it twice. */
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={styles.photoError}>{decorative ? "" : "Фото временно недоступно"}</span>;
  return (
    <Image
      src={photo.src}
      alt={decorative ? "" : `${name}, ${photo.caption}`}
      fill
      sizes={sizes}
      priority={priority}
      className={styles.photo}
      onError={() => setFailed(true)}
    />
  );
}

const DEFAULT_COVER_SIZES = "(min-width: 1280px) 588px, (min-width: 768px) calc(50vw - 36px), calc(100vw - 32px)";

/**
 * Cover + preview thumbnails + modal viewer with a filmstrip. Shared by the
 * gazebo catalog and the Play Park page. Native dialog provides focus
 * containment and makes the page behind it inert.
 */
export function PhotoGallery({
  name, photos, cover = 0, previews: previewIndexes = [], badge, priority = false,
  coverSizes = DEFAULT_COVER_SIZES, tone = "light",
}: {
  /** Dialog title and the prefix of every control label, e.g. «Беседка №1». */
  name: string;
  photos: readonly GalleryPhoto[];
  /** Index of the photo shown large. */
  cover?: number;
  /** Indexes shown as thumbnails under the cover (the cover itself is skipped). */
  previews?: readonly number[];
  /** Short visual label over the cover (decorative, hidden from screen readers). */
  badge?: string;
  priority?: boolean;
  coverSizes?: string;
  tone?: "light" | "dark";
}) {
  const titleId = useId();
  const hintId = useId();
  const historyKey = `photo-gallery-${titleId}`;
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const savedOverflow = useRef<string | null>(null);
  const pendingBack = useRef(false);
  const focusFrame = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const coverIndex = cover >= 0 && cover < photos.length ? cover : 0;
  const [index, setIndex] = useState(coverIndex);
  const [isOpen, setIsOpen] = useState(false);
  const filmstrip = useRef<HTMLDivElement>(null);
  const previews = previewIndexes
    .filter((photoIndex) => photoIndex >= 0 && photoIndex < photos.length && photoIndex !== coverIndex);

  // Keep the active filmstrip thumbnail visible as the viewer moves through 10–18 photos.
  useEffect(() => {
    if (!isOpen) return;
    const active = filmstrip.current?.querySelector<HTMLElement>('[aria-current="true"]');
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [index, isOpen]);

  const restorePage = useCallback(() => {
    if (savedOverflow.current !== null) {
      document.body.style.overflow = savedOverflow.current;
      savedOverflow.current = null;
    }
    const button = trigger.current;
    button?.focus({ preventScroll: true });
    // History traversal can restore its own focus after popstate handlers run.
    // Reapply ours on the next frame, unless another modal has already opened.
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      if (button?.isConnected && !document.querySelector("dialog[open]")) {
        button.focus({ preventScroll: true });
      }
    });
  }, []);

  const showDialog = useCallback(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    if (focusFrame.current !== null) {
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = null;
    }
    savedOverflow.current = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    setIsOpen(true);
  }, []);

  const closeDialog = useCallback((fromHistory = false) => {
    if (!dialog.current?.open) return;
    if (!fromHistory && window.history.state?.photoGallery === historyKey) {
      // Leave the modal inert until popstate. Otherwise a fast close/reopen
      // could consume the next gallery's history entry and immediately close it.
      if (!pendingBack.current) {
        pendingBack.current = true;
        window.history.back();
      }
      return;
    }
    pendingBack.current = false;
    dialog.current.close();
    setIsOpen(false);
    restorePage();
  }, [historyKey, restorePage]);

  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      if (event.state?.photoGallery === historyKey) showDialog();
      else closeDialog(true);
    }
    window.addEventListener("popstate", onPopState);
    const element = dialog.current;
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      if (element?.open) element.close();
      if (savedOverflow.current !== null) {
        document.body.style.overflow = savedOverflow.current;
        savedOverflow.current = null;
      }
      if (window.history.state?.photoGallery === historyKey) {
        const { photoGallery: _gallery, ...state } = window.history.state;
        window.history.replaceState(state, "", window.location.href);
      }
    };
  }, [closeDialog, historyKey, showDialog]);

  function openPhoto(photoIndex: number, button: HTMLButtonElement) {
    if (dialog.current?.open) return;
    trigger.current = button;
    setIndex(photoIndex);
    // Same URL: gallery navigation must not replace the numbered page anchors.
    // Keep Next's history state so its own Back/Forward handling stays intact.
    if (window.history.state?.photoGallery !== historyKey) {
      window.history.pushState({ ...window.history.state, photoGallery: historyKey }, "", window.location.href);
    }
    showDialog();
  }

  function move(direction: number) {
    setIndex((current) => (current + direction + photos.length) % photos.length);
  }

  if (photos.length === 0) return null;

  return (
    <div className={styles.gallery} data-tone={tone}>
      <button
        type="button"
        className={styles.cover}
        aria-label={`${name}: открыть фотографии`}
        aria-haspopup="dialog"
        onClick={(event) => openPhoto(coverIndex, event.currentTarget)}
      >
        <Photo key={photos[coverIndex].src} photo={photos[coverIndex]} name={name} priority={priority} sizes={coverSizes} />
        {badge && <span className={styles.badge} aria-hidden="true">{badge}</span>}
      </button>
      <div className={styles.thumbnails} aria-label={`Фотографии: ${name}`}>
        {previews.map((photoIndex) => {
          const photo = photos[photoIndex];
          return (
            <button type="button" key={photo.src} className={styles.thumbnail}
              aria-label={`${name}: открыть фото ${photoIndex + 1} из ${photos.length}, ${photo.caption}`}
              aria-haspopup="dialog" onClick={(event) => openPhoto(photoIndex, event.currentTarget)}>
              <Photo key={photo.src} photo={photo} name={name} sizes="(min-width: 1280px) 140px, (min-width: 768px) 12vw, 24vw" />
            </button>
          );
        })}
        <button type="button" className={styles.allPhotos} aria-haspopup="dialog"
          aria-label={`${name}: все фотографии`}
          onClick={(event) => openPhoto(coverIndex, event.currentTarget)}>
          Все {photos.length} фото
        </button>
      </div>
      <dialog ref={dialog} className={styles.dialog} data-tone={tone} aria-labelledby={titleId} aria-describedby={hintId}
        onCancel={(event) => { event.preventDefault(); closeDialog(); }}
        onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}
        onKeyDown={(event) => {
          // Native dialog makes the page inert, but Chromium can move focus to
          // browser chrome at the ends. Keep Tab cycling through our controls.
          if (event.key === "Tab") {
            const controls = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault(); first?.focus();
            }
          }
          if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
          if (event.key === "Home") { event.preventDefault(); setIndex(0); }
          if (event.key === "End") { event.preventDefault(); setIndex(photos.length - 1); }
        }}>
        <div className={styles.dialogPanel}>
          <div className={styles.dialogHeader}>
            <h2 id={titleId}>{name}</h2>
            <button type="button" className={styles.iconButton} aria-label="Закрыть фотографии" onClick={() => closeDialog()} autoFocus>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div className={styles.dialogPhoto}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              touchStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
            }}
            onTouchMove={(event) => { if (event.touches.length !== 1) touchStart.current = null; }}
            onTouchCancel={() => { touchStart.current = null; }}
            onTouchEnd={(event) => {
              const start = touchStart.current;
              const touch = event.changedTouches[0];
              touchStart.current = null;
              if (!start || !touch) return;
              const dx = touch.clientX - start.x;
              if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(touch.clientY - start.y)) move(dx < 0 ? 1 : -1);
            }}>
            {isOpen && <Photo key={photos[index].src} photo={photos[index]} name={name} sizes="(min-width: 1280px) 1152px, 96vw" />}
            {isOpen && <span className={styles.photoCaption}>{photos[index].caption}</span>}
          </div>
          {isOpen && photos.length > 1 && (
            <div ref={filmstrip} className={styles.filmstrip} role="group" aria-label="Все фотографии">
              {photos.map((photo, photoIndex) => (
                <button type="button" key={photo.src} className={styles.filmstripItem}
                  aria-label={`Фото ${photoIndex + 1}, ${photo.caption}`}
                  aria-current={photoIndex === index ? "true" : undefined}
                  // Roving tabindex: one Tab stop for the strip, ←/→/Home/End move within it.
                  tabIndex={photoIndex === index ? 0 : -1}
                  onClick={() => setIndex(photoIndex)}>
                  <Photo photo={photo} name={name} sizes="96px" decorative />
                </button>
              ))}
            </div>
          )}
          <div className={styles.dialogControls}>
            <button type="button" className={styles.iconButton} aria-label="Предыдущее фото" onClick={() => move(-1)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
            </button>
            <p aria-live="polite" aria-atomic="true">Фото {index + 1} из {photos.length}</p>
            <button type="button" className={styles.iconButton} aria-label="Следующее фото" onClick={() => move(1)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
            </button>
          </div>
          <p id={hintId} className={styles.galleryHint}>Листайте фото свайпом или стрелками. Esc — закрыть.</p>
        </div>
      </dialog>
    </div>
  );
}
