"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { GazeboGalleryData, GazeboPhoto } from "./gazebo-photos";
import styles from "./gazebos.module.css";

function Photo({ photo, name, sizes, priority = false }: {
  photo: GazeboPhoto; name: string; sizes: string; priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={styles.photoError}>Фото временно недоступно</span>;
  return (
    <Image
      src={photo.src}
      alt={`${name}, фотография ${photo.number}`}
      fill
      sizes={sizes}
      priority={priority}
      className={styles.photo}
      onError={() => setFailed(true)}
    />
  );
}

/** Native dialog provides focus containment and makes the page behind it inert. */
export function GazeboGallery({ name, gallery, priority = false }: {
  name: string; gallery: GazeboGalleryData; priority?: boolean;
}) {
  const titleId = useId();
  const hintId = useId();
  const historyKey = `gazebo-gallery-${titleId}`;
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const savedOverflow = useRef<string | null>(null);
  const pendingBack = useRef(false);
  const focusFrame = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const coverIndex = Math.max(0, gallery.photos.findIndex((photo) => photo.number === gallery.cover));
  const [index, setIndex] = useState(coverIndex);
  const [isOpen, setIsOpen] = useState(false);

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
    if (!fromHistory && window.history.state?.gazeboGallery === historyKey) {
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
      if (event.state?.gazeboGallery === historyKey) showDialog();
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
      if (window.history.state?.gazeboGallery === historyKey) {
        const { gazeboGallery: _gallery, ...state } = window.history.state;
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
    if (window.history.state?.gazeboGallery !== historyKey) {
      window.history.pushState({ ...window.history.state, gazeboGallery: historyKey }, "", window.location.href);
    }
    showDialog();
  }

  function move(direction: number) {
    setIndex((current) => (current + direction + gallery.photos.length) % gallery.photos.length);
  }

  if (gallery.photos.length === 0) return null;

  return (
    <div className={styles.gallery}>
      <button
        type="button"
        className={styles.cover}
        aria-label={`${name}: открыть фотографии`}
        aria-haspopup="dialog"
        onClick={(event) => openPhoto(coverIndex, event.currentTarget)}
      >
        <Photo key={gallery.photos[coverIndex].src} photo={gallery.photos[coverIndex]} name={name} priority={priority}
          sizes="(min-width: 1280px) 588px, (min-width: 768px) calc(50vw - 36px), calc(100vw - 32px)" />
        <span className={styles.numberBadge} aria-hidden="true">№{gallery.number}</span>
      </button>
      <div className={styles.thumbnails} aria-label={`Фотографии: ${name}`}>
        {gallery.photos.map((photo, photoIndex) => (
          <button type="button" key={photo.src} className={styles.thumbnail}
            aria-label={`${name}: открыть фото ${photo.number} из ${gallery.photos.length}`}
            aria-haspopup="dialog" onClick={(event) => openPhoto(photoIndex, event.currentTarget)}>
            <Photo key={photo.src} photo={photo} name={name} sizes="(min-width: 768px) 180px, 30vw" />
          </button>
        ))}
        <button type="button" className={styles.allPhotos} aria-haspopup="dialog"
          aria-label={`${name}: все фотографии`}
          onClick={(event) => openPhoto(coverIndex, event.currentTarget)}>
          Все {gallery.photos.length} фото
        </button>
      </div>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={hintId}
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
          if (event.key === "End") { event.preventDefault(); setIndex(gallery.photos.length - 1); }
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
            {isOpen && <Photo key={gallery.photos[index].src} photo={gallery.photos[index]} name={name} sizes="(min-width: 1280px) 1152px, 96vw" />}
          </div>
          <div className={styles.dialogControls}>
            <button type="button" className={styles.iconButton} aria-label="Предыдущее фото" onClick={() => move(-1)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
            </button>
            <p aria-live="polite" aria-atomic="true">Фото {index + 1} из {gallery.photos.length}</p>
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
