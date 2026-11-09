// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { PhotoGallery } from "../photo-gallery";

vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element -- Test the image contract without Next's optimization server.
    <img {...props} alt={props.alt ?? ""} />
  ),
}));

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) {
    this.open = true;
  } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) {
    this.open = false;
  } });
});
afterEach(() => { cleanup(); document.body.style.overflow = ""; vi.restoreAllMocks(); });

const photos = ["зал", "игровое место", "вход"].map((caption, index) => ({ caption, src: `/p/${index + 1}.webp` }));

describe("shared photo gallery", () => {
  it("renders the dark tone without a badge and builds alt text from the caption", () => {
    const { container } = render(<PhotoGallery name="Плей Парк" photos={photos} cover={0} previews={[1, 2]} tone="dark" />);
    expect(container.firstElementChild?.getAttribute("data-tone")).toBe("dark");
    expect(container.querySelector("span[aria-hidden='true']")).toBeNull();
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual([
      "Плей Парк, зал", "Плей Парк, игровое место", "Плей Парк, вход",
    ]);
    expect(screen.getByRole("button", { name: "Плей Парк: все фотографии" }).textContent).toBe("Все 3 фото");
  });

  it("drops the cover and out-of-range indexes from previews, and falls back to the first photo for a bad cover", () => {
    render(<PhotoGallery name="Плей Парк" photos={photos} cover={9} previews={[0, 2, 7, -1]} />);
    expect(screen.getAllByRole("button", { name: /открыть фото \d/ }).map((button) => button.getAttribute("aria-label")))
      .toEqual(["Плей Парк: открыть фото 3 из 3, вход"]);
    fireEvent.click(screen.getByRole("button", { name: "Плей Парк: открыть фотографии" }));
    const modal = within(screen.getByRole("dialog", { name: "Плей Парк" }));
    expect(modal.getByText("Фото 1 из 3")).toBeTruthy();
    expect(modal.getByText("зал")).toBeTruthy();
  });

  it("renders nothing without photos", () => {
    const { container } = render(<PhotoGallery name="Плей Парк" photos={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
