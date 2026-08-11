/**
 * Общий HTTP-путь к GitHub API для всех скриптов автоочереди и интейка.
 *
 * Аутентификация:
 *   - в GitHub Actions — заголовок Authorization с $GH_TOKEN;
 *   - в сессии Claude Code — заголовок не нужен, исходящий HTTPS идёт через
 *     agent-proxy, который сам подставляет учётку (node fetch прокси игнорирует,
 *     поэтому здесь именно curl, а не fetch).
 */
import { execFileSync } from 'node:child_process';

export const REPO = process.env.QUEUE_REPO ?? 'aylisrg/Platform-Delovoy';
const API = 'https://api.github.com';

export function ghApi<T = unknown>(path: string, method = 'GET', body?: unknown): T {
  const args = ['-sS', '-X', method, '-H', 'Accept: application/vnd.github+json', '-w', '\n%{http_code}'];
  if (process.env.GITHUB_ACTIONS && process.env.GH_TOKEN) {
    args.push('-H', `Authorization: Bearer ${process.env.GH_TOKEN}`);
  }
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body));
  args.push(path.startsWith('http') ? path : `${API}${path}`);

  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const nl = out.lastIndexOf('\n');
  const status = Number(out.slice(nl + 1));
  const text = out.slice(0, nl);
  if (status < 200 || status >= 300) {
    throw new Error(`${method} ${path} → ${status}: ${text.slice(0, 400)}`);
  }
  return (text.trim() ? JSON.parse(text) : null) as T;
}
