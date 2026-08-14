const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { WebSocket, WebSocketServer } = require("ws");

const LUTADORES = require("./data");
const EVENTOS = require("./protocol");
const REGRAS_BATALHA = require("./regras-batalha");

const SITUACOES = Object.freeze({
  AGUARDANDO: "aguardando",
  SELECAO: "selecao",
  BATALHA: "batalha",
  ENCERRADA: "encerrada",
});

const ARQUIVOS_PUBLICOS = new Set([
  "app.js",
  "data.js",
  "main.html",
  "protocol.js",
  "regras-batalha.js",
  "style.css",
]);

const TIPOS_MIME = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
});

const CABECALHOS_SEGURANCA = Object.freeze({
  "Content-Security-Policy": [
    "default-src 'self'",
    "connect-src 'self' ws: wss:",
    "img-src 'self' data:",
    "media-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

const EVENTOS_RECEBIDOS = new Set([
  EVENTOS.CRIAR_SALA,
  EVENTOS.ENTRAR_SALA,
  EVENTOS.SELECIONAR_LUTADOR,
  EVENTOS.ESCOLHER_GOLPE,
  EVENTOS.SOLICITAR_REVANCHE,
  EVENTOS.SAIR_SALA,
]);

const TODOS_EVENTOS = new Set(Object.values(EVENTOS));
const LUTADORES_POR_ID = new Map(
  LUTADORES.map((lutador) => [lutador.id, lutador]),
);

const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TAMANHO_CODIGO = 6;
const LIMITE_MENSAGEM = 16 * 1024;
const LIMITE_MENSAGENS_POR_JANELA = 60;
const DURACAO_JANELA_MENSAGENS = 10_000;
const INTERVALO_VERIFICACAO_CONEXAO = 30_000;

function ehObjetoSimples(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function possuiSomenteCampos(objeto, camposPermitidos) {
  const permitidos = new Set(camposPermitidos);
  return Object.keys(objeto).every((campo) => permitidos.has(campo));
}

function caminhoEstaContido(raiz, candidato) {
  const relativo = path.relative(raiz, candidato);
  return (
    relativo === "" ||
    (relativo !== ".." &&
      !relativo.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativo))
  );
}

function aplicarCabecalhosSeguranca(resposta) {
  for (const [nome, valor] of Object.entries(CABECALHOS_SEGURANCA)) {
    resposta.setHeader(nome, valor);
  }
}

function enviarTexto(requisicao, resposta, codigoHttp, mensagem, extras = {}) {
  if (resposta.headersSent) {
    resposta.destroy();
    return;
  }

  const corpo = Buffer.from(mensagem, "utf8");
  aplicarCabecalhosSeguranca(resposta);
  resposta.writeHead(codigoHttp, {
    "Cache-Control": "no-store",
    "Content-Length": corpo.length,
    "Content-Type": "text/plain; charset=utf-8",
    ...extras,
  });

  resposta.end(requisicao.method === "HEAD" ? undefined : corpo);
}

function extrairCaminhoDaRequisicao(requisicao) {
  const endereco = requisicao.url || "/";

  if (!endereco.startsWith("/") || endereco.startsWith("//")) {
    throw new URIError("Formato de endereço inválido.");
  }

  const caminhoCodificado = new URL(endereco, "http://servidor.local").pathname;
  const caminhoDecodificado = decodeURIComponent(caminhoCodificado);

  if (caminhoDecodificado.includes("\0") || caminhoDecodificado.includes("\\")) {
    throw new URIError("O caminho contém caracteres inválidos.");
  }

  return caminhoDecodificado === "/" ? "/main.html" : caminhoDecodificado;
}

function recursoEstaLiberado(caminhoRelativo) {
  const caminhoPortatil = caminhoRelativo.split(path.sep).join("/");
  return (
    ARQUIVOS_PUBLICOS.has(caminhoPortatil) ||
    caminhoPortatil.startsWith("img/")
  );
}

function criarAtendedorHttp(diretorioRaiz) {
  const raizReal = fs.realpathSync(diretorioRaiz);

  return async function atenderHttp(requisicao, resposta) {
    if (requisicao.method !== "GET" && requisicao.method !== "HEAD") {
      enviarTexto(
        requisicao,
        resposta,
        405,
        "Método não permitido.",
        { Allow: "GET, HEAD" },
      );
      return;
    }

    let caminhoUrl;
    try {
      caminhoUrl = extrairCaminhoDaRequisicao(requisicao);
    } catch {
      enviarTexto(requisicao, resposta, 400, "Endereço inválido.");
      return;
    }

    const caminhoSolicitado = path.resolve(
      raizReal,
      caminhoUrl.replace(/^\/+/, ""),
    );

    if (!caminhoEstaContido(raizReal, caminhoSolicitado)) {
      enviarTexto(requisicao, resposta, 404, "Recurso não encontrado.");
      return;
    }

    const caminhoRelativo = path.relative(raizReal, caminhoSolicitado);
    if (!recursoEstaLiberado(caminhoRelativo)) {
      enviarTexto(requisicao, resposta, 404, "Recurso não encontrado.");
      return;
    }

    let caminhoReal;
    let informacoes;
    try {
      caminhoReal = await fsPromises.realpath(caminhoSolicitado);
      if (!caminhoEstaContido(raizReal, caminhoReal)) {
        enviarTexto(requisicao, resposta, 404, "Recurso não encontrado.");
        return;
      }

      informacoes = await fsPromises.stat(caminhoReal);
    } catch {
      enviarTexto(requisicao, resposta, 404, "Recurso não encontrado.");
      return;
    }

    if (!informacoes.isFile()) {
      enviarTexto(requisicao, resposta, 404, "Recurso não encontrado.");
      return;
    }

    aplicarCabecalhosSeguranca(resposta);
    resposta.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Length": informacoes.size,
      "Content-Type":
        TIPOS_MIME[path.extname(caminhoReal).toLowerCase()] ||
        "application/octet-stream",
      "Last-Modified": informacoes.mtime.toUTCString(),
    });

    if (requisicao.method === "HEAD") {
      resposta.end();
      return;
    }

    const fluxo = fs.createReadStream(caminhoReal);
    fluxo.once("error", () => {
      if (resposta.headersSent) {
        resposta.destroy();
      } else {
        enviarTexto(
          requisicao,
          resposta,
          500,
          "Não foi possível ler o recurso solicitado.",
        );
      }
    });
    resposta.once("close", () => {
      if (!resposta.writableEnded) {
        fluxo.destroy();
      }
    });
    fluxo.pipe(resposta);
  };
}

function validarPorta(valor) {
  const porta = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isInteger(porta) || porta < 0 || porta > 65_535) {
    throw new TypeError("A porta deve ser um número inteiro entre 0 e 65535.");
  }

  return porta;
}

