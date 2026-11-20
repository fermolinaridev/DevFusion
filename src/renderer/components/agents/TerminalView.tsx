import { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { AgentId } from '@shared/agents';
import { terminalSizes } from '../../stores/agentStore';

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
      fontSize: 13,
      cursorBlink: true,
      convertEol: false,
      theme: themeFromCss(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Links abrem no navegador do sistema (o main só permite https) e exigem clique.
    term.loadAddon(new WebLinksAddon((_e, uri) => { window.open(uri); }));
    term.open(el);
    termRef.current = term;

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

    return () => { offData(); input.dispose(); ro.disconnect(); cancelAnimationFrame(raf); term.dispose(); termRef.current = null; };
  }, [agent]);

  // Nova sessão: limpa a tela anterior e leva o foco do teclado ao terminal,
  // para que Enter/teclas vão para a CLI (e não para um botão da interface).
  useEffect(() => {
    if (!sessionId) return;
    termRef.current?.reset();
    termRef.current?.focus();
  }, [sessionId]);
  useEffect(() => { if (termRef.current) termRef.current.options.theme = themeFromCss(); }, [themeKey]);

  return <div ref={host} className="h-full w-full overflow-hidden px-1 pt-1" data-testid={`terminal-${agent}`} />;
}
