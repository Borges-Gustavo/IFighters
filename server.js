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
    "style-src 'self'",
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
  EVENTOS.REENTRAR_SALA,
  EVENTOS.SELECIONAR_EQUIPE,
  EVENTOS.ESCOLHER_ACAO,
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
const PRAZO_RECONEXAO = 30_000;
const VERSAO_PROTOCOLO = 2;
const QUANTIDADE_LUTADORES_EQUIPE = 3;
const CODIGO_SALA_VALIDO = /^[A-HJ-NP-Z2-9]{6}$/;
const TOKEN_RECONEXAO_VALIDO = /^[A-Za-z0-9_-]{43}$/;

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

function interpretarFaixaBytes(cabecalho, tamanho) {
  if (cabecalho === undefined) {
    return null;
  }

  if (typeof cabecalho !== "string") {
    return false;
  }

  const correspondencia = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim());
  if (!correspondencia || (!correspondencia[1] && !correspondencia[2])) {
    return false;
  }

  const inicioInformado = correspondencia[1]
    ? Number(correspondencia[1])
    : null;
  const fimInformado = correspondencia[2]
    ? Number(correspondencia[2])
    : null;

  if (
    (inicioInformado !== null && !Number.isSafeInteger(inicioInformado)) ||
    (fimInformado !== null && !Number.isSafeInteger(fimInformado))
  ) {
    return false;
  }

  let inicio;
  let fim;

  if (inicioInformado === null) {
    if (fimInformado <= 0) {
      return false;
    }
    inicio = Math.max(0, tamanho - fimInformado);
    fim = tamanho - 1;
  } else {
    inicio = inicioInformado;
    fim =
      fimInformado === null
        ? tamanho - 1
        : Math.min(fimInformado, tamanho - 1);
  }

  if (inicio < 0 || inicio >= tamanho || fim < inicio) {
    return false;
  }

  return { fim, inicio };
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

    const faixa = interpretarFaixaBytes(
      requisicao.headers.range,
      informacoes.size,
    );

    if (faixa === false) {
      aplicarCabecalhosSeguranca(resposta);
      resposta.writeHead(416, {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": 0,
        "Content-Range": `bytes */${informacoes.size}`,
      });
      resposta.end();
      return;
    }

    const inicio = faixa?.inicio ?? 0;
    const fim = faixa?.fim ?? informacoes.size - 1;
    const tamanhoResposta = fim - inicio + 1;
    const cabecalhos = {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      "Content-Length": tamanhoResposta,
      "Content-Type":
        TIPOS_MIME[path.extname(caminhoReal).toLowerCase()] ||
        "application/octet-stream",
      "Last-Modified": informacoes.mtime.toUTCString(),
    };

    if (faixa) {
      cabecalhos["Content-Range"] =
        `bytes ${inicio}-${fim}/${informacoes.size}`;
    }

    aplicarCabecalhosSeguranca(resposta);
    resposta.writeHead(faixa ? 206 : 200, cabecalhos);

    if (requisicao.method === "HEAD" || tamanhoResposta === 0) {
      resposta.end();
      return;
    }

    const fluxo = fs.createReadStream(caminhoReal, { end: fim, start: inicio });
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

