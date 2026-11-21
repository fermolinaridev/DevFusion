# Fase 8 — Distribuição

Status: **concluída** — instaladores gerados e testados nas três plataformas pelo workflow de release (tag `v0.3.0-beta.1`, execução 44859491674) (versão `0.3.0-beta.1`) · Pré-requisito: Fase 7 concluída com CI verde no Windows e no Linux ([17-FASE7-ESTABILIDADE.md](17-FASE7-ESTABILIDADE.md)).
Roadmap: "Instalador Windows, depois macOS/Linux após testes específicos. README, manual, documentação, GitHub Releases e atualizações verificadas." Referência: [08-SEGURANCA.md](08-SEGURANCA.md) § Distribuição.

## Inspeção do repositório (início da fase)
- **Sem empacotamento**: o app só roda por `electron .`/`electron-vite`; não há `electron-builder`, ícone, `build/` nem workflow de release (a arquitetura já prevê `electron-builder.yml`).
- Módulos nativos: `node-pty` 1.1.0 (N-API, estável entre versões do Node/Electron; prebuilds para Windows e macOS, compilado no `npm ci` no Linux) precisa ficar **fora do asar**. SQLite é o `node:sqlite` embutido (sem addon nativo).
- Já preparado para o pacote: variáveis de teste (`DEVFUSION_*`) e DevTools desligados quando empacotado; CSP de produção; sandbox global.
- **Fuses do Electron** não configuradas: o binário empacotado aceitaria `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` e `--inspect`, permitindo usar o executável do app como um Node genérico.
- A statusline do Claude usa `ELECTRON_RUN_AS_NODE` como alternativa quando não há Node externo (só macOS/Linux; no Windows já exige Node).
- Sem mecanismo de atualização nem manual do usuário.

## Decisões do usuário
1. Instalar `electron-builder` 26.18.0 e `@electron/fuses` 2.1.3 (devDependencies fixadas).
2. **Beta sem assinatura de código** + SHA-256 publicado (sem custo de certificado).
3. Atualização **só avisa** (consulta o GitHub Releases; nada é baixado nem instalado sozinho).
4. **Windows homologado** + macOS/Linux gerados e testados, marcados como beta.
5. Durante a fase: **integrar o ai-memory** como opção desligada por padrão ([19-AI-MEMORY.md](19-AI-MEMORY.md)).

## Plano
1. **Empacotamento** com `electron-builder` (devDependency fixada) e `electron-builder.yml`: só `out/` e dependências de produção no pacote; `node-pty` desempacotado do asar; nada de testes, `poc/`, docs, `.env`, mapas de código ou CLIs de terceiros.
   - Windows: instalador **NSIS por usuário** (sem administrador), x64, atalho no menu Iniciar, desinstalador.
   - macOS: `.dmg` (arm64 e x64). Linux: AppImage e `.deb`.
