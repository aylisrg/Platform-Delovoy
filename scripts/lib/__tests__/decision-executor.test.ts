import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeDecision, type DecisionIo, type DecisionWire } from '../decision-executor';

const NOW = new Date('2026-09-03T12:00:00Z');
const CONFIG = { autoMerge: true, decisionGraceMinutes: 15 };
const SHA = 'abcdef1234567890';

function wire(over: Partial<DecisionWire> = {}): DecisionWire {
  return {
    id: 'dec-1',
    kind: 'merge-hold',
    subjectType: 'pr',
    subjectNumber: 832,
    headSha: SHA,
    title: 'fix: something',
    status: 'APPROVED',
    decision: 'approve',
    note: null,
    payload: null,
    decidedAt: '2026-09-03T11:30:00Z', // 30 мин назад — grace 15 прошёл
    ...over,
  };
}

function fakeIo(over: Partial<DecisionIo> = {}): DecisionIo & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const rec =
    <T,>(name: string, impl: (...args: never[]) => T) =>
    (...args: unknown[]): T => {
      (calls[name] ??= []).push(args);
      return (impl as (...a: unknown[]) => T)(...args);
    };
  return {
    calls,
    getPr: rec('getPr', () => ({ state: 'open', merged: false, headSha: SHA })),
    mergePr: rec('mergePr', () => ({ merged: true })),
    closePr: rec('closePr', () => undefined),
    comment: rec('comment', () => undefined),
    patchDecision: rec('patchDecision', () => undefined),
    closedIssueNumbers: rec('closedIssueNumbers', () => [700, 701]),
    getIssue: rec('getIssue', () => ({ state: 'open', labels: ['prio:P2', 'auto:review'] })),
    setIssueLane: rec('setIssueLane', () => undefined),
    dispatchWorkflow: rec('dispatchWorkflow', () => undefined),
    createIssue: rec('createIssue', () => ({ issue: 900, deduped: false })),
    ...over,
  };
}

beforeEach(() => vi.restoreAllMocks());

