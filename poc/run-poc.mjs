#!/usr/bin/env node
// DevFusion — Fase 0: prova de conceito das CLIs oficiais.
//
// Uso:
//   node run-poc.mjs                   # só verificações locais (sem consumir cota)
//   node run-poc.mjs --with-inference  # inclui prompts mínimos (consome cota da assinatura)
//
// Garantias:
//  - nunca lê arquivos de credenciais/tokens; status vem só dos comandos oficiais;
//  - ambiente das CLIs por allowlist (sem API keys => sem fallback para API paga);
//  - nunca aprova prompts de permissão/confiança automaticamente;
//  - toda saída registrada passa por redact().
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, platform, arch, release } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCleanEnv, redact, stripAnsi, isAlive } from './lib/env.mjs';
import { detectTool, run } from './lib/detect.mjs';

const require = createRequire(import.meta.url);
const pty = require('node-pty');
const here = dirname(fileURLToPath(import.meta.url));
const WITH_INFERENCE = process.argv.includes('--with-inference');
const MARKER = 'FUSAO7';
const PROMPT = 'Responda apenas com a palavra FUSAO seguida do numero 7, sem espaco e sem mais nada.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(redact(a.join(' ')));

// ---------------------------------------------------------------- PTY
async function ptySession({ label, file, args = [], cwd, env, sendText, expect, readyMarker, timeoutMs = 90000 }) {
  const r = { label, spawned: false, firstOutputMs: null, bytes: 0, resizeOk: null, readyMarkerSeen: null, inputRoundTrip: null, exit: null, orphan: null, screenExcerpt: '' };
  const t0 = Date.now();
  let p;
  try {
    p = pty.spawn(file, args, { name: 'xterm-256color', cols: 120, rows: 40, cwd, env });
    r.spawned = true;
  } catch (e) { r.error = redact(e.message); return r; }
  let buf = '';
  let exited = null;
  p.onData((d) => { if (r.firstOutputMs === null) r.firstOutputMs = Date.now() - t0; r.bytes += d.length; buf += d; if (buf.length > 400_000) buf = buf.slice(-200_000); });
  p.onExit((e) => { exited = e; });
  const plain = () => stripAnsi(buf);
  const waitFor = async (pred, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; if (exited) return pred(); await sleep(200); } return false; };

  await waitFor(() => readyMarker ? readyMarker.test(plain()) : r.bytes > 0, 20000);
  r.readyMarkerSeen = readyMarker ? readyMarker.test(plain()) : null;
  try { p.resize(100, 30); r.resizeOk = true; } catch { r.resizeOk = false; }
  await sleep(800);

  if (sendText && !exited) {
    p.write(sendText);
    await sleep(400);
    p.write('\r');
    const tIn = Date.now();
    // O texto enviado não contém o marcador literal; ele só aparece na resposta.
    const ok = await waitFor(() => plain().includes(expect), timeoutMs);
    r.inputRoundTrip = { ok, ms: Date.now() - tIn };
  }
  r.screenExcerpt = redact(plain().split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-12).join("\n")).slice(-1200);

  // Encerramento controlado: Ctrl-C (interrupção do usuário), depois SIGTERM, depois SIGKILL.
  const pid = p.pid;
  if (!exited) { p.write('\x03'); await sleep(300); p.write('\x03'); await waitFor(() => exited, 3000); }
  if (!exited) { try { p.kill('SIGTERM'); } catch {} await waitFor(() => exited, 3000); }
  if (!exited) { try { p.kill('SIGKILL'); } catch {} await waitFor(() => exited, 2000); }
  r.exit = exited;
  r.orphan = isAlive(pid);
  return r;
}

// ---------------------------------------------------------------- JSON-RPC (codex app-server)
function jsonRpcClient(child) {
  let nextId = 1; let buf = '';
  const pending = new Map();
  const notifications = [];
  const serverRequests = [];
  const listeners = new Set();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && msg.method) { // requisição do servidor
        serverRequests.push(msg.method);
        // Política da POC: nunca aprovar automaticamente.
        const decline = /requestApproval|Approval$/.test(msg.method) ? { decision: 'decline' } : null;
        if (decline) child.stdin.write(JSON.stringify({ id: msg.id, result: decline }) + '\n');
        else child.stdin.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: 'not supported by DevFusion POC' } }) + '\n');
      } else if (msg.id !== undefined) {
        const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg); }
      } else if (msg.method) {
        notifications.push(msg); for (const l of listeners) l(msg);
      }
    }
  });
  return {
    request(method, params, timeoutMs = 30000) {
      const id = nextId++;
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      return new Promise((resolve) => {
        const t = setTimeout(() => { pending.delete(id); resolve({ timeout: true }); }, timeoutMs);
        pending.set(id, (m) => { clearTimeout(t); resolve(m); });
      });
    },
    notify(method, params) { child.stdin.write(JSON.stringify(params === undefined ? { method } : { method, params }) + '\n'); },
    waitNotification(pred, timeoutMs) {
      const hit = notifications.find(pred); if (hit) return Promise.resolve(hit);
      return new Promise((resolve) => {
        const t = setTimeout(() => { listeners.delete(l); resolve(null); }, timeoutMs);
        const l = (m) => { if (pred(m)) { clearTimeout(t); listeners.delete(l); resolve(m); } };
        listeners.add(l);
      });
    },
    notifications, serverRequests,
  };
}

