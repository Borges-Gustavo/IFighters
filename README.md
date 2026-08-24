# IFighters

IFighters é um jogo web de batalhas por turnos com seleção de personagens, partida local e multiplayer pela rede local. A interface preserva a identidade visual inspirada em jogos de luta e foi preparada para teclado, toque, diferentes tamanhos de tela e preferências de acessibilidade.

## Requisitos

- Node.js 20 ou mais recente.
- npm, incluído na instalação do Node.js.
- Um navegador moderno com suporte à API `fetch`.

## Instalação e execução

O projeto não depende de pacotes externos. No terminal, dentro da pasta, inicie o servidor:

```bash
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
| `npm start` | Inicia o servidor HTTP da interface e das partidas. |
| `npm run dev` | Inicia o servidor em modo de desenvolvimento e reinicia após alterações. |
| `npm run verificar` | Verifica a sintaxe dos arquivos JavaScript do cliente, dos dados, das regras, do protocolo e do servidor. |
| `npm test` | Executa a verificação de sintaxe e todos os testes da pasta `testes/` com `node:test`. |

## Como jogar

### Partida local

1. Assista à introdução automática ou avance para a abertura.
2. Escolha **Jogar** e depois **Um jogador**.
3. Monte uma equipe com exatamente três IFighters. O primeiro selecionado será o inicial.
4. Em cada turno, escolha **Lutar** para abrir os quatro movimentos ou **Pokémon** para trocar o integrante ativo.
5. A troca consome o turno e acontece antes dos golpes. A batalha termina somente quando os três integrantes de uma equipe forem derrotados.
6. Tipos, imunidades, resistências, fraquezas e STAB alteram o dano. A interface indica a efetividade de cada movimento contra o adversário atual.

O adversário recebe uma equipe aleatória que não repete os seus integrantes e escolhe movimentos pelo dano esperado, considerando poder, precisão e tipos. Uma revanche mantém as mesmas equipes.

### Multiplayer em duas abas ou dispositivos da mesma rede

1. Em um dos computadores, execute `npm start`. O terminal exibirá `http://localhost:3000` e os endereços disponíveis na rede local.
2. Em duas abas, use `http://localhost:3000`. Em dispositivos diferentes, ambos devem abrir o mesmo endereço de rede mostrado no terminal, por exemplo `http://192.168.0.10:3000`. Permita a porta no firewall, se necessário.
3. No primeiro cliente, escolha **Jogar**, **Multiplayer** e **Criar sala**.
4. Copie o código exibido. No segundo cliente, informe esse código e escolha **Entrar**.
5. Cada participante monta e confirma uma equipe de três IFighters. A equipe adversária permanece privada durante a seleção.
6. Cada turno é resolvido depois que ambos escolhem um golpe ou uma troca. O servidor valida e resolve todas as ações.
7. O navegador consulta o servidor por HTTP em intervalos curtos. Se a comunicação cair, o jogo tenta retomar a sessão autenticada por até três minutos sem perder vidas ou a ação pendente.
8. Ao final, os participantes podem solicitar uma revanche ou sair da sala.

O servidor guarda as salas apenas em memória. Reiniciar o processo encerra as partidas e invalida os códigos existentes. O servidor escuta em `0.0.0.0` por padrão para aceitar dispositivos da mesma rede; defina a variável `HOST` se quiser restringir a interface de rede. Sessões HTTP sem atividade expiram após 60 segundos, mas a vaga autenticada permanece reservada durante a janela de reconexão.

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
├── app.js               Interface, navegação e cliente HTTP multiplayer
├── data.js              Catálogo compartilhado de IFighters e golpes
├── main.html            Estrutura semântica das telas
├── protocol.js          Eventos compartilhados do protocolo multiplayer
├── regras-batalha.js    Regras de dano, acerto e ordem usadas nos dois lados
├── server.js            Servidor HTTP, salas e coordenação das partidas
└── style.css            Identidade visual, responsividade e acessibilidade
```

O navegador carrega `data.js`, `protocol.js`, `regras-batalha.js` e `app.js`. Os módulos compartilhados também expõem seus dados ao Node.js, evitando versões diferentes do protocolo, da tabela de tipos e das regras entre cliente e servidor. As funções de batalha aceitam uma fonte de aleatoriedade substituível, o que permite testar acertos, IA e desempates de modo previsível. O mesmo servidor HTTP publica os arquivos do jogo e mantém o estado autoritativo das salas com dois participantes.

Os catálogos de equipe e IFDEX são renderizados somente quando abertos, em páginas pequenas. As imagens usam carregamento preguiçoso fora dos destaques e da arena, evitando baixar dezenas de sprites pesados na abertura.

## API multiplayer pela rede local

As ações usam requisições HTTP com JSON. Não existe dependência de transporte persistente. Cada navegador cria uma sessão autenticada e consulta os eventos novos por polling curto.

Endpoints principais:

| Método | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/api/multijogador/status` | Informa versão, transporte e endereços da rede. |
| `POST` | `/api/multijogador/sessoes` | Cria uma sessão temporária e devolve suas credenciais privadas. |
| `GET` | `/api/multijogador/sessoes/:id/eventos?desde=:cursor` | Busca somente os eventos ainda não processados. |
| `POST` | `/api/multijogador/sessoes/:id/eventos` | Envia uma ação ao servidor e recebe eventos pendentes. |
| `DELETE` | `/api/multijogador/sessoes/:id` | Encerra a sessão HTTP. |

