// @vitest-environment jsdom
//
// #502: сервер отвечает 402 PENALTY_CONFIRMATION_REQUIRED с
// {penaltyAmount, basePrice} в error.metadata при поздней отмене (после #426).
// К моменту заведения issue страница ещё не подтверждала штраф — к моменту
// работы над этой задачей #517 (ролевой ребилд Mini App) уже принёс полную
// обработку: диалог отмены различает 402 и повторяет DELETE с
// confirmPenalty: true. Тест фиксирует это поведение как регрессионный барьер.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const telegramMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("@/components/webapp/TelegramProvider", async () => {
  const actual = await vi.importActual<typeof import("@/components/webapp/TelegramProvider")>(
    "@/components/webapp/TelegramProvider"
  );
  return {
    ...actual,
    useTelegram: () => ({
      ready: true,
      user: { id: "u-1" },
      apiFetch: telegramMock.apiFetch,
      showBackButton: vi.fn(),
      onBackButtonClick: vi.fn(),
      haptic: {
        impact: vi.fn(),
        notification: vi.fn(),
        selection: vi.fn(),
      },
    }),
  };
});

import { ApiFetchError } from "@/components/webapp/TelegramProvider";
import BookingsPage from "../page";

const booking = {
  id: "booking-1",
  moduleSlug: "gazebos",
  resourceName: "Беседка №1",
  date: "2026-09-01",
  startTime: "10:00",
  endTime: "12:00",
  status: "CONFIRMED",
};

function mockLoadThenDelete(deleteImpl: (body: unknown) => Promise<unknown>) {
  telegramMock.apiFetch.mockImplementation(
    async (url: string, options?: RequestInit) => {
      if (url === "/api/webapp/bookings" && (!options || options.method === undefined)) {
        return [booking];
      }
      if (url === "/api/webapp/bookings" && options?.method === "DELETE") {
        return deleteImpl(JSON.parse(options.body as string));
      }
      throw new Error(`unexpected apiFetch call: ${url}`);
    }
  );
}

describe("webapp bookings page — обработка 402 PENALTY_CONFIRMATION_REQUIRED (#502)", () => {
  beforeEach(() => {
    telegramMock.apiFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("отмена без штрафа: DELETE уходит без confirmPenalty, бронь пропадает из списка", async () => {
    mockLoadThenDelete(async () => ({ ok: true }));

    render(<BookingsPage />);
    fireEvent.click(await screen.findByText("Отменить бронь"));
    fireEvent.click(screen.getAllByText("Отменить бронь")[1]);

    // Ассерт на тело запроса — ВНЕ мока apiFetch: внутри mockImplementation
    // (Promise-чейне apiFetch → try/catch компонента) любой брошенный
    // изнутри AssertionError перехватывается тем же catch, что и реальные
    // ошибки API, и молча тонет в dialogError — тест такого не ловит
    // (обнаружено мутационным прогоном при ревью #502).
    const deleteCall = await waitFor(() => {
      const call = telegramMock.apiFetch.mock.calls.find(
        ([, options]) => (options as RequestInit | undefined)?.method === "DELETE"
      );
      if (!call) throw new Error("DELETE ещё не отправлен");
      return call;
    });
    expect(JSON.parse((deleteCall[1] as RequestInit).body as string)).toEqual({
      bookingId: "booking-1",
    });
  });

  it("402 PENALTY_CONFIRMATION_REQUIRED: показывает сумму штрафа и не закрывает диалог", async () => {
    mockLoadThenDelete(async () => {
      throw new ApiFetchError({
        code: "PENALTY_CONFIRMATION_REQUIRED",
        message: "Penalty confirmation required",
        status: 402,
        data: { penaltyAmount: 500, basePrice: 1000 },
      });
    });

    render(<BookingsPage />);
    fireEvent.click(await screen.findByText("Отменить бронь"));
    fireEvent.click(screen.getAllByText("Отменить бронь")[1]);

    expect(
      await screen.findByRole("button", { name: /Отменить с штрафом 500/ })
    ).toBeTruthy();
  });

  it("подтверждение штрафа: повторный DELETE уходит с confirmPenalty: true", async () => {
    let call = 0;
    mockLoadThenDelete(async () => {
      call += 1;
      if (call === 1) {
        throw new ApiFetchError({
          code: "PENALTY_CONFIRMATION_REQUIRED",
          message: "Penalty confirmation required",
          status: 402,
          data: { penaltyAmount: 500, basePrice: 1000 },
        });
      }
      return { ok: true };
    });

    render(<BookingsPage />);
    fireEvent.click(await screen.findByText("Отменить бронь"));
    fireEvent.click(screen.getAllByText("Отменить бронь")[1]);

    const confirmButton = await screen.findByText(/Отменить с штрафом/);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(call).toBe(2));

    // Тела обоих DELETE-вызовов — вне мока (см. комментарий в первом тесте):
    // первый без confirmPenalty (сервер отвечает 402), второй — с ним.
    const deleteCalls = telegramMock.apiFetch.mock.calls.filter(
      ([, options]) => (options as RequestInit | undefined)?.method === "DELETE"
    );
    expect(deleteCalls).toHaveLength(2);
    expect(JSON.parse((deleteCalls[0][1] as RequestInit).body as string)).toEqual({
      bookingId: "booking-1",
    });
    expect(JSON.parse((deleteCalls[1][1] as RequestInit).body as string)).toEqual({
      bookingId: "booking-1",
      confirmPenalty: true,
    });
  });

  it("402 без penaltyAmount в metadata: всё равно показывает подтверждение штрафа (не тупик)", async () => {
    mockLoadThenDelete(async () => {
      throw new ApiFetchError({
        code: "PENALTY_CONFIRMATION_REQUIRED",
        message: "Penalty confirmation required",
        status: 402,
        data: {},
      });
    });

    render(<BookingsPage />);
    fireEvent.click(await screen.findByText("Отменить бронь"));
    fireEvent.click(screen.getAllByText("Отменить бронь")[1]);

    expect(await screen.findByText("Отменить со штрафом")).toBeTruthy();
  });

  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
  ])(
    "402 с penaltyAmount: %s — не рендерит его, показывает generic-лейбл штрафа",
    async (_label, penaltyAmount) => {
      mockLoadThenDelete(async () => {
        throw new ApiFetchError({
          code: "PENALTY_CONFIRMATION_REQUIRED",
          message: "Penalty confirmation required",
          status: 402,
          data: { penaltyAmount, basePrice: 1000 },
        });
      });

      render(<BookingsPage />);
      fireEvent.click(await screen.findByText("Отменить бронь"));
      fireEvent.click(screen.getAllByText("Отменить бронь")[1]);

      expect(await screen.findByText("Отменить со штрафом")).toBeTruthy();
      expect(screen.queryByText(/NaN/)).toBeNull();
      expect(screen.queryByText(/Infinity/)).toBeNull();
    }
  );

  it("прочие ошибки (не 402) — обычное сообщение об ошибке, без режима штрафа", async () => {
    mockLoadThenDelete(async () => {
      throw new ApiFetchError({
        code: "INTERNAL_ERROR",
        message: "Что-то сломалось",
        status: 500,
      });
    });

    render(<BookingsPage />);
    fireEvent.click(await screen.findByText("Отменить бронь"));
    fireEvent.click(screen.getAllByText("Отменить бронь")[1]);

    expect(await screen.findByText("Что-то сломалось")).toBeTruthy();
    expect(screen.queryByText(/штраф/i)).toBeNull();
  });
});
