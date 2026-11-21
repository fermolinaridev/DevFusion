# Segurança, testes e distribuição

## Níveis de permissão
1. Leitura; 2. desenvolvimento em arquivos autorizados; 3. comandos/testes permitidos; 4. delegação; 5. autonomia limitada. Níveis são políticas do produto, não garantias de isolamento de processos.

Electron: contextIsolation=true, nodeIntegration=false, sandbox do renderer quando compatível, CSP restritiva, preload mínimo, canais IPC allowlist e Zod, validar remetente e argumentos. Não carregar conteúdo remoto privilegiado. Executar processos com argumentos separados e sem concatenação de shell; preservar sandbox e aprovações nativas de cada CLI. Não enviar teclas para aprovar prompts automaticamente. Restrições de filesystem precisam de mecanismo real do SO ou sandbox da CLI, não apenas validação textual do orquestrador. Nunca afirmar isolamento que não existe.

Proteção de .env e credenciais; redigir logs; tratar saída e conteúdo do repositório como dados não confiáveis. Não transmitir dados desnecessários ao outro provedor. Exigir aprovação para operações destrutivas, instalação, acesso fora de workspace e merge. Limitar rodadas, tempo, concorrência e mensagens. Botão de parada geral encerra tarefas e processos controlados com tratamento por plataforma. Não contornar limites de assinatura.

## Testes
- Unitários: detectores, parsers, schemas, política de permissões, scheduler, loop guard, caminhos.
- Integração: CLIs simuladas, PTY, SQLite/migrações, Git temporário, erro e cancelamento; separar testes reais opcionais com assinatura.
- E2E: primeira execução, ambiente incompleto, instalação cancelada, sessão individual, dois terminais, modo manual, revisão, recuperação, parada geral.
- Segurança: IPC inválido, comandos perigosos, path traversal, symlinks, injeção shell, segredo em saída, conteúdo malicioso de agente.
- Compatibilidade: Windows prioritário, homologação macOS/Linux, módulos nativos compilados para versão Electron/arquitetura alvo.

## Distribuição
Electron Builder: .exe Windows, .dmg macOS, AppImage ou pacote Linux. Builds por plataforma, assinatura/notarização quando aplicável, checksums, releases e atualizações verificadas. Validar instaladores em máquinas limpas e documentar requisitos específicos. Native addons (node-pty/SQLite) requerem atenção à ABI. Não incluir credenciais ou CLIs sem verificar direitos de redistribuição; usar instaladores oficiais assistidos.

Implementado na Fase 8 ([18-FASE8-DISTRIBUICAO.md](18-FASE8-DISTRIBUICAO.md)): Electron Fuses (sem RunAsNode/NODE_OPTIONS/inspect; integridade do asar), pacote verificado por teste (sem credenciais, testes ou CLIs de terceiros), releases em rascunho com SHA-256 e aviso de versão com URL validada. Integração opcional com o ai-memory documentada em [19-AI-MEMORY.md](19-AI-MEMORY.md).

Fase 9 ([20-FASE9-ORQUESTRADOR.md](20-FASE9-ORQUESTRADOR.md)):
- O Dev Orchestrator não dá ao app nenhum poder novo sobre os agentes. A automação parte do agente oficial, e o DevFusion só lê arquivos de eventos (hooks oficiais do Claude Code e saída JSONL do `codex exec`) para exibir.
- Os eventos contêm prompts e ficam na pasta de dados do app; são apagados ao iniciar uma nova sessão do orquestrador.
- Workers do Codex usam o sandbox oficial (`workspace-write`), nunca `--dangerously-bypass-approvals-and-sandbox` (verificado por teste).
- Exceção à allowlist de ambiente, por decisão do usuário: `AI_MEMORY_AUTH_TOKEN` é repassado se exportado; nenhum outro token ou API key.
