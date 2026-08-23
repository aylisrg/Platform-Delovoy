"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { buildCancellationSummary } from "@/modules/booking/cancellation-summary";

/**
 * Блок акцепта публичной оферты перед оплатой.
 *
 * Переиспользуемый: тот же блок встанет в Плей Парк, когда появится его текст
 * оферты (ТЗ §2), и уже используется на странице управления бронью для броней,
 * оформленных оператором по телефону (ТЗ §5.4).
 *
 * Требования, которые здесь легко случайно сломать «улучшением конверсии»
 * (ТЗ §9) — они и есть смысл компонента:
 *   - обе отметки сняты и НЕ восстанавливаются: ни из вёрстки, ни скриптом,
 *     ни из localStorage;
 *   - согласие на обработку ПД — текст, а не галочка: обработка для исполнения
 *     договора согласия не требует, а лишнее согласие пришлось бы хранить и
 *     уметь отзывать;
 *   - согласие на рекламу — отдельная необязательная отметка;
 *   - клик по ссылке внутри лейбла не переключает чекбокс;
 *   - ссылки открываются в новой вкладке — состояние формы не теряется.
 */

export type OfferAcceptanceState = {
  acceptOffer: boolean;
  acceptMarketing: boolean;
  /** Редакция, которую клиент видит прямо сейчас; null — пока не загрузилась. */
  offerVersionSlug: string | null;
};

export type SummaryLine = { label: string; value: string; muted?: boolean };

