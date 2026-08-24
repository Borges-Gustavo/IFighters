const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const test = require("node:test");
const WebSocket = require("ws");

const LUTADORES = require("../data");
const EVENTOS = require("../protocol");
const { criarServidor } = require("../server");

const TEMPO_LIMITE = 2_000;

function requisitar(porta, caminho, metodo = "GET", cabecalhos = {}) {
  return new Promise((resolver, rejeitar) => {
    const requisicao = http.request(
      {
        agent: false,
        host: "127.0.0.1",
        headers: cabecalhos,
        method: metodo,
        path: caminho,
        port: porta,
      },
      (resposta) => {
        const partes = [];
        resposta.on("data", (parte) => partes.push(parte));
        resposta.on("end", () => {
          const buffer = Buffer.concat(partes);
          resolver({
            buffer,
            cabecalhos: resposta.headers,
            codigo: resposta.statusCode,
            corpo: buffer.toString("utf8"),
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

const EQUIPES = Object.freeze({
  primeira: ["leonardo", "eraldo", "laura"],
  segunda: ["dalcin", "kurt", "flores"],
});

function obterLutador(lutadorId) {
  return LUTADORES.find((lutador) => lutador.id === lutadorId);
}

function indiceDoGolpeMaisForte(lutadorId) {
  const lutador = obterLutador(lutadorId);
  return lutador.golpes.reduce(
    (melhor, golpe, indice) =>
      golpe.poder > lutador.golpes[melhor].poder ? indice : melhor,
    0,
  );
}

function obterJogadorNoEstado(estado, jogadorId) {
  return estado.jogadores.find((jogador) => jogador.id === jogadorId);
}

async function prepararBatalha(primeiro, segundo) {
  const conexaoPrimeiro = await primeiro.receber(EVENTOS.CONEXAO);
  const conexaoSegundo = await segundo.receber(EVENTOS.CONEXAO);

  primeiro.enviar(EVENTOS.CRIAR_SALA);
  const codigo = (await primeiro.receber(EVENTOS.SALA_CRIADA)).dados.codigo;
  segundo.enviar(EVENTOS.ENTRAR_SALA, { codigo: codigo.toLowerCase() });
  await Promise.all([
    primeiro.receber(EVENTOS.SALA_ENTRADA),
    segundo.receber(EVENTOS.SALA_ENTRADA),
  ]);

  primeiro.enviar(EVENTOS.SELECIONAR_EQUIPE, {
    lutadorIds: EQUIPES.primeira,
  });
  await primeiro.receber(EVENTOS.ACAO_ACEITA);
  segundo.enviar(EVENTOS.SELECIONAR_EQUIPE, {
    lutadorIds: EQUIPES.segunda,
  });
  await segundo.receber(EVENTOS.ACAO_ACEITA);
  const [inicioPrimeiro, inicioSegundo] = await Promise.all([
    primeiro.receber(EVENTOS.BATALHA_INICIADA),
    segundo.receber(EVENTOS.BATALHA_INICIADA),
  ]);

  assert.deepEqual(inicioPrimeiro, inicioSegundo);
  return {
    codigo,
    conexaoPrimeiro: conexaoPrimeiro.dados,
    conexaoSegundo: conexaoSegundo.dados,
    estado: inicioPrimeiro.dados.estado,
  };
}

async function enviarAcoes(primeiro, acaoPrimeiro, segundo, acaoSegundo) {
  primeiro.enviar(EVENTOS.ESCOLHER_ACAO, { acao: acaoPrimeiro });
  await primeiro.receber(EVENTOS.ACAO_ACEITA);
  segundo.enviar(EVENTOS.ESCOLHER_ACAO, { acao: acaoSegundo });
  await segundo.receber(EVENTOS.ACAO_ACEITA);

  const [resultadoPrimeiro, resultadoSegundo] = await Promise.all([
    primeiro.receber(),
    segundo.receber(),
  ]);
  assert.deepEqual(resultadoPrimeiro, resultadoSegundo);
  return resultadoPrimeiro;
}

test("o HTTP entrega apenas recursos públicos e trata caminhos hostis", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto);

  const pagina = await requisitar(porta, "/");
  assert.equal(pagina.codigo, 200);
  assert.match(pagina.corpo, /<!doctype html>/i);
  assert.match(pagina.cabecalhos["content-type"], /^text\/html/);
  assert.equal(pagina.cabecalhos["x-content-type-options"], "nosniff");
  assert.match(pagina.cabecalhos["content-security-policy"], /default-src 'self'/);
  assert.match(pagina.cabecalhos["content-security-policy"], /style-src 'self'/);
  assert.doesNotMatch(
    pagina.cabecalhos["content-security-policy"],
    /unsafe-inline/,
  );

  const cabecalho = await requisitar(porta, "/style.css", "HEAD");
  assert.equal(cabecalho.codigo, 200);
  assert.equal(cabecalho.corpo, "");
  assert.ok(Number(cabecalho.cabecalhos["content-length"]) > 0);
  assert.equal(cabecalho.cabecalhos["accept-ranges"], "bytes");

  const faixaVideo = await requisitar(
    porta,
    "/img/game/introducao.mp4",
    "GET",
    { Range: "bytes=0-99" },
  );
  assert.equal(faixaVideo.codigo, 206);
  assert.equal(faixaVideo.buffer.length, 100);
  assert.match(faixaVideo.cabecalhos["content-type"], /^video\/mp4/);
  assert.match(faixaVideo.cabecalhos["content-range"], /^bytes 0-99\/\d+$/);

  const faixaInvalida = await requisitar(
    porta,
    "/img/game/introducao.mp4",
    "GET",
    { Range: "bytes=999999999-" },
  );
  assert.equal(faixaInvalida.codigo, 416);
  assert.equal(faixaInvalida.buffer.length, 0);
  assert.match(faixaInvalida.cabecalhos["content-range"], /^bytes \*\/\d+$/);

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

test("o handshake WebSocket rejeita origem de outro site", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto);
  const conexao = new WebSocket(`ws://127.0.0.1:${porta}`, {
    origin: "https://site-malicioso.invalid",
  });
  contexto.after(() => conexao.terminate());

  const codigoHttp = await new Promise((resolver, rejeitar) => {
    conexao.once("open", () => rejeitar(new Error("Origem hostil foi aceita.")));
    conexao.once("error", () => {
      // O erro acompanha a rejeição HTTP e não deve ficar sem observador.
    });
    conexao.once("unexpected-response", (_requisicao, resposta) => {
      resposta.resume();
      resolver(resposta.statusCode);
    });
  });

  assert.equal(codigoHttp, 401);
});

test("equipes trocam, lutam até o fim, reiniciam e saem", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto);
  const primeiro = await conectarCliente(contexto, porta);
  const segundo = await conectarCliente(contexto, porta);
  const preparada = await prepararBatalha(primeiro, segundo);
  const { conexaoPrimeiro, conexaoSegundo } = preparada;

  assert.match(conexaoPrimeiro.jogadorId, /^[0-9a-f-]{36}$/i);
  assert.match(conexaoPrimeiro.tokenReconexao, /^[\w-]{43}$/);
  assert.equal(conexaoPrimeiro.versaoProtocolo, 2);
  assert.notEqual(conexaoPrimeiro.jogadorId, conexaoSegundo.jogadorId);
  assert.match(preparada.codigo, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(preparada.estado.situacao, "batalha");
  assert.equal(preparada.estado.numeroTurno, 1);
  assert.deepEqual(
    preparada.estado.jogadores.map((jogador) => jogador.lutadorAtivoId),
    ["leonardo", "dalcin"],
  );
  assert.ok(
    preparada.estado.jogadores.every(
      (jogador) =>
        jogador.equipe.length === 3 &&
        jogador.equipe.every((membro) => membro.vidaAtual > 0),
    ),
  );
  assert.doesNotMatch(JSON.stringify(preparada.estado), /tokenReconexao/);

  const primeiroTurno = await enviarAcoes(
    primeiro,
    { tipo: "troca", lutadorId: "eraldo" },
    segundo,
    {
      tipo: "golpe",
      indiceGolpe: indiceDoGolpeMaisForte("dalcin"),
    },
  );
  assert.equal(primeiroTurno.tipo, EVENTOS.RESULTADO_TURNO);
  assert.equal(primeiroTurno.dados.numeroTurno, 1);
  assert.equal(primeiroTurno.dados.estado.numeroTurno, 2);
  assert.match(primeiroTurno.dados.registros[0], /recuou/);
  const jogadorPrimeiro = obterJogadorNoEstado(
    primeiroTurno.dados.estado,
    conexaoPrimeiro.jogadorId,
  );
  assert.equal(jogadorPrimeiro.lutadorAtivoId, "eraldo");
  assert.equal(
    jogadorPrimeiro.equipe.find((membro) => membro.lutadorId === "leonardo")
      .vidaAtual,
    obterLutador("leonardo").atributos.vida,
  );
  assert.ok(
    jogadorPrimeiro.equipe.find((membro) => membro.lutadorId === "eraldo")
      .vidaAtual < obterLutador("eraldo").atributos.vida,
  );

  let eventoFinal = primeiroTurno;
  let houveEntradaAutomatica = false;
  for (let turno = 0; turno < 100; turno += 1) {
    if (eventoFinal.tipo === EVENTOS.BATALHA_ENCERRADA) {
      break;
    }

    const estado = eventoFinal.dados.estado;
    const ativoPrimeiro = obterJogadorNoEstado(
      estado,
      conexaoPrimeiro.jogadorId,
    ).lutadorAtivoId;
    const ativoSegundo = obterJogadorNoEstado(
      estado,
      conexaoSegundo.jogadorId,
    ).lutadorAtivoId;
    eventoFinal = await enviarAcoes(
      primeiro,
      {
        tipo: "golpe",
        indiceGolpe: indiceDoGolpeMaisForte(ativoPrimeiro),
      },
      segundo,
      {
        tipo: "golpe",
        indiceGolpe: indiceDoGolpeMaisForte(ativoSegundo),
      },
    );
    houveEntradaAutomatica ||=
      eventoFinal.dados.registros.some((registro) =>
        /foi derrotado/.test(registro),
      ) &&
      eventoFinal.dados.registros.some((registro) =>
        /entrou na batalha/.test(registro),
      );
  }

  assert.equal(eventoFinal.tipo, EVENTOS.BATALHA_ENCERRADA);
  assert.equal(eventoFinal.dados.estado.situacao, "encerrada");
  assert.ok(
    [conexaoPrimeiro.jogadorId, conexaoSegundo.jogadorId].includes(
      eventoFinal.dados.vencedorId,
    ),
  );
  assert.ok(
    eventoFinal.dados.estado.jogadores.some((jogador) =>
      jogador.equipe.every((membro) => membro.vidaAtual === 0),
    ),
  );
  assert.equal(houveEntradaAutomatica, true);

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
  assert.equal(reinicioPrimeiro.dados.estado.numeroTurno, 1);
  assert.deepEqual(
    reinicioPrimeiro.dados.estado.jogadores.map((jogador) => jogador.revanche),
    [false, false],
  );
  for (const jogador of reinicioPrimeiro.dados.estado.jogadores) {
    for (const membro of jogador.equipe) {
      assert.equal(
        membro.vidaAtual,
        obterLutador(membro.lutadorId).atributos.vida,
      );
    }
  }

  segundo.enviar(EVENTOS.SAIR_SALA);
  const desconexao = await primeiro.receber(EVENTOS.OPONENTE_DESCONECTADO);
  assert.equal(desconexao.dados.mensagem, "O adversário saiu da sala.");
  assert.equal(desconexao.dados.temporario, false);

  segundo.enviar(EVENTOS.CRIAR_SALA);
  assert.equal(
    (await segundo.receber(EVENTOS.SALA_CRIADA)).tipo,
    EVENTOS.SALA_CRIADA,
  );
});

test("o WebSocket valida envelopes, equipes e ações sem corromper a sala", async (contexto) => {
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

  primeiro.enviar(EVENTOS.SALA_CRIADA, { codigo: "AAAAAA" });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Esse evento não pode ser enviado pelo cliente.",
  );

  primeiro.enviarConteudo(Buffer.from("mensagem binária"));
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Mensagens binárias não são aceitas.",
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

  primeiro.enviar(EVENTOS.SELECIONAR_EQUIPE, {
    lutadorIds: ["leonardo", "leonardo", "toString"],
  });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Selecione exatamente três lutadores diferentes.",
  );

  primeiro.enviar(EVENTOS.SELECIONAR_EQUIPE, {
    lutadorIds: EQUIPES.primeira,
  });
  await primeiro.receber(EVENTOS.ACAO_ACEITA);
  segundo.enviar(EVENTOS.SELECIONAR_EQUIPE, {
    lutadorIds: EQUIPES.segunda,
  });
  await segundo.receber(EVENTOS.ACAO_ACEITA);
  await Promise.all([
    primeiro.receber(EVENTOS.BATALHA_INICIADA),
    segundo.receber(EVENTOS.BATALHA_INICIADA),
  ]);

  primeiro.enviar(EVENTOS.ESCOLHER_ACAO, {
    acao: { tipo: "golpe", indiceGolpe: "map" },
  });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Ação de batalha inválida.",
  );

  primeiro.enviar(EVENTOS.ESCOLHER_ACAO, {
    acao: { tipo: "troca", lutadorId: "leonardo" },
  });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Ação de batalha inválida.",
  );

  primeiro.enviar(EVENTOS.ESCOLHER_ACAO, {
    acao: { tipo: "golpe", indiceGolpe: 0 },
  });
  assert.equal(
    (await primeiro.receber(EVENTOS.ACAO_ACEITA)).tipo,
    EVENTOS.ACAO_ACEITA,
  );
  primeiro.enviar(EVENTOS.ESCOLHER_ACAO, {
    acao: { tipo: "troca", lutadorId: "eraldo" },
  });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Você já escolheu uma ação neste turno.",
  );

  segundo.enviar(EVENTOS.ESCOLHER_ACAO, {
    acao: { tipo: "troca", lutadorId: "kurt" },
  });
  await segundo.receber(EVENTOS.ACAO_ACEITA);
  const [resultadoPrimeiro, resultadoSegundo] = await Promise.all([
    primeiro.receber(EVENTOS.RESULTADO_TURNO),
    segundo.receber(EVENTOS.RESULTADO_TURNO),
  ]);
  assert.deepEqual(resultadoPrimeiro, resultadoSegundo);
  assert.equal(
    obterJogadorNoEstado(
      resultadoPrimeiro.dados.estado,
      resultadoPrimeiro.dados.estado.jogadores[1].id,
    ).lutadorAtivoId,
    "kurt",
  );
});

test("eventos fora de ordem são recusados sem alterar a sessão", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto);
  const primeiro = await conectarCliente(contexto, porta);
  await primeiro.receber(EVENTOS.CONEXAO);

  primeiro.enviar(EVENTOS.ESCOLHER_ACAO, {
    acao: { tipo: "golpe", indiceGolpe: 0 },
  });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Entre em uma sala primeiro.",
  );

  primeiro.enviar(EVENTOS.ENTRAR_SALA, { codigo: "AAAAAA" });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Sala inexistente.",
  );

  primeiro.enviar(EVENTOS.CRIAR_SALA, { campoExtra: true });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Dados inválidos para criar a sala.",
  );

  primeiro.enviar(EVENTOS.CRIAR_SALA);
  await primeiro.receber(EVENTOS.SALA_CRIADA);
  primeiro.enviar(EVENTOS.CRIAR_SALA);
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Você já está em uma sala.",
  );

  primeiro.enviar(EVENTOS.SELECIONAR_EQUIPE, {
    lutadorIds: EQUIPES.primeira,
  });
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "A sala não está na etapa de seleção.",
  );

  primeiro.enviar(EVENTOS.SOLICITAR_REVANCHE);
  assert.equal(
    (await primeiro.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "A revanche só pode ser solicitada após a batalha.",
  );
});

