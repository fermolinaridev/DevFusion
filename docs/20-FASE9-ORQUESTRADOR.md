# Fase 9 — Dev Orchestrator

Status: **implementada no macOS** (Linux pelo mesmo código POSIX, a validar no CI; Windows ainda não suportado) · Pedido do usuário (2026-11-21): um orquestrador no meio que distribui tarefas para agentes do Claude Code e do Codex, escolhendo modelo e esforço conforme a tarefa. Claude à esquerda, Codex à direita, tudo com o ai-memory.

## Decisões do usuário
1. **Quem orquestra é um agente oficial**, não o DevFusion. O painel central é uma sessão interativa da CLI oficial:
   - Claude Code com **Opus 5.5, esforço alto**, ou
   - Codex com **GPT-6.2-Astra, esforço alto**.

   O agente dispara os workers com recursos oficiais da própria CLI. O DevFusion só inicia as CLIs com flags documentadas e **mostra** os workers; ele não lê saída para decidir nada nem envia Enter sozinho. Isso mantém a decisão de termos da Fase 0, porque o app continua sem automatizar o Claude.
2. ai-memory real instalado e configurado (ver [19-AI-MEMORY.md](19-AI-MEMORY.md) § Teste real).
3. Workers do Codex usam a CLI embutida no ChatGPT.app (nada instalado).
4. Repassar `AI_MEMORY_AUTH_TOKEN` às CLIs (ver abaixo).

## Inspeção (início da fase)
- A skill `dev-orchestrator` existente é só uma persona ("engenheiro sênior, respostas curtas"). Ela não tem roteamento, roster de modelos nem controle de workers.
- **Claude Code 2.1.330**: `--model`, `--effort low|medium|high|xhigh|max`, `--agents <json>`, `--settings`, `--append-system-prompt`.
  - Validado agora: com o orquestrador em Sonnet, um worker declarado com `"model":"haiku","effort":"low"` respondeu como `claude-haiku-5-5`.
  - Os subagentes rodam dentro da sessão do orquestrador, e as aprovações aparecem no terminal central.
- **Codex 0.171.0-alpha.13** (ChatGPT.app): `exec --json -m <modelo> -c model_reasoning_effort=<e> -s workspace-write -C <dir>`.
  - Modelos no cache local: `gpt-6.2-astra`, `gpt-6.2-sol`, `gpt-6.1-terra`, `gpt-6-luna` etc.
  - Esforços: low até max/ultra.
- Hoje a UI tem dois terminais (Claude | Codex) e não tem painel central.

## Arquitetura
```
┌──────────── Agentes Claude ───────────┬──────── ORQUESTRADOR ────────┬──────── Agentes Codex ────────┐
│ cards por subagente (modelo, esforço, │ terminal da CLI oficial      │ cards por `codex exec`        │
│ status, tarefa, saída resumida)       │ (Opus 5.5 alto | 6.2-Astra)  │ (modelo, esforço, JSONL)      │
└───────────────────────────────────────┴──────────────────────────────┴───────────────────────────────┘
                     ↑ hooks oficiais (SubagentStart/Stop)      ↑ arquivos JSONL que o orquestrador grava
                     └──────── DevFusion só observa e exibe; Parar tudo encerra a árvore inteira ────────┘
```

### Roster de workers (editável em Configurações)
| Classe da tarefa | Worker padrão | Exemplos |
|---|---|---|
| trivial | Claude **Sonnet, esforço baixo** | renomear, ajustar texto, rodar e ler testes |
| rotina | Claude Sonnet médio · Codex GPT-6.2-Sol médio | bugfix localizado, teste unitário, revisão de diff pequeno |
| complexa | Claude **Opus 5.5 alto** · Codex **GPT-6.2-Astra alto** | feature multi-arquivo, refatoração, revisão de arquitetura |
| crítica | o mesmo da complexa + revisão cruzada pelo outro provedor | segurança, migração de dados |

### Peças
1. **Skill `devfusion-orchestrator`**, empacotada com o app e passada por flag oficial, sem alterar a configuração global do usuário. Ela descreve:
   - classificação da tarefa;
   - roster;
   - quando usar Claude ou Codex (implementação × revisão/teste cruzado);
   - paralelismo só em worktrees separados;
   - limites (máximo de workers simultâneos, rodadas de revisão);
   - uso do ai-memory para handoff e decisões;
   - formato do relatório final.
