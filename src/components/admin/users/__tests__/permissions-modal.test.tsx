// @vitest-environment jsdom
//
// #485: пользовательский фидбек — «Не скролится на мобиле права». Модалка
// ограничивала прокрутку только внутренним блоком (max-h-[60vh]
// overflow-y-auto на body), а сам контейнер модалки не имел ни ограничения
// по высоте, ни overflow — на коротких мобильных viewport'ах header+body+footer
// суммарно превышали экран, и обрезанная часть не прокручивалась. Модалка
// теперь сама max-h-[90vh] flex flex-col, а скроллится именно body (flex-1
// overflow-y-auto); header/footer остаются на месте.
//
// PRD 2026-10-25 US-A4: три группы — «Доступны по роли» (только чтение),
// «Можно выдать», «Особый доступ»; роль-разделы на сохранение не уходят.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PermissionsModal, PERMISSIONS_TEXTS } from "../permissions-modal";

const nedelovoy = { slug: "nedelovoy", label: "НеДеловой", icon: "🏗" };

const managerResponse = {
  success: true,
  data: {
    userId: "user-1",
    userName: "Иван",
    userRole: "MANAGER",
    roleSections: [],
    grantableSections: [
      { slug: "gazebos", label: "Беседки", icon: "🏕️" },
      { slug: "ps-park", label: "PS Park", icon: "🎮" },
    ],
    strictSections: [nedelovoy],
    granted: ["gazebos"],
    notes: { superadminStrictAutoGrant: false },
  },
};

const superadminResponse = {
  success: true,
  data: {
    userId: "sa-1",
    userName: "Владелец",
    userRole: "SUPERADMIN",
    roleSections: [
      { slug: "dashboard", label: "Дашборд", icon: "📊" },
      { slug: "telephony", label: "Звонки", icon: "☎" },
    ],
    grantableSections: [],
    strictSections: [nedelovoy],
    granted: [],
    notes: { superadminStrictAutoGrant: true },
  },
};

function mockFetch(getBody: unknown, putBody: unknown = { success: true, data: { userId: "x", granted: [] } }) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve({ json: () => Promise.resolve(init?.method === "PUT" ? putBody : getBody) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PermissionsModal", () => {
  it("caps the whole modal to the viewport height and scrolls only the section list", async () => {
    mockFetch(managerResponse);
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

  it("AC-A4.1: SUPERADMIN — role sections read-only, НеДеловой manageable, auto-grant note", async () => {
    mockFetch(superadminResponse);
    render(
      <PermissionsModal userId="sa-1" userName="Владелец" userRole="SUPERADMIN" onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(PERMISSIONS_TEXTS.roleGroup)).toBeTruthy());
    const roleList = screen.getByTestId("role-sections");
    expect(roleList.textContent).toContain("Дашборд");
    expect(roleList.querySelector("input")).toBeNull();
    expect(screen.queryByText(PERMISSIONS_TEXTS.grantableGroup)).toBeNull();
    expect(screen.getByText(PERMISSIONS_TEXTS.strictGroup)).toBeTruthy();
    expect(screen.getByText(PERMISSIONS_TEXTS.superadminStrictNote)).toBeTruthy();
  });

  it("AC-A4.2: saving for SUPERADMIN sends only managed (strict) sections", async () => {
    const fetchMock = mockFetch(superadminResponse);
    const onSaved = vi.fn();
    render(
      <PermissionsModal userId="sa-1" userName="Владелец" userRole="SUPERADMIN" onClose={vi.fn()} onSaved={onSaved} />,
    );

    const checkbox = await screen.findByRole("checkbox", { name: /НеДеловой/ });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({ sections: ["nedelovoy"] });
  });

  it("MANAGER: grantable and strict groups, «Выбрать все» covers only grantable", async () => {
    const fetchMock = mockFetch(managerResponse);
    render(
      <PermissionsModal userId="user-1" userName="Иван" userRole="MANAGER" onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText("1 из 2")).toBeTruthy());
    fireEvent.click(screen.getByText("Выбрать все"));
    expect(screen.getByText("2 из 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(putCall?.[1]?.body)).sections.sort()).toEqual(["gazebos", "ps-park"]);
  });

  it("shows the server error (e.g. SECTION_NOT_GRANTABLE) inside the modal", async () => {
    mockFetch(managerResponse, {
      success: false,
      error: { code: "SECTION_NOT_GRANTABLE", message: "Раздел «Звонки» доступен только суперадмину" },
    });
    render(
      <PermissionsModal userId="user-1" userName="Иван" userRole="MANAGER" onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await screen.findByText("Выбрать все");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(screen.getByText("Раздел «Звонки» доступен только суперадмину")).toBeTruthy());
  });

  it("USER: explains that rights are for the team only, no save button", () => {
    mockFetch({ success: true, data: { ...managerResponse.data, userRole: "USER" } });
    render(<PermissionsModal userId="u" userName="Клиент" userRole="USER" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText(PERMISSIONS_TEXTS.notInTeam)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull();
  });
});
