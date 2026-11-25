import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId } from '@shared/agentIds';
import { EFFORT_LABEL, ORCH_TIERS, SPEND_HINT, SPEND_LABEL, TIER_HINT, TIER_LABEL, modelLabel, type OrchTier, type OrchestratorSettings } from '@shared/orchestrator';
import { shellQuote } from '../usage/ClaudeStatuslineBridge';

/**
 * Dev Orchestrator (Fase 9). O DevFusion NÃO orquestra: ele inicia a CLI oficial escolhida como
 * orquestrador com flags documentadas e entrega a ela:
 *  - as instruções de gerente de projeto (skill) — `--append-system-prompt` no Claude Code,
 *    `-c developer_instructions=…` no Codex;
 *  - o roster de workers do Claude como subagentes oficiais (`--agents`, com `model` e `effort`);
 *  - um script que dispara workers do Codex por `codex exec --json` (comando documentado);
 *  - hooks oficiais do Claude Code (`--settings`) que só gravam eventos num arquivo para exibição.
 * Quem decide e dispara é o agente; aprovações continuam no terminal do usuário.
 */
export interface OrchestratorContext {
  /** Já resolvida pelo nível de gasto e pelo Eco (`resolveSpend`). */
  settings: OrchestratorSettings;
  /** Pasta de eventos (hooks do Claude e arquivos dos workers do Codex). */
  eventsDir: string;
  /** Script gerado que dispara um worker do Codex. */
  scriptPath: string;
  /** Pasta para worktrees de workers em paralelo. */
  worktreesDir: string;
  workspacePath: string;
  /** Windows: `sh.exe` do Git for Windows. Nas outras plataformas não é usado. */
  shPath?: string | null;
  /** Padrão: plataforma atual (injetável para testes). */
  platform?: NodeJS.Platform;
  /** Caminho validado do Codex (null = workers do Codex indisponíveis). */
  codexPath: string | null;
  /** ai-memory ligado e encontrado: workers do Codex também passam por `ai-memory run`. */
  aiMemoryPath: string | null;
}

const isWin = (p: NodeJS.Platform | undefined) => (p ?? process.platform) === 'win32';
/** Caminho entre aspas para o sh. No Git Bash, barras normais (`C:/…`) funcionam em todo lugar. */
const shPathQuote = (path: string, platform?: NodeJS.Platform) => shellQuote(isWin(platform) ? path.replace(/\\/g, '/') : path);
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const claudeWorkerName = (tier: OrchTier) => `claude-${tier}`;

const WORKER_PROMPT = [
  'Você é um worker do DevFusion, acionado pelo orquestrador (gerente de projeto).',
  'Faça somente a tarefa recebida, no diretório indicado por ela.',
  'Não faça commit, push, merge, reset nem qualquer operação destrutiva: isso é decisão do usuário.',
  'Termine com um resumo curto: o que mudou (arquivos), como verificou (comandos e resultado real) e pendências.',
].join(' ');

/** Subagentes oficiais do Claude Code (`--agents`), um por classe de tarefa. */
export function claudeWorkerAgents(s: OrchestratorSettings): Record<string, { description: string; prompt: string; model: string; effort: string }> {
  return Object.fromEntries(ORCH_TIERS.map((t) => {
    const slot = s.roster[t].claude;
    return [claudeWorkerName(t), {
      description: `Worker do DevFusion para tarefas da classe "${TIER_LABEL[t]}" (${TIER_HINT[t]}). ${modelLabel(slot.model)}, esforço ${EFFORT_LABEL[slot.effort]}.`,
      prompt: WORKER_PROMPT,
      model: slot.model,
      effort: slot.effort,
    }];
  }));
}

/** Hooks oficiais do Claude Code: cada evento vira um arquivo JSON (só leitura pelo DevFusion). */
export function claudeEventHooks(eventsDir: string, platform?: NodeJS.Platform): Record<string, unknown> {
  const cmd = `cat > ${shPathQuote(eventsDir, platform)}/c-$(date +%s)-$$.json`;
  const entry = (matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: cmd }] }];
  return { SubagentStart: entry(), SubagentStop: entry(), PreToolUse: entry('Agent|Task'), PostToolUse: entry('Agent|Task') };
}

