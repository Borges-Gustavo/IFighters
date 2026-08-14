const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const test = require("node:test");
const WebSocket = require("ws");

const EVENTOS = require("../protocol");
const { criarServidor } = require("../server");

const TEMPO_LIMITE = 2_000;

function requisitar(porta, caminho, metodo = "GET") {
  return new Promise((resolver, rejeitar) => {
    const requisicao = http.request(
      {
        agent: false,
        host: "127.0.0.1",
        method: metodo,
        path: caminho,
        port: porta,
      },
      (resposta) => {
        const partes = [];
        resposta.on("data", (parte) => partes.push(parte));
        resposta.on("end", () => {
          resolver({
            cabecalhos: resposta.headers,
            codigo: resposta.statusCode,
            corpo: Buffer.concat(partes).toString("utf8"),
          });
        });
      },
    );

    requisicao.on("error", rejeitar);
    requisicao.end();
  });
}

async function iniciarAplicacao(contexto, opcoes = {}) {
  const aplicacao = criarServidor({
    aleatorio: () => 0,
    porta: 0,
    ...opcoes,
  });
  const endereco = await aplicacao.iniciar();
  contexto.after(() => aplicacao.encerrar());
  return {
    aplicacao,
    porta: endereco.port,
  };
}

async function conectarCliente(contexto, porta) {
  const conexao = new WebSocket(`ws://127.0.0.1:${porta}`);
  const fila = [];
  const esperas = [];

  conexao.on("message", (conteudo) => {
    const mensagem = JSON.parse(conteudo.toString("utf8"));
    const indiceEspera = esperas.findIndex(
      (espera) => !espera.tipo || espera.tipo === mensagem.tipo,
    );

    if (indiceEspera === -1) {
      fila.push(mensagem);
      return;
    }

    const [espera] = esperas.splice(indiceEspera, 1);
    clearTimeout(espera.temporizador);
    espera.resolver(mensagem);
  });

  await once(conexao, "open");

  function receber(tipo, tempoLimite = TEMPO_LIMITE) {
    const indiceMensagem = fila.findIndex(
      (mensagem) => !tipo || mensagem.tipo === tipo,
    );
    if (indiceMensagem !== -1) {
      return Promise.resolve(fila.splice(indiceMensagem, 1)[0]);
    }

    return new Promise((resolver, rejeitar) => {
      const espera = {
        rejeitar,
        resolver,
        tipo,
        temporizador: setTimeout(() => {
          const indice = esperas.indexOf(espera);
          if (indice !== -1) {
            esperas.splice(indice, 1);
          }
          rejeitar(
            new Error(`Tempo esgotado aguardando o evento ${tipo || "seguinte"}.`),
          );
        }, tempoLimite),
      };
      esperas.push(espera);
    });
  }

  function enviar(tipo, dados = {}) {
    conexao.send(JSON.stringify({ tipo, dados }));
  }

  function enviarConteudo(conteudo) {
    conexao.send(conteudo);
  }

  async function fechar() {
    if (conexao.readyState === WebSocket.CLOSED) {
      return;
    }

    const fechou = once(conexao, "close");
    if (conexao.readyState === WebSocket.OPEN) {
      conexao.close();
    } else {
      conexao.terminate();
    }
    await fechou;
  }

  contexto.after(fechar);
  return { conexao, enviar, enviarConteudo, fechar, receber };
}

test("o HTTP entrega apenas recursos públicos e trata caminhos hostis", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto);

  const pagina = await requisitar(porta, "/");
  assert.equal(pagina.codigo, 200);
  assert.match(pagina.corpo, /<!doctype html>/i);
  assert.match(pagina.cabecalhos["content-type"], /^text\/html/);
  assert.equal(pagina.cabecalhos["x-content-type-options"], "nosniff");
  assert.match(pagina.cabecalhos["content-security-policy"], /default-src 'self'/);

  const cabecalho = await requisitar(porta, "/style.css", "HEAD");
  assert.equal(cabecalho.codigo, 200);
  assert.equal(cabecalho.corpo, "");
  assert.ok(Number(cabecalho.cabecalhos["content-length"]) > 0);

  for (const caminhoPrivado of [
    "/server.js",
    "/package.json",
    "/.git/config",
    "/img/%2e%2e%2fserver.js",
  ]) {
    const resposta = await requisitar(porta, caminhoPrivado);
    assert.equal(resposta.codigo, 404, caminhoPrivado);
    assert.equal(resposta.corpo, "Recurso não encontrado.");
  }

  const enderecoInvalido = await requisitar(porta, "/arquivo%ZZ");
  assert.equal(enderecoInvalido.codigo, 400);
  assert.equal(enderecoInvalido.corpo, "Endereço inválido.");

  const diretorio = await requisitar(porta, "/img/");
  assert.equal(diretorio.codigo, 404);
  assert.equal((await requisitar(porta, "/")).codigo, 200);

  const metodoInvalido = await requisitar(porta, "/", "POST");
  assert.equal(metodoInvalido.codigo, 405);
  assert.equal(metodoInvalido.cabecalhos.allow, "GET, HEAD");
  assert.equal(metodoInvalido.corpo, "Método não permitido.");
});

