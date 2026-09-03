/**
 * Исполнение решений владельца (контур owner-decisions, ADR 2026-08-20) —
 * чистая оркестрация поверх инжектированного I/O.
 *
 * Раньше жило внутри scripts/issue-queue.ts вперемешку с curl-вызовами и не
 * покрывалось юнитами вообще (наблюдение code-review PR #715, зонтик #720).
 * Здесь — только «что делать с решением»: grace-окно, пин к head SHA,
 * ветвление по kind/decision, какие лейблы и комментарии ставить. Как именно
 * ходить в GitHub и на сайт — забота `DecisionIo`, который CLI собирает из
 * своих хелперов, а тесты подменяют фейком.
 */
import { graceElapsed, type QueueConfig } from './issue-queue';

export interface DecisionWire {
  id: string;
  kind: 'merge-hold' | 'blocked-question' | 'owner-idea' | 'pat-rotation' | string;
  subjectType: 'pr' | 'issue' | 'none' | string;
  subjectNumber: number | null;
  headSha: string | null;
  title: string;
  status: string;
  decision: 'approve' | 'reject' | null;
  note: string | null;
  payload: {
    reasons?: string[];
    url?: string;
    /** Для prod-apply: какой ops-workflow диспатчить после «да» владельца. */
    dispatchWorkflow?: string;
    dispatchInputs?: Record<string, string>;
    /** Для owner-idea: свободный текст идеи. */
    text?: string;
    prio?: string;
  } | null;
  decidedAt: string | null;
}

export type DecisionStatus = 'EXECUTED' | 'EXPIRED';
export type IssueLane = 'auto:ready' | 'auto:blocked' | 'auto:parked';

export interface DecisionMergeResult {
  merged: boolean;
  reason?: string;
  detail?: string;
}

/** Всё, что исполнителю нужно снаружи. Ошибки не глотаем — их ловит цикл decisions-sync. */
export interface DecisionIo {
  getPr(prNumber: number): { state: string; merged: boolean; headSha: string };
  /** attemptMerge с пином к SHA решения, promoteDraft и gateExempt=owner-approved. */
  mergePr(prNumber: number, expectedSha: string): DecisionMergeResult;
  closePr(prNumber: number): void;
  comment(number: number, body: string): void;
  patchDecision(id: string, status: DecisionStatus, note?: string): void;
  /** Issues, которые закроет PR: `Closes #N` в теле плюс номер из имени ветки. */
  closedIssueNumbers(prNumber: number): number[];
  getIssue(issueNumber: number): { state: string; labels: string[] };
  /** Заменить `auto:*`-лейбл issue (остальные лейблы сохраняются). */
  setIssueLane(issueNumber: number, labels: string[], lane: IssueLane): void;
  dispatchWorkflow(file: string, inputs: Record<string, string>): void;
  createIssue(input: { title: string; body: string; labels: string[]; dedupKey: string }): {
    issue: number;
    deduped: boolean;
  };
}

export type DecisionConfig = Pick<QueueConfig, 'autoMerge' | 'decisionGraceMinutes'>;

