// @vitest-environment jsdom
//
// #523: minBookingHours was hardcoded to 4 in this component instead of
// coming from Module.config (via TimelineData → TimelineGrid → this popover).
// These tests pin that the popover actually uses the prop, not a constant.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GazeboQuickBookingPopover } from "../quick-booking-popover";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

afterEach(() => {
  cleanup();
});

function renderPopover(minBookingHours: number) {
  const { container } = render(
    <GazeboQuickBookingPopover
      resourceId="resource-1"
      resourceName="Беседка №1"
      date="2030-06-15"
      startTime="10:00"
      maxEndTime="23:00"
      pricePerHour={500}
      minBookingHours={minBookingHours}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />
  );
  const timeInputs = container.querySelectorAll<HTMLInputElement>('input[type="time"]');
  return { startInput: timeInputs[0], endInput: timeInputs[1] };
}

describe("GazeboQuickBookingPopover minBookingHours", () => {
  it("defaults the end time to start + minBookingHours (2h), not a hardcoded 4h", () => {
    const { endInput } = renderPopover(2);
    expect(endInput.value).toBe("12:00");
  });

  it("defaults the end time to start + minBookingHours (1h) when configured to 1", () => {
    const { endInput } = renderPopover(1);
    expect(endInput.value).toBe("11:00");
  });

  it("sets the end input's min attribute to start + minBookingHours (6h)", () => {
    const { endInput } = renderPopover(6);
    expect(endInput.min).toBe("16:00");
  });
});

describe("GazeboQuickBookingPopover — комментарий и email (issue #665)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("отправляет заполненные комментарий и email в теле запроса", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    renderPopover(2);

    fireEvent.change(screen.getByPlaceholderText("Имя клиента *"), { target: { value: "Иван" } });
    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "+79991234567" } });
    fireEvent.change(screen.getByPlaceholderText("Email (необязательно)"), {
      target: { value: "guest@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Комментарий (необязательно)"), {
      target: { value: "Аллергия на орехи" },
    });
    fireEvent.click(screen.getByText("Забронировать"));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.email).toBe("guest@example.com");
    expect(body.comment).toBe("Аллергия на орехи");
  });

  it("не отправляет comment/email в теле запроса, когда поля пустые", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    renderPopover(2);

    fireEvent.change(screen.getByPlaceholderText("Имя клиента *"), { target: { value: "Иван" } });
    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "+79991234567" } });
    fireEvent.click(screen.getByText("Забронировать"));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("comment");
  });
});

describe("GazeboQuickBookingPopover — автокомплит гостя по телефону (issue #666)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("показывает подсказки после ввода 3+ символов телефона (AC-1)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [{ name: "Иван Петров", phone: "+79991234567" }] })
    );
    renderPopover(2);

    fireEvent.focus(screen.getByPlaceholderText("Телефон *"));
    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "999" } });

    await screen.findByText("Иван Петров", {}, { timeout: 1000 });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/gazebos/guests/search?phone=999"),
      expect.anything()
    );
  });

  it("не запрашивает подсказки при вводе короче 3 символов", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderPopover(2);

    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "99" } });
    await new Promise((r) => setTimeout(r, 350));

    expect(fetch).not.toHaveBeenCalled();
  });

  it("выбор гостя подставляет имя и телефон, имя остаётся редактируемым (AC-2)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: [{ name: "Иван Петров", phone: "+79991234567" }] })
    );
    renderPopover(2);

    fireEvent.focus(screen.getByPlaceholderText("Телефон *"));
    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "999" } });
    const suggestion = await screen.findByText("Иван Петров", {}, { timeout: 1000 });
    fireEvent.mouseDown(suggestion);

    const nameInput = screen.getByPlaceholderText("Имя клиента *") as HTMLInputElement;
    const phoneInput = screen.getByPlaceholderText("Телефон *") as HTMLInputElement;
    expect(nameInput.value).toBe("Иван Петров");
    expect(phoneInput.value).toBe("+79991234567");

    fireEvent.change(nameInput, { target: { value: "Иван Петров (компания)" } });
    expect(nameInput.value).toBe("Иван Петров (компания)");
  });

  it("нет совпадений — форма ведёт себя как ручной ввод (AC-3)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderPopover(2);

    fireEvent.focus(screen.getByPlaceholderText("Телефон *"));
    fireEvent.change(screen.getByPlaceholderText("Телефон *"), { target: { value: "999" } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 1000 });

    expect(screen.queryByRole("list")).toBeNull();
    const phoneInput = screen.getByPlaceholderText("Телефон *") as HTMLInputElement;
    expect(phoneInput.value).toBe("999");
  });
});
