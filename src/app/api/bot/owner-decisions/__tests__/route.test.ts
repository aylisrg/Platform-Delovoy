import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/modules/owner-decisions/service', () => ({
  ownerDecide: vi.fn(),
  createOwnerIdea: vi.fn(),
  attachNote: vi.fn(),
  listDecisions: vi.fn(),
}));

import { POST } from '../route';
import { listDecisions, ownerDecide } from '@/modules/owner-decisions/service';

const BOT_TOKEN = 'bot-token';
const OWNER_ID = '694696';

function makeRequest(body: unknown, botToken: string | null = BOT_TOKEN) {
  return new NextRequest('http://localhost/api/bot/owner-decisions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(botToken ? { 'x-bot-token': botToken } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', BOT_TOKEN);
  vi.stubEnv('TELEGRAM_OWNER_CHAT_ID', OWNER_ID);
  vi.mocked(ownerDecide).mockResolvedValue({ ok: true, ack: '✅' });
  vi.mocked(listDecisions).mockResolvedValue([]);
});

describe('POST /api/bot/owner-decisions', () => {
  it('решение владельца проходит и уходит в сервис', async () => {
    const res = await POST(
      makeRequest({ op: 'decide', decisionId: 'dec1', action: 'approve', telegramUserId: OWNER_ID }),
    );
    expect(res.status).toBe(200);
    expect(ownerDecide).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: 'dec1', action: 'approve', telegramUserId: OWNER_ID }),
    );
  });

  it('401 без бот-токена', async () => {
    const res = await POST(
      makeRequest({ op: 'decide', decisionId: 'dec1', action: 'approve', telegramUserId: OWNER_ID }, null),
    );
    expect(res.status).toBe(401);
    expect(ownerDecide).not.toHaveBeenCalled();
  });

  it('403 для не-владельца — сервер не верит боту на слово', async () => {
    const res = await POST(
      makeRequest({ op: 'decide', decisionId: 'dec1', action: 'approve', telegramUserId: '111111' }),
    );
    expect(res.status).toBe(403);
    expect(ownerDecide).not.toHaveBeenCalled();
  });

  it('409 когда решение в неподходящем статусе', async () => {
    vi.mocked(ownerDecide).mockResolvedValue({ ok: false, error: 'уже исполнено' });
    const res = await POST(
      makeRequest({ op: 'decide', decisionId: 'dec1', action: 'approve', telegramUserId: OWNER_ID }),
    );
    expect(res.status).toBe(409);
  });

  it('op=list отдаёт ждущие решения', async () => {
    const res = await POST(makeRequest({ op: 'list', telegramUserId: OWNER_ID }));
    expect(res.status).toBe(200);
    expect(listDecisions).toHaveBeenCalledWith('pending');
  });
});
