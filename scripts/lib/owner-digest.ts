/**
 * Вечерний дайджест владельцу (ADR 2026-08-20-owner-out-of-github) — чистая
 * сборка текста. Владелец не открывает GitHub: всё, что раньше требовало
 * заглянуть в репозиторий (что уехало в прод, что с бэклогом, что ждёт
 * решения), приезжает одним сообщением в личный Telegram в 21:00 МСК.
 *
 * I/O нет — данные собирает scripts/owner-digest.ts, отправляет workflow
 * owner-digest.yml. Кнопок в дайджесте нет намеренно: действия живут в
 * отдельных decision-сообщениях и команде /decisions бота.
 */

import type { WeeklyFunnelDigest } from '../../src/modules/analytics/types';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const RU_MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «14–20 сентября» или «28 сентября – 4 октября» — владельцу, а не машине. */
export function formatRuPeriod(dateFrom: string, dateTo: string): string {
  const [, fromMonth, fromDay] = dateFrom.split('-');
  const [, toMonth, toDay] = dateTo.split('-');
  const month = (m: string) => RU_MONTHS_GENITIVE[Number(m) - 1] ?? m;
  const day = (d: string) => String(Number(d));
  return fromMonth === toMonth
    ? `${day(fromDay)}–${day(toDay)} ${month(toMonth)}`
    : `${day(fromDay)} ${month(fromMonth)} – ${day(toDay)} ${month(toMonth)}`;
}

export interface DigestPr {
  number: number;
  title: string;
}

export interface DigestDecision {
  title: string;
  kind: string;
  status: string; // PENDING | DEFERRED
  ageHours: number;
}

export interface OwnerDigestInput {
  /** Короткий SHA задеплоенного прода; null — переменная не прочиталась. */
  deployedShaShort: string | null;
  /** PR, смерженные за последние 24 ч (все — это и есть «что уехало»). */
  mergedPrs: DigestPr[];
  backlog: {
    totalOpen: number;
    opened24h: number;
    closed24h: number;
  };
  /** Ждущие решения (PENDING + DEFERRED с возрастом) — напоминание, не кнопки. */
  decisions: DigestDecision[];
  /** Счётчики фидбека за сутки; null — прод недоступен (секция опускается). */
  feedback: { bugs: number; suggestions: number } | null;
  /**
   * Недельный отчёт по воронке, доехавший в main за сутки (US-3 эпика #583,
   * ADR 2026-09-16-weekly-product-analyst-loop §7). null — свежего отчёта
   * сегодня нет, и блок не рендерится вовсе (AC-3.3).
   */
  weeklyFunnel: WeeklyFunnelDigest | null;
}

const MAX_PR_LINES = 10;

/**
 * Блок недельной воронки: выжимка и гипотезы, ждущие слова владельца.
 * Полный отчёт не пересказывается — только путь к файлу (AC-3.4); ссылок на
 * GitHub нет намеренно, владелец туда не ходит.
 */
function weeklyFunnelLines(w: WeeklyFunnelDigest): string[] {
  const header = `📊 <b>Воронка за неделю ${escapeHtml(formatRuPeriod(w.period.dateFrom, w.period.dateTo))}</b>`;
  // Мало данных — одна честная строка. Выдуманных процентов здесь быть не должно.
  if (w.insufficientData) {
    return [header, 'Данных за неделю мало — разбора и гипотез нет.'];
  }

  const lines = [header];
  for (const f of w.funnels) {
    if (f.insufficientData) {
      lines.push(`• ${escapeHtml(f.label)}: мало данных за неделю — выводов не делаем`);
      continue;
    }
    const delta = f.endToEndDeltaPp === null
      ? ''
      : ` (${f.endToEndDeltaPp > 0 ? '+' : f.endToEndDeltaPp < 0 ? '−' : '±'}${Math.abs(f.endToEndDeltaPp).toFixed(1)} пп)`;
    const drop = f.biggestDropLabel && f.biggestDropConversion !== null
      ? `; слабое место — «${escapeHtml(f.biggestDropLabel)}» (${f.biggestDropConversion.toFixed(1)}%)`
      : '';
    lines.push(
      `• ${escapeHtml(f.label)}: до конца воронки доходит ${f.endToEndConversion.toFixed(1)}%${delta}${drop}`,
    );
  }

  if (w.hypotheses.length === 0) {
    // Отсутствие гипотез — тоже информация: неделя разобрана, предлагать нечего.
    lines.push('💡 Гипотез на этой неделе нет.');
  } else {
    lines.push(
      `💡 <b>Гипотезы недели (${w.hypotheses.length})</b> — ждут твоего «делай», сами в работу не уйдут:`,
    );
    // Заголовки пришли из прозы агента — данные, не разметка.
    for (const h of w.hypotheses) lines.push(`• ${escapeHtml(h.title)} (#${h.issue})`);
  }
  lines.push(`Полный отчёт — ${escapeHtml(w.reportPath)}`);
  return lines;
}

