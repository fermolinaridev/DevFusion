import { execFile, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORCHESTRATOR, type OrchestratorSettings, type WorkersSnapshot } from '../../src/shared/orchestrator';
import { claudeEventHooks, claudeLeadArgs, codexLeadArgs, codexWorkerScript, orchestratorInstructions, orchestratorPaths, prepareOrchestrator, type OrchestratorContext } from '../../src/main/orchestrator/DevOrchestrator';
import { WorkerMonitor } from '../../src/main/orchestrator/WorkerMonitor';
import { displayArgs } from '../../src/main/agents/CliAgentAdapter';
import { PlatformDetector } from '../../src/main/system/PlatformDetector';

let root: string;
const ctxFor = (over: Partial<OrchestratorContext> = {}, settings: OrchestratorSettings = DEFAULT_ORCHESTRATOR): OrchestratorContext => ({
  settings, ...orchestratorPaths(join(root, 'userData')), workspacePath: join(root, 'proj'), codexPath: join(root, 'bin', 'codex'), aiMemoryPath: null, ...over,
});
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'devfusion-orch-')); mkdirSync(join(root, 'proj')); mkdirSync(join(root, 'bin')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const WIN = process.platform === 'win32';
/** sh real: `/bin/sh`, ou o do Git for Windows (o mesmo que o app usa). */
const SH = new PlatformDetector().locateSh() ?? '/bin/sh';
const shEnv = (extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...(WIN ? process.env : { PATH: '/usr/bin:/bin' }), ...extra });
/** Caminho como o script o repassa às CLIs (barras normais no Windows). */
const sp = (p: string) => (WIN ? p.replace(/\\/g, '/') : p);

const valueOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1]!;

describe('Dev Orchestrator no Windows (gerado, sem executar)', () => {
  const win = (): OrchestratorContext => ctxFor({
    platform: 'win32', shPath: 'C:\\Program Files\\Git\\bin\\sh.exe', codexPath: 'C:\\npm\\codex.exe', workspacePath: 'C:\\proj',
    eventsDir: "C:\\Users\\D'Ávila\\ev", scriptPath: 'C:\\Users\\u v\\w.sh', worktreesDir: 'C:\\wt',
  });
  it('hooks e script usam barras normais, PID do Windows e taskkill', () => {
    const s = codexWorkerScript(win());
    expect(s).toContain("EV='C:/Users/D'\\''Ávila/ev'");
    expect(s).toContain("CODEX='C:/npm/codex.exe'");
    expect(s).toContain('/proc/$pid/winpid');
    expect(s).toContain('taskkill /PID "$wpid" /T /F');
    expect(s).toContain('export MSYS_NO_PATHCONV=1');
    expect(JSON.stringify(claudeEventHooks('C:\\ev', 'win32'))).toContain("cat > 'C:/ev'/c-");
  });
  it('líder Claude chama pelo Git Bash; líder Codex pelo PowerShell com o caminho do sh', () => {
    expect(orchestratorInstructions(win(), 'claude')).toContain("`sh 'C:/Users/u v/w.sh' <classe> <pasta> '<tarefa>'`");
    expect(orchestratorInstructions(win(), 'codex')).toContain("`& 'C:\\Program Files\\Git\\bin\\sh.exe' 'C:/Users/u v/w.sh' <classe> '<pasta>' '<tarefa>'`");
  });
  it('o script das outras plataformas não muda', () => {
    const s = codexWorkerScript({ ...win(), platform: 'linux' });
    expect(s).not.toMatch(/taskkill|cygpath|MSYS|spid/);
    expect(s).toContain('kill -TERM -- -$pid');
  });
});