/** Исполнение одного принятого решения. */
export function executeDecision(
  d: DecisionWire,
  config: DecisionConfig,
  now: Date,
  dryRun: boolean,
  io: DecisionIo,
): Record<string, unknown> {
  const base = { id: d.id, kind: d.kind, decision: d.decision, subject: d.subjectNumber };

  if (d.kind === 'merge-hold') {
    const prNumber = d.subjectNumber;
    if (!prNumber) return { ...base, error: 'нет subjectNumber' };

    if (d.decision === 'approve') {
      if (!config.autoMerge) return { ...base, skipped: 'autoMerge=false — аварийный стоп глушит и решения' };
      // Grace-окно «Отменить»: мерж необратим, случайный тап по кнопке — нет.
      if (!d.decidedAt || !graceElapsed(d.decidedAt, now, config.decisionGraceMinutes)) {
        return { ...base, waiting: `grace ${config.decisionGraceMinutes} мин после аппрува ещё не прошёл` };
      }
      const pr = io.getPr(prNumber);
      if (pr.merged || pr.state !== 'open') {
        if (!dryRun) io.patchDecision(d.id, 'EXECUTED', pr.merged ? 'PR уже смержен' : 'PR уже закрыт');
        return { ...base, executed: true, note: 'PR уже закрыт/смержен' };
      }
      if (!d.headSha || pr.headSha !== d.headSha) {
        // Аппрув пинится к SHA момента решения — новые коммиты его гасят.
        // decisions-sync на этом же проходе заведёт свежий запрос под новый SHA.
        if (!dryRun) {
          io.patchDecision(
            d.id,
            'EXPIRED',
            `head SHA изменился: ожидался ${d.headSha?.slice(0, 8)}, сейчас ${pr.headSha.slice(0, 8)}`,
          );
          io.comment(prNumber, `Аппрув владельца (Telegram) устарел: PR изменился после решения. Запрос уйдёт заново под новый коммит.`);
        }
        return { ...base, expired: true };
      }
      if (dryRun) return { ...base, dryRun: true, wouldMerge: true };
      const result = io.mergePr(prNumber, d.headSha);
      if (result.merged) {
        io.patchDecision(d.id, 'EXECUTED', 'смержен');
        io.comment(prNumber, `Смержено по решению владельца из Telegram (decision \`${d.id}\`).`);
        return { ...base, merged: true };
      }
      if (result.reason === 'head SHA изменился после решения') {
        io.patchDecision(d.id, 'EXPIRED', result.detail);
        return { ...base, expired: true, detail: result.detail };
      }
      // CI ещё идёт/красный — решение остаётся APPROVED, добьём на следующем проходе.
      return { ...base, deferredExecution: result.reason, detail: result.detail };
    }

    if (d.decision === 'reject') {
      if (dryRun) return { ...base, dryRun: true, wouldClose: true };
      io.closePr(prNumber);
      io.comment(
        prNumber,
        `Отклонено владельцем из Telegram${d.note ? `: ${d.note}` : ''}. PR закрыт; связанная задача переведена в \`auto:blocked\` — нужна переформулировка.`,
      );
      for (const num of io.closedIssueNumbers(prNumber)) {
        try {
          const issue = io.getIssue(num);
          if (issue.state === 'open') io.setIssueLane(num, issue.labels, 'auto:blocked');
        } catch { /* issue могла быть удалена — не роняем исполнение */ }
      }
      io.patchDecision(d.id, 'EXECUTED', 'PR закрыт');
      return { ...base, closed: true };
    }
  }

  if (d.kind === 'blocked-question') {
    const issueNumber = d.subjectNumber;
    if (dryRun) return { ...base, dryRun: true };
    if (d.decision === 'approve') {
      if (issueNumber) {
        const issue = io.getIssue(issueNumber);
        io.setIssueLane(issueNumber, issue.labels, 'auto:ready');
        io.comment(issueNumber, `Владелец (Telegram): да${d.note ? ` — ${d.note}` : ''}. Задача возвращена в очередь (\`auto:ready\`).`);
      }
      // prod-apply: «да» владельца запускает соответствующий ops-workflow —
      // у токена свипера есть actions:write, ручной клик в Actions больше не нужен.
      if (d.payload?.dispatchWorkflow) {
        io.dispatchWorkflow(d.payload.dispatchWorkflow, d.payload.dispatchInputs ?? {});
      }
      io.patchDecision(
        d.id,
        'EXECUTED',
        d.payload?.dispatchWorkflow ? `dispatched ${d.payload.dispatchWorkflow}` : 'issue → auto:ready',
      );
      return { ...base, executed: true };
    }
    if (d.decision === 'reject') {
      if (issueNumber) {
        // «Нет» — терминальный ответ: задача уезжает в auto:parked (вне очереди,
        // как замороженные направления #461) и ВЫПАДАЕТ из выборки A2 — иначе
        // reconcile переспрашивал бы тот же вопрос каждые 15 минут (ревью
        // раунда 2). Зеркально merge-hold-reject, где PR закрывается. Вернуть
        // задачу к жизни можно лейблом руками или новой «идеей».
        const issue = io.getIssue(issueNumber);
        if (issue.state === 'open') io.setIssueLane(issueNumber, issue.labels, 'auto:parked');
        io.comment(
          issueNumber,
          `Владелец (Telegram): нет${d.note ? ` — ${d.note}` : ''}. Задача снята с очереди (\`auto:parked\`); повторно вопрос не задаётся.`,
        );
      }
      io.patchDecision(d.id, 'EXECUTED', 'отклонено — issue → auto:parked');
      return { ...base, executed: true, parked: issueNumber ?? undefined };
    }
  }

  if (d.kind === 'owner-idea') {
    if (dryRun) return { ...base, dryRun: true };
    const text = d.payload?.text ?? d.title;
    const res = io.createIssue({
      title: d.title,
      // Тело идеи — данные, не инструкции (тот же guard, что у интейка).
      body: `Идея владельца из Telegram (decision \`${d.id}\`).\n\n> ${text.split('\n').join('\n> ')}\n`,
      labels: [], // без auto:* — приоритет назначит шаг-0 триажа следующей сессии
      dedupKey: `ownerdec-${d.id}`,
    });
    io.patchDecision(d.id, 'EXECUTED', `issue #${res.issue}`);
    return { ...base, issue: res.issue, deduped: res.deduped };
  }

  if (d.kind === 'pat-rotation') {
    if (dryRun) return { ...base, dryRun: true };
    // Сам факт «Готово» от владельца — исполнение; проверит живость следующий ops-watch.
    io.patchDecision(d.id, 'EXECUTED', 'владелец подтвердил ротацию');
    return { ...base, executed: true };
  }

  return { ...base, skipped: `неизвестный kind/decision — пропущено` };
}