function criarServidor({
  porta = process.env.PORT || 3000,
  aleatorio = Math.random,
  prazoReconexao = PRAZO_RECONEXAO,
} = {}) {
  const portaConfigurada = validarPorta(porta);
  if (typeof aleatorio !== "function") {
    throw new TypeError("A fonte de aleatoriedade deve ser uma função.");
  }
  if (!Number.isInteger(prazoReconexao) || prazoReconexao < 10) {
    throw new TypeError("O prazo de reconexão deve ser de ao menos 10 ms.");
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
    const conexao = jogador.conexao;
    if (!conexao || conexao.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      conexao.send(JSON.stringify({ tipo, dados }), (erro) => {
        if (erro && conexao.readyState !== WebSocket.CLOSED) {
          conexao.terminate();
        }
      });
      return true;
    } catch {
      conexao.terminate();
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

  function criarTokenReconexao() {
    return crypto.randomBytes(32).toString("base64url");
  }

  function obterMembroDaEquipe(jogador, lutadorId) {
    return (
      jogador.equipe.find((membro) => membro.lutadorId === lutadorId) || null
    );
  }

  function obterMembroAtivo(jogador) {
    return obterMembroDaEquipe(jogador, jogador.lutadorAtivoId);
  }

  function obterLutadorAtivo(jogador) {
    return LUTADORES_POR_ID.get(jogador.lutadorAtivoId) || null;
  }

  function jogadorTemLutadoresVivos(jogador) {
    return jogador.equipe.some((membro) => membro.vidaAtual > 0);
  }

  function zerarEstadoDeBatalha(jogador) {
    jogador.equipe = [];
    jogador.lutadorAtivoId = null;
    jogador.acao = null;
    jogador.revanche = false;
  }

  function estadoDaSala(sala, destinatario = null) {
    return {
      codigo: sala.codigo,
      situacao: sala.situacao,
      numeroTurno: sala.numeroTurno,
      jogadores: sala.jogadores.map((jogador) => {
        const ocultarEquipe =
          sala.situacao === SITUACOES.SELECAO &&
          destinatario &&
          jogador !== destinatario;
        return {
          id: jogador.id,
          equipe: ocultarEquipe
            ? []
            : jogador.equipe.map((membro) => ({ ...membro })),
          lutadorAtivoId: ocultarEquipe ? null : jogador.lutadorAtivoId,
          revanche: jogador.revanche,
        };
      }),
    };
  }

  function limparPrazoReconexao(jogador) {
    if (jogador.temporizadorReconexao) {
      clearTimeout(jogador.temporizadorReconexao);
      jogador.temporizadorReconexao = null;
    }
  }

  function removerJogadorDaSala(jogador, mensagemAoOponente) {
    const sala = obterSala(jogador);
    limparPrazoReconexao(jogador);
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
    sala.numeroTurno = 0;
    sala.vencedorId = null;
    for (const participante of sala.jogadores) {
      zerarEstadoDeBatalha(participante);
    }

    if (mensagemAoOponente) {
      transmitir(sala, EVENTOS.OPONENTE_DESCONECTADO, {
        mensagem: mensagemAoOponente,
        prazoMs: 0,
        temporario: false,
      });
    }
    return true;
  }

  function agendarRemocaoPorDesconexao(jogador) {
    const sala = obterSala(jogador);
    if (!sala || jogador.temporizadorReconexao) {
      return;
    }

    jogador.conexao = null;
    transmitir(sala, EVENTOS.OPONENTE_DESCONECTADO, {
      mensagem: "O adversário se desconectou. Aguardando reconexão…",
      prazoMs: prazoReconexao,
      temporario: true,
    });

    jogador.temporizadorReconexao = setTimeout(() => {
      jogador.temporizadorReconexao = null;
      removerJogadorDaSala(
        jogador,
        "O adversário não retornou e saiu da sala.",
      );
    }, prazoReconexao);
    jogador.temporizadorReconexao.unref();
  }

  function jogadoresEstaoConectados(sala) {
    return sala.jogadores.every(
      (jogador) => jogador.conexao?.readyState === WebSocket.OPEN,
    );
  }

  function iniciarBatalha(sala) {
    if (
      sala.jogadores.length !== 2 ||
      !jogadoresEstaoConectados(sala) ||
      sala.jogadores.some((jogador) =>
        jogador.equipe.length !== QUANTIDADE_LUTADORES_EQUIPE ||
        jogador.equipe.some(
          (membro) => !LUTADORES_POR_ID.has(membro.lutadorId),
        )
      )
    ) {
      return false;
    }

    sala.situacao = SITUACOES.BATALHA;
    sala.numeroTurno = 1;
    sala.vencedorId = null;
    for (const jogador of sala.jogadores) {
      for (const membro of jogador.equipe) {
        membro.vidaAtual = LUTADORES_POR_ID.get(
          membro.lutadorId,
        ).atributos.vida;
      }
      jogador.lutadorAtivoId = jogador.equipe[0].lutadorId;
      jogador.acao = null;
      jogador.revanche = false;
    }

    transmitir(sala, EVENTOS.BATALHA_INICIADA, {
      estado: estadoDaSala(sala),
    });
    return true;
  }

  function ativarPrimeiraReservaViva(jogador, registros) {
    const reserva = jogador.equipe.find((membro) => membro.vidaAtual > 0);
    if (!reserva) {
      return false;
    }

    jogador.lutadorAtivoId = reserva.lutadorId;
    const lutador = LUTADORES_POR_ID.get(reserva.lutadorId);
    registros.push(`${lutador.nome} entrou na batalha.`);
    return true;
  }

  function aplicarTrocas(sala, registros) {
    for (const jogador of sala.jogadores) {
      if (jogador.acao.tipo !== "troca") {
        continue;
      }

      const anterior = obterLutadorAtivo(jogador);
      const proximo = LUTADORES_POR_ID.get(jogador.acao.lutadorId);
      jogador.lutadorAtivoId = jogador.acao.lutadorId;
      registros.push(`${anterior.nome} recuou. ${proximo.nome} entrou na batalha.`);
    }
  }

  function criarAcoesDeGolpe(sala) {
    return sala.jogadores
      .filter((jogador) => jogador.acao.tipo === "golpe")
      .map((jogador) => {
        const atacante = obterLutadorAtivo(jogador);
        return {
          atacante,
          atacanteId: jogador.lutadorAtivoId,
          golpe: atacante.golpes[jogador.acao.indiceGolpe],
          jogador,
        };
      });
  }

  function ordenarAcoesDeGolpe(acoes) {
    if (acoes.length < 2) {
      return acoes;
    }

    return REGRAS_BATALHA.ordenarAcoes(acoes[0], acoes[1], aleatorio);
  }

  function resolverTurno(sala) {
    const numeroTurno = sala.numeroTurno;
    const registros = [];
    aplicarTrocas(sala, registros);
    const acoesOrdenadas = ordenarAcoesDeGolpe(criarAcoesDeGolpe(sala));

    for (const acao of acoesOrdenadas) {
      const atacanteMembro = obterMembroDaEquipe(
        acao.jogador,
        acao.atacanteId,
      );
      if (
        acao.jogador.lutadorAtivoId !== acao.atacanteId ||
        !atacanteMembro ||
        atacanteMembro.vidaAtual <= 0
      ) {
        continue;
      }

      const defensorJogador = sala.jogadores.find(
        (jogador) => jogador !== acao.jogador,
      );
      const defensorMembro = defensorJogador
        ? obterMembroAtivo(defensorJogador)
        : null;
      if (!defensorJogador || !defensorMembro || defensorMembro.vidaAtual <= 0) {
        break;
      }

      const defensor = obterLutadorAtivo(defensorJogador);
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
      defensorMembro.vidaAtual = Math.max(
        0,
        defensorMembro.vidaAtual - dano,
      );

      if (dano === 0) {
        registros.push(`${acao.atacante.nome} usou ${acao.golpe.nome}.`);
      } else {
        registros.push(
          `${acao.atacante.nome} usou ${acao.golpe.nome} e causou ${dano} de dano.`,
        );
      }

      if (defensorMembro.vidaAtual === 0) {
        registros.push(`${defensor.nome} foi derrotado.`);
        ativarPrimeiraReservaViva(defensorJogador, registros);
      }
    }

    for (const jogador of sala.jogadores) {
      jogador.acao = null;
    }

    const derrotado = sala.jogadores.find(
      (jogador) => !jogadorTemLutadoresVivos(jogador),
    );
    if (derrotado) {
      const vencedor = sala.jogadores.find(
        (jogador) => jogador !== derrotado,
      );
      sala.situacao = SITUACOES.ENCERRADA;
      sala.vencedorId = vencedor.id;
      transmitir(sala, EVENTOS.BATALHA_ENCERRADA, {
        estado: estadoDaSala(sala),
        numeroTurno,
        registros,
        vencedorId: vencedor.id,
      });
      return;
    }

    sala.numeroTurno += 1;
    transmitir(sala, EVENTOS.RESULTADO_TURNO, {
      estado: estadoDaSala(sala),
      numeroTurno,
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
      jogadores: [jogador],
      numeroTurno: 0,
      situacao: SITUACOES.AGUARDANDO,
      vencedorId: null,
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
    if (!CODIGO_SALA_VALIDO.test(codigo)) {
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

  function tokensSaoIguais(primeiro, segundo) {
    if (
      typeof primeiro !== "string" ||
      typeof segundo !== "string" ||
      primeiro.length !== segundo.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(primeiro), Buffer.from(segundo));
  }

  function reentrarNaSala(jogador, dados) {
    if (
      !dadosSaoValidos(dados, ["codigo", "jogadorId", "tokenReconexao"]) ||
      typeof dados.codigo !== "string" ||
      typeof dados.jogadorId !== "string" ||
      !TOKEN_RECONEXAO_VALIDO.test(dados.tokenReconexao)
    ) {
      enviarErro(jogador, "Credenciais de reconexão inválidas.");
      return;
    }

    if (jogador.codigoSala) {
      enviarErro(jogador, "Você já está em uma sala.");
      return;
    }

    const codigo = dados.codigo.trim().toUpperCase();
    const sala = CODIGO_SALA_VALIDO.test(codigo) ? salas.get(codigo) : null;
    const jogadorAnterior = sala?.jogadores.find(
      (participante) => participante.id === dados.jogadorId,
    );

    if (
      !sala ||
      !jogadorAnterior ||
      jogadorAnterior.conexao ||
      !jogadorAnterior.temporizadorReconexao ||
      !tokensSaoIguais(
        jogadorAnterior.tokenReconexao,
        dados.tokenReconexao,
      )
    ) {
      enviarErro(jogador, "Não foi possível retomar essa sessão.");
      return;
    }

    limparPrazoReconexao(jogadorAnterior);
    Object.assign(jogador, {
      acao: jogadorAnterior.acao,
      codigoSala: codigo,
      equipe: jogadorAnterior.equipe,
      id: jogadorAnterior.id,
      lutadorAtivoId: jogadorAnterior.lutadorAtivoId,
      revanche: jogadorAnterior.revanche,
      tokenReconexao: criarTokenReconexao(),
    });
    jogadorAnterior.codigoSala = null;

    const indice = sala.jogadores.indexOf(jogadorAnterior);
    sala.jogadores[indice] = jogador;
    enviar(jogador, EVENTOS.SALA_REENTRADA, {
      acaoPendente: Boolean(jogador.acao),
      equipeConfirmada:
        jogador.equipe.length === QUANTIDADE_LUTADORES_EQUIPE,
      estado: estadoDaSala(sala, jogador),
      jogadorId: jogador.id,
      tokenReconexao: jogador.tokenReconexao,
      vencedorId: sala.vencedorId,
    });

    for (const oponente of sala.jogadores) {
      if (oponente === jogador) {
        continue;
      }
      enviar(oponente, EVENTOS.OPONENTE_RECONECTADO, {
        acaoPendente: Boolean(oponente.acao),
        equipeConfirmada:
          oponente.equipe.length === QUANTIDADE_LUTADORES_EQUIPE,
        estado: estadoDaSala(sala, oponente),
        mensagem: "O adversário se reconectou.",
        vencedorId: sala.vencedorId,
      });
    }
  }

  function selecionarEquipe(jogador, dados) {
    if (
      !dadosSaoValidos(dados, ["lutadorIds"]) ||
      !Array.isArray(dados.lutadorIds) ||
      dados.lutadorIds.length !== QUANTIDADE_LUTADORES_EQUIPE ||
      new Set(dados.lutadorIds).size !== QUANTIDADE_LUTADORES_EQUIPE ||
      dados.lutadorIds.some(
        (lutadorId) =>
          typeof lutadorId !== "string" || !LUTADORES_POR_ID.has(lutadorId),
      )
    ) {
      enviarErro(jogador, "Selecione exatamente três lutadores diferentes.");
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

    if (!jogadoresEstaoConectados(sala)) {
      enviarErro(jogador, "Aguardando a reconexão do adversário.");
      return;
    }

    if (jogador.equipe.length) {
      enviarErro(jogador, "Você já confirmou sua equipe.");
      return;
    }

    jogador.equipe = dados.lutadorIds.map((lutadorId) => ({
      lutadorId,
      vidaAtual: 0,
    }));
    jogador.lutadorAtivoId = dados.lutadorIds[0];
    enviar(jogador, EVENTOS.ACAO_ACEITA, {
      mensagem: "Equipe confirmada. Aguardando o adversário.",
    });
    iniciarBatalha(sala);
  }

  function validarAcao(jogador, dados) {
    if (!dadosSaoValidos(dados, ["acao"]) || !ehObjetoSimples(dados.acao)) {
      return null;
    }

    const acao = dados.acao;
    if (
      acao.tipo === "golpe" &&
      dadosSaoValidos(acao, ["tipo", "indiceGolpe"]) &&
      Number.isInteger(acao.indiceGolpe) &&
      obterLutadorAtivo(jogador)?.golpes[acao.indiceGolpe]
    ) {
      return { tipo: "golpe", indiceGolpe: acao.indiceGolpe };
    }

    const membro =
      acao.tipo === "troca" && typeof acao.lutadorId === "string"
        ? obterMembroDaEquipe(jogador, acao.lutadorId)
        : null;
    if (
      dadosSaoValidos(acao, ["tipo", "lutadorId"]) &&
      membro &&
      membro.lutadorId !== jogador.lutadorAtivoId &&
      membro.vidaAtual > 0
    ) {
      return { tipo: "troca", lutadorId: membro.lutadorId };
    }

    return null;
  }

  function escolherAcao(jogador, dados) {
    const sala = obterSala(jogador);
    if (!sala) {
      enviarErro(jogador, "Entre em uma sala primeiro.");
      return;
    }

    if (sala.situacao !== SITUACOES.BATALHA) {
      enviarErro(jogador, "A batalha não está em andamento.");
      return;
    }

    if (!jogadoresEstaoConectados(sala)) {
      enviarErro(jogador, "Aguardando a reconexão do adversário.");
      return;
    }

    if (jogador.acao) {
      enviarErro(jogador, "Você já escolheu uma ação neste turno.");
      return;
    }

    const acao = validarAcao(jogador, dados);
    if (!acao) {
      enviarErro(jogador, "Ação de batalha inválida.");
      return;
    }

    jogador.acao = acao;
    enviar(jogador, EVENTOS.ACAO_ACEITA, {
      mensagem: "Ação aceita. Aguardando o adversário.",
      numeroTurno: sala.numeroTurno,
    });

    if (sala.jogadores.every((participante) => participante.acao)) {
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

    if (!jogadoresEstaoConectados(sala)) {
      enviarErro(jogador, "Aguardando a reconexão do adversário.");
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
      case EVENTOS.REENTRAR_SALA:
        reentrarNaSala(jogador, dados);
        break;
      case EVENTOS.SELECIONAR_EQUIPE:
        selecionarEquipe(jogador, dados);
        break;
      case EVENTOS.ESCOLHER_ACAO:
        escolherAcao(jogador, dados);
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
      equipe: [],
      id: crypto.randomUUID(),
      inicioJanelaMensagens: Date.now(),
      lutadorAtivoId: null,
      mensagensNaJanela: 0,
      revanche: false,
      temporizadorReconexao: null,
      tokenReconexao: criarTokenReconexao(),
    };

    conexao.estaAtiva = true;
    conexao.on("pong", () => {
      conexao.estaAtiva = true;
    });
    conexao.on("message", (conteudo, mensagemBinaria) => {
      receberMensagem(jogador, conteudo, mensagemBinaria);
    });
    conexao.on("close", () => {
      if (encerrado) {
        removerJogadorDaSala(jogador, null);
      } else {
        agendarRemocaoPorDesconexao(jogador);
      }
    });
    conexao.on("error", () => {
      // O evento "close" realiza a limpeza; este ouvinte evita erro não tratado.
    });

    enviar(jogador, EVENTOS.CONEXAO, {
      jogadorId: jogador.id,
      tokenReconexao: jogador.tokenReconexao,
      versaoProtocolo: VERSAO_PROTOCOLO,
    });
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
    for (const sala of salas.values()) {
      for (const jogador of sala.jogadores) {
        limparPrazoReconexao(jogador);
      }
    }

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