describe('executeDecision — merge-hold', () => {
  it('без subjectNumber — ошибка без побочных эффектов', () => {
    const io = fakeIo();
    expect(executeDecision(wire({ subjectNumber: null }), CONFIG, NOW, false, io)).toMatchObject({ error: 'нет subjectNumber' });
    expect(io.calls).toEqual({});
  });

  it('autoMerge=false — аварийный стоп глушит и решения', () => {
    const io = fakeIo();
    const r = executeDecision(wire(), { ...CONFIG, autoMerge: false }, NOW, false, io);
    expect(r.skipped).toContain('autoMerge=false');
    expect(io.calls.mergePr).toBeUndefined();
  });

  it('grace-окно «Отменить» ещё не прошло — ждём, PR не трогаем', () => {
    const io = fakeIo();
    const r = executeDecision(wire({ decidedAt: '2026-09-03T11:50:00Z' }), CONFIG, NOW, false, io);
    expect(r.waiting).toContain('grace 15 мин');
    expect(io.calls.getPr).toBeUndefined();
  });

  it('без decidedAt — тоже ждём (нет отсчёта для grace)', () => {
    const io = fakeIo();
    expect(executeDecision(wire({ decidedAt: null }), CONFIG, NOW, false, io)).toHaveProperty('waiting');
  });

  it('PR уже смержен — решение исполнено без мержа', () => {
    const io = fakeIo({ getPr: () => ({ state: 'closed', merged: true, headSha: SHA }) });
    const r = executeDecision(wire(), CONFIG, NOW, false, io);
    expect(r).toMatchObject({ executed: true });
    expect(io.calls.patchDecision).toEqual([['dec-1', 'EXECUTED', 'PR уже смержен']]);
    expect(io.calls.mergePr).toBeUndefined();
  });

  it('head SHA уехал после решения — EXPIRED + комментарий, мержа нет', () => {
    const io = fakeIo({ getPr: () => ({ state: 'open', merged: false, headSha: 'ffffff0000000000' }) });
    const r = executeDecision(wire(), CONFIG, NOW, false, io);
    expect(r).toMatchObject({ expired: true });
    expect(io.calls.patchDecision[0][1]).toBe('EXPIRED');
    expect(String(io.calls.patchDecision[0][2])).toContain('abcdef12');
    expect(io.calls.comment).toHaveLength(1);
    expect(io.calls.mergePr).toBeUndefined();
  });

  it('dry-run на пути к мержу — ничего не пишет', () => {
    const io = fakeIo();
    const r = executeDecision(wire(), CONFIG, NOW, true, io);
    expect(r).toMatchObject({ dryRun: true, wouldMerge: true });
    expect(io.calls.mergePr).toBeUndefined();
    expect(io.calls.patchDecision).toBeUndefined();
  });

  it('аппрув: мерж с пином к SHA решения → EXECUTED + комментарий с id решения', () => {
    const io = fakeIo();
    const r = executeDecision(wire(), CONFIG, NOW, false, io);
    expect(r).toMatchObject({ merged: true });
    expect(io.calls.mergePr).toEqual([[832, SHA]]);
    expect(io.calls.patchDecision).toEqual([['dec-1', 'EXECUTED', 'смержен']]);
    expect(String(io.calls.comment[0][1])).toContain('dec-1');
  });

  it('мерж не удался из-за смены SHA в последний момент → EXPIRED', () => {
    const io = fakeIo({ mergePr: () => ({ merged: false, reason: 'head SHA изменился после решения', detail: 'x' }) });
    const r = executeDecision(wire(), CONFIG, NOW, false, io);
    expect(r).toMatchObject({ expired: true, detail: 'x' });
    expect(io.calls.patchDecision).toEqual([['dec-1', 'EXPIRED', 'x']]);
  });

  it('CI ещё идёт — решение остаётся APPROVED, исполнение отложено', () => {
    const io = fakeIo({ mergePr: () => ({ merged: false, reason: 'CI ещё идёт' }) });
    const r = executeDecision(wire(), CONFIG, NOW, false, io);
    expect(r).toMatchObject({ deferredExecution: 'CI ещё идёт' });
    expect(io.calls.patchDecision).toBeUndefined();
  });

  it('reject: PR закрыт, открытые связанные issues → auto:blocked, закрытые не трогаем', () => {
    const io = fakeIo({
      getIssue: (n) => (n === 700 ? { state: 'open', labels: ['prio:P2', 'auto:review'] } : { state: 'closed', labels: ['auto:review'] }),
    });
    const r = executeDecision(wire({ decision: 'reject', note: 'не так' }), CONFIG, NOW, false, io);
    expect(r).toMatchObject({ closed: true });
    expect(io.calls.closePr).toEqual([[832]]);
    expect(String(io.calls.comment[0][1])).toContain('не так');
    expect(io.calls.setIssueLane).toEqual([[700, ['prio:P2', 'auto:review'], 'auto:blocked']]);
    expect(io.calls.patchDecision).toEqual([['dec-1', 'EXECUTED', 'PR закрыт']]);
  });

  it('reject: удалённая issue не роняет исполнение', () => {
    const io = fakeIo({
      getIssue: () => {
        throw new Error('404');
      },
    });
    expect(executeDecision(wire({ decision: 'reject' }), CONFIG, NOW, false, io)).toMatchObject({ closed: true });
  });

  it('reject dry-run — только отчёт', () => {
    const io = fakeIo();
    expect(executeDecision(wire({ decision: 'reject' }), CONFIG, NOW, true, io)).toMatchObject({ dryRun: true, wouldClose: true });
    expect(io.calls.closePr).toBeUndefined();
  });
});