describe('Dev Orchestrator: argumentos oficiais do orquestrador', () => {
  it('Claude: modelo/esforço do líder, roster como subagentes oficiais e hooks no mesmo --settings da statusline', () => {
    const args = claudeLeadArgs(ctxFor(), { type: 'command', command: 'node statusline.cjs', padding: 0 });
    expect(valueOf(args, '--model')).toBe('claude-opus-5-5');
    expect(valueOf(args, '--effort')).toBe('high');
    expect(args.filter((a) => a === '--settings')).toHaveLength(1);
    const agents = JSON.parse(valueOf(args, '--agents')) as Record<string, { model: string; effort: string; prompt: string }>;
    expect(Object.keys(agents)).toEqual(['claude-trivial', 'claude-rotina', 'claude-complexa', 'claude-critica']);
    expect(agents['claude-trivial']).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' });
    expect(agents['claude-complexa']).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' });
    expect(agents['claude-trivial']!.prompt).toMatch(/Não faça commit, push, merge/);
    const settings = JSON.parse(valueOf(args, '--settings')) as { statusLine: unknown; hooks: Record<string, unknown> };
    expect(settings.statusLine).toMatchObject({ command: 'node statusline.cjs' });
    expect(Object.keys(settings.hooks).sort()).toEqual(['PostToolUse', 'PreToolUse', 'SubagentStart', 'SubagentStop']);
    const skill = valueOf(args, '--append-system-prompt');
    expect(skill).toContain('devfusion-codex-worker.sh');
    expect(skill).toContain('No máximo 3 workers');
    expect(skill).toContain('subagente `claude-trivial` (Sonnet 5.5, baixo)');
    expect(skill).toMatch(/push, merge, reset/);
  });

  it('Codex: -m/-c oficiais; instruções em string TOML válida; sem workers do Claude', () => {
    const args = codexLeadArgs(ctxFor());
    expect(args.slice(0, 4)).toEqual(['-m', 'gpt-6.2-astra', '-c', 'model_reasoning_effort=high']);
    const instr = args[5]!;
    expect(instr.startsWith('developer_instructions="')).toBe(true);
    const text = JSON.parse(instr.slice('developer_instructions='.length)) as string;
    expect(text).toContain('Workers do Claude não estão disponíveis com o Codex como orquestrador');
    expect(text).toContain('fora do sandbox');
  });

  it('comando exibido oculta settings, roster e instruções', () => {
    expect(displayArgs(['--model', 'm', '--agents', '{}', '--append-system-prompt', 'x', '--settings', '{}', '-c', 'developer_instructions="y"', '-c', 'a=b']))
      .toEqual(['--model', 'm', '--agents', '…', '--append-system-prompt', '…', '-c', 'developer_instructions=…', '-c', 'a=b']);
  });
});

const run = (file: string, args: string[], env: NodeJS.ProcessEnv = {}) => new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
  execFile(file, args, { env: shEnv(env), timeout: 20_000 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }));
});
const waitFor = async (fn: () => boolean, ms = 10_000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)); } };

/** Codex falso: registra o argv, emite JSONL como `codex exec --json` e grava `-o`. */
const FAKE_CODEX = `#!/bin/sh
printf '%s\\n' "$@" > "$ARGV_LOG"
out=""; last=""
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; *) last=$1; shift ;; esac; done
case "$last" in *dormir*) echo '{"type":"item.started","item":{"type":"command_execution","command":"sleep 30"}}'; sleep 30 ;; esac
echo '{"type":"thread.started","thread_id":"t"}'
echo '{"type":"item.completed","item":{"type":"command_execution","command":"npm test"}}'
echo '{"type":"item.completed","item":{"type":"agent_message","text":"feito"}}'
case "$last" in *falhar*) echo '{"type":"turn.failed","error":{"message":"modelo recusou"}}'; exit 1 ;; esac
echo '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'
printf 'feito: %s' "$last" > "$out"
`;