test("o limite de mensagens encerra clientes abusivos", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto);
  const cliente = await conectarCliente(contexto, porta);
  await cliente.receber(EVENTOS.CONEXAO);
  const fechamento = once(cliente.conexao, "close");

  for (let indice = 0; indice < 61; indice += 1) {
    cliente.enviarConteudo("{}");
  }

  const [codigo, motivo] = await fechamento;
  assert.equal(codigo, 1008);
  assert.equal(motivo.toString("utf8"), "Limite de mensagens excedido.");
});

test("uma partida continua após reconexão autenticada", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto, { prazoReconexao: 500 });
  const primeiro = await conectarCliente(contexto, porta);
  const segundo = await conectarCliente(contexto, porta);
  const preparada = await prepararBatalha(primeiro, segundo);

  primeiro.enviar(EVENTOS.ESCOLHER_ACAO, {
    acao: { tipo: "golpe", indiceGolpe: 0 },
  });
  await primeiro.receber(EVENTOS.ACAO_ACEITA);
  await primeiro.fechar();

  const ausencia = await segundo.receber(EVENTOS.OPONENTE_DESCONECTADO);
  assert.equal(ausencia.dados.temporario, true);
  assert.equal(ausencia.dados.prazoMs, 500);

  segundo.enviar(EVENTOS.ESCOLHER_ACAO, {
    acao: { tipo: "golpe", indiceGolpe: 0 },
  });
  assert.equal(
    (await segundo.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Aguardando a reconexão do adversário.",
  );

  const reconectado = await conectarCliente(contexto, porta);
  await reconectado.receber(EVENTOS.CONEXAO);
  reconectado.enviar(EVENTOS.REENTRAR_SALA, {
    codigo: preparada.codigo,
    jogadorId: preparada.conexaoPrimeiro.jogadorId,
    tokenReconexao: preparada.conexaoPrimeiro.tokenReconexao,
  });
  const retomada = await reconectado.receber(EVENTOS.SALA_REENTRADA);
  const retorno = await segundo.receber(EVENTOS.OPONENTE_RECONECTADO);

  assert.equal(retomada.dados.jogadorId, preparada.conexaoPrimeiro.jogadorId);
  assert.equal(retomada.dados.acaoPendente, true);
  assert.notEqual(
    retomada.dados.tokenReconexao,
    preparada.conexaoPrimeiro.tokenReconexao,
  );
  assert.equal(retomada.dados.estado.situacao, "batalha");
  assert.equal(retorno.dados.acaoPendente, false);
  assert.deepEqual(retorno.dados.estado, retomada.dados.estado);

  segundo.enviar(EVENTOS.ESCOLHER_ACAO, {
    acao: { tipo: "golpe", indiceGolpe: 0 },
  });
  await segundo.receber(EVENTOS.ACAO_ACEITA);
  const [resultadoReconectado, resultadoSegundo] = await Promise.all([
    reconectado.receber(EVENTOS.RESULTADO_TURNO),
    segundo.receber(EVENTOS.RESULTADO_TURNO),
  ]);
  assert.deepEqual(resultadoReconectado, resultadoSegundo);

  reconectado.enviar(EVENTOS.SAIR_SALA);
  const saida = await segundo.receber(EVENTOS.OPONENTE_DESCONECTADO);
  assert.equal(saida.dados.temporario, false);
});

