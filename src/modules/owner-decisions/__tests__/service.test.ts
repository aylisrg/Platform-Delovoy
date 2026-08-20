import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    ownerDecision: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logAudit: vi.fn(),
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const mockTelegramApi = vi.fn();
vi.mock('@/lib/telegram/client', () => ({
  telegramApi: (...args: unknown[]) => mockTelegramApi(...args),
}));

import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/logger';
import {
  createDecisionRequest,
  createOwnerIdea,
  listDecisions,
  markExecutor,
  ownerDecide,
} from '../service';

const mocked = vi.mocked(prisma.ownerDecision, true);
const mockedUser = vi.mocked(prisma.user, true);

const ROW = {
  id: 'dec1',
  kind: 'merge-hold',
  subjectType: 'pr',
  subjectNumber: 677,
  headSha: 'abc123def456',
  title: 'feat: печатный лист дня',
  payload: { reasons: ['трогает рубильники'], url: 'https://github.com/x/pr/677' },
  status: 'PENDING',
  decision: null,
  note: null,
  telegramMessageId: '42',
  decidedAt: null,
  executedAt: null,
  createdAt: new Date('2026-08-20T10:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TELEGRAM_OWNER_CHAT_ID', '694696');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
  mockTelegramApi.mockResolvedValue({ ok: true, result: { message_id: 42 } });
  mockedUser.findFirst.mockResolvedValue({ id: 'user1' } as never);
});

describe('createDecisionRequest', () => {
  it('идемпотентен: существующий (kind, subject, sha) не создаёт дубль и не шлёт сообщение', async () => {
    mocked.findUnique.mockResolvedValue(ROW as never);
    const res = await createDecisionRequest({
      kind: 'merge-hold',
      subjectType: 'pr',
      subjectNumber: 677,
      headSha: 'abc123def456',
      title: 'x',
    });
    expect(res).toEqual({ id: 'dec1', created: false });
    expect(mocked.create).not.toHaveBeenCalled();
    expect(mockTelegramApi).not.toHaveBeenCalled();
  });

  it('новый запрос: гасит устаревшие PENDING того же subject, создаёт строку и шлёт кнопки владельцу', async () => {
    mocked.findUnique.mockResolvedValue(null as never);
    mocked.updateMany.mockResolvedValue({ count: 1 } as never);
    mocked.create.mockResolvedValue({ ...ROW, id: 'dec2', headSha: 'newsha0000' } as never);
    mocked.update.mockResolvedValue(ROW as never);

    const res = await createDecisionRequest({
      kind: 'merge-hold',
      subjectType: 'pr',
      subjectNumber: 677,
      headSha: 'newsha0000',
      title: 'x',
      payload: { reasons: ['r1'] },
    });

    expect(res.created).toBe(true);
    expect(mocked.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ NOT: { headSha: 'newsha0000' } }),
      }),
    );
    const [method, payload] = mockTelegramApi.mock.calls[0];
    expect(method).toBe('sendMessage');
    expect((payload as { chat_id: string }).chat_id).toBe('694696');
    expect(JSON.stringify(payload)).toContain('ownerdec:dec2:approve');
  });

  it('kind без subject (pat-rotation) дедупится по живому PENDING того же kind', async () => {
    mocked.findFirst.mockResolvedValue({ ...ROW, id: 'rot1', kind: 'pat-rotation' } as never);
    const res = await createDecisionRequest({
      kind: 'pat-rotation',
      subjectType: 'none',
      subjectNumber: null,
      headSha: null,
      title: 'ротация',
    });
    expect(res).toEqual({ id: 'rot1', created: false });
    expect(mocked.create).not.toHaveBeenCalled();
  });

  it('blocked-question дедупится ПО-СУБЪЕКТНО: вопросы по разным issues не склеиваются', async () => {
    // Ревью-находка: дедуп только по kind вернул бы вопрос про issue #454
    // вместо создания вопроса про issue #590.
    mocked.findFirst.mockResolvedValue(null as never);
    mocked.create.mockResolvedValue({ ...ROW, id: 'bq590', kind: 'blocked-question', subjectNumber: 590 } as never);
    mocked.update.mockResolvedValue(ROW as never);

    await createDecisionRequest({
      kind: 'blocked-question',
      subjectType: 'issue',
      subjectNumber: 590,
      headSha: null,
      title: 'вопрос',
    });

    expect(mocked.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: 'blocked-question', subjectNumber: 590 }),
      }),
    );
    expect(mocked.create).toHaveBeenCalled();
  });
});

