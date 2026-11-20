import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * CSP restritiva injetada somente no build de produção. Em desenvolvimento o
 * Vite precisa de scripts inline (react-refresh) e WebSocket de HMR.
 */
const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  // xterm.js injeta <style> dinâmico (tema/cursor). Só estilos recebem 'unsafe-inline';
  // scripts seguem estritos e img/connect bloqueados impedem exfiltração via CSS.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  // Sem `frame-ancestors`: é ignorada em <meta> (gerava um erro no log a cada abertura);
  // a janela carrega file:// e navegação/iframes externos já são bloqueados pelo main.
].join('; ');

function productionCsp(): Plugin {
  return {
    name: 'devfusion-production-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`),
  };
}

const shared = { '@shared': resolve(__dirname, 'src/shared') };

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    resolve: { alias: shared },
    // Preload roda com sandbox: precisa ser CommonJS autocontido.
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') }, output: { format: 'cjs' } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { ...shared, '@renderer': resolve(__dirname, 'src/renderer') } },
    plugins: [react(), tailwindcss(), productionCsp()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
  },
});