test("a reconexão durante a seleção não revela a equipe adversária", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto, { prazoReconexao: 500 });
  const primeiro = await conectarCliente(contexto, porta);
  const segundo = await conectarCliente(contexto, porta);
  await primeiro.receber(EVENTOS.CONEXAO);
  const credenciaisSegundo = (await segundo.receber(EVENTOS.CONEXAO)).dados;

  primeiro.enviar(EVENTOS.CRIAR_SALA);
  const codigo = (await primeiro.receber(EVENTOS.SALA_CRIADA)).dados.codigo;
  segundo.enviar(EVENTOS.ENTRAR_SALA, { codigo });
  await Promise.all([
    primeiro.receber(EVENTOS.SALA_ENTRADA),
    segundo.receber(EVENTOS.SALA_ENTRADA),
  ]);
  primeiro.enviar(EVENTOS.SELECIONAR_EQUIPE, {
    lutadorIds: EQUIPES.primeira,
  });
  await primeiro.receber(EVENTOS.ACAO_ACEITA);

  await segundo.fechar();
  await primeiro.receber(EVENTOS.OPONENTE_DESCONECTADO);
  const reconectado = await conectarCliente(contexto, porta);
  await reconectado.receber(EVENTOS.CONEXAO);
  reconectado.enviar(EVENTOS.REENTRAR_SALA, {
    codigo,
    jogadorId: credenciaisSegundo.jogadorId,
    tokenReconexao: credenciaisSegundo.tokenReconexao,
  });

  const retomada = await reconectado.receber(EVENTOS.SALA_REENTRADA);
  const retorno = await primeiro.receber(EVENTOS.OPONENTE_RECONECTADO);
  assert.equal(retomada.dados.equipeConfirmada, false);
  assert.ok(
    retomada.dados.estado.jogadores.every(
      (jogador) => jogador.equipe.length === 0,
    ),
  );
  assert.equal(retorno.dados.equipeConfirmada, true);
  assert.deepEqual(
    retorno.dados.estado.jogadores.map((jogador) => jogador.equipe.length),
    [3, 0],
  );

  reconectado.enviar(EVENTOS.SELECIONAR_EQUIPE, {
    lutadorIds: EQUIPES.segunda,
  });
  await reconectado.receber(EVENTOS.ACAO_ACEITA);
  const [inicioPrimeiro, inicioReconectado] = await Promise.all([
    primeiro.receber(EVENTOS.BATALHA_INICIADA),
    reconectado.receber(EVENTOS.BATALHA_INICIADA),
  ]);
  assert.deepEqual(inicioPrimeiro, inicioReconectado);
  assert.ok(
    inicioPrimeiro.dados.estado.jogadores.every(
      (jogador) => jogador.equipe.length === 3,
    ),
  );
});

