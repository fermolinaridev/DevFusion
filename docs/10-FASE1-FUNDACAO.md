# Fase 1 — Fundação Electron

Status: **concluída no macOS** (Windows não testado) · Pré-requisito: Fase 0 aceita no macOS (ver [09-FASE0-POC.md](09-FASE0-POC.md)).

## Inspeção do repositório (início da fase)
- `poc/`: POC da Fase 0 (Node puro, node-pty). Permanece separada e não é dependência do app.
- `docs/`: especificação. Nenhum código de aplicativo existia.

## Escopo
Roadmap Fase 1: Electron/React/TypeScript/Vite/Tailwind, preload e IPC seguro, SQLite, migrações, configurações e layout inicial.

Fora desta fase: System Doctor (Fase 2), terminais e adapters (Fase 3), orquestração (Fase 4), Git (Fase 5), Monaco/shadcn/temas avançados (Fase 6), instalador (Fase 8).

## Plano
1. Validar no Electron alvo: `node:sqlite` embutido (evita addon nativo para o banco) e carregamento do prebuild N-API do node-pty (necessário na Fase 3).
2. Estrutura `src/{main,preload,renderer,shared}` com electron-vite, React 19, TypeScript, Tailwind 4, Zustand.
3. Segurança Electron: `contextIsolation`, `sandbox`, sem `nodeIntegration`, CSP restritiva, bloqueio de navegação e `window.open`, sem conteúdo remoto, permissões de sessão negadas.
4. IPC: canais em allowlist, argumentos e respostas validados com Zod nos dois lados, verificação do remetente (frame principal e origem do app), API mínima no preload.
5. SQLite: banco em `userData`, `foreign_keys=ON`, WAL, migrações versionadas em transação, tabelas do [05-WORKSPACE.md](05-WORKSPACE.md) com índices; repositório de configurações tipado (chaves em allowlist com schema).
6. Layout inicial conforme [06-INTERFACE.md](06-INTERFACE.md), com estados reais ("não iniciado", "disponível na Fase N"), sem dados simulados; tema claro/escuro persistido.
7. Testes: Vitest (schemas IPC, migrações, configurações) e Playwright `_electron` (app abre, flags de segurança, preload mínimo, IPC inválido rejeitado, tema persiste após reinício).

## Critérios de aceitação
| # | Critério |
|---|---|
| F1 | `npm run dev` abre a janela; `npm run build` gera main/preload/renderer sem erro; `npm run typecheck` limpo. |
| F2 | Renderer sem acesso a Node: `require`, `process` e `ipcRenderer` indefinidos; só `window.devfusion` exposto. |
| F3 | `contextIsolation`, `sandbox` ativos e `nodeIntegration` inativo, verificados em teste E2E. |
| F4 | IPC com canal fora da allowlist ou argumento inválido é rejeitado (teste). |
| F5 | Migrações aplicadas em banco novo, idempotentes em reexecução, com `foreign_keys` ativo (teste). |
| F6 | Configuração (tema) persiste no SQLite entre reinícios do app (teste E2E). |
| F7 | Layout com sidebar, dois painéis de agente, chat e barra de status; nenhum dado falso. |
| F8 | Nenhum segredo gravado; logs passam pela sanitização. |

## Resultado (2026-11-20, macOS 27.2 arm64)

| # | Status | Evidência |
|---|---|---|
| F1 | ✅ | `npm run dev` abre a janela sem erros/bloqueios no log; `npm run build` e `npm run typecheck` limpos |
| F2 | ✅ | E2E "renderer não tem acesso a Node…": `require`, `process`, `ipcRenderer`, `electron` indefinidos; `window.devfusion` congelado com só `app.getInfo`, `settings.getAll`, `settings.set` |
| F3 | ✅ | E2E "janela abre com preferências web seguras" |
| F4 | ✅ | Unitários do roteador (canal desconhecido, remetente não confiável, 5 formas de argumento inválido, erro interno sem vazamento) + E2E chamando o preload com valores inválidos |
| F5 | ✅ | `tests/unit/database.test.ts`: 12 tabelas, idempotência, WAL, FKs e CHECKs aplicados, rollback de migração quebrada, detecção de migração divergente e de banco mais novo |
| F6 | ✅ | E2E "tema escolhido persiste no SQLite entre reinícios" |
| F7 | ✅ | E2E de layout + revisão visual em screenshots (claro e escuro) |
| F8 | ✅ | Logger do main passa tudo por `redact()` (testado); tabela `settings` só aceita chaves em allowlist; auditoria registra a chave alterada |

Totais: **22 testes unitários** (Vitest) e **7 E2E** (Playwright no Electron real), todos passando. Script único: `npm run check`.

## Decisões
1. **`node:sqlite` em vez de better-sqlite3**: o Electron 45.4.1 traz Node 24.22.3 com SQLite 3.54.1 embutido (validado). Sem addon nativo → sem rebuild de ABI por plataforma. O módulo ainda é marcado como experimental pelo Node; o acesso fica isolado em `src/main/database/` para permitir troca.
2. **node-pty validado dentro do Electron 45** (prebuild N-API carregou e executou um processo sem rebuild). Ainda não é dependência do app; entra na Fase 3.
3. **Preload CommonJS sem dependências** (exigência do `sandbox: true`): só importa os nomes de canais; toda validação Zod acontece no main.
4. **Envelope `IpcResult`**: erros chegam ao renderer como `{ code, message }` genéricos; detalhes ficam só no log sanitizado.
5. **Remetente IPC**: aceito apenas o frame principal da janela do app carregado da origem esperada (servidor Vite em dev, `out/renderer/index.html` em produção; comparação de caminho compatível com Windows).
6. **CSP restritiva só no build** (`default-src 'none'`, `script-src 'self'`, `connect-src 'none'`…); em dev o Vite precisa de inline/HMR. Além disso, `webRequest` bloqueia qualquer requisição fora da origem do app, permissões do navegador são negadas, navegação/popups/webviews bloqueados, links `https` abrem no navegador do sistema.
7. **`DEVFUSION_USER_DATA_DIR`** (caminho absoluto) permite isolar o banco em testes.
8. **shadcn/ui adiado** para quando houver componentes reais (Fases 2/6); a Fase 1 usa Tailwind 4 com tokens de tema próprios.
9. **TypeScript 7.0.2** (compilador nativo) funcionou para typecheck; transpilação continua com o Vite.

## Limitações e pendências
- **Windows e Linux não testados.** Os caminhos de arquivo foram escritos para Windows, mas sem execução real.
- Bug encontrado na revisão visual e corrigido: lançar o Electron apontando para o arquivo JS fazia `app.getVersion()` retornar a versão do Electron; o E2E agora lança pela raiz do projeto e verifica a versão.
- O E2E de preferências usa `webContents.getLastWebPreferences()`, que existe em runtime mas não está nos tipos públicos do Electron 45; as mesmas garantias também são verificadas pelo comportamento.
- O bundle do renderer (~750 kB) inclui o Zod por causa de `shared/settings`; otimização adiada (irrelevante para app local, revisar na Fase 6).
- Sem empacotamento (`electron-builder`) até a Fase 8; o main depende de `zod` em `node_modules`.
- Layout redimensionável básico; persistência dos tamanhos de painel, atalhos e acessibilidade completa ficam para a Fase 6.
