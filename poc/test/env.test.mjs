import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { buildCleanEnv, redact, stripAnsi } from '../lib/env.mjs';

test('buildCleanEnv não repassa API keys nem variáveis de sessões hospedeiras', () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: 'sk-ant-xxxxxxxxxxxxxxxxxxxx', OPENAI_API_KEY: 'sk-yyyyyyyyyyyyyyyyyyyy', CODEX_API_KEY: 'k',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDECODE: '1',
    });
    const env = buildCleanEnv();
    for (const k of Object.keys(env)) assert.ok(!/API_KEY|TOKEN|ANTHROPIC|CLAUDE|OPENAI|CODEX/.test(k), `vazou ${k}`);
    assert.ok(env.PATH.length > 0);
    assert.equal(env.TERM, 'xterm-256color');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('redact remove e-mails, chaves, JWTs, bearer tokens, UUIDs e home', () => {
  const input = [
    'user fulano@example.com logged in',
    'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'Authorization: Bearer abcdefghijklmnop1234',
    'org 123e4567-e89b-12d3-a456-426614174000',
    `path ${homedir()}/projeto`,
  ].join('\n');
  const out = redact(input);
  assert.ok(!out.includes('fulano@example.com'));
  assert.ok(!out.includes('sk-ant-api03'));
  assert.ok(!out.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(!out.includes('abcdefghijklmnop1234'));
  assert.ok(!out.includes('123e4567-e89b'));
  assert.ok(!out.includes(homedir()));
  assert.match(out, /<email>/);
  assert.match(out, /~\/projeto/);
});

test('stripAnsi remove CSI e OSC', () => {
  assert.equal(stripAnsi('\x1b[31mvermelho\x1b[0m \x1b]0;titulo\x07ok'), 'vermelho ok');
});
