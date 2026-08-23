// @vitest-environment jsdom
//
// Требования ТЗ §9 «которые нельзя нарушать» легко сломать при рефакторинге
// или «улучшении конверсии» — эти тесты и есть защита от такой правки.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.PropsWithChildren<{ href: string } & Record<string, unknown>>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { OfferAcceptance } from "../offer-acceptance";

const onSubmit = vi.fn();

function renderBlock(props: Partial<React.ComponentProps<typeof OfferAcceptance>> = {}) {
  return render(
    <OfferAcceptance
      lines={[
        { label: "Аренда, 4 ч × 1 100 ₽", value: "4 400 ₽" },
        { label: "Уголь, 3 кг × 1 шт", value: "400 ₽" },
      ]}
      total={4800}
      submitting={false}
      onSubmit={onSubmit}
      {...props}
    />
  );
}

/** Ждём, пока подгрузится номер действующей редакции. */
async function ready() {
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith("/api/legal/current");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ success: true, data: { slug: "v1", number: 1 } }),
  }) as unknown as typeof fetch;
});

afterEach(cleanup);

describe("OfferAcceptance — отметки", () => {
  it("обе отметки при монтировании сняты", async () => {
    renderBlock();
    await ready();

    const offer = screen.getByRole("checkbox", { name: /ознакомлен/i });
    const marketing = screen.getByRole("checkbox", { name: /рекламные сообщения/i });
    expect((offer as HTMLInputElement).checked).toBe(false);
    expect((marketing as HTMLInputElement).checked).toBe(false);
  });

  it("не восстанавливает отметки из localStorage", async () => {
    window.localStorage.setItem("acceptOffer", "true");
    window.localStorage.setItem("acceptMarketing", "true");

    renderBlock();
    await ready();

    expect(
      (screen.getByRole("checkbox", { name: /ознакомлен/i }) as HTMLInputElement).checked
    ).toBe(false);
    expect(
      (screen.getByRole("checkbox", { name: /рекламные сообщения/i }) as HTMLInputElement).checked
    ).toBe(false);
    window.localStorage.clear();
  });

  it("согласие на обработку ПД — текст, а не галочка", async () => {
    renderBlock();
    await ready();

    // Ровно две отметки: оферта и реклама. Третьей (на обработку ПД) быть не должно.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText(/152-ФЗ/)).toBeTruthy();
  });
});

describe("OfferAcceptance — отправка", () => {
  it("без обязательной отметки не отправляет и объясняет причину", async () => {
    renderBlock();
    await ready();

    fireEvent.click(screen.getByTestId("offer-accept-submit"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/подтвердите согласие с условиями оферты/i)).toBeTruthy();
  });

  it("переводит фокус на чекбокс при попытке отправки без отметки", async () => {
    renderBlock();
    await ready();

    fireEvent.click(screen.getByTestId("offer-accept-submit"));

    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /ознакомлен/i }));
  });

  it("объявляет ошибку через aria-live и связывает её с полем", async () => {
    renderBlock();
    await ready();

    fireEvent.click(screen.getByTestId("offer-accept-submit"));

    const offer = screen.getByRole("checkbox", { name: /ознакомлен/i });
    const describedBy = offer.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const errorNode = document.getElementById(describedBy!);
    expect(errorNode?.getAttribute("aria-live")).toBe("polite");
    expect(errorNode?.textContent).toMatch(/подтвердите согласие/i);
  });

  it("с отметкой отправляет редакцию оферты и снятое согласие на рекламу", async () => {
    renderBlock();
    await ready();

    fireEvent.click(screen.getByRole("checkbox", { name: /ознакомлен/i }));
    fireEvent.click(screen.getByTestId("offer-accept-submit"));

    expect(onSubmit).toHaveBeenCalledWith({ acceptMarketing: false, offerVersionSlug: "v1" });
  });

  it("передаёт согласие на рекламу, когда его проставили", async () => {
    renderBlock();
    await ready();

    fireEvent.click(screen.getByRole("checkbox", { name: /ознакомлен/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /рекламные сообщения/i }));
    fireEvent.click(screen.getByTestId("offer-accept-submit"));

    expect(onSubmit).toHaveBeenCalledWith({ acceptMarketing: true, offerVersionSlug: "v1" });
  });

  it("не отправляет, пока внешние условия не выполнены (не заполнены контакты)", async () => {
    renderBlock({ disabled: true });
    await ready();

    fireEvent.click(screen.getByRole("checkbox", { name: /ознакомлен/i }));
    fireEvent.click(screen.getByTestId("offer-accept-submit"));

    // Отметка стоит, но кнопка помечена неактивной — отправки не происходит.
    expect(screen.getByTestId("offer-accept-submit").getAttribute("aria-disabled")).toBe("true");
  });
});

describe("OfferAcceptance — что видно до оплаты", () => {
  it("показывает сумму на кнопке", async () => {
    renderBlock();
    await ready();
    // toLocaleString("ru-RU") разделяет разряды неразрывным пробелом.
    const label = screen.getByTestId("offer-accept-submit").textContent ?? "";
    expect(label.replace(/\u00a0/g, " ")).toBe("Оплатить 4 800 ₽");
  });

  it("показывает каждую позицию с ценой и итог", async () => {
    renderBlock();
    await ready();

    expect(screen.getByText("Аренда, 4 ч × 1 100 ₽")).toBeTruthy();
    expect(screen.getByText("4 400 ₽")).toBeTruthy();
    expect(screen.getByText("Уголь, 3 кг × 1 шт")).toBeTruthy();
    expect(screen.getByText("Итого")).toBeTruthy();
  });

  it("показывает условия отмены до оплаты со ссылкой на раздел 7 оферты", async () => {
    renderBlock();
    await ready();

    expect(screen.getByText("Отмена и перенос")).toBeTruthy();
    const details = screen.getByRole("link", { name: /п\. 7 оферты/i });
    expect(details.getAttribute("href")).toBe("/oferta#p-7");
  });

  it("ведёт на оферту и правила отдельными страницами в новой вкладке", async () => {
    renderBlock();
    await ready();

    const offerLink = screen.getByRole("link", { name: "Публичной оферты" });
    expect(offerLink.getAttribute("href")).toBe("/oferta");
    expect(offerLink.getAttribute("target")).toBe("_blank");
    expect(offerLink.getAttribute("rel")).toContain("noopener");

    const rulesLink = screen.getByRole("link", { name: "Правил посещения" });
    expect(rulesLink.getAttribute("href")).toBe("/oferta#pravila");
    expect(rulesLink.getAttribute("target")).toBe("_blank");
  });

  it("клик по ссылке внутри лейбла не переключает чекбокс", async () => {
    renderBlock();
    await ready();

    fireEvent.click(screen.getByRole("link", { name: "Публичной оферты" }));

    expect(
      (screen.getByRole("checkbox", { name: /ознакомлен/i }) as HTMLInputElement).checked
    ).toBe(false);
  });

  it("объясняет, что оплата и есть акцепт", async () => {
    renderBlock();
    await ready();
    expect(screen.getByText(/п\. 3 ст\. 438 ГК РФ/)).toBeTruthy();
  });

  it("не начинает оплату, пока редакция оферты не загрузилась", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    renderBlock();

    fireEvent.click(screen.getByRole("checkbox", { name: /ознакомлен/i }));
    fireEvent.click(screen.getByTestId("offer-accept-submit"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/не удалось загрузить условия оферты/i)).toBeTruthy();
  });
});