2. **Orquestrador Claude**: `claude --model opus --effort high --agents <roster> --append-system-prompt <skill> --settings <hooks+statusline>`.
   - Os hooks `SubagentStart`/`SubagentStop` gravam eventos num arquivo do DevFusion.
   - Comando dos hooks: `sh`/PowerShell com `cat >> arquivo`, sem Node.
3. **Workers Codex**: a skill dá o comando exato (`codex exec --json … > <pasta de eventos>/<id>.jsonl`), com o caminho do Codex já validado pelo Doctor.
4. **Orquestrador Codex**: `codex -m gpt-6.2-astra -c model_reasoning_effort=high` com a skill como instrução.
   - Ele dispara workers Codex com `codex exec`.
   - Workers Claude só com `claude -p` e **desligados por padrão**, por causa da ressalva de termos da Fase 0.
5. **UI em três colunas**:
   - Esquerda: cards dos workers Claude.
   - Centro: terminal do orquestrador e seletor de modelo.
   - Direita: cards dos workers Codex.
   - Cada card mostra modelo, esforço, tarefa, status, duração e a saída resumida. O transcript completo abre sob demanda.
   - Os terminais diretos de Claude e Codex continuam disponíveis (modo atual).
6. **ai-memory**: com a opção ligada, o orquestrador também inicia por `ai-memory run`. Os workers herdam os hooks globais do ai-memory e a captura acontece em todos.
7. **Parar tudo**: encerra o orquestrador, os subagentes e cada `codex exec` (grupo de processos), sem órfãos.

## Token do ai-memory (decisão do usuário)
- `AI_MEMORY_AUTH_TOKEN` entrou na allowlist de ambiente das CLIs (única variável com TOKEN). O MCP do ai-memory no Codex lê esse nome.
- O valor só existe se o próprio usuário exportou a variável. O DevFusion não lê o arquivo do token e não registra o valor (o ambiente não vai para o log).
- Teste unitário: só esse nome passa; `GITHUB_TOKEN`, `OPENAI_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` etc. continuam bloqueados.

## Implementação
| Peça | Arquivo |
|---|---|
| Tipos, roster padrão, modelos e esforços | `src/shared/orchestrator.ts` (configuração `orchestrator`) |
| Instruções do orquestrador, roster `--agents`, hooks, script do worker do Codex, argumentos do líder | `src/main/orchestrator/DevOrchestrator.ts` |
| Leitura dos eventos e montagem dos cards (só leitura), Parar worker/tudo | `src/main/orchestrator/WorkerMonitor.ts` |
| Início no papel de orquestrador (`role: 'orchestrator'`), comando exibido sem instruções | `AgentService`, `CliAgentAdapter` |
| IPC `workers:list`, `workers:stop`, evento `event:workers` | `ipcChannels`, `ipcContracts`, preload |
| Barra de modo, três colunas, cards, seção em Configurações | `ModeBar`, `WorkersColumn`, `AgentPane`, `SettingsView` |

Detalhes que vieram do teste real:
- O Claude Code entrega por hook o modelo efetivo do subagente (`tool_response.resolvedModel`); o card mostra esse valor quando existe.
- Subagente em segundo plano gera `PostToolUse` com `status: "async_launched"` antes de terminar; tratado como "trabalhando" até o `SubagentStop`.
- Com o Codex como orquestrador, o shell dele roda no sandbox; o script do worker precisa de rede e da pasta de eventos, então o Codex pede aprovação ao usuário para rodá-lo fora do sandbox.
- Os eventos ficam em `<dados do app>/orchestrator/events` e são apagados ao iniciar uma nova sessão, porque contêm prompts.

