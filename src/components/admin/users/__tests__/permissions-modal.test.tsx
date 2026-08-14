// @vitest-environment jsdom
//
// #485: пользовательский фидбек — «Не скролится на мобиле права». Модалка
// ограничивала прокрутку только внутренним блоком (max-h-[60vh]
// overflow-y-auto на body), а сам контейнер модалки не имел ни ограничения
// по высоте, ни overflow — на коротких мобильных viewport'ах header+body+footer
// суммарно превышали экран, и обрезанная часть не прокручивалась. Модалка
// теперь сама max-h-[90vh] flex flex-col, а скроллится именно body (flex-1
// overflow-y-auto); header/footer остаются на месте.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { PermissionsModal } from "../permissions-modal";

const sectionsResponse = {
  success: true,
  data: {
    allSections: [
      { slug: "gazebos", label: "Беседки", icon: "🏕️" },
      { slug: "ps-park", label: "PS Park", icon: "🎮" },
    ],
    strictSections: [],
    grantedSections: ["gazebos"],
  },
};

function mockFetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: () => Promise.resolve(sectionsResponse),
    })
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PermissionsModal", () => {
  it("caps the whole modal to the viewport height and scrolls only the section list", async () => {
    mockFetchOk();
    const { container } = render(
      <PermissionsModal
        userId="user-1"
        userName="Иван"
        userRole="MANAGER"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText("Выбрать все")).toBeTruthy());

    const modalBox = container.querySelector(".max-h-\\[90vh\\]");
    expect(modalBox).toBeTruthy();
    expect(modalBox?.className).toContain("flex-col");

    const scrollBody = container.querySelector(".flex-1.overflow-y-auto");
    expect(scrollBody).toBeTruthy();
    // Regression guard: the body must not carry its own separate height cap —
    // that's exactly what silently clipped the modal on short mobile viewports
    // (fixed-position modal, no scroll escape on the outer container).
    expect(scrollBody?.className ?? "").not.toMatch(/max-h-\[60vh\]/);
  });
});
