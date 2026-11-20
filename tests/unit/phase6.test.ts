import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase, type Db } from '../../src/main/database/Database';
import { AuditLogRepository } from '../../src/main/database/repositories/AuditLogRepository';
import { MessageRepository } from '../../src/main/database/repositories/MessageRepository';
import { WorkspaceRepository } from '../../src/main/database/repositories/WorkspaceRepository';
import { HistoryService } from '../../src/main/history/HistoryService';
import { Notifier } from '../../src/main/system/Notifier';
import { MAX_EDIT_BYTES, readTextFile, writeTextFile } from '../../src/main/workspace/FileEditor';
import { applyChatMode } from '../../src/shared/orchestration';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA } from '../../src/shared/settings';

let base: string;
beforeEach(() => { base = realpathSync(mkdtempSync(join(tmpdir(), 'devfusion-p6-'))); });
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('FileEditor', () => {
  it('lê e salva texto dentro da raiz; recusa binário, grande, pasta e fora da raiz', async () => {
    const root = join(base, 'ws'); mkdirSync(root);
    writeFileSync(join(root, 'a.ts'), 'antes');
    const f = await readTextFile(root, 'a.ts');
    expect(f.content).toBe('antes');
    expect(await writeTextFile(root, 'a.ts', 'depois', f.mtimeMs, false)).toMatchObject({ status: 'saved' });
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('depois');
    writeFileSync(join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
    await expect(readTextFile(root, 'bin.dat')).rejects.toThrow(/binário/);
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(MAX_EDIT_BYTES + 1));
    await expect(readTextFile(root, 'big.txt')).rejects.toThrow(/grande demais/);
    await expect(readTextFile(root, '')).rejects.toThrow(/Não é um arquivo/);
    writeFileSync(join(base, 'fora.txt'), 'segredo');
    if (process.platform !== 'win32') { // symlink no Windows exige privilégio de administrador
      symlinkSync(join(base, 'fora.txt'), join(root, 'link.txt'));
      await expect(readTextFile(root, 'link.txt')).rejects.toThrow(/Fora da pasta/);
    }
    await expect(writeTextFile(root, '../fora.txt', 'x', 0, true)).rejects.toThrow(/Fora da pasta/);
    await expect(writeTextFile(root, 'novo.ts', 'x', 0, true)).rejects.toThrow(/não encontrado/);
    expect(readFileSync(join(base, 'fora.txt'), 'utf8')).toBe('segredo');
  });

  it('alteração externa vira conflito; só sobrescreve com overwrite', async () => {
    const root = join(base, 'ws'); mkdirSync(root);
    writeFileSync(join(root, 'a.ts'), 'v1');
    const f = await readTextFile(root, 'a.ts');
    writeFileSync(join(root, 'a.ts'), 'v2 do agente');
    utimesSync(join(root, 'a.ts'), new Date(), new Date(Date.now() + 5000));
    expect(await writeTextFile(root, 'a.ts', 'minha', f.mtimeMs, false)).toMatchObject({ status: 'conflict' });
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('v2 do agente');
    expect(await writeTextFile(root, 'a.ts', 'minha', f.mtimeMs, true)).toMatchObject({ status: 'saved' });
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('minha');
  });
});