/** Script sh que dispara um worker do Codex (no Windows, pelo Git Bash). Gerado a cada início do orquestrador. */
export function codexWorkerScript(ctx: OrchestratorContext): string {
  const cases = ORCH_TIERS.map((t) => `  ${t}) model=${ctx.settings.roster[t].codex.model}; effort=${ctx.settings.roster[t].codex.effort} ;;`).join('\n');
  const win = isWin(ctx.platform);
  const q = (p: string) => shPathQuote(p, ctx.platform);
  // Windows: `.pid` é o PID do Windows (o app encerra com taskkill) e `.spid` o do Git Bash (contagem no script).
  const livePid = win ? 'spid' : 'pid';
  const exec = `exec --json --skip-git-repo-check -m "$model" -c "model_reasoning_effort=$effort" -s workspace-write -C "$dir" -o "$b.last" "$task" > "$b.jsonl" 2> "$b.err" < /dev/null &`;
  return `#!/bin/sh
# DevFusion — worker do Codex disparado pelo orquestrador (gerado pelo app a cada sessão; não editar).
# Uso: sh <este script> <trivial|rotina|complexa|critica> <pasta> <tarefa>
set -u
EV=${q(ctx.eventsDir)}
CODEX=${q(ctx.codexPath ?? '')}
AIMEM=${q(ctx.aiMemoryPath ?? '')}
MAX=${ctx.settings.maxParallel}
if [ $# -lt 3 ]; then echo "uso: sh $0 <trivial|rotina|complexa|critica> <pasta> <tarefa>" >&2; exit 2; fi
if [ -z "$CODEX" ]; then echo "DevFusion: o Codex não foi encontrado pelo System Doctor." >&2; exit 2; fi
tier=$1; dir=$2; shift 2; task=$*
case "$tier" in
${cases}
  *) echo "DevFusion: classe inválida '$tier' (use trivial, rotina, complexa ou critica)" >&2; exit 2 ;;
esac
${win ? `# Sem conversão automática de caminhos: uma tarefa como "/login" chega intacta ao Codex.
export MSYS_NO_PATHCONV=1
dir=$(cygpath -m "$dir")
` : ''}if [ ! -d "$dir" ]; then echo "DevFusion: a pasta não existe: $dir" >&2; exit 2; fi
mkdir -p "$EV"
n=0
for f in "$EV"/codex-*.${livePid}; do
  [ -f "$f" ] || continue
  [ -f "\${f%.${livePid}}.exit" ] && continue
  kill -0 "$(cat "$f")" 2>/dev/null && n=$((n + 1))
done
if [ "$n" -ge "$MAX" ]; then echo "DevFusion: limite de $MAX workers do Codex ao mesmo tempo. Espere um terminar e tente de novo." >&2; exit 3; fi
id="codex-$(date +%s)-$$"
b="$EV/$id"
printf '%s %s %s\\n' "$tier" "$model" "$effort" > "$b.meta"
printf '%s' "$task" > "$b.task"
printf '%s' "$dir" > "$b.dir"
# Grupo de processos próprio: Parar tudo encerra o worker e os filhos dele.
set -m
if [ -n "$AIMEM" ]; then
  "$AIMEM" run --no-exit-prompt --executable "$CODEX" codex ${exec}
else
  "$CODEX" ${exec}
fi
pid=$!
${win ? `echo "$pid" > "$b.spid"
# Espera o executável nativo assumir o processo antes de anotar o PID do Windows.
i=0
while [ $i -lt 10 ]; do
  case "$(cat "/proc/$pid/exename" 2>/dev/null)" in */sh|*/sh.exe|*/bash|*/bash.exe) sleep 0.2; i=$((i + 1)) ;; *) break ;; esac
