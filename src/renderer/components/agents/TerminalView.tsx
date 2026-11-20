import { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { AgentId } from '@shared/agents';
import { terminalSizes, useAgentStore } from '../../stores/agentStore';
import { useAppStore } from '../../stores/appStore';

/** Terminais montados, para focar e ler a seleção a partir de outros componentes. */
const terminals = new Map<AgentId, Terminal>();
export const focusTerminal = (agent: AgentId) => terminals.get(agent)?.focus();
export const terminalSelection = (agent: AgentId) => terminals.get(agent)?.getSelection() ?? '';

function themeFromCss(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { background: v('--bg'), foreground: v('--text'), cursor: v('--accent'), selectionBackground: v('--surface-2') };
}

/**
 * Terminal xterm.js ligado ao PTY do agente no main. Confirma o consumo da saída
 * (controle de fluxo), reanexa o histórico recente e acompanha o tamanho do painel.
 */
export function TerminalView({ agent, sessionId, themeKey }: { agent: AgentId; sessionId: string | null; themeKey: string }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      scrollback: 5000,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace',
      fontSize: useAppStore.getState().settings.terminalFontSize,
      cursorBlink: true,
      convertEol: false,
      // CLIs como o Codex capturam o mouse; ⌥ Option (macOS) / Shift (outros) força a seleção de texto.
      macOptionClickForcesSelection: true,
      // Links OSC 8 escondem o destino atrás de um texto: confirma mostrando a URL real.
      linkHandler: {
        allowNonHttpProtocols: false,
        activate: (_e, uri) => { if (/^https:\/\//i.test(uri) && window.confirm(`Abrir no navegador?\n\n${uri}`)) window.open(uri); },
      },
      theme: themeFromCss(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Links abrem no navegador do sistema (o main só permite https) e exigem clique.
    term.loadAddon(new WebLinksAddon((_e, uri) => { window.open(uri); }));
    term.open(el);
    termRef.current = term;
    terminals.set(agent, term);
    const sel = term.onSelectionChange(() => useAgentStore.getState().setHasSelection(agent, term.hasSelection()));

    const doFit = () => {
      try { fit.fit(); } catch { return; }
      terminalSizes[agent] = { cols: term.cols, rows: term.rows };
      void window.devfusion.terminal.resize(agent, term.cols, term.rows);
    };
    doFit();
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(doFit); });
    ro.observe(el);

    const offData = window.devfusion.terminal.onData(({ agent: a, data }) => {
      if (a !== agent) return;
      term.write(data, () => { void window.devfusion.terminal.ack(agent, data.length); });
    });
    const input = term.onData((d) => { void window.devfusion.terminal.write(agent, d); });
    void window.devfusion.terminal.replay(agent).then((r) => { if (r.ok && r.data) term.write(r.data); });

    return () => { offData(); input.dispose(); sel.dispose(); ro.disconnect(); cancelAnimationFrame(raf); if (terminals.get(agent) === term) terminals.delete(agent); term.dispose(); termRef.current = null; };
  }, [agent]);

  // Nova sessão: limpa a tela anterior e leva o foco do teclado ao terminal,
  // para que Enter/teclas vão para a CLI (e não para um botão da interface).
  useEffect(() => {
    if (!sessionId) return;
    termRef.current?.reset();
    termRef.current?.focus();
  }, [sessionId]);
  useEffect(() => { if (termRef.current) termRef.current.options.theme = themeFromCss(); }, [themeKey]);
  const fontSize = useAppStore((s) => s.settings.terminalFontSize);
  useEffect(() => { if (termRef.current) termRef.current.options.fontSize = fontSize; }, [fontSize]);

  return <div ref={host} className="h-full w-full overflow-hidden px-1 pt-1" data-testid={`terminal-${agent}`} />;
}
