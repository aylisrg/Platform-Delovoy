// @vitest-environment jsdom
//
// issue #667: кнопка/форма создания стола — те же поля, что форма
// редактирования (AC-2), обязательно только название (AC-1, AC-2), POST
// /api/ps-park подключён (AC-6).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TableCreator } from "../table-creator";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe("TableCreator (issue #667)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("кнопка открывает форму создания", () => {
    render(<TableCreator />);

    fireEvent.click(screen.getByText("+ Добавить стол"));

    expect(screen.getByText("Новый стол")).toBeTruthy();
  });

  it("не отправляет запрос без названия — блокируется на клиенте (AC-2)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: {} }));
    render(<TableCreator />);

    fireEvent.click(screen.getByText("+ Добавить стол"));
    fireEvent.click(screen.getByText("Добавить"));

    expect(await screen.findByText("Название обязательно")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("создаёт стол только с названием — цена необязательна (AC-2)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: { id: "t-new" } }));
    render(<TableCreator />);

    fireEvent.click(screen.getByText("+ Добавить стол"));
    fireEvent.change(screen.getByPlaceholderText("Например: Стол №5"), {
      target: { value: "Стол №9" },
    });
    fireEvent.click(screen.getByText("Добавить"));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/ps-park");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.name).toBe("Стол №9");
    expect(body).not.toHaveProperty("pricePerHour");
  });

  it("передаёт цену за час, если заполнена", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: { id: "t-new" } }));
    render(<TableCreator />);

    fireEvent.click(screen.getByText("+ Добавить стол"));
    fireEvent.change(screen.getByPlaceholderText("Например: Стол №5"), {
      target: { value: "Стол №10" },
    });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "500" } });
    fireEvent.click(screen.getByText("Добавить"));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.pricePerHour).toBe(500);
  });

  it("показывает ошибку сервера и не закрывает форму", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: false, error: { message: "Название обязательно" } })
    );
    render(<TableCreator />);

    fireEvent.click(screen.getByText("+ Добавить стол"));
    fireEvent.change(screen.getByPlaceholderText("Например: Стол №5"), {
      target: { value: "Стол №11" },
    });
    fireEvent.click(screen.getByText("Добавить"));

    expect(await screen.findByText("Название обязательно")).toBeTruthy();
    expect(screen.getByText("Новый стол")).toBeTruthy();
  });
});