done
wpid=$(cat "/proc/$pid/winpid" 2>/dev/null)
[ -n "$wpid" ] && echo "$wpid" > "$b.pid"
trap '[ -n "$wpid" ] && taskkill /PID "$wpid" /T /F > /dev/null 2>&1' INT TERM HUP` : `echo "$pid" > "$b.pid"
trap 'kill -TERM -- -$pid 2>/dev/null || kill -TERM $pid 2>/dev/null' INT TERM HUP`}
wait "$pid"
code=$?
echo "$code" > "$b.exit"
echo "DevFusion · worker $id ($tier, $model, esforço $effort) terminou com código $code."
if [ -s "$b.last" ]; then cat "$b.last"; else tail -c 2000 "$b.err"; fi
exit "$code"
`;
}

/** O orquestrador vê o nível de gasto escolhido; o roster da tabela já está ajustado a ele. */
function spendInstructions(s: OrchestratorSettings): string[] {
  return [
    '## Nível de gasto de tokens',
    `- Nível escolhido pelo usuário: **${SPEND_LABEL[s.spend]}**. ${SPEND_HINT[s.spend]} Modo Eco: **${s.eco ? 'ligado' : 'desligado'}**.`,
    '- O roster acima já está ajustado a esse nível. Escolha o worker pela dificuldade real da tarefa e não troque modelo nem esforço por conta própria.',
    '- Economia nunca rebaixa a classe: tarefa difícil vai como complexa ou crítica mesmo no nível mais baixo ou com o Eco ligado.',
    ...(s.eco ? [
      '- Eco: use o mínimo de workers, mande só o contexto necessário, peça respostas curtas e não repita leitura ou teste já feito. Revisão cruzada só na classe crítica ou se o usuário pedir.',
    ] : []),
  ];
}

/** Instruções de gerente de projeto entregues ao orquestrador. */
export function orchestratorInstructions(ctx: OrchestratorContext, lead: AgentId): string {
  const s = ctx.settings;
  const rows = ORCH_TIERS.map((t) => `| ${TIER_LABEL[t]} | ${TIER_HINT[t]} | ${lead === 'claude' ? `subagente \`${claudeWorkerName(t)}\` (${modelLabel(s.roster[t].claude.model)}, ${EFFORT_LABEL[s.roster[t].claude.effort]})` : '—'} | ${modelLabel(s.roster[t].codex.model)}, ${EFFORT_LABEL[s.roster[t].codex.effort]} |`).join('\n');
  const win = isWin(ctx.platform);
  // O Claude Code usa o Git Bash no Windows; o Codex usa o PowerShell, que precisa do caminho do sh.
  const codexCmd = win && lead === 'codex' && ctx.shPath
    ? `& ${psQuote(ctx.shPath)} ${psQuote(ctx.scriptPath.replace(/\\/g, '/'))} <classe> '<pasta>' '<tarefa>'`
    : `sh ${shPathQuote(ctx.scriptPath, ctx.platform)} <classe> <pasta> '<tarefa>'`;
  return [
    '# DevFusion — Dev Orchestrator',
    'Você é o orquestrador (gerente de projeto) desta sessão do DevFusion. O usuário conversa com você; você planeja, divide o trabalho, distribui para workers com o modelo e o esforço certos, acompanha, integra os resultados e reporta.',
    '',
    '## Regras',
    '- Classifique cada tarefa antes de delegar. Use o worker mais barato que resolve; suba de classe só se o resultado não for bom o bastante.',
    '- Você pode ler o código e planejar. Implementação, testes e revisões vão para workers.',
    '- Implementação e revisão por provedores diferentes quando possível (revisão cruzada). A classe "crítica" exige revisão cruzada.',
    `- No máximo ${s.maxParallel} workers ao mesmo tempo. Workers que escrevem em paralelo precisam de worktrees separados: \`git worktree add ${shPathQuote(ctx.worktreesDir, ctx.platform)}/<nome> -b devfusion/<nome>\`. Um worker por pasta. Workers de leitura podem compartilhar a pasta.`,
    '- Nunca faça (nem peça a workers) commit na branch principal, push, merge, reset, rebase, apagar branch ou qualquer operação destrutiva sem o usuário pedir. Integrar worktrees é decisão do usuário: mostre o diff e pergunte.',
    '- Antes de iniciar um plano com mais de 3 workers ou com tarefa crítica, apresente o plano e espere o ok do usuário.',
    '- Aprovações de permissão aparecem no terminal; quem responde é o usuário. Não tente contorná-las.',
    '',
    `## Roster (pasta do projeto: ${ctx.workspacePath})`,
    '| Classe | Exemplos | Worker Claude | Worker Codex |',
    '|---|---|---|---|',
    rows,
    '',
    ...spendInstructions(s),
    '',
    '## Como disparar',
    lead === 'claude'
      ? `- Claude: ferramenta Agent com \`subagent_type\` = \`claude-<classe>\` (ex.: \`${claudeWorkerName('trivial')}\`). Diga na tarefa a pasta onde trabalhar.`
      : '- Workers do Claude não estão disponíveis com o Codex como orquestrador (decisão de termos do DevFusion). Para usar o Claude, o usuário troca o orquestrador para o Claude Code.',
    ctx.codexPath
      ? `- Codex: \`${codexCmd}\`, com <classe> = trivial | rotina | complexa | critica. A saída final do worker é impressa no fim. ${lead === 'claude' ? 'Use `run_in_background` no Bash para tarefas longas e leia o resultado quando terminar.' : 'Esse comando precisa rodar fora do sandbox (rede e pasta de eventos do DevFusion): peça a aprovação ao usuário quando a CLI solicitar.'} Escape aspas simples na tarefa${win ? ' e não use aspas duplas nela; escreva a pasta com barras normais (C:/…) e entre aspas' : ''}.`
      : '- Workers do Codex indisponíveis: o System Doctor não encontrou o Codex.',
    '',
    '## Memória',
    ctx.aiMemoryPath
      ? '- O ai-memory está ligado: no começo, procure handoff e decisões do projeto pelas ferramentas do ai-memory; ao fim, registre as decisões duráveis. Workers do Codex também rodam por `ai-memory run`.'
      : '- Memória compartilhada (ai-memory) desligada nesta sessão.',
    '',
    '## Relatório ao usuário',
    '- Ao concluir, uma tabela: tarefa, worker (provedor, modelo, esforço), resultado verificado, pendências. Sem afirmar o que não foi testado.',
  ].join('\n');
}

