/**
 * scripts/deploy-state.sh (issue #1074): состояние деплоя в git-тегах
 * deployed/current и deployed/previous через GITHUB_TOKEN. gh подменяется
 * фейком на PATH, который хранит refs в JSON-файле и логирует вызовы.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../deploy-state.sh');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

// Фейковый gh: refs.json = { "<tag>": {type, sha} }, vars.json = { NAME: value }.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs');
const dir = process.env.FAKE_DIR;
const args = process.argv.slice(2);
fs.appendFileSync(dir + '/calls.log', args.join(' ') + '\\n');
if (process.env.FAKE_FAIL_WRITES && args.includes('-X')) process.exit(1);
const refs = JSON.parse(fs.readFileSync(dir + '/refs.json', 'utf8'));
const vars = JSON.parse(fs.readFileSync(dir + '/vars.json', 'utf8'));
const save = () => fs.writeFileSync(dir + '/refs.json', JSON.stringify(refs));
const field = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const fval = (name) => { for (let i = 0; i < args.length; i++) if ((args[i] === '-f' || args[i] === '-F') && args[i+1].startsWith(name + '=')) return args[i+1].slice(name.length + 1); };
const method = field('-X') || 'GET';
const path = args.find((a) => a.startsWith('repos/'));
let m;
if (method === 'GET' && (m = path.match(/git\\/ref\\/tags\\/(.+)$/))) {
  const r = refs[m[1]];
  if (!r) { process.stderr.write('HTTP 404'); process.exit(1); }
  process.stdout.write(r.type + ' ' + r.sha + '\\n'); process.exit(0);
}
if (method === 'GET' && (m = path.match(/actions\\/variables\\/(.+)$/))) {
  if (!(m[1] in vars)) process.exit(1);
  process.stdout.write(vars[m[1]] + '\\n'); process.exit(0);
}
if (method === 'PATCH' && (m = path.match(/git\\/refs\\/tags\\/(.+)$/))) {
  if (!refs[m[1]]) { process.stderr.write('HTTP 422'); process.exit(1); }
  if (fval('force') !== 'true') process.exit(1);
  refs[m[1]] = { type: 'commit', sha: fval('sha') }; save(); process.exit(0);
}
if (method === 'POST' && path.endsWith('git/refs')) {
  const name = fval('ref').replace('refs/tags/', '');
  if (refs[name]) process.exit(1);
  refs[name] = { type: 'commit', sha: fval('sha') }; save(); process.exit(0);
}
process.exit(1);
`;

let dir: string;

function setup(refs: Record<string, { type: string; sha: string }>, vars: Record<string, string> = {}) {
  writeFileSync(join(dir, 'refs.json'), JSON.stringify(refs));
  writeFileSync(join(dir, 'vars.json'), JSON.stringify(vars));
}

function run(args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_DIR: dir,
      GITHUB_REPOSITORY: 'o/r',
      GH_TOKEN: 'x',
      ...extraEnv,
    },
  });
}

const refs = () => JSON.parse(readFileSync(join(dir, 'refs.json'), 'utf8'));
const calls = () => (existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8') : '');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deploy-state-'));
  writeFileSync(join(dir, 'gh'), FAKE_GH);
  chmodSync(join(dir, 'gh'), 0o755);
  execFileSync('bash', ['-n', SCRIPT]);
});

describe('deploy-state.sh get', () => {
  it('печатает SHA lightweight-тега', () => {
    setup({ 'deployed/current': { type: 'commit', sha: A } });
    const r = run(['get', 'current']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(A);
  });

  it('нет тега (404) -> пусто и exit 0 (fail-open для guard)', () => {
    setup({});
    const r = run(['get', 'previous']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('аннотированный тег или не-SHA -> пусто', () => {
    setup({ 'deployed/current': { type: 'tag', sha: A }, 'deployed/previous': { type: 'commit', sha: 'abc' } });
    expect(run(['get', 'current']).stdout.trim()).toBe('');
    expect(run(['get', 'previous']).stdout.trim()).toBe('');
  });

  it('неизвестное имя -> usage, exit 2', () => {
    setup({});
    expect(run(['get', 'other']).status).toBe(2);
  });

  it('не трогает repo variables', () => {
    setup({ 'deployed/current': { type: 'commit', sha: A } });
    run(['get', 'current']);
    expect(calls()).not.toContain('actions/variables');
  });
});

describe('deploy-state.sh record', () => {
  it('первый деплой: создаёт current, previous не создаёт', () => {
    setup({});
    const r = run(['record', A]);
    expect(r.status).toBe(0);
    expect(refs()).toEqual({ 'deployed/current': { type: 'commit', sha: A } });
  });

  it('сдвигает current -> previous и force-обновляет current', () => {
    setup({ 'deployed/current': { type: 'commit', sha: A }, 'deployed/previous': { type: 'commit', sha: C } });
    const r = run(['record', B]);
    expect(r.status).toBe(0);
    expect(refs()['deployed/current'].sha).toBe(B);
    expect(refs()['deployed/previous'].sha).toBe(A);
    expect(calls()).toMatch(/PATCH repos\/o\/r\/git\/refs\/tags\/deployed\/current .*force=true/);
  });

  it('редеплой того же SHA не затирает previous', () => {
    setup({ 'deployed/current': { type: 'commit', sha: A }, 'deployed/previous': { type: 'commit', sha: C } });
    expect(run(['record', A]).status).toBe(0);
    expect(refs()['deployed/previous'].sha).toBe(C);
  });

  it('миграция: тега нет, previous берётся из старой repo variable', () => {
    setup({}, { DEPLOYED_SHA_CURRENT: C });
    expect(run(['record', A]).status).toBe(0);
    expect(refs()['deployed/previous'].sha).toBe(C);
    expect(refs()['deployed/current'].sha).toBe(A);
  });

  it('мусор в старой variable игнорируется', () => {
    setup({}, { DEPLOYED_SHA_CURRENT: 'garbage' });
    expect(run(['record', A]).status).toBe(0);
    expect(refs()['deployed/previous']).toBeUndefined();
  });

  it('отказ записи -> громкий exit != 0', () => {
    setup({ 'deployed/current': { type: 'commit', sha: A } });
    const r = run(['record', B], { FAKE_FAIL_WRITES: '1' });
    expect(r.status).not.toBe(0);
  });

  it('невалидный SHA -> exit 2 без вызовов записи', () => {
    setup({});
    const r = run(['record', 'abc123']);
    expect(r.status).toBe(2);
    expect(calls()).not.toContain('-X');
  });
});

describe('workflows не зависят от PAT и repo variables', () => {
  const wf = (f: string) => readFileSync(resolve(__dirname, '../../../.github/workflows', f), 'utf8');
  it.each(['deploy.yml', 'deploy-error-budget.yml', 'owner-digest.yml'])('%s', (f) => {
    const src = wf(f);
    expect(src).not.toContain('DEPLOY_STATE_TOKEN');
    expect(src).not.toContain('actions/variables/DEPLOYED_SHA');
    expect(src).not.toMatch(/gh variable set/);
  });
});