describe('Dev Orchestrator: script do worker do Codex e monitor', { timeout: 40_000 }, () => {
  let snaps: WorkersSnapshot[];
  let monitor: WorkerMonitor;
  let ctx: OrchestratorContext;
  let argvLog: string;
  beforeEach(() => {
    const codex = join(root, 'bin', 'codex');
    writeFileSync(codex, FAKE_CODEX); chmodSync(codex, 0o755);
    argvLog = join(root, 'argv.txt');
    ctx = ctxFor({}, { ...DEFAULT_ORCHESTRATOR, maxParallel: 1 });
    prepareOrchestrator(ctx);
    snaps = [];
    monitor = new WorkerMonitor({ eventsDir: ctx.eventsDir, emit: (s) => snaps.push(s), shorten: (p) => p.replace(root, '~') });
    monitor.begin('claude', ctx.settings);
  });
  afterEach(() => { monitor.stopAll(); monitor.dispose(); });

  it('dispara `codex exec --json` com modelo/esforço da classe e o monitor mostra o resultado', async () => {
    const r = await run(SH, [ctx.scriptPath, 'complexa', ctx.workspacePath, "implementar 'login'"], { ARGV_LOG: argvLog });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('(complexa, gpt-6.2-astra, esforço high) terminou com código 0');
    expect(r.stdout).toContain("feito: implementar 'login'");
    const argv = readFileSync(argvLog, 'utf8').trim().split('\n');
    expect(argv.slice(0, 7)).toEqual(['exec', '--json', '--skip-git-repo-check', '-m', 'gpt-6.2-astra', '-c', 'model_reasoning_effort=high']);
    expect(argv).toEqual(expect.arrayContaining(['-s', 'workspace-write', '-C', sp(ctx.workspacePath)]));
    expect(argv).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    const [w] = monitor.refresh().workers;
    expect(w).toMatchObject({ provider: 'codex', tier: 'complexa', model: 'gpt-6.2-astra', effort: 'high', status: 'completed', task: "implementar 'login'", tokens: { input: 10, output: 5 }, cwd: WIN ? '~\\proj' : '~/proj' });
    expect(w!.output).toBe("feito: implementar 'login'");
  });

  it('falha do worker aparece com o erro; classe inválida e pasta inexistente são recusadas', async () => {
    expect((await run(SH, [ctx.scriptPath, 'trivial', ctx.workspacePath, 'falhar agora'], { ARGV_LOG: argvLog })).code).toBe(1);
    const [w] = monitor.refresh().workers;
    expect(w).toMatchObject({ status: 'failed', model: 'gpt-6.2-sol', effort: 'low', output: 'modelo recusou' });
    const bad = await run(SH, [ctx.scriptPath, 'urgente', ctx.workspacePath, 'x'], { ARGV_LOG: argvLog });
    expect(bad.code).toBe(2); expect(bad.stderr).toContain('classe inválida');
    expect((await run(SH, [ctx.scriptPath, 'trivial', join(root, 'nao-existe'), 'x'], { ARGV_LOG: argvLog })).code).toBe(2);
  });

  it('limite de workers simultâneos e Parar tudo encerra o worker (sem processo restante)', async () => {
    const child = spawn(SH, [ctx.scriptPath, 'rotina', ctx.workspacePath, 'dormir'], { env: shEnv({ ARGV_LOG: argvLog }), stdio: 'ignore' });
    const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
    await waitFor(() => readdirSync(ctx.eventsDir).some((f) => f.endsWith('.pid')));
    await waitFor(() => monitor.refresh().workers[0]?.activity === '$ sleep 30');
    const second = await run(SH, [ctx.scriptPath, 'trivial', ctx.workspacePath, 'outra'], { ARGV_LOG: argvLog });
    expect(second.code).toBe(3); expect(second.stderr).toContain('limite de 1 workers');
    const pid = Number(readFileSync(join(ctx.eventsDir, readdirSync(ctx.eventsDir).find((f) => f.endsWith('.pid'))!), 'utf8'));
    expect(monitor.hasRunning()).toBe(true);
    expect(monitor.stopAll()).toBe(1);
    await exited;
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
    expect(monitor.refresh().workers[0]).toMatchObject({ status: 'stopped' });
    expect(monitor.hasRunning()).toBe(false);
  });

  it('tarefa com acentos, barra inicial, cifrão e crase chega intacta ao Codex', async () => {
    const task = '/login: ação não é $HOME nem `date`; 50% & <tag>';
    expect((await run(SH, [ctx.scriptPath, 'trivial', ctx.workspacePath, task], { ARGV_LOG: argvLog })).code).toBe(0);
    expect(readFileSync(argvLog, 'utf8').trim().split('\n').at(-1)).toBe(task);
    expect(monitor.refresh().workers[0]!.task).toBe(task);
  });

  it('com ai-memory: o worker passa por `ai-memory run --no-exit-prompt --executable <codex> codex exec …`', async () => {
    const mem = join(root, 'bin', 'ai-memory');
    writeFileSync(mem, `#!/bin/sh\nprintf '%s\\n' "$@" > "$MEM_LOG"\nshift 4\nshift\nexec "$CODEX_BIN" "$@"\n`); chmodSync(mem, 0o755);
    const c2 = ctxFor({ aiMemoryPath: mem });
    prepareOrchestrator(c2);
    const memLog = join(root, 'mem.txt');
    const r = await run(SH, [c2.scriptPath, 'trivial', c2.workspacePath, 'oi'], { ARGV_LOG: argvLog, MEM_LOG: memLog, CODEX_BIN: c2.codexPath! });
    expect(r.code).toBe(0);
    expect(readFileSync(memLog, 'utf8').trim().split('\n').slice(0, 7)).toEqual(['run', '--no-exit-prompt', '--executable', sp(c2.codexPath!), 'codex', 'exec', '--json']);
  });

  it('hooks oficiais do Claude: o comando grava o evento e o monitor monta o worker do roster', async () => {
    const hooks = claudeEventHooks(ctx.eventsDir) as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    const cmd = hooks['SubagentStart']![0]!.hooks[0]!.command;
    const fire = async (payload: object) => {
      await new Promise<void>((resolve, reject) => {
        const p = spawn(SH, ['-c', cmd], { stdio: ['pipe', 'ignore', 'inherit'] });
        p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`hook saiu com ${c}`))));
        p.stdin.end(JSON.stringify(payload));
      });
      await new Promise((r) => setTimeout(r, 15)); // ordem por mtime
    };
    // Formato real observado no Claude Code 2.1.330 (2026-11-21).
    await fire({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: { description: 'Rodar testes', prompt: 'npm test em ~/proj', subagent_type: 'claude-trivial' } });
    await fire({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'claude-trivial' });
    await fire({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu2', tool_input: { description: 'Refatorar auth', prompt: '...', subagent_type: 'claude-complexa' } });
    await fire({ hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'claude-complexa' });
    let ws = monitor.refresh().workers;
    expect(ws.map((w) => [w.name, w.model, w.effort, w.status])).toEqual([
      ['claude-trivial', 'claude-sonnet-5-5', 'low', 'running'],
      ['claude-complexa', 'claude-opus-5-5', 'high', 'running'],
    ]);
    await fire({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'claude-trivial', last_assistant_message: '42 testes passaram' });
    await fire({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_response: { status: 'completed', agentId: 'a1' } });
    ws = monitor.refresh().workers;
    expect(ws[0]).toMatchObject({ status: 'completed', task: 'Rodar testes: npm test em ~/proj', output: '42 testes passaram' });
    expect(ws[1]!.status).toBe('running');
    // Subagente em segundo plano (formato real): PostToolUse "async_launched" chega antes do fim.
    await fire({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'tu2', tool_response: { isAsync: true, status: 'async_launched', agentId: 'a2', resolvedModel: 'claude-opus-5-5' } });
    expect(monitor.refresh().workers[1]).toMatchObject({ status: 'running', task: 'Refatorar auth: ...', endedAt: null });
    // Orquestrador encerrou com o subagente ainda rodando: aparece como interrompido.
    monitor.end();
    expect(monitor.snapshot().workers[1]!.status).toBe('stopped');
    expect(snaps.length).toBeGreaterThan(0);
  });

  it('nova sessão limpa os eventos antigos (contêm prompts)', () => {
    writeFileSync(join(ctx.eventsDir, 'c-1-1.json'), '{}');
    monitor.begin('claude', ctx.settings);
    expect(existsSync(join(ctx.eventsDir, 'c-1-1.json'))).toBe(false);
  });
});
