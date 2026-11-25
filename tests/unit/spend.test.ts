import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase } from '../../src/main/database/Database';
import { SettingsRepository } from '../../src/main/database/repositories/SettingsRepository';
import { claudeLeadArgs, claudeWorkerAgents, codexLeadArgs, codexWorkerScript, orchestratorInstructions, orchestratorPaths, type OrchestratorContext } from '../../src/main/orchestrator/DevOrchestrator';
import { CLAUDE_MODELS, CODEX_MODELS, DEFAULT_ORCHESTRATOR, EFFORTS, ORCH_TIERS, OrchestratorSettingsSchema, SPEND_LEVELS, type OrchestratorSettings, type SpendLevel } from '../../src/shared/orchestrator';
import { ECO_MAX_PARALLEL, claudeRank, codexRank, resolveSpend } from '../../src/shared/spend';

const at = (spend: SpendLevel, eco = false, over: Partial<OrchestratorSettings> = {}) => resolveSpend({ ...DEFAULT_ORCHESTRATOR, ...over, spend, eco });
const ctx = (settings: OrchestratorSettings): OrchestratorContext => ({ settings, ...orchestratorPaths(join('x', 'userData')), workspacePath: join('x', 'proj'), codexPath: '/bin/codex', aiMemoryPath: null });
const STRONG_CLAUDE = claudeRank({ model: 'claude-opus-5-5', effort: 'medium' });
const STRONG_CODEX = codexRank({ model: 'gpt-6.2-astra', effort: 'medium' });

describe('nível de gasto', () => {
  it('"alto" sem Eco é exatamente a configuração do usuário', () => {
    expect(at('alto')).toEqual(DEFAULT_ORCHESTRATOR);
    const custom: OrchestratorSettings = { ...DEFAULT_ORCHESTRATOR, leadClaude: { model: 'claude-fable-5-2', effort: 'max' } };
    expect(resolveSpend(custom)).toEqual(custom);
  });

  it('subir o nível nunca enfraquece orquestrador nem worker (roster padrão)', () => {
    for (const eco of [false, true]) {
      for (let i = 1; i < SPEND_LEVELS.length; i++) {
        const a = at(SPEND_LEVELS[i - 1]!, eco); const b = at(SPEND_LEVELS[i]!, eco);
        expect(claudeRank(b.leadClaude)).toBeGreaterThanOrEqual(claudeRank(a.leadClaude));
        expect(codexRank(b.leadCodex)).toBeGreaterThanOrEqual(codexRank(a.leadCodex));
        for (const t of ORCH_TIERS) {
          expect(claudeRank(b.roster[t].claude)).toBeGreaterThanOrEqual(claudeRank(a.roster[t].claude));
          expect(codexRank(b.roster[t].codex)).toBeGreaterThanOrEqual(codexRank(a.roster[t].codex));
        }
      }
    }
  });

  it('tarefa difícil usa modelo forte em todos os níveis, com e sem Eco', () => {
    for (const l of SPEND_LEVELS) for (const eco of [false, true]) for (const t of ['complexa', 'critica'] as const) {
      const s = at(l, eco).roster[t];
      expect(claudeRank(s.claude), `${l} ${t}`).toBeGreaterThanOrEqual(STRONG_CLAUDE);
      expect(codexRank(s.codex), `${l} ${t}`).toBeGreaterThanOrEqual(STRONG_CODEX);
    }
  });

  it('ultra baixo usa os modelos mais leves no que é simples; ultra usa esforço máximo no difícil', () => {
    expect(at('ultra-baixo').roster.trivial).toEqual({ claude: { model: 'claude-haiku-5-5', effort: 'low' }, codex: { model: 'gpt-6-luna', effort: 'low' } });
    expect(at('ultra').roster.critica).toEqual({ claude: { model: 'claude-opus-5-5', effort: 'max' }, codex: { model: 'gpt-6.2-astra', effort: 'max' } });
  });
});