async function codexAppServer(codexPath, env, cwd) {
  const r = { initialize: null, account: null, turn: null, interrupt: null, notificationMethods: {}, serverRequests: [], exit: null, orphan: null };
  const child = spawn(codexPath, ['app-server'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-10000); });
  const exitP = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));
  const rpc = jsonRpcClient(child);
  try {
    const init = await rpc.request('initialize', { clientInfo: { name: 'devfusion_poc', title: 'DevFusion POC', version: '0.0.0' } });
    r.initialize = init.timeout ? { ok: false, timeout: true } : { ok: !init.error, error: init.error ? redact(JSON.stringify(init.error)) : null, resultKeys: init.result ? Object.keys(init.result) : [] };
    rpc.notify('initialized');
    const acc = await rpc.request('account/read', { refreshToken: false });
    const a = acc.result?.account;
    r.account = acc.timeout ? { timeout: true } : { error: acc.error ? redact(JSON.stringify(acc.error)) : null, type: a?.type ?? null, planType: a?.planType ?? null, requiresOpenaiAuth: acc.result?.requiresOpenaiAuth ?? null };

    if (WITH_INFERENCE && a) {
      const th = await rpc.request('thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'untrusted', ephemeral: true });
      const threadId = th.result?.thread?.id;
      if (!threadId) { r.turn = { ok: false, error: redact(JSON.stringify(th.error ?? th)).slice(0, 500) }; }
      else {
        // Turno 1: ida e volta completa com eventos estruturados.
        const t0 = Date.now();
        const ts = await rpc.request('turn/start', { threadId, input: [{ type: 'text', text: PROMPT }] });
        const turnId = ts.result?.turn?.id;
        const done = await rpc.waitNotification((m) => m.method === 'turn/completed' && m.params?.turn?.id === turnId, 180000);
        const text = rpc.notifications.filter((m) => m.method === 'item/agentMessage/delta' && m.params?.turnId === turnId).map((m) => m.params?.delta ?? '').join('');
        r.turn = { ok: Boolean(done) && done.params.turn.status === 'completed', status: done?.params?.turn?.status ?? 'timeout', ms: Date.now() - t0, markerInAgentText: text.includes(MARKER), agentTextExcerpt: redact(text).slice(0, 200) };

        // Turno 2: interrupção via protocolo (RF12), sem depender de texto ANSI.
        const ts2 = await rpc.request('turn/start', { threadId, input: [{ type: 'text', text: 'Conte de 1 a 400, um numero por linha, sem usar ferramentas.' }] });
        const turn2 = ts2.result?.turn?.id;
        await rpc.waitNotification((m) => m.method === 'turn/started' && m.params?.turn?.id === turn2, 30000);
        await sleep(1500);
        const ti = Date.now();
        const intr = await rpc.request('turn/interrupt', { threadId, turnId: turn2 });
        const done2 = await rpc.waitNotification((m) => m.method === 'turn/completed' && m.params?.turn?.id === turn2, 30000);
        r.interrupt = { requestOk: Boolean(intr.result) && !intr.error, finalStatus: done2?.params?.turn?.status ?? 'timeout', ms: Date.now() - ti };
      }
    }
  } finally {
    for (const m of rpc.notifications) r.notificationMethods[m.method] = (r.notificationMethods[m.method] ?? 0) + 1;
    r.serverRequests = rpc.serverRequests;
    child.stdin.end();
    const exit = await Promise.race([exitP, sleep(5000).then(() => null)]);
    if (!exit) { child.kill('SIGTERM'); }
    r.exit = exit ?? await Promise.race([exitP, sleep(3000).then(() => 'killed')]);
    r.orphan = isAlive(child.pid);
    r.stderrExcerpt = redact(stderr).slice(-600);
  }
  return r;
}

// ---------------------------------------------------------------- codex exec --json
async function codexExec(codexPath, env, cwd) {
  const res = await run(codexPath, ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '-C', cwd, PROMPT], { env, cwd, timeoutMs: 180000, input: '' });
  const events = []; let finalText = '';
  for (const line of res.stdout.split('\n')) {
    try {
      const ev = JSON.parse(line); events.push(ev.type);
      if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') finalText = ev.item.text ?? '';
    } catch { /* linhas não-JSON */ }
  }
  return { exitCode: res.exitCode, timedOut: res.timedOut, ms: res.ms, eventTypes: [...new Set(events)], markerInFinalMessage: finalText.includes(MARKER), finalTextExcerpt: finalText.slice(0, 200), stderrExcerpt: res.stderr.slice(-400) };
}