2. **Endurecimento por Fuses**: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` e `EnableNodeCliInspectArguments` desligados; validação de integridade do asar e `OnlyLoadAppFromAsar` ligados. Consequência: sem Node externo, o card de uso do Claude explica que precisa do Node (como já acontece no Windows).
3. **System Doctor ganha a checagem "Terminal integrado (PTY)"**: abre um processo trivial pelo `node-pty` e confirma a saída — detecta módulo nativo quebrado no pacote antes de o usuário abrir um agente.
4. **Ícone** original gerado a partir de um SVG versionado no repositório.
5. **Teste do app empacotado** (Playwright apontando para o executável gerado, perfil isolado): abre, Doctor roda, PTY nativo funciona, sandbox/CSP, variáveis de teste ignoradas, Fuses efetivas (`ELECTRON_RUN_AS_NODE=1` não vira Node) e conteúdo do asar sem arquivos indevidos.
6. **CI de release** (tag `v*`): instaladores nas três plataformas, `SHA256SUMS.txt`, instalação silenciosa do NSIS num runner Windows limpo → teste do app instalado → desinstalação; release criada como **rascunho** (quem publica é o usuário).
7. **Atualizações verificadas** conforme decisão do usuário.
8. **Documentação**: manual do usuário (instalação, avisos de SmartScreen/Gatekeeper sem assinatura, primeiro uso, login oficial, onde ficam dados e logs, desinstalação), README, CHANGELOG e versão `0.3.0-beta.1`.

## Critérios de aceitação
| # | Critério |
|---|---|
| D1 | Instalador Windows instala sem administrador, abre o app, desinstala sem deixar processos; dados do usuário preservados. Verificado em runner Windows limpo. |
| D2 | App empacotado: Doctor roda, PTY nativo funciona, SQLite ok, sandbox/CSP ativos, variáveis de teste ignoradas. |
| D3 | Fuses efetivas no binário (RunAsNode, NODE_OPTIONS, inspect desligados; integridade do asar). |
| D4 | Pacote sem credenciais, testes, `poc/`, `.env` ou CLIs de terceiros (listagem do asar verificada). |
| D5 | Release por tag gera instaladores + `SHA256SUMS.txt` numa release rascunho; nada publicado sem o usuário. |
| D6 | Atualização verificada conforme a decisão (sem instalar nada sem consentimento). |
| D7 | macOS e Linux: artefatos gerados e testados (macOS nesta máquina; Linux no CI) com status de homologação documentado. |
| D8 | Manual, README e CHANGELOG atualizados; critério de lançamento do roadmap revisado item a item. |

## Resultado (2026-11-20, macOS 27.2 arm64)

| # | Status | Evidência |
|---|---|---|
| D1 | ✅ | `release.yml` na tag `v0.3.0-beta.1`: NSIS instalado em silêncio num runner Windows limpo (por usuário, sem administrador), teste do app **instalado** aprovado, desinstalação sem executável nem processo restante. |
| D2 | ✅ | `tests/package/packaged.spec.ts` (Playwright pela porta de depuração do Chromium, perfil isolado por `--user-data-dir`): Doctor com `pty`/`app-data` ok, renderer sem Node, CSP, variáveis `DEVFUSION_*` ignoradas. Passou no app arm64 e nos dois `.dmg` montados (arm64 e x64 via Rosetta). No CI (commit `89f0c6b`), o app empacotado também passou no mesmo teste no **Windows** e no **Linux**. |
| D3 | ✅ | Mesmo teste lê as Fuses do binário (`@electron/fuses`) e confirma que `ELECTRON_RUN_AS_NODE=1` não executa código como Node. |
| D4 | ✅ | Teste lê o índice do asar: só `out/`, `package.json`, `node-pty` e `zod`; nenhum `.env`, mapa, `.pdb`, teste, fonte TS, `poc/` ou docs; binário nativo só da plataforma empacotada. |
| D5 | ✅ | Release **rascunho** criada com instaladores, `SHA256SUMS.txt` e notas do CHANGELOG; versão da tag conferida com o `package.json`. A publicação é feita pelo usuário. |
| D6 | ✅ | `UpdateChecker`: SemVer com pré-releases, rascunhos ignorados, URL aceita só do repositório oficial e da mesma tag, timeout, uma vez por dia, desligável. Unitários + E2E com servidor local (inclui release maliciosa recusada). |
| D7 | ✅ | `.dmg` arm64/x64 verificados e testados (local e no CI de release); Linux: `.deb` instalado, testado e removido, AppImage extraído e testado no `release.yml`. Homologação em máquinas reais ainda pendente (beta). |
| D8 | ✅ | [MANUAL.md](MANUAL.md), README, CHANGELOG, este documento e [19-AI-MEMORY.md](19-AI-MEMORY.md). |

Totais locais: **136 testes unitários**, **42 E2E** e **3 testes do app empacotado**.

### Problemas encontrados e corrigidos
| Problema | Causa | Correção |
|---|---|---|
| App empacotado morto ao abrir no Apple Silicon (exit 137) | as Fuses alteram o binário e invalidam a assinatura ad-hoc original | `mac.identity: "-"` (assinatura ad-hoc no build; gratuita) |
| `codesign` falhava ("resource fork… not allowed") | pasta `Documents` sincronizada pelo iCloud grava atributos estendidos | gerar o build do Mac fora do iCloud: `npx electron-builder --mac -c.directories.output=/tmp/devfusion-release` |
| `files` por plataforma incluiu `src/*.ts` e `.md` no asar | no electron-builder, `files` de plataforma substitui a lista da raiz | lista única na raiz com macros `${platform}-${arch}`; teste do asar impede regressão |
| node-pty do Windows com 30 MB por arquitetura | símbolos de depuração (`.pdb`) e prebuilds de outras plataformas | excluídos |
| Monaco/React iam duas vezes para o pacote | bibliotecas do renderer listadas em `dependencies` | movidas para `devDependencies` (o Vite já as embute) |
| Consulta de atualização bloqueada (`ERR_BLOCKED_BY_CLIENT`) | a sessão do renderer bloqueia toda rede externa (correto) | consulta numa sessão própria só em memória; a do renderer segue bloqueada |
| Statusline do Claude sem Node externo | dependia de `ELECTRON_RUN_AS_NODE`, agora desligado pelas Fuses | no app empacotado a alternativa é desligada e o card explica que precisa do Node.js |

## Limitações
- **Sem assinatura de código**: SmartScreen (Windows) e Gatekeeper (macOS) avisam na primeira abertura; o manual explica como conferir o SHA-256 e abrir.
- Instalador Windows, `.deb` e AppImage exercitados só pelo CI (runners limpos), sem teste manual em máquina real.
- `npm audit`: 6 alertas **moderados** no `minimatch` (ReDoS) dentro do electron-builder, ferramenta de build que não entra no app e só processa padrões escritos por nós; aceito até o electron-builder atualizar.
- O renderer continua carregado de `file://` (a Fuse `grantFileProtocolExtraPrivileges` fica ligada); migrar para protocolo próprio é melhoria futura.
- Sem atualização automática (decisão do usuário).