test("a vaga é liberada quando o prazo de reconexão termina", async (contexto) => {
  const { porta } = await iniciarAplicacao(contexto, { prazoReconexao: 30 });
  const primeiro = await conectarCliente(contexto, porta);
  const segundo = await conectarCliente(contexto, porta);
  const conexaoSegundo = await segundo.receber(EVENTOS.CONEXAO);
  await primeiro.receber(EVENTOS.CONEXAO);

  primeiro.enviar(EVENTOS.CRIAR_SALA);
  const codigo = (await primeiro.receber(EVENTOS.SALA_CRIADA)).dados.codigo;
  segundo.enviar(EVENTOS.ENTRAR_SALA, { codigo });
  await Promise.all([
    primeiro.receber(EVENTOS.SALA_ENTRADA),
    segundo.receber(EVENTOS.SALA_ENTRADA),
  ]);
  await segundo.fechar();
  assert.equal(
    (await primeiro.receber(EVENTOS.OPONENTE_DESCONECTADO)).dados.temporario,
    true,
  );
  assert.equal(
    (await primeiro.receber(EVENTOS.OPONENTE_DESCONECTADO)).dados.temporario,
    false,
  );

  const terceiro = await conectarCliente(contexto, porta);
  await terceiro.receber(EVENTOS.CONEXAO);
  terceiro.enviar(EVENTOS.ENTRAR_SALA, { codigo });
  await Promise.all([
    primeiro.receber(EVENTOS.SALA_ENTRADA),
    terceiro.receber(EVENTOS.SALA_ENTRADA),
  ]);

  const intruso = await conectarCliente(contexto, porta);
  await intruso.receber(EVENTOS.CONEXAO);
  intruso.enviar(EVENTOS.REENTRAR_SALA, {
    codigo,
    jogadorId: conexaoSegundo.dados.jogadorId,
    tokenReconexao: conexaoSegundo.dados.tokenReconexao,
  });
  assert.equal(
    (await intruso.receber(EVENTOS.ERRO_SALA)).dados.mensagem,
    "Não foi possível retomar essa sessão.",
  );
});
