import { describe, expect, it } from 'vitest';
import { compareSemver, RELEASES_PAGE_PREFIX } from '../../src/shared/updates';
import { pickLatest, UpdateChecker, type FetchJson } from '../../src/main/updates/UpdateChecker';

const rel = (tag: string, over: Record<string, unknown> = {}) => ({ tag_name: tag, html_url: `${RELEASES_PAGE_PREFIX}${tag}`, draft: false, prerelease: tag.includes('-'), published_at: '2026-11-20T00:00:00Z', ...over });

describe('compareSemver', () => {
  it('segue SemVer 2.0, inclusive pré-releases', () => {
    const ordered = ['0.2.0-beta.1', '0.2.0-beta.2', '0.2.0-beta.10', '0.2.0-rc.1', '0.2.0', '0.2.1', '0.10.0', '1.0.0-alpha', '1.0.0'];
    for (let i = 0; i < ordered.length - 1; i++) expect(compareSemver(ordered[i]!, ordered[i + 1]!)).toBe(-1);
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
    expect(() => compareSemver('1.2', '1.2.3')).toThrow();
  });
});

describe('pickLatest', () => {
  it('beta instalada recebe a próxima beta ou estável; rascunhos ignorados', () => {
    const list = [rel('v0.2.0-beta.1'), rel('v0.3.0-beta.1'), rel('v0.4.0', { draft: true })];
    expect(pickLatest(list, '0.2.0-beta.1')).toMatchObject({ version: '0.3.0-beta.1', prerelease: true });
    expect(pickLatest([rel('v0.2.0-beta.1')], '0.2.0-beta.1')).toBeNull();
  });

  it('versão estável instalada não recebe pré-releases', () => {
    expect(pickLatest([rel('v1.1.0-beta.1'), rel('v1.0.1')], '1.0.0')).toMatchObject({ version: '1.0.1', prerelease: false });
  });

  it('recusa URL fora do repositório oficial, tag divergente e dados malformados', () => {
    const evil = [
      rel('v9.0.0', { html_url: 'https://evil.example/releases/tag/v9.0.0' }),
      rel('v9.0.1', { html_url: `${RELEASES_PAGE_PREFIX}v1.0.0` }),
      { tag_name: 'v9.0.2' },
      rel('latest'),
      'lixo', null, 42,
    ];
    expect(pickLatest(evil, '0.2.0-beta.1')).toBeNull();
  });
});

describe('UpdateChecker', () => {
  const make = (fetchJson: FetchJson, enabled = true) => {
    const events: string[] = [];
    let on = enabled;
    const c = new UpdateChecker({ currentVersion: '0.2.0-beta.1', fetchJson, enabled: () => on, onChange: (s) => events.push(s.state), now: () => new Date('2026-11-20T12:00:00Z'), timeoutMs: 50 });
    return { c, events, setEnabled: (v: boolean) => { on = v; } };
  };

  it('avisa nova versão e expõe só a URL validada', async () => {
    const { c, events } = make(async () => [rel('v0.3.0-beta.1')]);
    const s = await c.check();
    expect(s).toMatchObject({ state: 'available', latest: { version: '0.3.0-beta.1' }, checkedAt: '2026-11-20T12:00:00.000Z' });
    expect(c.availableUrl()).toBe(`${RELEASES_PAGE_PREFIX}v0.3.0-beta.1`);
    expect(events).toEqual(['checking', 'available']);
  });

  it('desligado: não consulta a rede', async () => {
    let calls = 0;
    const { c } = make(async () => { calls++; return []; }, false);
    expect((await c.check()).state).toBe('disabled');
    expect(c.maybeCheck()).toBeNull();
    expect(calls).toBe(0);
  });

  it('erros viram estado legível: rede, resposta inesperada e tempo esgotado', async () => {
    expect((await make(async () => { throw new Error('getaddrinfo ENOTFOUND'); }).c.check())).toMatchObject({ state: 'error', error: expect.stringContaining('ENOTFOUND') });
    expect((await make(async () => ({ message: 'API rate limit exceeded' })).c.check())).toMatchObject({ state: 'error', error: 'Resposta inesperada do GitHub.' });
    const slow: FetchJson = (_u, signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    expect((await make(slow).c.check())).toMatchObject({ state: 'error', error: 'Tempo esgotado ao consultar o GitHub.' });
  });

  it('verificação automática respeita o intervalo; chamadas simultâneas compartilham a mesma consulta', async () => {
    let calls = 0;
    const { c } = make(async () => { calls++; return []; });
    const [a, b] = [c.check(), c.check()];
    expect(a).toBe(b);
    expect((await a).state).toBe('up-to-date');
    expect(c.maybeCheck()).toBeNull();
    expect(calls).toBe(1);
  });
});
