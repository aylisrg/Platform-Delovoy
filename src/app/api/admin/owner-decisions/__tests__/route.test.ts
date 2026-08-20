import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/modules/owner-decisions/service', () => ({
  createDecisionRequest: vi.fn(),
  listDecisions: vi.fn(),
  markExecutor: vi.fn(),
}));

import { GET, PATCH, POST } from '../route';
import {
  createDecisionRequest,
  listDecisions,
  markExecutor,
} from '@/modules/owner-decisions/service';

const SECRET = 'sweeper-secret';

function makeRequest(method: string, body?: unknown, opts: { secret?: string; query?: string } = {}) {
  return new NextRequest(`http://localhost/api/admin/owner-decisions${opts.query ?? ''}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.secret !== undefined ? { Authorization: `Bearer ${opts.secret}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const VALID_CREATE = {
  kind: 'merge-hold',
  subjectType: 'pr',
  subjectNumber: 677,
  headSha: 'abc123def456',
  title: 'PR ждёт решения',
  payload: { reasons: ['трогает рубильники автоматики'] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OWNER_DECISIONS_SECRET', SECRET);
  vi.mocked(createDecisionRequest).mockResolvedValue({ id: 'dec1', created: true });
  vi.mocked(listDecisions).mockResolvedValue([]);
  vi.mocked(markExecutor).mockResolvedValue({ ok: true });
});

describe('/api/admin/owner-decisions', () => {
  it('POST создаёт запрос решения при верном секрете', async () => {
    const res = await POST(makeRequest('POST', VALID_CREATE, { secret: SECRET }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ id: 'dec1', created: true });
    expect(createDecisionRequest).toHaveBeenCalled();
  });

  it('401 при неверном секрете — контур мержа мимо гейта закрыт для посторонних', async () => {
    const res = await POST(makeRequest('POST', VALID_CREATE, { secret: 'wrong' }));
    expect(res.status).toBe(401);
    expect(createDecisionRequest).not.toHaveBeenCalled();
  });

  it('503 когда секрет не заведён (мягкая деградация периода до настройки)', async () => {
    vi.stubEnv('OWNER_DECISIONS_SECRET', '');
    const res = await POST(makeRequest('POST', VALID_CREATE, { secret: SECRET }));
    expect(res.status).toBe(503);
  });

  it('400 на невалидное тело', async () => {
    const res = await POST(makeRequest('POST', { kind: 'nonsense' }, { secret: SECRET }));
    expect(res.status).toBe(400);
  });

  it('GET ?status=decided отдаёт список для свипера', async () => {
    const res = await GET(makeRequest('GET', undefined, { secret: SECRET, query: '?status=decided' }));
    expect(res.status).toBe(200);
    expect(listDecisions).toHaveBeenCalledWith('decided');
  });

  it('PATCH передаёт отчёт исполнения в сервис', async () => {
    const res = await PATCH(
      makeRequest('PATCH', { id: 'dec1', status: 'EXECUTED', executorNote: 'смержен' }, { secret: SECRET }),
    );
    expect(res.status).toBe(200);
    expect(markExecutor).toHaveBeenCalledWith({ id: 'dec1', status: 'EXECUTED', executorNote: 'смержен' });
  });
});
