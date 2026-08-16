// @vitest-environment jsdom
//
// issue #667: кнопка/форма создания ресурса — те же поля, что форма
// редактирования (AC-2), обязательно только название (AC-1, AC-2), POST
// /api/gazebos подключён (AC-6).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResourceCreator } from "../resource-creator";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe("ResourceCreator (issue #667)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("кнопка открывает форму создания", () => {
    render(<ResourceCreator />);

    fireEvent.click(screen.getByText("+ Добавить беседку"));

    expect(screen.getByText("Новая беседка")).toBeTruthy();
  });

  it("не отправляет запрос без названия — блокируется на клиенте (AC-2)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    render(<ResourceCreator />);

    fireEvent.click(screen.getByText("+ Добавить беседку"));
    fireEvent.click(screen.getByText("Добавить"));

    expect(await screen.findByText("Название обязательно")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("создаёт ресурс только с названием — остальные поля необязательны (AC-2)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: { id: "r-new" } }));
    render(<ResourceCreator />);

    fireEvent.click(screen.getByText("+ Добавить беседку"));
    fireEvent.change(screen.getByPlaceholderText("Например: Беседка №5"), {
      target: { value: "Беседка №9" },
    });
    fireEvent.click(screen.getByText("Добавить"));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/gazebos");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.name).toBe("Беседка №9");
    expect(body).not.toHaveProperty("description");
    expect(body).not.toHaveProperty("capacity");
    expect(body).not.toHaveProperty("pricePerHour");
  });

  it("собирает полную матрицу прайса будни/выходные в metadata.priceList (AC-2, паритет с ResourceEditor)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: { id: "r-new" } }));
    render(<ResourceCreator />);

    fireEvent.click(screen.getByText("+ Добавить беседку"));
    fireEvent.change(screen.getByPlaceholderText("Например: Беседка №5"), {
      target: { value: "Беседка №10" },
    });
    fireEvent.change(screen.getByPlaceholderText("Например: Большая беседка с отоплением, до 20 человек"), {
      target: { value: "Уютная беседка" },
    });

    const [capacity, weekdayHour, weekdayDay, weekendHour, weekendDay] = screen.getAllByRole("spinbutton");
    fireEvent.change(capacity, { target: { value: "8" } });
    fireEvent.change(weekdayHour, { target: { value: "500" } });
    fireEvent.change(weekdayDay, { target: { value: "4000" } });
    fireEvent.change(weekendHour, { target: { value: "700" } });
    fireEvent.change(weekendDay, { target: { value: "5500" } });

    fireEvent.click(screen.getByText("Добавить"));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.description).toBe("Уютная беседка");
    expect(body.capacity).toBe(8);
    expect(body.pricePerHour).toBe(500);
    expect(body.metadata.priceList).toEqual({
      weekdayHour: 500,
      weekdayDay: 4000,
      weekendHour: 700,
      weekendDay: 5500,
    });
  });

  it("показывает ошибку сервера и не закрывает форму", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: false, error: { message: "Название обязательно" } })
    );
    render(<ResourceCreator />);

    fireEvent.click(screen.getByText("+ Добавить беседку"));
    fireEvent.change(screen.getByPlaceholderText("Например: Беседка №5"), {
      target: { value: "Беседка №11" },
    });
    fireEvent.click(screen.getByText("Добавить"));

    expect(await screen.findByText("Название обязательно")).toBeTruthy();
    expect(screen.getByText("Новая беседка")).toBeTruthy();
  });
});
