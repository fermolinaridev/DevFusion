import { useEffect } from 'react';
import { NAV_ITEMS } from '../components/layout/Sidebar';
import { focusTerminal } from '../components/agents/TerminalView';
import { useAgentStore } from '../stores/agentStore';
import { useAppStore } from '../stores/appStore';
import { useEditorStore } from '../stores/editorStore';

export const IS_MAC = navigator.userAgent.includes('Mac');
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

export const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: `${MOD_LABEL}+1 … ${MOD_LABEL}+8`, action: 'Trocar de vista na barra lateral (Dashboard, Explorer, System Doctor, Tarefas, Uso, Git, Sessões, Configurações)' },
  { keys: `${MOD_LABEL}+K`, action: 'Ir para o chat compartilhado' },
  { keys: `${MOD_LABEL}+Shift+1`, action: 'Focar o terminal do Claude Code' },
  { keys: `${MOD_LABEL}+Shift+2`, action: 'Focar o terminal do Codex' },
  { keys: `${MOD_LABEL}+Shift+.`, action: 'Parar tudo (encerra os agentes)' },
  { keys: `${MOD_LABEL}+S`, action: 'Salvar o arquivo no editor' },
  { keys: `${MOD_LABEL}+Shift+/`, action: 'Mostrar esta lista de atalhos' },
];

/**
 * Atalhos globais. Usa só combinações com ⌘ (macOS) ou Ctrl (+Shift) que os terminais
 * não usam, e captura antes do xterm/Monaco para que funcionem com o foco em qualquer lugar.
 */
export function useShortcuts(onHelp: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.altKey) return;
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
      let handled = true;
      if (digit && !e.shiftKey) {
        const item = NAV_ITEMS[Number(digit) - 1];
        if (item) useAppStore.getState().setView(item.id); else handled = false;
      } else if (digit && e.shiftKey && (digit === '1' || digit === '2')) {
        useEditorStore.getState().activate('agents');
        focusTerminal(digit === '1' ? 'claude' : 'codex');
      } else if (e.code === 'KeyK' && !e.shiftKey) {
        (document.getElementById('chat-input') as HTMLTextAreaElement | null)?.focus();
      } else if (e.code === 'Period' && e.shiftKey) {
        void useAgentStore.getState().stopAll();
      } else if (e.code === 'Slash' && e.shiftKey) {
        onHelp();
      } else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onHelp]);
}