O corpo de uma ação mantém o envelope compartilhado:

```json
{
  "tipo": "escolher_acao",
  "dados": {
    "numeroTurno": 3,
    "acao": {
      "tipo": "golpe",
      "indiceGolpe": 0
    }
  },
  "desde": 12,
  "idComando": "82b85012-aab4-41bc-978c-bd53770efeb0"
}
```

O protocolo atual é a versão 4. Cada comando possui um identificador aleatório; repetir o mesmo comando é seguro e não executa a ação duas vezes. Reutilizar o identificador com outro conteúdo é recusado. Ações de batalha também informam o turno, impedindo que uma requisição atrasada seja aplicada na rodada seguinte.

Fluxo principal dos eventos:

| Direção lógica | Eventos | Uso |
| --- | --- | --- |
| Servidor → cliente | `conexao` | Confirma a sessão HTTP e informa a identificação do cliente. |
| Cliente → servidor | `criar_sala` | Solicita uma sala nova. |
| Servidor → cliente | `sala_criada` | Retorna o código da sala. |
| Cliente → servidor | `entrar_sala` | Entra em uma sala usando o código recebido. |
| Servidor → clientes | `sala_entrada` | Confirma que a sala possui os dois participantes. |
| Cliente → servidor | `selecionar_equipe` | Confirma três IFighters diferentes e define o inicial. |
| Servidor → clientes | `batalha_iniciada` | Envia o estado inicial quando ambos confirmam. |
| Cliente → servidor | `escolher_acao` | Registra um golpe ou uma troca para o turno atual. |
| Servidor → cliente | `acao_aceita` | Confirma que a ação foi recebida e aguarda o oponente. |
| Servidor → clientes | `resultado_turno` ou `batalha_encerrada` | Distribui os registros e o novo estado da batalha. |
| Cliente → servidor | `reentrar_sala` | Retoma uma sessão interrompida usando código, identificação e token privado. |
| Servidor → cliente | `sala_reentrada` | Confirma a retomada e devolve o estado preservado. |
| Servidor → cliente | `oponente_reconectado` | Informa que o outro participante retornou. |
| Cliente → servidor | `solicitar_revanche` | Registra o interesse em uma nova batalha. |
| Servidor → clientes | `status_revanche` | Informa quais participantes aceitaram a revanche. |
| Cliente → servidor | `sair_sala` | Abandona a sala atual. |
| Servidor → cliente | `oponente_desconectado` | Informa a saída ou desconexão do outro participante. |
| Servidor → cliente | `erro_sala` | Informa código inválido, sala cheia ou ação incompatível com o estado atual. |

O estado compartilhado possui `codigo`, `situacao`, `numeroTurno` e `jogadores`. Cada jogador informa `id`, `conectado`, `equipe`, `lutadorAtivoId` e `revanche`; cada membro da equipe possui `lutadorId` e `vidaAtual`. A situação avança por `aguardando`, `selecao`, `batalha` e `encerrada`.

O servidor é a autoridade sobre validação, turno, ordem, efetividade, dano, troca, entrada automática da próxima reserva, vitória e revanche. Credenciais de retomada ficam apenas na sessão do navegador, e o token é rotacionado depois de cada reconexão bem-sucedida.

## Codificação e recursos visuais

Os arquivos de texto usam UTF-8, finais de linha LF, indentação de dois espaços e uma quebra de linha final. `.editorconfig`, `.gitattributes` e as configurações do VS Code mantêm esse padrão entre sistemas operacionais. Palavras reservadas das linguagens e chaves obrigatórias de ferramentas permanecem com a grafia exigida por essas tecnologias.

Os recursos visuais ficam em `img/game/` e `img/sprites/`. Os 37 sprites da IFDEX usam PNG, nomes em letras minúsculas ASCII e palavras separadas por hífen, por exemplo `img/sprites/leonardo-lucario.png`. Ao incluir ou renomear um arquivo, atualize também sua referência em `main.html`, `data.js` ou `style.css`. O fundo principal utilizado pela interface é `img/game/fundo.png`.

A IFDEX é ordenada alfabeticamente e pode ser pesquisada por pessoa, Pokémon, tipo ou número. Cada registro exibe tipos, atributos e quatro movimentos com nome localizado, nome original, tipo e poder-base de referência. A batalha usa uma escala arcade própria para manter partidas curtas; efeitos avançados como recuo, golpes múltiplos e condições de status ainda não são simulados.
