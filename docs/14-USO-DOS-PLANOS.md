# Painel "Uso dos planos" (entre a Fase 4 e a Fase 5)

Pedido do usuário (2026-11-20): mostrar o uso dos planos do Claude e do Codex, nas janelas de 5 horas e semanal, antes da Fase 5.

## Fontes investigadas
| Provedor | Fonte oficial | Situação |
|---|---|---|
| Codex | App Server: `account/rateLimits/read` → `primary`/`secondary` com `usedPercent`, `windowDurationMins`, `resetsAt` (schema gerado pela própria CLI) | ✅ Leitura sem conversar com o modelo e sem consumir cota |
| Claude Code | Statusline: o JSON entregue ao comando de statusline traz `rate_limits.five_hour` e `rate_limits.seven_day` (`used_percentage`, `resets_at`) — [docs](https://code.claude.com/docs/en/statusline) | ✅ Só para assinantes, só durante uma sessão e depois da primeira resposta |
| Claude Code | `/usage` | Só barras na tela, sem formato documentado; não usado |
| Claude Code | API interna de uso | Exigiria ler o token OAuth; **proibido** (termos e regras do projeto) |

## Decisões do usuário
1. **Codex**: usar o App Server **somente para ler** os limites (consulta a cada 5 min e no botão "Atualizar").
2. **Claude**: iniciar as sessões do DevFusion com a flag oficial `--settings` acrescentando uma statusline do DevFusion. O usuário não tinha statusline própria, então nada foi substituído.

## Implementação
- `CodexUsageReader`: App Server efêmero; **allowlist** de métodos (`initialize`, `initialized`, `account/rateLimits/read`). O consumo do reset gratuito (`account/rateLimitResetCredit/consume`) é impossível de chamar pelo app; o reset é só exibido. O `accountId` não é exibido nem guardado.
- `ClaudeStatuslineBridge`: script `devfusion-statusline.cjs` em `userData/usage/`, executado pelo Claude Code. Ele grava **apenas** `rate_limits` em `claude-rate-limits.json` (sem `cwd`, caminho de transcrição ou conversa) e imprime "DevFusion · uso do plano: 5h N% · semana M%" no rodapé do Claude. Executor: Node externo detectado; sem ele, o próprio Electron com `ELECTRON_RUN_AS_NODE=1` (POSIX).
- `UsageService`: junta as fontes; falha temporária do Codex mantém o último valor bom e avisa; não estima nem prevê nada (respeita "clients must not infer recovery from percentages").
- UI: item "Uso dos planos" na barra lateral (barras por janela, reinício relativo e absoluto, "atualizado há…", fonte) e resumo da janela de 5 h na barra de status.

## Testes
- Unitários (10): script da statusline (só `rate_limits`, entrada inválida, janela ausente), comando gerado executado num shell real, aspas em caminhos, arquivo corrompido; leitor do Codex com App Server falso (mapeamento, extras, **log dos métodos enviados**, sem login, formato inesperado, timeout, CLI ausente); último valor bom mantido.
- E2E (2): painel com Codex falso e statusline simulada, atualização ao vivo, `--settings` chegando ao Claude, só métodos de leitura; Codex sem login sem números inventados.
- **Teste real** (2026-11-20): Codex Plus 8% (5 h) e 1% (semanal); Claude Pro 96% (5 h) e 16% (semanal), recebidos 2 s após uma resposta; rodapé do Claude com a linha do DevFusion; arquivo gravado só com `rate_limits`.

## Limitações
- Claude só atualiza durante sessões abertas no DevFusion e depois de uma resposta; fora disso o painel mostra o último valor com o horário.
- Se você configurar uma statusline própria no Claude Code, nas sessões do DevFusion vale a do DevFusion (a `--settings` tem precedência).
- Windows: sem Node externo não há statusline do Claude (o atalho `ELECTRON_RUN_AS_NODE=1` é sintaxe POSIX). Não testado.
- App Server do Codex é experimental: se o formato mudar, o card mostra "formato inesperado" em vez de números errados.
- Empacotamento (Fase 8): se o fuse `RunAsNode` do Electron for desligado, o executor precisa ser o Node externo.