function criarCodigoSeguro(salas) {
  for (let tentativa = 0; tentativa < 100; tentativa += 1) {
    let codigo = "";
    for (let indice = 0; indice < TAMANHO_CODIGO; indice += 1) {
      codigo += ALFABETO_CODIGO[crypto.randomInt(ALFABETO_CODIGO.length)];
    }

    if (!salas.has(codigo)) {
      return codigo;
    }
  }

  throw new Error("Não foi possível gerar um código de sala exclusivo.");
}

function criarServidor({ porta = process.env.PORT || 3000, aleatorio = Math.random } = {}) {
  const portaConfigurada = validarPorta(porta);
  if (typeof aleatorio !== "function") {
    throw new TypeError("A fonte de aleatoriedade deve ser uma função.");
  }

  const salas = new Map();
  const atenderHttp = criarAtendedorHttp(__dirname);
  const servidorHttp = http.createServer((requisicao, resposta) => {
    atenderHttp(requisicao, resposta).catch(() => {
      enviarTexto(
        requisicao,
        resposta,
        500,
        "O servidor não conseguiu concluir a solicitação.",
      );
    });
  });

  const servidorWebSocket = new WebSocketServer({
    clientTracking: true,
    maxPayload: LIMITE_MENSAGEM,
    perMessageDeflate: false,
    server: servidorHttp,
    verifyClient: ({ origin, req }) => {
      if (!origin) {
        return true;
      }

      try {
        return new URL(origin).host === req.headers.host;
      } catch {
        return false;
      }
    },
  });

  let encerrado = false;
  let promessaDeInicio = null;
  let promessaDeEncerramento = null;

  function enviar(jogador, tipo, dados = {}) {
    if (jogador.conexao.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      jogador.conexao.send(JSON.stringify({ tipo, dados }), (erro) => {
        if (erro && jogador.conexao.readyState !== WebSocket.CLOSED) {
          jogador.conexao.terminate();
        }
      });
      return true;
    } catch {
      jogador.conexao.terminate();
      return false;
    }
  }

  function enviarErro(jogador, mensagem) {
    enviar(jogador, EVENTOS.ERRO_SALA, { mensagem });
  }

  function transmitir(sala, tipo, dados) {
    for (const jogador of sala.jogadores) {
      enviar(jogador, tipo, dados);
    }
  }

  function obterSala(jogador) {
    if (!jogador.codigoSala) {
      return null;
    }

    return salas.get(jogador.codigoSala) || null;
  }

  function zerarEstadoDeBatalha(jogador) {
    jogador.lutadorId = null;
    jogador.vidaAtual = 0;
    jogador.acao = null;
    jogador.revanche = false;
  }

  function estadoDaSala(sala) {
    return {
      codigo: sala.codigo,
      situacao: sala.situacao,
      jogadores: sala.jogadores.map((jogador) => ({
        id: jogador.id,
        lutadorId: jogador.lutadorId,
        vidaAtual: jogador.vidaAtual,
        revanche: jogador.revanche,
      })),
    };
  }

  function removerJogadorDaSala(jogador, mensagemAoOponente) {
    const sala = obterSala(jogador);
    jogador.codigoSala = null;
    zerarEstadoDeBatalha(jogador);

    if (!sala) {
      return false;
    }

    sala.jogadores = sala.jogadores.filter(
      (participante) => participante !== jogador,
    );

    if (sala.jogadores.length === 0) {
      salas.delete(sala.codigo);
      return true;
    }

    sala.situacao = SITUACOES.AGUARDANDO;
    for (const participante of sala.jogadores) {
      zerarEstadoDeBatalha(participante);
    }

    transmitir(sala, EVENTOS.OPONENTE_DESCONECTADO, {
      mensagem: mensagemAoOponente,
    });
    return true;
  }

  function iniciarBatalha(sala) {
    if (
      sala.jogadores.length !== 2 ||
      sala.jogadores.some(
        (jogador) => !LUTADORES_POR_ID.has(jogador.lutadorId),
      )
    ) {
      return false;
    }

    sala.situacao = SITUACOES.BATALHA;
    for (const jogador of sala.jogadores) {
      const lutador = LUTADORES_POR_ID.get(jogador.lutadorId);
      jogador.vidaAtual = lutador.atributos.vida;
      jogador.acao = null;
      jogador.revanche = false;
    }

    transmitir(sala, EVENTOS.BATALHA_INICIADA, {
      estado: estadoDaSala(sala),
    });
    return true;
  }

  function resolverTurno(sala) {
    const acoesOrdenadas = REGRAS_BATALHA.ordenarAcoes(
      sala.jogadores[0].acao,
      sala.jogadores[1].acao,
      aleatorio,
    );
    const registros = [];

    for (const acao of acoesOrdenadas) {
      const defensorJogador = sala.jogadores.find(
        (jogador) => jogador !== acao.jogador,
      );
      if (!defensorJogador || defensorJogador.vidaAtual <= 0) {
        break;
      }

      const defensor = LUTADORES_POR_ID.get(defensorJogador.lutadorId);
      if (!REGRAS_BATALHA.golpeAcertou(acao.golpe, aleatorio)) {
        registros.push(
          `${acao.atacante.nome} usou ${acao.golpe.nome}, mas errou.`,
        );
        continue;
      }

      const dano = REGRAS_BATALHA.calcularDano(
        acao.atacante,
        defensor,
        acao.golpe,
      );
      defensorJogador.vidaAtual = Math.max(
        0,
        defensorJogador.vidaAtual - dano,
      );

      if (dano === 0) {
        registros.push(`${acao.atacante.nome} usou ${acao.golpe.nome}.`);
      } else {
        registros.push(
          `${acao.atacante.nome} usou ${acao.golpe.nome} e causou ${dano} de dano.`,
        );
      }

      if (defensorJogador.vidaAtual === 0) {
        break;
      }
    }

    for (const jogador of sala.jogadores) {
      jogador.acao = null;
    }

    const derrotado = sala.jogadores.find(
      (jogador) => jogador.vidaAtual === 0,
    );
    if (derrotado) {
      const vencedor = sala.jogadores.find(
        (jogador) => jogador !== derrotado,
      );
      sala.situacao = SITUACOES.ENCERRADA;
      transmitir(sala, EVENTOS.BATALHA_ENCERRADA, {
        estado: estadoDaSala(sala),
        vencedorId: vencedor.id,
        registros,
      });
      return;
    }

    transmitir(sala, EVENTOS.RESULTADO_TURNO, {
      estado: estadoDaSala(sala),
      registros,
    });
  }

  function dadosSaoValidos(dados, camposEsperados) {
    return (
      ehObjetoSimples(dados) &&
      Object.keys(dados).length === camposEsperados.length &&
      possuiSomenteCampos(dados, camposEsperados)
    );
  }

  function criarSala(jogador, dados) {
    if (!dadosSaoValidos(dados, [])) {
      enviarErro(jogador, "Dados inválidos para criar a sala.");
      return;
    }

    if (jogador.codigoSala) {
      enviarErro(jogador, "Você já está em uma sala.");
      return;
    }

    zerarEstadoDeBatalha(jogador);
    const codigo = criarCodigoSeguro(salas);
    const sala = {
      codigo,
      situacao: SITUACOES.AGUARDANDO,
      jogadores: [jogador],
    };
    jogador.codigoSala = codigo;
    salas.set(codigo, sala);
    enviar(jogador, EVENTOS.SALA_CRIADA, { codigo });
  }

  function entrarNaSala(jogador, dados) {
    if (
      !dadosSaoValidos(dados, ["codigo"]) ||
      typeof dados.codigo !== "string"
    ) {
      enviarErro(jogador, "Informe um código de sala válido.");
      return;
    }

    if (jogador.codigoSala) {
      enviarErro(jogador, "Você já está em uma sala.");
      return;
    }

    const codigo = dados.codigo.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(codigo)) {
      enviarErro(jogador, "Informe um código de sala válido.");
      return;
    }

    const sala = salas.get(codigo);
    if (!sala) {
      enviarErro(jogador, "Sala inexistente.");
      return;
    }

    if (sala.jogadores.length >= 2) {
      enviarErro(jogador, "A sala está cheia.");
      return;
    }

    if (sala.situacao !== SITUACOES.AGUARDANDO) {
      enviarErro(jogador, "A sala não está disponível para entrada.");
      return;
    }

    zerarEstadoDeBatalha(jogador);
    jogador.codigoSala = codigo;
    sala.jogadores.push(jogador);
    sala.situacao = SITUACOES.SELECAO;
    transmitir(sala, EVENTOS.SALA_ENTRADA, { codigo });
  }

  function selecionarLutador(jogador, dados) {
    if (
      !dadosSaoValidos(dados, ["lutadorId"]) ||
      typeof dados.lutadorId !== "string" ||
      !LUTADORES_POR_ID.has(dados.lutadorId)
    ) {
      enviarErro(jogador, "Seleção de lutador inválida.");
      return;
    }

    const sala = obterSala(jogador);
    if (!sala) {
      enviarErro(jogador, "Entre em uma sala primeiro.");
      return;
    }

    if (sala.situacao !== SITUACOES.SELECAO) {
      enviarErro(jogador, "A sala não está na etapa de seleção.");
      return;
    }

    if (jogador.lutadorId) {
      enviarErro(jogador, "Você já selecionou um lutador.");
      return;
    }

    jogador.lutadorId = dados.lutadorId;
    enviar(jogador, EVENTOS.ACAO_ACEITA, {
      mensagem: "Lutador confirmado. Aguardando o adversário.",
    });
    iniciarBatalha(sala);
  }

  function escolherGolpe(jogador, dados) {
    if (
      !dadosSaoValidos(dados, ["indiceGolpe"]) ||
      !Number.isInteger(dados.indiceGolpe)
    ) {
      enviarErro(jogador, "Índice de golpe inválido.");
      return;
    }

    const sala = obterSala(jogador);
    if (!sala) {
      enviarErro(jogador, "Entre em uma sala primeiro.");
      return;
    }

    if (sala.situacao !== SITUACOES.BATALHA) {
      enviarErro(jogador, "A batalha não está em andamento.");
      return;
    }

    if (jogador.acao) {
      enviarErro(jogador, "Você já escolheu um golpe neste turno.");
      return;
    }

    const lutador = LUTADORES_POR_ID.get(jogador.lutadorId);
    const golpe = lutador && lutador.golpes[dados.indiceGolpe];
    if (!golpe) {
      enviarErro(jogador, "Golpe inválido.");
      return;
    }

    jogador.acao = {
      atacante: lutador,
      golpe,
      jogador,
    };
    enviar(jogador, EVENTOS.ACAO_ACEITA, {
      mensagem: "Golpe aceito. Aguardando o adversário.",
    });

    if (sala.jogadores.length === 2 && sala.jogadores.every((item) => item.acao)) {
      resolverTurno(sala);
    }
  }

  function solicitarRevanche(jogador, dados) {
    if (!dadosSaoValidos(dados, [])) {
      enviarErro(jogador, "Dados inválidos para solicitar revanche.");
      return;
    }

    const sala = obterSala(jogador);
    if (!sala) {
      enviarErro(jogador, "Entre em uma sala primeiro.");
      return;
    }

    if (sala.situacao !== SITUACOES.ENCERRADA) {
      enviarErro(jogador, "A revanche só pode ser solicitada após a batalha.");
      return;
    }

    if (jogador.revanche) {
      enviarErro(jogador, "Você já solicitou uma revanche.");
      return;
    }

    jogador.revanche = true;
    transmitir(sala, EVENTOS.STATUS_REVANCHE, {
      estado: estadoDaSala(sala),
    });

    if (sala.jogadores.every((participante) => participante.revanche)) {
      iniciarBatalha(sala);
    }
  }

  function sairDaSala(jogador, dados) {
    if (!dadosSaoValidos(dados, [])) {
      enviarErro(jogador, "Dados inválidos para sair da sala.");
      return;
    }

    if (!obterSala(jogador)) {
      enviarErro(jogador, "Você não está em uma sala.");
      return;
    }

    removerJogadorDaSala(jogador, "O adversário saiu da sala.");
  }

  function processarEvento(jogador, tipo, dados) {
    switch (tipo) {
      case EVENTOS.CRIAR_SALA:
        criarSala(jogador, dados);
        break;
      case EVENTOS.ENTRAR_SALA:
        entrarNaSala(jogador, dados);
        break;
      case EVENTOS.SELECIONAR_LUTADOR:
        selecionarLutador(jogador, dados);
        break;
      case EVENTOS.ESCOLHER_GOLPE:
        escolherGolpe(jogador, dados);
        break;
      case EVENTOS.SOLICITAR_REVANCHE:
        solicitarRevanche(jogador, dados);
        break;
      case EVENTOS.SAIR_SALA:
        sairDaSala(jogador, dados);
        break;
      default:
        enviarErro(jogador, "Evento não reconhecido.");
    }
  }

  function limiteDeMensagensExcedido(jogador) {
    const agora = Date.now();
    if (agora - jogador.inicioJanelaMensagens >= DURACAO_JANELA_MENSAGENS) {
      jogador.inicioJanelaMensagens = agora;
      jogador.mensagensNaJanela = 0;
    }

    jogador.mensagensNaJanela += 1;
    return jogador.mensagensNaJanela > LIMITE_MENSAGENS_POR_JANELA;
  }

  function receberMensagem(jogador, conteudo, mensagemBinaria) {
    if (limiteDeMensagensExcedido(jogador)) {
      enviarErro(jogador, "Muitas mensagens foram enviadas em pouco tempo.");
      jogador.conexao.close(1008, "Limite de mensagens excedido.");
      return;
    }

    if (mensagemBinaria) {
      enviarErro(jogador, "Mensagens binárias não são aceitas.");
      return;
    }

    let mensagem;
    try {
      mensagem = JSON.parse(conteudo.toString("utf8"));
    } catch {
      enviarErro(jogador, "A mensagem enviada não contém JSON válido.");
      return;
    }

    if (
      !ehObjetoSimples(mensagem) ||
      !possuiSomenteCampos(mensagem, ["tipo", "dados"]) ||
      typeof mensagem.tipo !== "string"
    ) {
      enviarErro(jogador, "A mensagem deve conter um tipo de evento válido.");
      return;
    }

    const dados = mensagem.dados === undefined ? {} : mensagem.dados;
    if (!ehObjetoSimples(dados)) {
      enviarErro(jogador, "Os dados do evento devem ser um objeto.");
      return;
    }

    if (!TODOS_EVENTOS.has(mensagem.tipo)) {
      enviarErro(jogador, "Evento desconhecido.");
      return;
    }

    if (!EVENTOS_RECEBIDOS.has(mensagem.tipo)) {
      enviarErro(jogador, "Esse evento não pode ser enviado pelo cliente.");
      return;
    }

    try {
      processarEvento(jogador, mensagem.tipo, dados);
    } catch (erro) {
      console.error("Falha ao processar uma mensagem WebSocket:", erro);
      enviarErro(jogador, "Não foi possível processar o evento enviado.");
    }
  }

  servidorWebSocket.on("connection", (conexao) => {
    const jogador = {
      acao: null,
      codigoSala: null,
      conexao,
      id: crypto.randomUUID(),
      inicioJanelaMensagens: Date.now(),
      lutadorId: null,
      mensagensNaJanela: 0,
      revanche: false,
      vidaAtual: 0,
    };

    conexao.estaAtiva = true;
    conexao.on("pong", () => {
      conexao.estaAtiva = true;
    });
    conexao.on("message", (conteudo, mensagemBinaria) => {
      receberMensagem(jogador, conteudo, mensagemBinaria);
    });
    conexao.on("close", () => {
      removerJogadorDaSala(jogador, "O adversário se desconectou.");
    });
    conexao.on("error", () => {
      // O evento "close" realiza a limpeza; este ouvinte evita erro não tratado.
    });

    enviar(jogador, EVENTOS.CONEXAO, { jogadorId: jogador.id });
  });

  const verificadorDeConexoes = setInterval(() => {
    for (const conexao of servidorWebSocket.clients) {
      if (conexao.estaAtiva === false) {
        conexao.terminate();
        continue;
      }

      conexao.estaAtiva = false;
      try {
        conexao.ping();
      } catch {
        conexao.terminate();
      }
    }
  }, INTERVALO_VERIFICACAO_CONEXAO);
  verificadorDeConexoes.unref();

  function iniciar() {
    if (encerrado) {
      return Promise.reject(new Error("O servidor já foi encerrado."));
    }

    if (servidorHttp.listening) {
      return Promise.resolve(servidorHttp.address());
    }

    if (promessaDeInicio) {
      return promessaDeInicio;
    }

    promessaDeInicio = new Promise((resolver, rejeitar) => {
      function falhou(erro) {
        servidorHttp.off("listening", iniciou);
        promessaDeInicio = null;
        rejeitar(erro);
      }

      function iniciou() {
        servidorHttp.off("error", falhou);
        resolver(servidorHttp.address());
      }

      servidorHttp.once("error", falhou);
      servidorHttp.once("listening", iniciou);
      servidorHttp.listen(portaConfigurada);
    });

    return promessaDeInicio;
  }

  function encerrar() {
    if (promessaDeEncerramento) {
      return promessaDeEncerramento;
    }

    encerrado = true;
    clearInterval(verificadorDeConexoes);

    promessaDeEncerramento = (async () => {
      if (promessaDeInicio && !servidorHttp.listening) {
        try {
          await promessaDeInicio;
        } catch {
          // Uma falha de inicialização significa que não há porta para fechar.
        }
      }

      if (!servidorHttp.listening) {
        for (const conexao of servidorWebSocket.clients) {
          conexao.terminate();
        }
        return;
      }

      await new Promise((resolver) => {
        const temporizador = setTimeout(() => {
          for (const conexao of servidorWebSocket.clients) {
            conexao.terminate();
          }
        }, 500);

        servidorWebSocket.close(() => {
          clearTimeout(temporizador);
          servidorHttp.close(() => resolver());
        });

        for (const conexao of servidorWebSocket.clients) {
          conexao.close(1001, "Servidor encerrado.");
        }
      });
    })();

    return promessaDeEncerramento;
  }

  return Object.freeze({
    encerrar,
    iniciar,
    servidorHttp,
    servidorWebSocket,
  });
}

async function iniciarPeloTerminal() {
  const aplicacao = criarServidor();
  const endereco = await aplicacao.iniciar();
  const porta = typeof endereco === "object" ? endereco.port : endereco;
  console.log(`IFighters disponível em http://localhost:${porta}`);

  let encerramentoSolicitado = false;
  async function encerrarProcesso() {
    if (encerramentoSolicitado) {
      return;
    }

    encerramentoSolicitado = true;
    await aplicacao.encerrar();
  }

  process.once("SIGINT", encerrarProcesso);
  process.once("SIGTERM", encerrarProcesso);
}

if (require.main === module) {
  iniciarPeloTerminal().catch((erro) => {
    console.error("Não foi possível iniciar o servidor:", erro);
    process.exitCode = 1;
  });
}

module.exports = { criarServidor };