## Critérios de aceitação
| # | Critério |
|---|---|
| O1 | Orquestrador inicia pela CLI oficial com modelo e esforço escolhidos (Opus 5.5 alto ou GPT-6.2-Astra alto); login e prompts de confiança continuam com o usuário. |
| O2 | Tarefa trivial vira worker Claude Sonnet com esforço baixo e tarefa complexa vira Opus alto ou 6.2-Astra alto, conforme o roster (verificado pelo modelo real reportado nos eventos). |
| O3 | Workers Claude aparecem à esquerda e workers Codex à direita, em tempo real, com modelo, esforço, status e saída. |
| O4 | Workers em paralelo usam worktrees separados; nenhum escreve na mesma árvore ao mesmo tempo. |
| O5 | Parar tudo encerra orquestrador e workers, sem processo restante. |
| O6 | Com ai-memory ligado: o orquestrador roda por `ai-memory run`, os eventos dos workers são capturados e uma decisão de um worker é recuperável pelo outro provedor. |
| O7 | O app não decide nada a partir da saída dos agentes nem envia teclas; toda automação parte do agente oficial. |
| O8 | Testes: unitários (roster, montagem de comandos, parser de eventos), E2E com CLIs falsas (três colunas, Parar tudo), teste real curto com Sonnet baixo e GPT-6.2-Astra. Docs, manual e CHANGELOG atualizados. |

## Resultado (2026-11-21, macOS 27.2 arm64)
| # | Status | Evidência |
|---|---|---|
| O1 | ✅ | E2E: líder Claude inicia com `--model claude-opus-5-5 --effort high --agents … --append-system-prompt … --settings …`; líder Codex com `-m gpt-6.2-astra -c model_reasoning_effort=high -c developer_instructions=…`. Login e prompts de confiança não são tocados. |
| O2 | ✅ | **Teste real** (`tests/real/orchestratorReal.test.ts`): o Claude Code de verdade, como orquestrador, delegou a tarefa trivial ao subagente `claude-trivial`, que rodou em **Sonnet 5.5, esforço baixo** (modelo confirmado pelo hook) e corrigiu o bug. O worker do Codex trivial rodou em **GPT-6.2-Sol, esforço baixo** e respondeu certo. Unitários conferem o roster de todas as classes. |
| O3 | ✅ | E2E: card do subagente à esquerda (modelo, esforço, tarefa, status) e do `codex exec` à direita (status, modelo, resultado, contagem). |
| O4 | ⚠️ parcial | As instruções exigem worktree separado por worker que escreve em paralelo, e o script limita os workers do Codex simultâneos (testado: o segundo é recusado com código 3). O app não impede um subagente do Claude de escrever na mesma pasta: isso depende do orquestrador seguir as instruções. |
| O5 | ✅ | E2E e unitário: Parar tudo encerra orquestrador, subagentes (aparecem "interrompido") e o grupo de processos do worker do Codex, sem processo restante. Ao sair do app, workers vivos também são encerrados. |
| O6 | ⚠️ parcial | Com o ai-memory ligado, o líder inicia por `ai-memory run` (integração existente) e os workers do Codex por `ai-memory run … codex exec` (unitário). A recuperação Claude → Codex real ainda depende de dois passos do usuário: confiar nos hooks do Codex na TUI e exportar `AI_MEMORY_AUTH_TOKEN`. |
| O7 | ✅ | O app só lê arquivos de eventos e mostra; não envia teclas nem decide nada. Quem dispara é o agente oficial. Revisão de código: o único caminho de escrita nos PTYs continua sendo o usuário (teclado, chat e tarefas). |
| O8 | ✅ | 9 unitários novos do orquestrador + 1 de ambiente (token do ai-memory), 2 E2E novos, 1 teste real opcional (`DEVFUSION_REAL_TESTS=1 DEVFUSION_REAL_PROMPTS=1`, envia prompts). Totais locais: **146 unitários**, **44 E2E**, 3 testes do app empacotado (Fase 8) e 1 teste real do orquestrador. |

## Riscos e limitações conhecidas
- **Windows**: modo orquestrador desligado nesta beta (o script do worker é POSIX e o encerramento usa grupos de processos).
- Os workers do Codex rodam com `-s workspace-write` (sandbox oficial). Os subagentes do Claude seguem as permissões da sessão do orquestrador.
- O roster usa nomes de modelo conferidos nesta máquina em 2026-11-21. Se um provedor renomear um modelo, a CLI recusa e o erro aparece no card ou no terminal.
- Workers custam cota do plano. A skill limita a concorrência (padrão: 3) e prefere o worker mais barato que resolve.
- Subagentes Claude rodam dentro do processo do orquestrador. A coluna esquerda mostra o que os hooks informam, e não um terminal interativo por worker.
- Codex embutido é alpha; flags podem mudar. O Doctor checa a versão.
- Codex orquestrando workers Claude via `claude -p` contraria a ressalva da Fase 0 e fica desligado até decisão explícita.
