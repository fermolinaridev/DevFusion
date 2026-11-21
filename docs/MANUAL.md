# Manual do DevFusion (beta 0.3.0)

O DevFusion roda o **Claude Code** e o **Codex** lado a lado, pelas CLIs oficiais e com as suas assinaturas (Claude Pro/Max e ChatGPT Plus/Pro). Não usa API keys nem servidor próprio.

## 1. Instalar

Baixe na página de **Releases** do repositório o arquivo do seu sistema e o `SHA256SUMS.txt`.

### Confira o arquivo (recomendado)
Os instaladores da beta **não têm assinatura de código**. Confira se o arquivo é o publicado:

- Windows (PowerShell): `Get-FileHash .\DevFusion-0.3.0-beta.1-win-x64.exe -Algorithm SHA256`
- macOS: `shasum -a 256 DevFusion-0.3.0-beta.1-mac-arm64.dmg`
- Linux: `sha256sum DevFusion-0.3.0-beta.1-linux-x64.AppImage`

O valor tem que ser igual à linha do arquivo em `SHA256SUMS.txt`.

### Windows 10/11 (x64)
1. Execute `DevFusion-…-win-x64.exe`. O SmartScreen pode mostrar "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo**.
2. A instalação é **por usuário** (não pede administrador); você pode escolher a pasta.
3. Abra pelo menu Iniciar → **DevFusion**.

### macOS 13+ (Apple Silicon: `arm64`; Intel: `x64`)
1. Abra o `.dmg` e arraste o **DevFusion** para **Aplicativos**.
2. Na primeira abertura o macOS bloqueia (app sem Apple Developer ID). Abra **Ajustes do Sistema → Privacidade e Segurança** e clique em **Abrir Mesmo Assim** (ou clique com o botão direito no app → **Abrir**).

### Linux (x64)
- **AppImage**: `chmod +x DevFusion-…-linux-x64.AppImage` e execute.
- **Debian/Ubuntu**: `sudo apt install ./DevFusion-…-linux-x64.deb`; o app fica em `/opt/DevFusion`.
- Ubuntu 24.04+: se o app não abrir por causa do sandbox, o AppArmor pode estar bloqueando namespaces de usuário; prefira o `.deb`, que instala o auxiliar de sandbox com as permissões corretas.

## 2. Primeiro uso
1. O **System Doctor** roda a cada abertura e verifica sistema, Git, Claude Code, Codex, contas, rede, Node.js e o terminal integrado.
2. O que faltar pode ser instalado pelo próprio app (**Instalar…**). Ele mostra a origem oficial e o comando e pede a sua confirmação. Scripts baixados da internet nunca são executados pelo app: ele mostra o comando para você rodar no seu terminal.
3. **Login**: use **Fazer login** no card do agente. O comando oficial (`claude auth login` / `codex login`) abre no terminal integrado e no navegador. O DevFusion nunca lê seus tokens.
4. Escolha a pasta do projeto (**Abrir projeto**) e inicie os agentes.

## 3. Usando
- **Terminais**: cada agente roda no próprio terminal. Pedidos de confiança ("trust this folder") e de aprovação são respondidos por você, no terminal.
- **Chat compartilhado**: o texto é **colado** no terminal do agente; quem envia é o seu Enter.
- **Encaminhar**: selecione texto num terminal (no Codex, segure ⌥ Option no macOS ou Shift no Windows/Linux) e use **Encaminhar**.
- **Tarefas desenvolvedor/revisor**, **Git Worktrees** (um branch por agente), **editor**, **histórico** e **uso dos planos**: veja a barra lateral. Atalhos: ⌘/Ctrl+Shift+/.
- **Parar tudo** encerra os dois agentes e os processos filhos.

## 4. Dev Orchestrator (macOS e Linux)
No topo da área dos agentes, escolha **Modo → Dev Orchestrator**. A tela vira três colunas:
- **Esquerda**: agentes do Claude Code trabalhando.
- **Centro**: o orquestrador, que é o Claude Code (Opus 5.5, esforço alto) ou o Codex (GPT-6.2-Astra, esforço alto), à sua escolha.
- **Direita**: agentes do Codex trabalhando.

