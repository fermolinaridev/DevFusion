# Fase 7 — Estabilidade e beta

Status: **concluída no macOS; CI Windows + Linux configurado** · Pré-requisito: Fase 6 aceita no macOS ([16-FASE6-UI.md](16-FASE6-UI.md)).
Roadmap: "Unitários, integração e E2E; falhas, limites, recuperação, processos órfãos, logs sanitizados e revisão de segurança." Referência de testes: [08-SEGURANCA.md](08-SEGURANCA.md).

## Inspeção do repositório (início da fase)
- 112 testes unitários e 34 E2E, todos locais no macOS; **Windows e Linux nunca executados**.
- Logs só no console (sanitizados); sem arquivo de log nem exportação de diagnóstico para relato de problemas.
- Sem tratamento explícito de queda do renderer, exceções não tratadas no main ou banco corrompido.
- `npm audit`: 2 alertas de baixa severidade no `dompurify` (dependência do Monaco).

## Decisão do usuário
CI no GitHub Actions em **Windows e Linux** (push na `main` e pull requests).

## Plano
1. **Revisão de segurança** sistemática (IPC, Electron, processos, caminhos, segredos, conteúdo de agentes, dependências) com correções e testes de regressão; fuzz de todos os canais IPC.
2. **Falhas e recuperação**: queda do renderer → recarregar e reanexar terminais; exceções no main registradas; banco corrompido/ilegível → mensagem clara sem apagar dados; processos de agente não sobrevivem ao app (inclusive se o main for morto à força).
3. **Logs em arquivo** (sanitizados, rotação por tamanho) e **"Exportar diagnóstico"** (versões, Doctor, configurações sem segredos, log recente) para relatar problemas.
4. **Testes**: cobertura medida, testes reais opcionais separados (`DEVFUSION_REAL_TESTS=1`), checagem de limites.
5. **CI** Windows + Linux; corrigir o que quebrar.
6. **Beta** `0.2.0-beta.1` com CHANGELOG.

## Critérios de aceitação
| # | Critério |
|---|---|
| S1 | Revisão de segurança documentada; achados corrigidos ou justificados; fuzz de IPC sem erro interno. |
| S2 | Renderer que cai é recarregado sem matar agentes; terminais reanexados. |
| S3 | Matar o processo main à força não deixa processos de agente vivos. |
| S4 | Banco ilegível gera mensagem e preserva o arquivo; exceções não tratadas são registradas. |
| S5 | Log em arquivo sanitizado e limitado; diagnóstico exportável sem segredos. |
| S6 | Cobertura medida; testes reais opcionais separados dos automáticos. |
| S7 | CI verde em Windows e Linux (ou falhas restantes documentadas como limitação de plataforma). |
| S8 | `npm audit` sem alertas ou com justificativa. |

## Revisão de segurança

| Área | Verificação | Resultado |
|---|---|---|
| IPC | Todos os canais em allowlist com schema Zod; remetente validado | **Fuzz**: unitário (todos os schemas × valores hostis, inclusive poluição de protótipo e 5 MB de texto) e E2E (cada função do preload × 8 valores hostis, > 200 chamadas): nenhum erro interno, app segue respondendo |
| Electron | `contextIsolation`, `sandbox` (agora também `app.enableSandbox()`), sem `nodeIntegration`, CSP, navegação/popups/webviews/permissões bloqueados, DevTools só fora do pacote | ✅ (E2E da Fase 1) |
| Processos | Nenhum `shell: true`/`exec`; argumentos separados; `.cmd` com rejeição de metacaracteres; único comando via shell é a statusline, com aspas testadas num shell real | ✅ |
| Arquivos | Explorer/editor presos à raiz por caminho real (traversal, absoluto, symlink para fora); gravações só em: arquivo existente validado, `userData` e local escolhido no diálogo nativo | ✅ |
| Segredos | Ambiente das CLIs por allowlist; `redact()` em logs, diffs e diagnóstico; `.env`/chaves fora de diffs e commits | ✅ (log em arquivo e diagnóstico testados sem e-mail/token/home) |
| Conteúdo de agente | Colagem sem Enter, remoção de sequências de controle, cabeçalho de procedência, pré-visualização; recusa de várias linhas sem bracketed paste | ✅ |
| Links no terminal | URLs visíveis abrem só `https` no navegador; **links OSC 8 (texto ≠ destino) agora pedem confirmação mostrando a URL real** | corrigido |
| Variáveis de ambiente de teste | `DEVFUSION_TOOL_PATH` etc. ignoradas no app empacotado | corrigido |
| Dependências | `npm audit` | `dompurify` forçado para 3.4.18 via `overrides`: **0 alertas**; editor revalidado pelos E2E |

Riscos aceitos e documentados:
- **Caminhos de CLI configuráveis**: o app executa o caminho que o usuário configurar (é a função do recurso). Um renderer comprometido poderia alterá-lo, mas o renderer já é a interface confiável que digita nos terminais; a proteção é a CSP + sandbox + IPC validado.
- **Hooks do Git** do repositório rodam no commit feito pelo app (comportamento normal do Git).
- **Log de diagnóstico de encerramento** inclui as últimas linhas da tela do agente (sanitizadas), gravadas só localmente.

## Resultado (2026-11-20, macOS 27.2 arm64)

| # | Status | Evidência |
|---|---|---|
| S1 | ✅ | Tabela acima; `tests/unit/ipcFuzz.test.ts`, `tests/e2e/fuzz.spec.ts` |
| S2 | ✅ | E2E: `forcefullyCrashRenderer()` com dois agentes rodando → janela recarrega, PIDs vivos, terminal reanexado com o conteúdo anterior e digitação funcionando; queda registrada no log |
| S3 | ✅ | E2E: SIGKILL no main com Codex falso que ignora SIGINT/SIGTERM → os dois agentes morrem (o fechamento do PTY os encerra) |
| S4 | ✅ | E2E: banco corrompido → mensagem, arquivo intacto, nada movido sem escolha; unitário da quarentena (renomeia com -wal/-shm); `uncaughtException`/`unhandledRejection` registrados |
| S5 | ✅ | Unitário: log sanitizado e rotação (3 arquivos); E2E: diagnóstico exportado sem e-mail nem caminho da home |
| S6 | ✅ | `npm run test:coverage`: 85,06% instruções, 71,58% ramos, 83,16% funções, 90,26% linhas (main + shared; ponto de entrada e config do Electron cobertos pelos E2E). `npm run test:real`: 3 testes com as CLIs reais, sem consumir cota |
| S7 | ⏳ | Workflow `.github/workflows/ci.yml` (Windows + Linux) pronto; resultado após o push |
| S8 | ✅ | 0 alertas |

Totais locais: **117 testes unitários** e **39 E2E**.

## Limitações
- Windows/Linux: dependem do primeiro resultado do CI (os testes com CLIs falsas por PTY ainda são pulados no Windows).
- Recuperação após queda do **main**: agentes são encerrados (não ficam órfãos), mas a sessão não é retomada automaticamente.
