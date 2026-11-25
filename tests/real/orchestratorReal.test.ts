/**
 * Teste REAL do Dev Orchestrator: Claude Code e Codex de verdade, com as contas do usuário.
 * ENVIA PROMPTS (consome um pouco da cota): só roda com DEVFUSION_REAL_TESTS=1 e DEVFUSION_REAL_PROMPTS=1.
 * Usa exatamente os argumentos que o DevFusion gera; o líder roda em `-p` com Sonnet/esforço baixo para
 * gastar pouco (o mecanismo é o mesmo do Opus 5.5 no terminal).
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ORCHESTRATOR, type OrchestratorSettings } from '../../src/shared/orchestrator';
import { claudeLeadArgs, orchestratorPaths, prepareOrchestrator } from '../../src/main/orchestrator/DevOrchestrator';
import { WorkerMonitor } from '../../src/main/orchestrator/WorkerMonitor';
import { PlatformDetector } from '../../src/main/system/PlatformDetector';

const enabled = process.env['DEVFUSION_REAL_PROMPTS'] === '1';
const detector = process.platform === 'win32' ? new PlatformDetector() : new PlatformDetector({ env: { HOME: process.env['HOME'], USER: process.env['USER'], PATH: '/usr/bin:/bin', LANG: process.env['LANG'] } });

describe.skipIf(!enabled)('Dev Orchestrator com CLIs reais (envia prompts)', () => {
  it('o líder Claude dispara um subagente do roster e um worker do Codex; o DevFusion observa os dois', async () => {
    const claude = detector.locate('claude').found?.path;
    const codex = detector.locate('codex').found?.path;
    expect(claude && codex).toBeTruthy();
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'devfusion-orch-real-')));
    const ws = join(root, 'proj');
    execFileSync('git', ['init', '-q', ws]);
    writeFileSync(join(ws, 'calc.py'), 'def soma(a, b):\n    return a - b\n');
    execFileSync('git', ['-C', ws, 'add', '.']);
    execFileSync('git', ['-C', ws, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'calc']);
    const settings: OrchestratorSettings = { ...DEFAULT_ORCHESTRATOR, leadClaude: { model: 'claude-sonnet-5-5', effort: 'low' } };
    const ctx = { settings, ...orchestratorPaths(join(root, 'userData')), workspacePath: ws, codexPath: codex!, aiMemoryPath: null, shPath: detector.locateSh() };
    prepareOrchestrator(ctx);
    const monitor = new WorkerMonitor({ eventsDir: ctx.eventsDir, emit: () => undefined, shorten: (p) => p });
    monitor.begin('claude', settings);
    const prompt = [
      `Duas tarefas triviais, na pasta ${ws}:`,
      '1) Delegue ao subagente claude-trivial: corrigir o bug da função soma em calc.py (deve somar).',
      `2) Dispare um worker do Codex da classe trivial com a tarefa: "Leia calc.py e diga em uma linha o que a função soma faz. Não altere arquivos."`,
      'Rode as duas e, no fim, responda só PRONTO.',
    ].join('\n');
    const args = ['-p', prompt, ...claudeLeadArgs(ctx, null), '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(sh:*)', 'Read', 'Edit'];
    const out = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const p = spawn(claude!, args, { cwd: ws, env: detector.childEnv(), stdio: ['ignore', 'pipe', 'inherit'] });
      let stdout = ''; p.stdout.on('data', (d) => { stdout += d; });
      p.on('exit', (code) => resolve({ code, stdout }));
    });
    const snap = monitor.refresh();
    monitor.dispose();
    console.log('saída do líder:', out.stdout.trim().slice(-300));
    console.log('workers:', JSON.stringify(snap.workers.map((w) => ({ provider: w.provider, name: w.name, model: w.model, effort: w.effort, status: w.status, task: w.task.slice(0, 80), output: (w.output ?? '').slice(0, 120) })), null, 2));
    expect(out.code).toBe(0);
    const cw = snap.workers.find((w) => w.provider === 'claude' && w.name === 'claude-trivial');
    expect(cw).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low', status: 'completed' });
    const xw = snap.workers.find((w) => w.provider === 'codex');
    expect(xw).toMatchObject({ tier: 'trivial', model: 'gpt-6.2-sol', effort: 'low', status: 'completed' });
    expect(readFileSync(join(ws, 'calc.py'), 'utf8')).toContain('a + b');
    // No Windows o preparo do sandbox do Codex pode segurar a pasta por um tempo: limpeza é melhor esforço.
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* pasta temporária */ }
  }, 600_000);
});