describe('ownerDecide', () => {
  it('approve merge-hold: статус APPROVED + ack с grace-окном + AuditLog', async () => {
    mocked.findUnique.mockResolvedValue(ROW as never);
    mocked.update.mockResolvedValue({ ...ROW, status: 'APPROVED', decision: 'approve', decidedAt: new Date() } as never);

    const res = await ownerDecide({ decisionId: 'dec1', action: 'approve', telegramUserId: '694696' });

    expect(res.ok).toBe(true);
    expect(res.ack).toContain('Мерж через');
    expect(logAudit).toHaveBeenCalledWith('user1', 'owner-decision.approve', 'OwnerDecision', 'dec1', expect.anything());
    // подтверждение с кнопкой «Отменить»
    expect(JSON.stringify(mockTelegramApi.mock.calls.at(-1))).toContain('ownerdec:dec1:cancel');
  });

  it('cancel возвращает APPROVED в PENDING — окно «Отменить» работает', async () => {
    mocked.findUnique.mockResolvedValue({ ...ROW, status: 'APPROVED' } as never);
    mocked.update.mockResolvedValue({ ...ROW, status: 'PENDING' } as never);
    const res = await ownerDecide({ decisionId: 'dec1', action: 'cancel', telegramUserId: '694696' });
    expect(res.ok).toBe(true);
    expect(mocked.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING', decision: null, decidedAt: null } }),
    );
  });

  it('исполненное решение не перерешивается', async () => {
    mocked.findUnique.mockResolvedValue({ ...ROW, status: 'EXECUTED' } as never);
    const res = await ownerDecide({ decisionId: 'dec1', action: 'approve', telegramUserId: '694696' });
    expect(res.ok).toBe(false);
  });
});

describe('createOwnerIdea', () => {
  it('создаёт сразу APPROVED (это поручение, не вопрос)', async () => {
    mocked.findFirst.mockResolvedValue(null as never);
    mocked.create.mockResolvedValue({ ...ROW, id: 'idea1', kind: 'owner-idea' } as never);
    const res = await createOwnerIdea({ text: 'Сделать тёмную тему', telegramUserId: '694696' });
    expect(res.created).toBe(true);
    expect(mocked.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', kind: 'owner-idea' }) }),
    );
  });

  it('повторная идея с тем же заголовком — дубль не заводится', async () => {
    mocked.findFirst.mockResolvedValue({ ...ROW, id: 'idea1' } as never);
    const res = await createOwnerIdea({ text: 'Сделать тёмную тему', telegramUserId: '694696' });
    expect(res.created).toBe(false);
  });
});

describe('markExecutor / listDecisions', () => {
  it('EXECUTED ставит executedAt и шлёт владельцу подтверждение', async () => {
    mocked.findUnique.mockResolvedValue(ROW as never);
    mocked.update.mockResolvedValue(ROW as never);
    const res = await markExecutor({ id: 'dec1', status: 'EXECUTED', executorNote: 'смержен' });
    expect(res.ok).toBe(true);
    expect(mocked.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXECUTED', executedAt: expect.any(Date) }) }),
    );
    expect(JSON.stringify(mockTelegramApi.mock.calls.at(-1))).toContain('677');
  });

  it('decided = APPROVED|REJECTED', async () => {
    mocked.findMany.mockResolvedValue([] as never);
    await listDecisions('decided');
    expect(mocked.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['APPROVED', 'REJECTED'] } } }),
    );
  });

  it('pending включает зависшие APPROVED — «Принято» без мержа не пропадает из виду', async () => {
    mocked.findMany.mockResolvedValue([] as never);
    await listDecisions('pending');
    const where = mocked.findMany.mock.calls[0][0]?.where as { OR: unknown[] };
    expect(where.OR).toHaveLength(2);
    expect(JSON.stringify(where.OR)).toContain('APPROVED');
  });
});
