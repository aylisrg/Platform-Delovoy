/**
 * @vitest-environment jsdom
 *
 * Единственное место в проекте, где реально рендерятся компоненты
 * framer-motion (`motion.div` + `AnimatePresence` с `variants`).
 * Остальной код держит из библиотеки только тип `Variants`, поэтому
 * major-обновление framer-motion не ловится ни tsc, ни остальными тестами —
 * этот smoke закрывает дыру: рендер, показ по isVisible и autoHide.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Toast } from "../toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast — рендер компонентов framer-motion", () => {
  it("показывает сообщение при isVisible=true", () => {
    render(
      <Toast message="Бронирование создано" type="success" isVisible onClose={() => {}} />,
    );

    expect(screen.getByText("Бронирование создано")).toBeDefined();
  });

  it("ничего не рендерит при isVisible=false", () => {
    render(
      <Toast
        message="Скрытое сообщение"
        type="error"
        isVisible={false}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText("Скрытое сообщение")).toBeNull();
  });

  it("вызывает onClose по истечении autoHideDuration", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    render(
      <Toast
        message="Автоскрытие"
        type="success"
        isVisible
        onClose={onClose}
        autoHideDuration={4000}
      />,
    );

    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
