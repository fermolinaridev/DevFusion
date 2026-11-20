// Carregado sob demanda (import dinâmico): o Monaco só entra na memória quando um arquivo é aberto.
// Apenas o núcleo do editor + realce de sintaxe (sem serviços de linguagem pesados) e um único worker.
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/basic-languages/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = { getWorker: () => new EditorWorker() };

/** Linguagem pelo nome do arquivo (extensões registradas pelo próprio Monaco). */
export function languageFor(fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const l of monaco.languages.getLanguages()) {
    if (l.filenames?.some((f) => f.toLowerCase() === lower)) return l.id;
    if (l.extensions?.some((e) => lower.endsWith(e.toLowerCase()))) return l.id;
  }
  return 'plaintext';
}

export { monaco };