/** Grava o script do worker do Codex e prepara as pastas. */
export function prepareOrchestrator(ctx: OrchestratorContext): void {
  mkdirSync(ctx.eventsDir, { recursive: true });
  mkdirSync(ctx.worktreesDir, { recursive: true });
  writeFileSync(ctx.scriptPath, codexWorkerScript(ctx), { mode: 0o755 });
  chmodSync(ctx.scriptPath, 0o755);
}

/** Argumentos oficiais do Claude Code como orquestrador. `statusLine` é mesclado no mesmo `--settings`. */
export function claudeLeadArgs(ctx: OrchestratorContext, statusLine: Record<string, unknown> | null): string[] {
  const lead = ctx.settings.leadClaude;
  const settings = { ...(statusLine ? { statusLine } : {}), hooks: claudeEventHooks(ctx.eventsDir, ctx.platform) };
  return [
    '--model', lead.model, '--effort', lead.effort,
    '--agents', JSON.stringify(claudeWorkerAgents(ctx.settings)),
    '--append-system-prompt', orchestratorInstructions(ctx, 'claude'),
    '--settings', JSON.stringify(settings),
  ];
}

/** Argumentos oficiais do Codex como orquestrador (`-c` usa valores TOML; string JSON é TOML válido). */
export function codexLeadArgs(ctx: OrchestratorContext): string[] {
  const lead = ctx.settings.leadCodex;
  return ['-m', lead.model, '-c', `model_reasoning_effort=${lead.effort}`, '-c', `developer_instructions=${JSON.stringify(orchestratorInstructions(ctx, 'codex'))}`];
}

export const orchestratorPaths = (userData: string) => {
  const base = join(userData, 'orchestrator');
  return { eventsDir: join(base, 'events'), scriptPath: join(base, 'devfusion-codex-worker.sh'), worktreesDir: join(base, 'worktrees') };
};