describe('executeDecision — blocked-question', () => {
  const q = (over: Partial<DecisionWire> = {}) =>
    wire({ kind: 'blocked-question', subjectType: 'issue', subjectNumber: 590, headSha: null, ...over });

  it('«да» → issue в auto:ready + комментарий, без dispatch', () => {
    const io = fakeIo();
    const r = executeDecision(q({ note: 'делай' }), CONFIG, NOW, false, io);
    expect(r).toMatchObject({ executed: true });
    expect(io.calls.setIssueLane).toEqual([[590, ['prio:P2', 'auto:review'], 'auto:ready']]);
    expect(String(io.calls.comment[0][1])).toContain('делай');
    expect(io.calls.dispatchWorkflow).toBeUndefined();
    expect(io.calls.patchDecision).toEqual([['dec-1', 'EXECUTED', 'issue → auto:ready']]);
  });

  it('«да» для prod-apply → ещё и dispatch ops-workflow с inputs', () => {
    const io = fakeIo();
    executeDecision(
      q({ payload: { dispatchWorkflow: 'ops-tls.yml', dispatchInputs: { action: 'enable' } } }),
      CONFIG,
      NOW,
      false,
      io,
    );
    expect(io.calls.dispatchWorkflow).toEqual([['ops-tls.yml', { action: 'enable' }]]);
    expect(io.calls.patchDecision).toEqual([['dec-1', 'EXECUTED', 'dispatched ops-tls.yml']]);
  });

  it('«нет» → открытая issue в auto:parked (вопрос не переспрашивается)', () => {
    const io = fakeIo();
    const r = executeDecision(q({ decision: 'reject' }), CONFIG, NOW, false, io);
    expect(r).toMatchObject({ executed: true, parked: 590 });
    expect(io.calls.setIssueLane).toEqual([[590, ['prio:P2', 'auto:review'], 'auto:parked']]);
  });

  it('«нет» по уже закрытой issue — лейблы не трогаем, комментарий и EXECUTED остаются', () => {
    const io = fakeIo({ getIssue: () => ({ state: 'closed', labels: [] }) });
    executeDecision(q({ decision: 'reject' }), CONFIG, NOW, false, io);
    expect(io.calls.setIssueLane).toBeUndefined();
    expect(io.calls.comment).toHaveLength(1);
    expect(io.calls.patchDecision).toHaveLength(1);
  });

  it('dry-run — ничего не пишет', () => {
    const io = fakeIo();
    expect(executeDecision(q(), CONFIG, NOW, true, io)).toMatchObject({ dryRun: true });
    expect(io.calls).toEqual({});
  });
});

describe('executeDecision — owner-idea / pat-rotation / неизвестное', () => {
  it('идея → issue без auto:*-лейблов, текст цитатой, дедуп по id решения', () => {
    const io = fakeIo();
    const r = executeDecision(
      wire({ kind: 'owner-idea', subjectType: 'none', subjectNumber: null, title: 'Идея', payload: { text: 'строка 1\nстрока 2' } }),
      CONFIG,
      NOW,
      false,
      io,
    );
    expect(r).toMatchObject({ issue: 900, deduped: false });
    const [input] = io.calls.createIssue[0] as [{ title: string; body: string; labels: string[]; dedupKey: string }];
    expect(input.labels).toEqual([]);
    expect(input.dedupKey).toBe('ownerdec-dec-1');
    expect(input.body).toContain('> строка 1\n> строка 2');
    expect(io.calls.patchDecision).toEqual([['dec-1', 'EXECUTED', 'issue #900']]);
  });

  it('идея без payload.text — тело из title', () => {
    const io = fakeIo();
    executeDecision(wire({ kind: 'owner-idea', subjectNumber: null, title: 'Только заголовок', payload: null }), CONFIG, NOW, false, io);
    expect((io.calls.createIssue[0][0] as { body: string }).body).toContain('> Только заголовок');
  });

  it('pat-rotation: «Готово» владельца — EXECUTED', () => {
    const io = fakeIo();
    expect(executeDecision(wire({ kind: 'pat-rotation', subjectNumber: null }), CONFIG, NOW, false, io)).toMatchObject({ executed: true });
    expect(io.calls.patchDecision).toEqual([['dec-1', 'EXECUTED', 'владелец подтвердил ротацию']]);
  });

  it('неизвестный kind или decision=null — пропуск без побочных эффектов', () => {
    const io = fakeIo();
    expect(executeDecision(wire({ kind: 'something-new' }), CONFIG, NOW, false, io)).toHaveProperty('skipped');
    expect(executeDecision(wire({ decision: null }), CONFIG, NOW, false, io)).toHaveProperty('skipped');
    expect(io.calls).toEqual({});
  });
});