test("duas pessoas completam batalha, revanche e saída", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto);
  const primeiro = await conectarCliente(contexto, porta);
  const segundo = await conectarCliente(contexto, porta);

  const conexaoPrimeiro = await primeiro.receber(EVENTOS.CONEXAO);
  const conexaoSegundo = await segundo.receber(EVENTOS.CONEXAO);
  assert.match(conexaoPrimeiro.dados.jogadorId, /^[0-9a-f-]{36}$/i);
  assert.match(conexaoSegundo.dados.jogadorId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(
    conexaoPrimeiro.dados.jogadorId,
    conexaoSegundo.dados.jogadorId,
  );

  primeiro.enviar(EVENTOS.CRIAR_SALA);
  const salaCriada = await primeiro.receber(EVENTOS.SALA_CRIADA);
  assert.match(salaCriada.dados.codigo, /^[A-Z2-9]{6}$/);

  segundo.enviar(EVENTOS.ENTRAR_SALA, {
    codigo: salaCriada.dados.codigo.toLowerCase(),
  });
  const [entradaPrimeiro, entradaSegundo] = await Promise.all([
    primeiro.receber(EVENTOS.SALA_ENTRADA),
    segundo.receber(EVENTOS.SALA_ENTRADA),
  ]);
  assert.equal(entradaPrimeiro.dados.codigo, salaCriada.dados.codigo);
  assert.deepEqual(entradaPrimeiro, entradaSegundo);

  primeiro.enviar(EVENTOS.SELECIONAR_LUTADOR, { lutadorId: "leonardo" });
  assert.equal(
    (await primeiro.receber(EVENTOS.ACAO_ACEITA)).tipo,
    EVENTOS.ACAO_ACEITA,
  );

  segundo.enviar(EVENTOS.SELECIONAR_LUTADOR, { lutadorId: "dalcin" });
  await segundo.receber(EVENTOS.ACAO_ACEITA);
  const [inicioPrimeiro, inicioSegundo] = await Promise.all([
    primeiro.receber(EVENTOS.BATALHA_INICIADA),
    segundo.receber(EVENTOS.BATALHA_INICIADA),
  ]);
  assert.deepEqual(inicioPrimeiro, inicioSegundo);
  assert.equal(inicioPrimeiro.dados.estado.situacao, "batalha");
  assert.deepEqual(
    inicioPrimeiro.dados.estado.jogadores.map((jogador) => jogador.lutadorId),
    ["leonardo", "dalcin"],
  );

  primeiro.enviar(EVENTOS.ESCOLHER_GOLPE, { indiceGolpe: 3 });
  await primeiro.receber(EVENTOS.ACAO_ACEITA);
  primeiro.enviar(EVENTOS.ESCOLHER_GOLPE, { indiceGolpe: 0 });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Você já escolheu um golpe neste turno.",
  );
  segundo.enviar(EVENTOS.ESCOLHER_GOLPE, { indiceGolpe: 0 });
  await segundo.receber(EVENTOS.ACAO_ACEITA);
  const [turnoPrimeiro, turnoSegundo] = await Promise.all([
    primeiro.receber(EVENTOS.RESULTADO_TURNO),
    segundo.receber(EVENTOS.RESULTADO_TURNO),
  ]);

  assert.deepEqual(turnoPrimeiro, turnoSegundo);
  assert.equal(turnoPrimeiro.dados.estado.situacao, "batalha");
  assert.equal(turnoPrimeiro.dados.registros.length, 2);
  assert.match(turnoPrimeiro.dados.registros[0], /^Leonardo usou Ataque Rápido/);
  assert.ok(
    turnoPrimeiro.dados.estado.jogadores.every(
      (jogador) => jogador.vidaAtual > 0,
    ),
  );

  primeiro.enviar(EVENTOS.ESCOLHER_GOLPE, { indiceGolpe: 3 });
  await primeiro.receber(EVENTOS.ACAO_ACEITA);
  segundo.enviar(EVENTOS.ESCOLHER_GOLPE, { indiceGolpe: 0 });
  await segundo.receber(EVENTOS.ACAO_ACEITA);
  const [fimPrimeiro, fimSegundo] = await Promise.all([
    primeiro.receber(EVENTOS.BATALHA_ENCERRADA),
    segundo.receber(EVENTOS.BATALHA_ENCERRADA),
  ]);
  assert.deepEqual(fimPrimeiro, fimSegundo);
  assert.equal(fimPrimeiro.dados.estado.situacao, "encerrada");
  assert.equal(fimPrimeiro.dados.vencedorId, conexaoPrimeiro.dados.jogadorId);
  assert.equal(fimPrimeiro.dados.registros.length, 1);

  primeiro.enviar(EVENTOS.SOLICITAR_REVANCHE);
  const [revanchePrimeiro, revancheSegundo] = await Promise.all([
    primeiro.receber(EVENTOS.STATUS_REVANCHE),
    segundo.receber(EVENTOS.STATUS_REVANCHE),
  ]);
  assert.deepEqual(revanchePrimeiro, revancheSegundo);
  assert.deepEqual(
    revanchePrimeiro.dados.estado.jogadores.map((jogador) => jogador.revanche),
    [true, false],
  );

  segundo.enviar(EVENTOS.SOLICITAR_REVANCHE);
  await Promise.all([
    primeiro.receber(EVENTOS.STATUS_REVANCHE),
    segundo.receber(EVENTOS.STATUS_REVANCHE),
  ]);
  const [reinicioPrimeiro, reinicioSegundo] = await Promise.all([
    primeiro.receber(EVENTOS.BATALHA_INICIADA),
    segundo.receber(EVENTOS.BATALHA_INICIADA),
  ]);
  assert.deepEqual(reinicioPrimeiro, reinicioSegundo);
  assert.equal(reinicioPrimeiro.dados.estado.situacao, "batalha");
  assert.deepEqual(
    reinicioPrimeiro.dados.estado.jogadores.map((jogador) => jogador.revanche),
    [false, false],
  );

  segundo.enviar(EVENTOS.SAIR_SALA);
  const desconexao = await primeiro.receber(EVENTOS.OPONENTE_DESCONECTADO);
  assert.equal(desconexao.dados.mensagem, "O adversário saiu da sala.");

  segundo.enviar(EVENTOS.CRIAR_SALA);
  assert.equal(
    (await segundo.receber(EVENTOS.SALA_CRIADA)).tipo,
    EVENTOS.SALA_CRIADA,
  );
});

