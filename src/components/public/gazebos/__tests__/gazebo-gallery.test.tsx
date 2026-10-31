// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { GazeboGallery } from "../gazebo-gallery";
import { GAZEBO_GALLERIES } from "../gazebo-photos";

vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element -- Test the image contract without Next's optimization server.
    <img {...props} alt={props.alt ?? ""} />
  ),
}));

beforeEach(() => {
  window.history.replaceState({ __NA: true }, "", "/gazebos#gazebo-1");
  vi.spyOn(window.history, "back").mockImplementation(() => {
    queueMicrotask(() => {
      window.history.replaceState({ __NA: true }, "", "/gazebos#gazebo-1");
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __NA: true } }));
    });
  });
  // jsdom has no native modal lifecycle/focus trap. Browser coverage tests the real one.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) {
    this.open = true;
    this.querySelector<HTMLButtonElement>("button")?.focus();
  } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) {
    this.open = false;
  } });
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

function setup() {
  const result = render(<GazeboGallery name="Беседка №1" gallery={GAZEBO_GALLERIES[0]} />);
  const trigger = screen.getByRole("button", { name: "Беседка №1: открыть фотографии" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Беседка №1" }) as HTMLDialogElement;
  return { ...result, trigger, dialog, modal: within(dialog) };
}

describe("gazebo photo gallery", () => {
  it("cycles keyboard focus across the first and last dialog controls", () => {
    const { modal, dialog } = setup();
    const first = modal.getByRole("button", { name: "Закрыть фотографии" });
    const last = modal.getByRole("button", { name: "Следующее фото" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("opens the approved cover, counts only the three supplied photos and preserves Next history state", () => {
    const { modal } = setup();
    expect(modal.getByRole("img").getAttribute("src")).toBe("/media/gazebos/gazebo-1/photo-02.webp");
    expect(modal.getByText("Фото 2 из 3")).toBeTruthy();
    expect(window.history.state.__NA).toBe(true);
    expect(window.location.hash).toBe("#gazebo-1");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("opens all photos at the approved cover and returns focus to that button on close", async () => {
    render(<GazeboGallery name="Беседка №2" gallery={GAZEBO_GALLERIES[1]} />);
    const trigger = screen.getByRole("button", { name: "Беседка №2: все фотографии" });
    expect(trigger.textContent).toBe("Все 3 фото");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Беседка №2" }) as HTMLDialogElement;
    const modal = within(dialog);
    expect(modal.getByRole("img").getAttribute("src")).toBe("/media/gazebos/gazebo-2/photo-03.webp");
    expect(modal.getByText("Фото 3 из 3")).toBeTruthy();
    fireEvent.click(modal.getByRole("button", { name: "Закрыть фотографии" }));
    await waitFor(() => expect(dialog.open).toBe(false));
    expect(document.activeElement).toBe(trigger);
  });

  it("opens the clicked thumbnail and wraps in both directions with keyboard navigation", () => {
    render(<GazeboGallery name="Беседка №3" gallery={GAZEBO_GALLERIES[2]} />);
    fireEvent.click(screen.getByRole("button", { name: "Беседка №3: открыть фото 1 из 3" }));
    const dialog = screen.getByRole("dialog");
    const modal = within(dialog);
    expect(modal.getByText("Фото 1 из 3")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(modal.getByText("Фото 3 из 3")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(modal.getByText("Фото 1 из 3")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "End" });
    expect(modal.getByText("Фото 3 из 3")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Home" });
    expect(modal.getByText("Фото 1 из 3")).toBeTruthy();
  });

  it("ignores vertical/pinch gestures and responds to a horizontal swipe", () => {
    const { modal } = setup();
    const photoArea = modal.getByRole("img").parentElement!;
    fireEvent.touchStart(photoArea, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(photoArea, { changedTouches: [{ clientX: 190, clientY: 260 }] });
    expect(modal.getByText("Фото 2 из 3")).toBeTruthy();
    fireEvent.touchStart(photoArea, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(photoArea, { touches: [{ clientX: 200, clientY: 100 }, { clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(photoArea, { changedTouches: [{ clientX: 20, clientY: 100 }] });
    expect(modal.getByText("Фото 2 из 3")).toBeTruthy();
    fireEvent.touchStart(photoArea, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(photoArea, { changedTouches: [{ clientX: 20, clientY: 100 }] });
    expect(modal.getByText("Фото 3 из 3")).toBeTruthy();
  });

  it.each(["close", "escape", "backdrop", "browser-back"])("%s closes, restores focus/scroll and permits reopening", async (method) => {
    document.body.style.overflow = "auto";
    const { trigger, dialog, modal } = setup();
    if (method === "close") fireEvent.click(modal.getByRole("button", { name: "Закрыть фотографии" }));
    if (method === "escape") fireEvent(dialog, new Event("cancel", { cancelable: true }));
    if (method === "backdrop") fireEvent.click(dialog);
    if (method === "browser-back") window.history.back();
    await waitFor(() => expect(dialog.open).toBe(false));
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("auto");
    fireEvent.click(trigger);
    expect(dialog.open).toBe(true);
    expect(modal.getByText("Фото 2 из 3")).toBeTruthy();
  });

  it("does not stack history on double-open or navigate twice on double-close", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const { dialog, trigger, modal } = setup();
    fireEvent.click(trigger);
    expect(push).toHaveBeenCalledTimes(1);
    const close = modal.getByRole("button", { name: "Закрыть фотографии" });
    fireEvent.click(close);
    fireEvent.click(close);
    fireEvent.click(trigger);
    expect(window.history.back).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dialog.open).toBe(false));
    fireEvent.click(trigger);
    expect(push).toHaveBeenCalledTimes(2);
    expect(dialog.open).toBe(true);
  });

  it("restores the same photo on Forward without creating another history entry", async () => {
    const { dialog, modal } = setup();
    fireEvent.click(modal.getByRole("button", { name: "Следующее фото" }));
    const galleryState: unknown = window.history.state;
    window.history.back();
    await waitFor(() => expect(dialog.open).toBe(false));
    window.history.replaceState(galleryState, "", "/gazebos#gazebo-1");
    fireEvent(window, new PopStateEvent("popstate", { state: galleryState }));
    expect(dialog.open).toBe(true);
    expect(modal.getByText("Фото 3 из 3")).toBeTruthy();
  });

  it("reports image failure truthfully and still permits navigation and closing", async () => {
    const { modal, dialog } = setup();
    fireEvent.error(modal.getByRole("img"));
    expect(modal.getByText("Фото временно недоступно")).toBeTruthy();
    fireEvent.click(modal.getByRole("button", { name: "Следующее фото" }));
    expect(modal.getByRole("img").getAttribute("src")).toContain("photo-03.webp");
    fireEvent.click(modal.getByRole("button", { name: "Закрыть фотографии" }));
    await waitFor(() => expect(dialog.open).toBe(false));
  });

  it("releases the scroll lock when unmounted while open", () => {
    const { unmount } = setup();
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
