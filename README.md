# IFighters

IFighters é um jogo web de batalhas por turnos com seleção de personagens, partida local e multiplayer em tempo real por WebSocket. A interface preserva a identidade visual inspirada em jogos de luta e foi preparada para teclado, toque, diferentes tamanhos de tela e preferências de acessibilidade.

## Requisitos

- Node.js 20 ou mais recente.
- npm, incluído na instalação do Node.js.
- Um navegador moderno com suporte a WebSocket.

## Instalação e execução

No terminal, dentro da pasta do projeto, instale as dependências e inicie o servidor:

```bash
npm install
npm start
```

Acesse `http://localhost:3000`. O servidor entrega a interface e mantém as salas multiplayer; por isso, abrir `main.html` diretamente ou usar uma extensão de servidor estático não oferece a experiência completa.

Para usar outra porta no PowerShell:

```powershell
$env:PORT = 4000
npm start
```

No Linux ou macOS:

```bash
PORT=4000 npm start
```

## Scripts disponíveis

| Comando | Finalidade |
| --- | --- |
| `npm start` | Inicia o servidor HTTP e WebSocket. |
| `npm run dev` | Inicia o servidor em modo de desenvolvimento e reinicia após alterações. |
| `npm run verificar` | Verifica a sintaxe dos arquivos JavaScript do cliente, dos dados, das regras, do protocolo e do servidor. |
| `npm test` | Executa a verificação de sintaxe e todos os testes da pasta `testes/` com `node:test`. |

Em ambientes automatizados, `npm ci` pode substituir `npm install` para reproduzir exatamente o conteúdo de `package-lock.json`.

## Como jogar

### Partida local

1. Inicie a introdução ou avance para a abertura.
2. Escolha **Jogar** e depois **Um jogador**.
3. Selecione um IFighter, confira a prévia e confirme.
4. Escolha um golpe a cada turno até o encerramento da batalha.

### Multiplayer em duas abas ou dispositivos

1. Mantenha uma única instância de `npm start` em execução.
2. Abra `http://localhost:3000` em duas abas do navegador. Para jogar em dois dispositivos da mesma rede, abra `http://IP_DO_SERVIDOR:3000` nos dois e permita a porta no firewall, se necessário.
3. No primeiro cliente, escolha **Jogar**, **Multiplayer** e **Criar sala**.
4. Copie o código exibido. No segundo cliente, informe esse código e escolha **Entrar**.
5. Cada participante seleciona seu IFighter. A batalha começa quando os dois confirmam.
6. Cada turno é resolvido depois que ambos escolhem um golpe. Ao final, os participantes podem solicitar uma revanche ou sair da sala.

O servidor guarda as salas apenas em memória. Reiniciar o processo encerra as partidas e invalida os códigos existentes. Para dispositivos fora da rede local, publique o projeto atrás de HTTPS e use uma conexão WebSocket segura.

## Controles

- Clique ou toque: selecionar e confirmar.
- `Enter`: confirmar o item em foco.
- Setas ou `W` e `S`: navegar pelos controles da tela.
- `Escape` ou `Backspace`: voltar, quando a tela permite.
- Na introdução, `Enter`, espaço, `Escape`, clique ou toque inicia ou avança o vídeo.

As preferências de animação, alto contraste e reprodução da introdução são armazenadas no navegador. O modo de movimento reduzido também respeita a preferência configurada no sistema operacional.

## Estrutura e arquitetura

```text
IFighters/
├── img/                 Imagens, sprites e vídeo da introdução
├── testes/              Testes automatizados com node:test
├── app.js               Interface, navegação e cliente WebSocket
├── data.js              Catálogo compartilhado de IFighters e golpes
├── main.html            Estrutura semântica das telas
├── protocol.js          Eventos compartilhados do protocolo multiplayer
├── regras-batalha.js    Regras de dano, acerto e ordem usadas nos dois lados
├── server.js            Servidor HTTP, salas e coordenação WebSocket
└── style.css            Identidade visual, responsividade e acessibilidade
```

O navegador carrega `data.js`, `protocol.js`, `regras-batalha.js` e `app.js`. Os módulos compartilhados também expõem seus dados ao Node.js, evitando versões diferentes das regras no cliente e no servidor. As funções de batalha aceitam uma fonte de aleatoriedade substituível, o que permite testar acertos e desempates de modo previsível. O servidor HTTP publica apenas os arquivos necessários para a aplicação e o servidor WebSocket coordena salas com dois participantes.

## Protocolo multiplayer

As mensagens WebSocket usam JSON com o envelope abaixo:

```json
{
  "tipo": "nome_do_evento",
  "dados": {}
}
```

Fluxo principal dos eventos:

| Direção | Eventos | Uso |
| --- | --- | --- |
| Servidor → cliente | `conexao` | Confirma a conexão e informa a identificação do cliente. |
| Cliente → servidor | `criar_sala` | Solicita uma sala nova. |
| Servidor → cliente | `sala_criada` | Retorna o código da sala. |
| Cliente → servidor | `entrar_sala` | Entra em uma sala usando o código recebido. |
| Servidor → clientes | `sala_entrada` | Confirma que a sala possui os dois participantes. |
| Cliente → servidor | `selecionar_lutador` | Confirma o IFighter escolhido. |
| Servidor → clientes | `batalha_iniciada` | Envia o estado inicial quando ambos confirmam. |
| Cliente → servidor | `escolher_golpe` | Registra a ação do turno. |
| Servidor → cliente | `acao_aceita` | Confirma que a ação foi recebida e aguarda o oponente. |
| Servidor → clientes | `resultado_turno` ou `batalha_encerrada` | Distribui os registros e o novo estado da batalha. |
| Cliente → servidor | `solicitar_revanche` | Registra o interesse em uma nova batalha. |
| Servidor → clientes | `status_revanche` | Informa quais participantes aceitaram a revanche. |
| Cliente → servidor | `sair_sala` | Abandona a sala atual. |
| Servidor → cliente | `oponente_desconectado` | Informa a saída ou desconexão do outro participante. |
| Servidor → cliente | `erro_sala` | Informa código inválido, sala cheia ou ação incompatível com o estado atual. |

O estado compartilhado possui `codigo`, `situacao` e `jogadores`. Cada jogador informa `id`, `lutadorId`, `vidaAtual` e `revanche`. A situação avança por `aguardando`, `selecao`, `batalha` e `encerrada`.

## Codificação e recursos visuais

Os arquivos de texto usam UTF-8, finais de linha LF, indentação de dois espaços e uma quebra de linha final. `.editorconfig`, `.gitattributes` e as configurações do VS Code mantêm esse padrão entre sistemas operacionais. Palavras reservadas das linguagens e chaves obrigatórias de ferramentas permanecem com a grafia exigida por essas tecnologias.

Os recursos visuais ficam em `img/game/` e `img/sprites/`. Os nomes seguem letras minúsculas em ASCII, palavras separadas por hífen e nenhum espaço antes da extensão, por exemplo `img/sprites/leonardo-lucario.png`. Ao incluir ou renomear um arquivo, atualize também sua referência em `main.html`, `data.js` ou `style.css`. O fundo principal utilizado pela interface é `img/game/fundo.png`.