test("o WebSocket rejeita mensagens e identificadores inválidos sem corromper a sala", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto);
  const primeiro = await conectarCliente(contexto, porta);
  await primeiro.receber(EVENTOS.CONEXAO);

  primeiro.enviarConteudo("não é JSON");
  assert.match(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    /JSON válido/,
  );

  primeiro.enviarConteudo(JSON.stringify({ tipo: "evento_inexistente", dados: {} }));
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Evento desconhecido.",
  );

  primeiro.enviarConteudo(
    JSON.stringify({ tipo: EVENTOS.CRIAR_SALA, dados: [] }),
  );
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Os dados do evento devem ser um objeto.",
  );

  primeiro.enviar(EVENTOS.CRIAR_SALA);
  const codigo = (await primeiro.receber(EVENTOS.SALA_CRIADA)).dados.codigo;
  primeiro.enviar(EVENTOS.ENTRAR_SALA, { codigo });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Você já está em uma sala.",
  );

  const segundo = await conectarCliente(contexto, porta);
  await segundo.receber(EVENTOS.CONEXAO);
  segundo.enviar(EVENTOS.ENTRAR_SALA, { codigo });
  await Promise.all([
    primeiro.receber(EVENTOS.SALA_ENTRADA),
    segundo.receber(EVENTOS.SALA_ENTRADA),
  ]);

  const terceiro = await conectarCliente(contexto, porta);
  await terceiro.receber(EVENTOS.CONEXAO);
  terceiro.enviar(EVENTOS.ENTRAR_SALA, { codigo });
  assert.equal(
    (await terceiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "A sala está cheia.",
  );

  primeiro.enviar(EVENTOS.SELECIONAR_LUTADOR, { lutadorId: "toString" });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Seleção de lutador inválida.",
  );

  primeiro.enviar(EVENTOS.SELECIONAR_LUTADOR, { lutadorId: "leonardo" });
  await primeiro.receber(EVENTOS.ACAO_ACEITA);
  segundo.enviar(EVENTOS.SELECIONAR_LUTADOR, { lutadorId: "dalcin" });
  await segundo.receber(EVENTOS.ACAO_ACEITA);
  await Promise.all([
    primeiro.receber(EVENTOS.BATALHA_INICIADA),
    segundo.receber(EVENTOS.BATALHA_INICIADA),
  ]);

  primeiro.enviar(EVENTOS.ESCOLHER_GOLPE, { indiceGolpe: "map" });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Índice de golpe inválido.",
  );

  primeiro.enviar(EVENTOS.ESCOLHER_GOLPE, { indiceGolpe: 0 });
  assert.equal(
    (await primeiro.receber(EVENTOS.ACAO_ACEITA)).tipo,
    EVENTOS.ACAO_ACEITA,
  );
});