export function buildOwnerDigest(i: OwnerDigestInput): string {
  const lines: string[] = ['🌙 <b>Деловой — вечерняя сводка</b>', ''];

  // Что уехало в прод
  if (i.mergedPrs.length === 0) {
    lines.push('🚀 За сутки в прод ничего не выкатывалось.');
  } else {
    lines.push(`🚀 <b>Уехало в прод за сутки (${i.mergedPrs.length}):</b>`);
    for (const pr of i.mergedPrs.slice(0, MAX_PR_LINES)) {
      lines.push(`• ${escapeHtml(pr.title)} (#${pr.number})`);
    }
    if (i.mergedPrs.length > MAX_PR_LINES) {
      lines.push(`• …и ещё ${i.mergedPrs.length - MAX_PR_LINES}`);
    }
    if (i.deployedShaShort) {
      lines.push(`Прод сейчас на <code>${escapeHtml(i.deployedShaShort)}</code>.`);
    }
  }
  lines.push('');

  // Бэклог
  const delta = i.backlog.closed24h - i.backlog.opened24h;
  const deltaText = delta > 0 ? `−${delta} за сутки` : delta < 0 ? `+${-delta} за сутки` : 'без изменений';
  lines.push(
    `📋 Бэклог: открыто <b>${i.backlog.totalOpen}</b> (${deltaText}; закрыто ${i.backlog.closed24h}, новых ${i.backlog.opened24h}).`,
  );
  lines.push('');

  // Решения
  if (i.decisions.length === 0) {
    lines.push('✅ Твоих решений никто не ждёт.');
  } else {
    lines.push(`❓ <b>Ждут твоего решения (${i.decisions.length})</b> — команда /decisions в боте:`);
    for (const d of i.decisions.slice(0, 8)) {
      // APPROVED в этом списке = «аппрув завис»: мерж не случился (CI не
      // зеленеет) — владелец должен это видеть, а не жить с «Принято» и тишиной.
      const mark = d.status === 'DEFERRED' ? '⏸' : d.status === 'APPROVED' ? '⚠' : '•';
      const note = d.status === 'APPROVED' ? ' (аппрув есть, мерж завис — CI?)' : '';
      lines.push(`${mark} ${escapeHtml(d.title)}${note} — ждёт ${Math.round(d.ageHours)} ч`);
    }
  }
  lines.push('');

  // Воронка за неделю (US-3) — между решениями и пользователями: это не
  // требование действия, но и не фон, а разбор недели с ожидающими гипотезами.
  if (i.weeklyFunnel) {
    lines.push(...weeklyFunnelLines(i.weeklyFunnel));
    lines.push('');
  }

  // Пользователи
  if (i.feedback) {
    if (i.feedback.bugs === 0 && i.feedback.suggestions === 0) {
      lines.push('👥 Фидбека от пользователей за сутки не было.');
    } else {
      lines.push(
        `👥 Пользователи за сутки: багов — ${i.feedback.bugs} (уже в очереди), предложений — ${i.feedback.suggestions}.`,
      );
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