describe('HistoryService', () => {
  let db: Db; let ws: string; let h: HistoryService;
  const msg = (id: string, content: string, createdAt = new Date().toISOString()) => new MessageRepository(db).insert({ id, workspaceId: ws, taskId: null, kind: 'message', sender: 'user', recipient: 'claude', content, createdAt });
  beforeEach(() => {
    db = openDatabase(':memory:'); migrate(db);
    ws = new WorkspaceRepository(db).upsert('/tmp/x', 'x').id;
    h = new HistoryService(db);
  });

  it('busca com escape de % e _, mais recentes primeiro', () => {
    msg('1', 'cobertura de 100% dos testes', '2026-01-01T00:00:00Z'); msg('2', 'nome_com_underline', '2026-01-02T00:00:00Z'); msg('3', 'outra coisa', '2026-01-03T00:00:00Z');
    expect(h.search(ws, '100%', 10).map((m) => m.id)).toEqual(['1']);
    expect(h.search(ws, '_com_', 10).map((m) => m.id)).toEqual(['2']);
    expect(h.search(ws, '', 10).map((m) => m.id)).toEqual(['3', '2', '1']);
    expect(h.overview(ws)).toMatchObject({ messages: 3, oldestMessageAt: '2026-01-01T00:00:00Z' });
  });

  it('exportação traz o histórico do workspace; exclusão mantém tarefas em andamento e auditoria', () => {
    msg('1', 'oi');
    db.prepare("INSERT INTO sessions (id, workspace_id, agent_id, state, created_at, updated_at) VALUES ('s1', ?, 'claude', 'completed', 'x', 'x')").run(ws);
    for (const [id, status] of [['t1', 'approved'], ['t2', 'in_progress']]) db.prepare("INSERT INTO tasks (id, workspace_id, title, status, assignee, criteria_json, created_at, updated_at) VALUES (?, ?, 'T', ?, 'claude', '[]', 'x', 'x')").run(id!, ws, status!);
    new AuditLogRepository(db).record('qualquer', null, {});
    const exp = h.export(ws) as { format: string; messages: unknown[]; tasks: unknown[]; sessions: unknown[] };
    expect(exp.format).toBe('devfusion-history/1');
    expect([exp.messages.length, exp.tasks.length, exp.sessions.length]).toEqual([1, 2, 1]);
    expect(h.deleteWorkspaceHistory(ws)).toEqual({ messages: 1, sessions: 1, tasks: 1 });
    expect((db.prepare('SELECT id FROM tasks').all() as Array<{ id: string }>).map((t) => t.id)).toEqual(['t2']);
    expect((db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number }).n).toBe(1);
  });

  it('retenção remove só mensagens mais antigas que o limite; 0 não remove nada', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    msg('velha', 'a', '2026-10-01T00:00:00Z'); msg('nova', 'b', '2026-11-19T00:00:00Z');
    expect(h.applyRetention(0, now)).toBe(0);
    expect(h.applyRetention(30, now)).toBe(1);
    expect(h.search(ws, '', 10).map((m) => m.id)).toEqual(['nova']);
  });
});

describe('Notifier', () => {
  it('respeita configuração, foco da janela e deduplicação', () => {
    const show = vi.fn(); let focused = false; const cfg = { ...DEFAULT_SETTINGS.notifications };
    const n = new Notifier({ isSupported: () => true, show, windowFocused: () => focused, settings: () => cfg });
    expect(n.notify('agentFailed', 'T', 'B')).toBe(true);
    expect(n.notify('usageHigh', 'T', 'B', 'k1')).toBe(true);
    expect(n.notify('usageHigh', 'T', 'B', 'k1')).toBe(false);
    focused = true; expect(n.notify('agentFailed', 'T', 'B')).toBe(false);
    focused = false; cfg.installDone = false; expect(n.notify('installDone', 'T', 'B')).toBe(false);
    expect(show).toHaveBeenCalledTimes(2);
  });
});

describe('modos e configurações', () => {
  it('modelos de modo só acrescentam instruções; manual não altera o texto', () => {
    expect(applyChatMode('manual', 'oi')).toBe('oi');
    expect(applyChatMode('debate', 'qual banco?')).toMatch(/^Modo debate \(DevFusion\).*Não altere arquivos ainda\.\n\nqual banco\?$/s);
    expect(applyChatMode('debug', 'erro 500')).toMatch(/hipóteses.*\n\nerro 500$/s);
  });
  it('valida novas configurações', () => {
    expect(SETTINGS_SCHEMA.terminalFontSize.safeParse(9).success).toBe(false);
    expect(SETTINGS_SCHEMA.historyRetentionDays.safeParse(0).success).toBe(true);
    expect(SETTINGS_SCHEMA.notifications.safeParse({ agentFailed: true }).success).toBe(false);
  });
});