// ---------------------------------------------------------------- claude -p stream-json
async function claudePrint(claudePath, env, cwd) {
  const res = await run(claudePath, ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', PROMPT], { env, cwd, timeoutMs: 180000, input: '' });
  const types = []; let resultEv = null;
  for (const line of res.stdout.split('\n')) {
    try { const ev = JSON.parse(line); types.push(ev.subtype ? `${ev.type}:${ev.subtype}` : ev.type); if (ev.type === 'result') resultEv = ev; } catch {}
  }
  return {
    exitCode: res.exitCode, timedOut: res.timedOut, ms: res.ms, eventTypes: [...new Set(types)],
    resultIsError: resultEv?.is_error ?? null,
    resultExcerpt: resultEv ? redact(String(resultEv.result ?? '')).slice(0, 300) : null,
    markerInResult: Boolean(resultEv?.result?.includes?.(MARKER)),
    stdoutExcerpt: resultEv ? undefined : res.stdout.slice(0, 400), stderrExcerpt: res.stderr.slice(-400),
  };
}

// ---------------------------------------------------------------- main
async function main() {
  const env = buildCleanEnv();
  const ws = mkdtempSync(join(tmpdir(), 'devfusion-poc-'));
  const report = {
    generatedAt: new Date().toISOString(), withInference: WITH_INFERENCE,
    platform: { os: platform(), arch: arch(), release: release(), node: process.version, nodePty: require('node-pty/package.json').version },
    envPolicy: { inheritedKeys: Object.keys(env).sort(), apiKeysPassed: Object.keys(env).filter((k) => /API_KEY|TOKEN/i.test(k)) },
    tools: {}, auth: {}, pty: {}, structured: {},
  };
  try {
    log('[1/5] Detectando ferramentas…');
    for (const t of ['git', 'node', 'npm', 'claude', 'codex']) report.tools[t] = await detectTool(t, env);
    const claude = report.tools.claude.candidates[0]?.absPath;
    const codex = report.tools.codex.candidates[0]?.absPath;

    log('[2/5] Status de autenticação via comandos oficiais…');
    if (claude) {
      const s = await run(claude, ['auth', 'status', '--json'], { env, cwd: ws });
      let j = null; try { j = JSON.parse(s.stdout); } catch {}
      report.auth.claude = { command: 'claude auth status --json', exitCode: s.exitCode, loggedIn: j?.loggedIn ?? 'unknown', authMethod: j?.authMethod ?? null, subscriptionType: j?.subscriptionType ?? null };
    } else report.auth.claude = { state: 'not-installed' };
    if (codex) {
      const s = await run(codex, ['login', 'status'], { env, cwd: ws });
      const text = (s.stdout + s.stderr).trim();
      report.auth.codex = { command: 'codex login status', exitCode: s.exitCode, output: text.slice(0, 200), method: /ChatGPT/i.test(text) ? 'chatgpt' : /API key/i.test(text) ? 'api-key' : s.exitCode === 0 ? 'unknown' : 'not-logged-in' };
    } else report.auth.codex = { state: 'not-installed' };

    log('[3/5] Sessões interativas em PTY…');
    if (claude) report.pty.claude = await ptySession({ label: 'claude (interativo)', file: claude, cwd: ws, env, readyMarker: /trust|Select login method|Welcome|>/i });
    if (codex) report.pty.codex = await ptySession({ label: 'codex (interativo)', file: codex, cwd: ws, env, readyMarker: /Ask Codex|trust/i, ...(WITH_INFERENCE ? { sendText: PROMPT, expect: MARKER } : {}) });

    log('[4/5] Modos estruturados…');
    if (codex) report.structured.codexAppServer = await codexAppServer(codex, env, ws);
    if (codex && WITH_INFERENCE) report.structured.codexExec = await codexExec(codex, env, ws);
    if (claude && WITH_INFERENCE) report.structured.claudePrint = await claudePrint(claude, env, ws);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }

  log('[5/5] Gravando relatório sanitizado…');
  for (const t of Object.values(report.tools)) for (const c of t.candidates) delete c.absPath;
  const outDir = join(here, 'results'); mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `poc-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, redact(JSON.stringify(report, null, 2)));
  console.log(redact(JSON.stringify(report, null, 2)));
  log(`\nRelatório: ${file}`);
}

main().catch((e) => { console.error(redact(e.stack ?? String(e))); process.exit(1); });