export function OfferAcceptance({
  lines,
  total,
  submitLabel,
  submitting,
  disabled,
  onSubmit,
  onBack,
}: {
  /** Позиции заказа построчно с ценами (ТЗ §5.1.1). */
  lines: SummaryLine[];
  total: number;
  submitLabel?: string;
  submitting: boolean;
  /** Внешние причины блокировки (незаполненные контакты и т. п.). */
  disabled?: boolean;
  onSubmit: (state: { acceptMarketing: boolean; offerVersionSlug: string }) => void;
  onBack?: () => void;
}) {
  const [acceptOffer, setAcceptOffer] = useState(false);
  const [acceptMarketing, setAcceptMarketing] = useState(false);
  const [offerVersionSlug, setOfferVersionSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const offerCheckboxId = useId();
  const marketingCheckboxId = useId();
  const errorId = useId();

  useEffect(() => {
    // Номер редакции нужен, чтобы сервер убедился: клиент согласился именно с
    // действующим текстом. Не загрузилась — оплату не начинаем.
    let cancelled = false;
    fetch("/api/legal/current")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.success) setOfferVersionSlug(d.data.slug as string);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = buildCancellationSummary();
  const fmtRub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
  const canSubmit = acceptOffer && offerVersionSlug !== null && !submitting && !disabled;

  function handleSubmit() {
    if (!acceptOffer) {
      setError("Чтобы продолжить, подтвердите согласие с условиями оферты");
      document.getElementById(offerCheckboxId)?.focus();
      return;
    }
    if (!offerVersionSlug) {
      setError("Не удалось загрузить условия оферты. Обновите страницу.");
      return;
    }
    setError(null);
    onSubmit({ acceptMarketing, offerVersionSlug });
  }

  return (
    <div className="space-y-5">
      {/* 5.1.1 Сводка заказа */}
      <div className="rounded-2xl border border-black/[0.08] p-5">
        <ul className="space-y-2">
          {lines.map((line, i) => (
            <li
              key={i}
              className="flex justify-between gap-4 text-sm font-[family-name:var(--font-inter)]"
            >
              <span className={line.muted ? "text-[#86868b]" : "text-[#1d1d1f]"}>{line.label}</span>
              <span className="shrink-0 text-[#1d1d1f] font-medium">{line.value}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-baseline justify-between border-t border-black/[0.06] pt-3">
          <span className="text-base font-semibold text-[#1d1d1f] font-[family-name:var(--font-inter)]">
            Итого
          </span>
          <span className="text-lg font-bold text-[#1d1d1f] font-[family-name:var(--font-inter)]">
            {fmtRub(total)}
          </span>
        </div>
      </div>

      {/* 5.1.2 Условия отмены — до оплаты, а не только внутри документа */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
        <p className="text-sm font-semibold text-[#1d1d1f] font-[family-name:var(--font-inter)]">
          {summary.title}
        </p>
        <div className="mt-2 space-y-1.5">
          {summary.lines.map((line, i) => (
            <p
              key={i}
              className="text-sm leading-relaxed text-[#1d1d1f]/85 font-[family-name:var(--font-inter)]"
            >
              {line}
            </p>
          ))}
        </div>
        <p className="mt-2 text-sm font-[family-name:var(--font-inter)]">
          Подробно — в{" "}
          <Link
            href={summary.detailsHref}
            target="_blank"
            rel="noopener"
            className="text-[#0071e3] underline underline-offset-2"
          >
            {summary.detailsLabel}
          </Link>
          .
        </p>
      </div>

      {/* 5.1.3 Обязательная отметка */}
      <div>
        <label
          htmlFor={offerCheckboxId}
          className="flex min-h-[44px] cursor-pointer items-start gap-3 py-1"
        >
          <input
            id={offerCheckboxId}
            name="acceptOffer"
            type="checkbox"
            checked={acceptOffer}
            onChange={(e) => {
              setAcceptOffer(e.target.checked);
              if (e.target.checked) setError(null);
            }}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[#16A34A]"
          />
          <span className="text-sm leading-relaxed text-[#1d1d1f] font-[family-name:var(--font-inter)]">
            Я ознакомлен(а) и согласен(на) с условиями{" "}
            <Link
              href="/oferta"
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
              className="text-[#0071e3] underline underline-offset-2"
            >
              Публичной оферты
            </Link>{" "}
            и{" "}
            <Link
              href="/oferta#pravila"
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
              className="text-[#0071e3] underline underline-offset-2"
            >
              Правил посещения
            </Link>
          </span>
        </label>

        <p id={errorId} aria-live="polite" className="min-h-[1.25rem]">
          {error && (
            <span className="text-xs text-red-600 font-[family-name:var(--font-inter)]">
              {error}
            </span>
          )}
        </p>
      </div>

      {/* 5.1.4 Информационная строка о ПД — текст, а не галочка */}
      <p className="text-xs leading-relaxed text-[#86868b] font-[family-name:var(--font-inter)]">
        Ваши данные обрабатываются для оформления и исполнения бронирования на основании
        п. 5 ч. 1 ст. 6 Федерального закона № 152-ФЗ. Подробнее — в{" "}
        <Link
          href="/privacy"
          target="_blank"
          rel="noopener"
          className="text-[#0071e3] underline underline-offset-2"
        >
          Политике обработки персональных данных
        </Link>
        .
      </p>

      {/* 5.1.5 Необязательная отметка на рассылку */}
      <label
        htmlFor={marketingCheckboxId}
        className="flex min-h-[44px] cursor-pointer items-start gap-3 py-1"
      >
        <input
          id={marketingCheckboxId}
          name="acceptMarketing"
          type="checkbox"
          checked={acceptMarketing}
          onChange={(e) => setAcceptMarketing(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[#16A34A]"
        />
        <span className="text-sm leading-relaxed text-[#1d1d1f] font-[family-name:var(--font-inter)]">
          Согласен(на) получать информационные и рекламные сообщения от бизнес-парка «Деловой»
        </span>
      </label>

      {/* 5.1.6 Кнопка с суммой и подпись под ней */}
      <div className="flex flex-wrap gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-[#1d1d1f]/[0.06] px-6 py-3 text-sm font-medium text-[#1d1d1f] transition-all hover:bg-[#1d1d1f]/[0.1] font-[family-name:var(--font-inter)]"
          >
            Назад
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          // Кнопка визуально и семантически неактивна без обязательной отметки,
          // но остаётся нажимаемой: клик по ней переводит фокус на чекбокс и
          // показывает причину. disabled-кнопка не сообщила бы ничего.
          aria-disabled={!canSubmit}
          data-testid="offer-accept-submit"
          className={`rounded-full px-6 py-3 text-sm font-medium text-white transition-all font-[family-name:var(--font-inter)] ${
            canSubmit ? "bg-[#16A34A] hover:bg-[#15803d]" : "bg-[#9ca3af] cursor-not-allowed"
          }`}
        >
          {submitting
            ? "Переходим к оплате…"
            : (submitLabel ?? `Оплатить ${fmtRub(total)}`)}
        </button>
      </div>

      <p className="text-xs leading-relaxed text-[#86868b] font-[family-name:var(--font-inter)]">
        Нажимая «Оплатить», вы акцептуете Публичную оферту (п. 3 ст. 438 ГК РФ). Договор
        считается заключённым с момента подтверждения платежа.
      </p>
    </div>
  );
}
