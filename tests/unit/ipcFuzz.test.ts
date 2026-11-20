import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';
import { IPC_ARG_SCHEMAS } from '../../src/shared/ipcContracts';

/** Valores hostis: tipos errados, poluição de protótipo, tamanhos extremos, caracteres de controle. */
const JUNK: unknown[] = [
  null, 0, -1, NaN, Infinity, true, '', ' ', 'x'.repeat(5_000_000), '\u0000', '../../etc/passwd', '/etc/passwd', 'C:\\Windows\\System32',
  [], [1, 2], {}, { __proto__: { admin: true } }, JSON.parse('{"__proto__":{"polluted":1}}'), { constructor: { prototype: { x: 1 } } },
  { agent: 'root' }, { agent: 'claude', data: 1 }, { location: { kind: 'worktree', id: '../x' }, rel: 'a' }, { id: "'; DROP TABLE tasks; --" },
  { key: 'theme', value: 'dark', extra: true }, { checks: ['os', 'rm -rf /'] }, { methodId: 'claude-npm; rm -rf /' },
];

describe('fuzz dos schemas de IPC', () => {
  it('todo canal tem schema', () => {
    for (const c of IPC_CHANNELS) expect(IPC_ARG_SCHEMAS[c as keyof typeof IPC_ARG_SCHEMAS], c).toBeDefined();
  });

  it('valores hostis nunca passam como argumento válido, exceto onde o canal aceita "nada"', () => {
    const accepted: string[] = [];
    for (const c of IPC_CHANNELS) {
      const schema = IPC_ARG_SCHEMAS[c as keyof typeof IPC_ARG_SCHEMAS];
      for (const v of JUNK) {
        let r: { success: boolean };
        expect(() => { r = schema.safeParse(v); }, `${c} lançou exceção`).not.toThrow();
        if (r!.success) accepted.push(`${c} <- ${JSON.stringify(v)?.slice(0, 40)}`);
      }
    }
    // Única aceitação legítima: "{}" em doctor:run significa "revalidar tudo".
    expect(accepted).toEqual(['doctor:run <- {}']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
