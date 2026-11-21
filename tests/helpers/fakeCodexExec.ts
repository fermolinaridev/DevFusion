import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeToolDir } from './fakeTools';
import { SPECS } from './fakeTools';

/**
 * Codex falso com `exec`: registra o argv em $ARGV_LOG (se definido), emite JSONL como
 * `codex exec --json` e grava o arquivo de `-o`. Tarefa com "dormir" fica rodando; com "falhar" falha.
 * Os demais subcomandos (--version, login status, interativo) vão para a CLI falsa padrão.
 */
export const FAKE_CODEX_EXEC = `if [ -n "\${ARGV_LOG:-}" ]; then printf '%s\\n' "$@" > "$ARGV_LOG"; fi
out=""; last=""
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; *) last=$1; shift ;; esac; done
case "$last" in *dormir*) echo '{"type":"item.started","item":{"type":"command_execution","command":"sleep 30"}}'; sleep 30 ;; esac
echo '{"type":"thread.started","thread_id":"t"}'
echo '{"type":"item.completed","item":{"type":"command_execution","command":"npm test"}}'
echo '{"type":"item.completed","item":{"type":"agent_message","text":"feito"}}'
case "$last" in *falhar*) echo '{"type":"turn.failed","error":{"message":"modelo recusou"}}'; exit 1 ;; esac
echo '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'
if [ -n "$out" ]; then printf 'feito: %s' "$last" > "$out"; fi
`;

/** `codex` = sh que trata `exec` e delega o resto à CLI falsa interativa. */
export function addFakeCodexWithExec(tools: FakeToolDir, argvLog?: string): string {
  // '*': sessão interativa também com as flags do orquestrador (-m/-c), registrando o argv.
  const inner = tools.add('codex-cli', { ...SPECS.interactiveAgent('codex'), '*': { interactive: { banner: 'codex falso', argvLog } } });
  const file = join(tools.dir, 'codex');
  writeFileSync(file, `#!/bin/sh\nif [ "\${1:-}" = exec ]; then\n  shift\n${FAKE_CODEX_EXEC}  exit 0\nfi\nexec "${inner}" "$@"\n`);
  chmodSync(file, 0o755);
  return file;
}
