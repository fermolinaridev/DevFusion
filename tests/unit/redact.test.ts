import { describe, expect, it } from 'vitest';
import { redact } from '../../src/shared/redact';

describe('redact', () => {
  it('remove e-mails, chaves, JWT, tokens, UUIDs e home', () => {
    const out = redact([
      'fulano@example.com',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'Authorization: Bearer abcdefghijklmnop1234',
      'password=hunter2hunter2',
      '123e4567-e89b-12d3-a456-426614174000',
      '/Users/fulano/projeto',
    ].join('\n'), '/Users/fulano');
    for (const secret of ['fulano@example.com', 'sk-ant-api03', 'eyJhbGci', 'abcdefghijklmnop1234', 'hunter2', '123e4567', '/Users/fulano']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('~/projeto');
  });

  it('serializa objetos e erros antes de redigir', () => {
    expect(redact({ email: 'a@b.co' })).toBe('{"email":"<email>"}');
    expect(redact(new Error('falhou para a@b.co'))).toBe('Error: falhou para <email>');
  });
});
