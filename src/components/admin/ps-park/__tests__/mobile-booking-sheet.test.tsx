// @vitest-environment jsdom
//
// issue #665: quick-форма бронирования не давала указать комментарий/email —
// мобильная форма должна получить те же поля, что десктопная (паритет, AC-2).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileBookingSheet } from "../mobile-booking-sheet";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

function renderSheet() {
  return render(
    <MobileBookingSheet
      open
      onClose={vi.fn()}
      onCreated={vi.fn()}
      resourceId="table-1"
      resourceName="Стол №1"
      date="2030-06-15"
      startTime="10:00"
      maxEndTime="23:00"
      pricePerHour={500}
    />
  );
}

describe("MobileBookingSheet — комментарий и email (issue #665)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("отправляет заполненные комментарий и email в теле запроса", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    renderSheet();

    fireEvent.change(screen.getByPlaceholderText("Например, Иван"), { target: { value: "Иван" } });
    fireEvent.change(screen.getByPlaceholderText("guest@example.com"), {
      target: { value: "guest@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пожелания гостя, особые условия…"), {
      target: { value: "Аллергия на орехи" },
    });
    fireEvent.click(screen.getByText(/Забронировать/));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.email).toBe("guest@example.com");
    expect(body.comment).toBe("Аллергия на орехи");
  });

  it("не отправляет comment/email в теле запроса, когда поля пустые", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    renderSheet();

    fireEvent.change(screen.getByPlaceholderText("Например, Иван"), { target: { value: "Иван" } });
    fireEvent.click(screen.getByText(/Забронировать/));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("comment");
  });
});

describe("MobileBookingSheet — автокомплит гостя по телефону (issue #666)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("показывает подсказки после ввода 3+ символов телефона (AC-1, паритет с desktop)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [{ name: "Иван Петров", phone: "+79991234567" }] })
    );
    renderSheet();

    const phoneInput = screen.getByPlaceholderText("+7 ___ ___ __ __");
    fireEvent.focus(phoneInput);
    fireEvent.change(phoneInput, { target: { value: "999" } });

    await screen.findByText("Иван Петров", {}, { timeout: 1000 });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/ps-park/guests/search?phone=999"),
      expect.anything()
    );
  });

  it("выбор гостя подставляет имя и телефон", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [{ name: "Иван Петров", phone: "+79991234567" }] })
    );
    renderSheet();

    const phoneInput = screen.getByPlaceholderText("+7 ___ ___ __ __") as HTMLInputElement;
    fireEvent.focus(phoneInput);
    fireEvent.change(phoneInput, { target: { value: "999" } });
    const suggestion = await screen.findByText("Иван Петров", {}, { timeout: 1000 });
    fireEvent.mouseDown(suggestion);

    const nameInput = screen.getByPlaceholderText("Например, Иван") as HTMLInputElement;
    expect(nameInput.value).toBe("Иван Петров");
    expect(phoneInput.value).toBe("+79991234567");
  });
});