Clique em **Iniciar orquestrador** e diga o que precisa. Ele classifica cada tarefa (trivial, rotina, complexa, crítica) e dispara workers com o modelo e o esforço da classe. Por exemplo, tarefa trivial vai para Claude Sonnet com esforço baixo; complexa vai para Opus alto ou GPT-6.2-Astra alto.

Cada card mostra modelo, esforço, tarefa, status, tempo e o resultado. Workers do Codex podem ser parados um a um; **Parar tudo** encerra o orquestrador e todos os workers.

- O roster (modelo e esforço por classe) e o limite de workers simultâneos ficam em **Configurações → Dev Orchestrator**.
- Workers gastam a cota do seu plano.
- Aprovações de permissão continuam com você, no terminal do orquestrador. Com o Codex como orquestrador, cada worker pede aprovação para rodar fora do sandbox.
- Com o Codex como orquestrador, workers do Claude ficam desligados (decisão de termos do DevFusion).
- O orquestrador não faz commit, push nem merge sem você pedir. Trabalho em paralelo vai para worktrees separados, e integrar é decisão sua.
- No Windows o modo ainda não está disponível.

## 5. Memória compartilhada (opcional, ai-memory)
O [ai-memory](https://github.com/akitaonrails/ai-memory) (projeto de terceiros) guarda a memória do trabalho num servidor local e permite que o Codex continue de onde o Claude parou.
1. Instale pelo System Doctor ou em **Configurações → Memória compartilhada → Instalar…**.
2. No **seu terminal**, rode `ai-memory setup`. Ele mostra o plano e pergunta antes de criar o serviço e configurar os agentes.
3. Em Configurações, ligue **Iniciar Claude Code e Codex via `ai-memory run`** e confirme no diálogo.
Na primeira vez, o ai-memory instala hooks e MCP nas configurações do Claude Code e do Codex, e prompts e chamadas de ferramentas passam a ser capturados por ele. Para parar, desligue a opção.

Para o Codex continuar de onde o Claude parou:
- Abra o `codex` uma vez no seu terminal e escolha **Trust all and continue** nos hooks novos.
- Exporte `AI_MEMORY_AUTH_TOKEN` no ambiente de onde abre o DevFusion. É a única variável com token que o app repassa às CLIs, e ele nunca lê o arquivo do token.

## 6. Atualizações
Em **Configurações → Atualizações**, o app consulta a lista pública de releases no GitHub (no máximo uma vez por dia; pode ser desligado) e avisa na barra de status. Ele **não baixa nada**: **Abrir página da versão** leva à release, e você baixa, confere o SHA-256 e instala por cima.

## 7. Onde ficam os dados
| Item | Windows | macOS | Linux |
|---|---|---|---|
| Banco, configurações, worktrees | `%APPDATA%\DevFusion` | `~/Library/Application Support/DevFusion` | `~/.config/DevFusion` |
| Logs (sanitizados, 3 × 1 MB) | `…\DevFusion\logs` | `…/DevFusion/logs` | `…/DevFusion/logs` |

Nenhuma senha, token ou API key é armazenada pelo DevFusion. Para relatar um problema use **Configurações → Exportar diagnóstico**. O arquivo sai sem e-mails, tokens ou caminhos da sua pasta pessoal.

## 8. Desinstalar
- **Windows**: Configurações → Aplicativos → DevFusion → Desinstalar.
- **macOS**: arraste o app de Aplicativos para o Lixo.
- **Linux**: `sudo apt remove devfusion`, ou apague o AppImage.

A desinstalação **não apaga** seus dados (tabela acima). Apague a pasta manualmente se quiser remover histórico e configurações. O Claude Code, o Codex e o ai-memory são programas separados e continuam instalados.

## 9. Limitações da beta
- Sem assinatura de código (avisos do SmartScreen/Gatekeeper).
- Windows e Linux validados por testes automatizados; ainda sem teste manual em máquinas reais.
- O app não automatiza a conversa entre os agentes. No modo lado a lado todo envio é confirmado por você. No Dev Orchestrator quem dispara os workers é o próprio agente oficial, e o app só mostra (decisão de projeto e termos dos provedores).