describe('modo Eco', () => {
  it('nunca aumenta nada, não mexe na classe crítica e limita os workers simultâneos', () => {
    for (const l of SPEND_LEVELS) {
      const off = at(l); const on = at(l, true);
      expect(claudeRank(on.leadClaude)).toBeLessThanOrEqual(claudeRank(off.leadClaude));
      expect(codexRank(on.leadCodex)).toBeLessThanOrEqual(codexRank(off.leadCodex));
      for (const t of ORCH_TIERS) {
        expect(claudeRank(on.roster[t].claude)).toBeLessThanOrEqual(claudeRank(off.roster[t].claude));
        expect(codexRank(on.roster[t].codex)).toBeLessThanOrEqual(codexRank(off.roster[t].codex));
      }
      expect(on.roster.critica).toEqual(off.roster.critica);
      expect(on.maxParallel).toBe(ECO_MAX_PARALLEL);
    }
    expect(at('alto', true, { maxParallel: 1 }).maxParallel).toBe(1);
  });

  it('ultra + Eco economiza de verdade: modelos leves no simples e um degrau a menos no orquestrador', () => {
    const r = at('ultra', true);
    expect(r.roster.trivial.claude).toEqual({ model: 'claude-haiku-5-5', effort: 'low' });
    expect(r.leadClaude).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' });
    expect(r.roster.complexa.codex).toEqual({ model: 'gpt-6.2-astra', effort: 'xhigh' });
  });

  it('respeita um roster personalizado já mais leve que o do Eco', () => {
    const light = { claude: { model: 'claude-haiku-5-5', effort: 'low' }, codex: { model: 'gpt-6-luna', effort: 'low' } } as const;
    const r = at('alto', true, { roster: { ...DEFAULT_ORCHESTRATOR.roster, rotina: light, complexa: light } });
    expect(r.roster.rotina).toEqual(light);
    expect(r.roster.complexa).toEqual(light);
  });
});

describe('nível chega ao agente oficial', () => {
  it('flags do líder, subagentes e script do Codex usam os modelos do nível', () => {
    const low = ctx(at('ultra-baixo'));
    const args = claudeLeadArgs(low, null);
    expect(args.slice(0, 4)).toEqual(['--model', 'claude-sonnet-5-5', '--effort', 'medium']);
    expect(codexLeadArgs(low).slice(0, 4)).toEqual(['-m', 'gpt-6.2-sol', '-c', 'model_reasoning_effort=medium']);
    expect(claudeWorkerAgents(low.settings)['claude-trivial']).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' });
    expect(codexWorkerScript(low)).toContain('trivial) model=gpt-6-luna; effort=low');
    expect(codexWorkerScript(low)).toContain('critica) model=gpt-6.2-astra; effort=high');
    expect(codexWorkerScript(ctx(at('ultra', true)))).toContain(`MAX=${ECO_MAX_PARALLEL}`);
  });

  it('as instruções dizem o nível, o Eco e que economia não rebaixa tarefa difícil', () => {
    for (const lead of ['claude', 'codex'] as const) {
      const off = orchestratorInstructions(ctx(at('ultra-baixo')), lead);
      expect(off).toContain('Nível escolhido pelo usuário: **Ultra baixo**');
      expect(off).toContain('Modo Eco: **desligado**');
      expect(off).toContain('Economia nunca rebaixa a classe');
      expect(off).not.toContain('- Eco: use o mínimo');
      const on = orchestratorInstructions(ctx(at('ultra', true)), lead);
      expect(on).toContain('Modo Eco: **ligado**');
      expect(on).toContain('- Eco: use o mínimo de workers');
      expect(on).toContain(`No máximo ${ECO_MAX_PARALLEL} workers`);
    }
  });
});

describe('configuração salva', () => {
  it('configuração antiga (sem spend/eco) continua válida e não volta ao padrão', () => {
    const { spend: _s, eco: _e, ...old } = { ...DEFAULT_ORCHESTRATOR, maxParallel: 5 };
    const db = openDatabase(':memory:'); migrate(db);
    db.prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES ('orchestrator', ?, 'x')`).run(JSON.stringify(old));
    const onInvalid = vi.fn();
    const repo = new SettingsRepository(db, undefined, onInvalid);
    expect(repo.getAll().orchestrator).toMatchObject({ maxParallel: 5, spend: 'alto', eco: false });
    expect(onInvalid).not.toHaveBeenCalled();
    expect(repo.set('orchestrator', { ...repo.getAll().orchestrator, spend: 'ultra', eco: true }).orchestrator).toMatchObject({ spend: 'ultra', eco: true, maxParallel: 5 });
  });

  it('nível desconhecido é recusado; os níveis prontos só usam modelos e esforços do catálogo', () => {
    expect(OrchestratorSettingsSchema.safeParse({ ...DEFAULT_ORCHESTRATOR, spend: 'infinito' }).success).toBe(false);
    for (const l of SPEND_LEVELS) {
      const r = at(l, true);
      expect(OrchestratorSettingsSchema.safeParse(r).success).toBe(true);
      for (const t of ORCH_TIERS) {
        expect(CLAUDE_MODELS).toContain(r.roster[t].claude.model);
        expect(CODEX_MODELS).toContain(r.roster[t].codex.model);
        expect(EFFORTS).toContain(r.roster[t].claude.effort);
      }
    }
  });
});
