const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

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
    "connect-src 'self'",
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
const LIMITE_CORPO_JSON = 16 * 1024;
const LIMITE_MENSAGENS_POR_JANELA = 60;
const DURACAO_JANELA_MENSAGENS = 10_000;
const PRAZO_RECONEXAO = 180_000;
const TEMPO_INATIVIDADE_SESSAO = 60_000;
const INTERVALO_LIMPEZA_SESSOES = 1_000;
const INTERVALO_POLLING_RECOMENDADO = 300;
const MAXIMO_EVENTOS_POR_SESSAO = 512;
const MAXIMO_COMANDOS_POR_SESSAO = 256;
const MAXIMO_SESSOES = 200;
const QUANTIDADE_LUTADORES_EQUIPE = 3;
const CODIGO_SALA_VALIDO = /^[A-HJ-NP-Z2-9]{6}$/;
const TOKEN_RECONEXAO_VALIDO = /^[A-Za-z0-9_-]{43}$/;
const IDENTIFICADOR_SESSAO_VALIDO = /^[A-Za-z0-9_-]{43}$/;
const IDENTIFICADOR_COMANDO_VALIDO = /^[A-Za-z0-9_-]{22,64}$/;

function ehObjetoSimples(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function possuiSomenteCampos(objeto, camposPermitidos) {
  const permitidos = new Set(camposPermitidos);
  return Object.keys(objeto).every((campo) => permitidos.has(campo));
}

function assinarComando(tipo, dados) {
  function normalizar(valor) {
    if (Array.isArray(valor)) {
      return valor.map(normalizar);
    }

    if (ehObjetoSimples(valor)) {
      return Object.fromEntries(
        Object.keys(valor)
          .sort()
          .map((chave) => [chave, normalizar(valor[chave])]),
      );
    }

    return valor;
  }

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        dados: normalizar(dados === undefined ? {} : dados),
        tipo,
      }),
      "utf8",
    )
    .digest("base64url");
}

function guardarResultadoComando(sessao, idComando, assinatura, codigoHttp) {
  sessao.comandosProcessados.set(idComando, { assinatura, codigoHttp });

  while (sessao.comandosProcessados.size > MAXIMO_COMANDOS_POR_SESSAO) {
    const idMaisAntigo = sessao.comandosProcessados.keys().next().value;
    sessao.comandosProcessados.delete(idMaisAntigo);
  }
}

function obterResultadoComando(sessao, idComando) {
  const resultado = sessao.comandosProcessados.get(idComando) || null;
  if (!resultado) {
    return null;
  }

  sessao.comandosProcessados.delete(idComando);
  sessao.comandosProcessados.set(idComando, resultado);
  return resultado;
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

function enviarJson(requisicao, resposta, codigoHttp, dados, extras = {}) {
  if (resposta.headersSent) {
    resposta.destroy();
    return;
  }

  const corpo = Buffer.from(JSON.stringify(dados), "utf8");
  aplicarCabecalhosSeguranca(resposta);
  resposta.writeHead(codigoHttp, {
    "Cache-Control": "no-store",
    "Content-Length": corpo.length,
    "Content-Type": "application/json; charset=utf-8",
    ...extras,
  });
  resposta.end(requisicao.method === "HEAD" ? undefined : corpo);
}

function origemEhPermitida(requisicao) {
  const origem = requisicao.headers.origin;
  if (!origem) {
    return true;
  }

  try {
    return new URL(origem).host === requisicao.headers.host;
  } catch {
    return false;
  }
}

function lerCorpoJson(requisicao) {
  return new Promise((resolver, rejeitar) => {
    const partes = [];
    let finalizado = false;
    let tamanho = 0;

    requisicao.on("data", (parte) => {
      if (finalizado) {
        return;
      }
      tamanho += parte.length;
      if (tamanho > LIMITE_CORPO_JSON) {
        finalizado = true;
        const erro = new Error("O corpo da requisição excede o limite permitido.");
        erro.codigoHttp = 413;
        rejeitar(erro);
        return;
      }
      partes.push(parte);
    });

    requisicao.on("end", () => {
      if (finalizado) {
        return;
      }
      finalizado = true;
      if (tamanho === 0) {
        resolver({});
        return;
      }

      try {
        resolver(JSON.parse(Buffer.concat(partes).toString("utf8")));
      } catch {
        const erro = new Error("O corpo da requisição não contém JSON válido.");
        erro.codigoHttp = 400;
        rejeitar(erro);
      }
    });
    requisicao.on("error", (erro) => {
      if (!finalizado) {
        finalizado = true;
        rejeitar(erro);
      }
    });
  });
}

function listarEnderecosDaRede(porta) {
  const enderecos = [];
  let interfacesDisponiveis;
  try {
    interfacesDisponiveis = os.networkInterfaces();
  } catch {
    return enderecos;
  }

  for (const interfaces of Object.values(interfacesDisponiveis)) {
    for (const interfaceRede of interfaces || []) {
      if (interfaceRede.family === "IPv4" && !interfaceRede.internal) {
        enderecos.push(`http://${interfaceRede.address}:${porta}`);
      }
    }
  }
  return [...new Set(enderecos)];
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
  host = process.env.HOST || "0.0.0.0",
  aleatorio = Math.random,
  prazoReconexao = PRAZO_RECONEXAO,
  tempoInatividadeSessao = TEMPO_INATIVIDADE_SESSAO,
} = {}) {
  const portaConfigurada = validarPorta(porta);
  if (typeof host !== "string" || !host.trim()) {
    throw new TypeError("O host do servidor deve ser uma string válida.");
  }
  if (typeof aleatorio !== "function") {
    throw new TypeError("A fonte de aleatoriedade deve ser uma função.");
  }
  if (!Number.isInteger(prazoReconexao) || prazoReconexao < 10) {
    throw new TypeError("O prazo de reconexão deve ser de ao menos 10 ms.");
  }
  if (!Number.isInteger(tempoInatividadeSessao) || tempoInatividadeSessao < 50) {
    throw new TypeError("O tempo de inatividade deve ser de ao menos 50 ms.");
  }

  const salas = new Map();
  const sessoes = new Map();
  const atenderHttp = criarAtendedorHttp(__dirname);
  const servidorHttp = http.createServer((requisicao, resposta) => {
    let caminho;
    try {
      caminho = new URL(
        requisicao.url || "/",
        "http://servidor.local",
      ).pathname;
    } catch {
      enviarJson(requisicao, resposta, 400, { erro: "Endereço inválido." });
      return;
    }

    const atendimento = caminho.startsWith("/api/multijogador/")
      ? atenderApiMultijogador(requisicao, resposta, caminho)
      : atenderHttp(requisicao, resposta);

    Promise.resolve(atendimento).catch((erro) => {
      console.error("Falha ao atender uma requisição HTTP:", erro);
      enviarTexto(
        requisicao,
        resposta,
        500,
        "O servidor não conseguiu concluir a solicitação.",
      );
    });
  });

  let encerrado = false;
  let promessaDeInicio = null;
  let promessaDeEncerramento = null;

  function enviar(jogador, tipo, dados = {}) {
    const sessao = jogador.sessao;
    if (!sessao?.ativa || sessoes.get(sessao.id) !== sessao) {
      return false;
    }

    sessao.ultimoEventoId += 1;
    sessao.eventos.push({
      id: sessao.ultimoEventoId,
      tipo,
      dados,
    });
    if (sessao.eventos.length > MAXIMO_EVENTOS_POR_SESSAO) {
      sessao.eventos.splice(
        0,
        sessao.eventos.length - MAXIMO_EVENTOS_POR_SESSAO,
      );
    }
    return true;
  }

  function enviarErro(jogador, mensagem, extras = {}) {
    enviar(jogador, EVENTOS.ERRO_SALA, { mensagem, ...extras });
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
          conectado: Boolean(
            jogador.sessao?.ativa &&
              sessoes.get(jogador.sessao.id) === jogador.sessao,
          ),
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

    jogador.sessao = null;
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
      (jogador) =>
        jogador.sessao?.ativa &&
        sessoes.get(jogador.sessao.id) === jogador.sessao,
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

      const resultadoDano = REGRAS_BATALHA.calcularDanoDetalhado(
        acao.atacante,
        defensor,
        acao.golpe,
      );
      const { dano, multiplicadorEfetividade } = resultadoDano;
      defensorMembro.vidaAtual = Math.max(
        0,
        defensorMembro.vidaAtual - dano,
      );

      if (resultadoDano.imune) {
        registros.push(
          `${acao.atacante.nome} usou ${acao.golpe.nome}, mas não afeta ${defensor.nome}.`,
        );
      } else if (multiplicadorEfetividade > 1) {
        registros.push(
          `${acao.atacante.nome} usou ${acao.golpe.nome}. É super efetivo: ${dano} de dano.`,
        );
      } else if (multiplicadorEfetividade < 1) {
        registros.push(
          `${acao.atacante.nome} usou ${acao.golpe.nome}. Não é muito efetivo: ${dano} de dano.`,
        );
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
    if (typeof primeiro !== "string" || typeof segundo !== "string") {
      return false;
    }

    const primeiroBuffer = Buffer.from(primeiro, "utf8");
    const segundoBuffer = Buffer.from(segundo, "utf8");
    if (primeiroBuffer.length !== segundoBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(primeiroBuffer, segundoBuffer);
  }

  function reentrarNaSala(jogador, dados) {
    if (
      !dadosSaoValidos(dados, ["codigo", "jogadorId", "tokenReconexao"]) ||
      typeof dados.codigo !== "string" ||
      typeof dados.jogadorId !== "string" ||
      !TOKEN_RECONEXAO_VALIDO.test(dados.tokenReconexao)
    ) {
      enviarErro(jogador, "Credenciais de reconexão inválidas.", {
        recuperavel: false,
      });
      return;
    }

    if (jogador.codigoSala) {
      enviarErro(jogador, "Você já está em uma sala.", {
        recuperavel: false,
      });
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
      !tokensSaoIguais(
        jogadorAnterior.tokenReconexao,
        dados.tokenReconexao,
      )
    ) {
      enviarErro(jogador, "Não foi possível retomar essa sessão.", {
        recuperavel: false,
      });
      return;
    }

    if (jogadorAnterior.sessao) {
      desativarSessao(jogadorAnterior.sessao, {
        agendarReconexao: false,
      });
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
    if (
      !dadosSaoValidos(dados, ["acao", "numeroTurno"]) ||
      !Number.isInteger(dados.numeroTurno) ||
      !ehObjetoSimples(dados.acao)
    ) {
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

    if (!Number.isInteger(dados?.numeroTurno)) {
      enviarErro(jogador, "Informe o turno da ação de batalha.");
      return;
    }

    if (dados.numeroTurno !== sala.numeroTurno) {
      enviarErro(jogador, "Essa ação não pertence ao turno atual.");
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

  function receberEvento(jogador, mensagem) {
    if (limiteDeMensagensExcedido(jogador)) {
      enviarErro(jogador, "Muitas mensagens foram enviadas em pouco tempo.");
      return 429;
    }

    if (
      !ehObjetoSimples(mensagem) ||
      !possuiSomenteCampos(mensagem, ["tipo", "dados"]) ||
      typeof mensagem.tipo !== "string"
    ) {
      enviarErro(jogador, "A mensagem deve conter um tipo de evento válido.");
      return 400;
    }

    const dados = mensagem.dados === undefined ? {} : mensagem.dados;
    if (!ehObjetoSimples(dados)) {
      enviarErro(jogador, "Os dados do evento devem ser um objeto.");
      return 400;
    }

    if (!TODOS_EVENTOS.has(mensagem.tipo)) {
      enviarErro(jogador, "Evento desconhecido.");
      return 400;
    }

    if (!EVENTOS_RECEBIDOS.has(mensagem.tipo)) {
      enviarErro(jogador, "Esse evento não pode ser enviado pelo cliente.");
      return 400;
    }

    try {
      processarEvento(jogador, mensagem.tipo, dados);
      return 200;
    } catch (erro) {
      console.error("Falha ao processar um evento multiplayer:", erro);
      enviarErro(jogador, "Não foi possível processar o evento enviado.");
      return 500;
    }
  }

  function criarSessao() {
    if (sessoes.size >= MAXIMO_SESSOES) {
      return null;
    }

    const sessao = {
      ativa: true,
      chave: crypto.randomBytes(32).toString("base64url"),
      comandosProcessados: new Map(),
      eventos: [],
      id: crypto.randomBytes(32).toString("base64url"),
      jogador: null,
      ultimaAtividade: Date.now(),
      ultimoEventoId: 0,
    };
    const jogador = {
      acao: null,
      codigoSala: null,
      equipe: [],
      id: crypto.randomUUID(),
      inicioJanelaMensagens: Date.now(),
      lutadorAtivoId: null,
      mensagensNaJanela: 0,
      revanche: false,
      sessao,
      temporizadorReconexao: null,
      tokenReconexao: criarTokenReconexao(),
    };
    sessao.jogador = jogador;
    sessoes.set(sessao.id, sessao);

    enviar(jogador, EVENTOS.CONEXAO, {
      jogadorId: jogador.id,
      tokenReconexao: jogador.tokenReconexao,
      versaoProtocolo: EVENTOS.VERSAO_PROTOCOLO,
    });
    return sessao;
  }

  function desativarSessao(
    sessao,
    { agendarReconexao = !encerrado } = {},
  ) {
    if (!sessao?.ativa) {
      return;
    }

    sessao.ativa = false;
    sessoes.delete(sessao.id);
    const jogador = sessao.jogador;
    if (!jogador || jogador.sessao !== sessao) {
      return;
    }

    jogador.sessao = null;
    if (agendarReconexao) {
      agendarRemocaoPorDesconexao(jogador);
    } else if (encerrado) {
      removerJogadorDaSala(jogador, null);
    }
  }

  function autenticarSessao(requisicao, identificador) {
    if (!IDENTIFICADOR_SESSAO_VALIDO.test(identificador)) {
      return null;
    }

    const sessao = sessoes.get(identificador);
    const autorizacao = requisicao.headers.authorization;
    const prefixo = "Bearer ";
    if (
      !sessao?.ativa ||
      typeof autorizacao !== "string" ||
      !autorizacao.startsWith(prefixo) ||
      !tokensSaoIguais(sessao.chave, autorizacao.slice(prefixo.length))
    ) {
      return null;
    }

    sessao.ultimaAtividade = Date.now();
    return sessao;
  }

  function interpretarCursor(valor) {
    if (valor === null || valor === undefined || valor === "") {
      return 0;
    }

    const cursor = Number(valor);
    return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
  }

  function obterEventosDesde(sessao, cursor) {
    return sessao.eventos.filter((evento) => evento.id > cursor);
  }

  function responderComEventos(
    requisicao,
    resposta,
    sessao,
    cursor,
    codigoHttp = 200,
  ) {
    const primeiroId = sessao.eventos[0]?.id ?? sessao.ultimoEventoId + 1;
    enviarJson(requisicao, resposta, codigoHttp, {
      eventos: obterEventosDesde(sessao, cursor),
      eventosPerdidos: cursor < primeiroId - 1,
      ultimoEventoId: sessao.ultimoEventoId,
    });
  }

  async function atenderApiMultijogador(requisicao, resposta, caminho) {
    if (!origemEhPermitida(requisicao)) {
      enviarJson(requisicao, resposta, 403, { erro: "Origem não permitida." });
      return;
    }

    if (caminho === "/api/multijogador/status") {
      if (requisicao.method !== "GET") {
        enviarJson(requisicao, resposta, 405, { erro: "Método não permitido." }, {
          Allow: "GET",
        });
        return;
      }

      const endereco = servidorHttp.address();
      const portaAtual = typeof endereco === "object" ? endereco.port : portaConfigurada;
      enviarJson(requisicao, resposta, 200, {
        enderecosRede: listarEnderecosDaRede(portaAtual),
        intervaloPollingMs: INTERVALO_POLLING_RECOMENDADO,
        transporte: "http",
        versaoProtocolo: EVENTOS.VERSAO_PROTOCOLO,
      });
      return;
    }

    if (caminho === "/api/multijogador/sessoes") {
      if (requisicao.method !== "POST") {
        enviarJson(requisicao, resposta, 405, { erro: "Método não permitido." }, {
          Allow: "POST",
        });
        return;
      }

      const sessao = criarSessao();
      if (!sessao) {
        enviarJson(requisicao, resposta, 503, {
          erro: "O servidor atingiu o limite de jogadores conectados.",
        });
        return;
      }

      enviarJson(requisicao, resposta, 201, {
        chaveSessao: sessao.chave,
        eventos: obterEventosDesde(sessao, 0),
        intervaloPollingMs: INTERVALO_POLLING_RECOMENDADO,
        sessaoId: sessao.id,
        ultimoEventoId: sessao.ultimoEventoId,
      });
      return;
    }

    const correspondencia = /^\/api\/multijogador\/sessoes\/([^/]+)(\/eventos)?$/.exec(
      caminho,
    );
    if (!correspondencia) {
      enviarJson(requisicao, resposta, 404, { erro: "Recurso não encontrado." });
      return;
    }

    const sessao = autenticarSessao(requisicao, correspondencia[1]);
    if (!sessao) {
      enviarJson(requisicao, resposta, 401, { erro: "Sessão inválida ou expirada." });
      return;
    }

    const rotaEventos = Boolean(correspondencia[2]);
    if (!rotaEventos && requisicao.method === "DELETE") {
      aplicarCabecalhosSeguranca(resposta);
      resposta.writeHead(204, { "Cache-Control": "no-store" });
      resposta.end();
      desativarSessao(sessao);
      return;
    }

    if (!rotaEventos) {
      enviarJson(requisicao, resposta, 405, { erro: "Método não permitido." }, {
        Allow: "DELETE",
      });
      return;
    }

    if (requisicao.method === "GET") {
      const endereco = new URL(requisicao.url, "http://servidor.local");
      if ([...endereco.searchParams.keys()].some((chave) => chave !== "desde")) {
        enviarJson(requisicao, resposta, 400, { erro: "Consulta inválida." });
        return;
      }
      const cursor = interpretarCursor(endereco.searchParams.get("desde"));
      if (cursor === null || cursor > sessao.ultimoEventoId) {
        enviarJson(requisicao, resposta, 400, { erro: "Cursor de eventos inválido." });
        return;
      }
      responderComEventos(requisicao, resposta, sessao, cursor);
      return;
    }

    if (requisicao.method !== "POST") {
      enviarJson(requisicao, resposta, 405, { erro: "Método não permitido." }, {
        Allow: "GET, POST",
      });
      return;
    }

    const tipoConteudo = String(
      requisicao.headers["content-type"] || "",
    ).split(";", 1)[0].trim().toLowerCase();
    if (tipoConteudo !== "application/json") {
      enviarErro(sessao.jogador, "Os eventos devem ser enviados como JSON.");
      responderComEventos(requisicao, resposta, sessao, 0, 415);
      return;
    }

    let corpo;
    try {
      corpo = await lerCorpoJson(requisicao);
    } catch (erro) {
      enviarErro(sessao.jogador, erro.message);
      responderComEventos(
        requisicao,
        resposta,
        sessao,
        0,
        erro.codigoHttp || 400,
      );
      return;
    }

    const cursor = interpretarCursor(corpo?.desde);
    if (
      cursor === null ||
      cursor > sessao.ultimoEventoId ||
      !ehObjetoSimples(corpo) ||
      !possuiSomenteCampos(corpo, ["tipo", "dados", "desde", "idComando"]) ||
      typeof corpo.idComando !== "string" ||
      !IDENTIFICADOR_COMANDO_VALIDO.test(corpo.idComando)
    ) {
      enviarErro(sessao.jogador, "A requisição de evento é inválida.");
      responderComEventos(requisicao, resposta, sessao, 0, 400);
      return;
    }

    const assinatura = assinarComando(corpo.tipo, corpo.dados);
    const resultadoAnterior = obterResultadoComando(
      sessao,
      corpo.idComando,
    );
    if (resultadoAnterior) {
      if (resultadoAnterior.assinatura !== assinatura) {
        enviarErro(
          sessao.jogador,
          "O identificador do comando já foi usado com outro conteúdo.",
          { recuperavel: false },
        );
        responderComEventos(requisicao, resposta, sessao, cursor, 409);
        return;
      }

      responderComEventos(
        requisicao,
        resposta,
        sessao,
        cursor,
        resultadoAnterior.codigoHttp,
      );
      return;
    }

    const codigoHttp = receberEvento(sessao.jogador, {
      tipo: corpo.tipo,
      dados: corpo.dados,
    });
    guardarResultadoComando(
      sessao,
      corpo.idComando,
      assinatura,
      codigoHttp,
    );
    responderComEventos(requisicao, resposta, sessao, cursor, codigoHttp);
  }

  const intervaloLimpeza = Math.min(
    INTERVALO_LIMPEZA_SESSOES,
    Math.max(25, Math.floor(tempoInatividadeSessao / 2)),
  );
  const verificadorDeSessoes = setInterval(() => {
    const agora = Date.now();
    for (const sessao of sessoes.values()) {
      if (agora - sessao.ultimaAtividade >= tempoInatividadeSessao) {
        desativarSessao(sessao);
      }
    }
  }, intervaloLimpeza);
  verificadorDeSessoes.unref();

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
      servidorHttp.listen(portaConfigurada, host.trim());
    });

    return promessaDeInicio;
  }

  function encerrar() {
    if (promessaDeEncerramento) {
      return promessaDeEncerramento;
    }

    encerrado = true;
    clearInterval(verificadorDeSessoes);
    for (const sala of salas.values()) {
      for (const jogador of sala.jogadores) {
        limparPrazoReconexao(jogador);
      }
    }
    for (const sessao of sessoes.values()) {
      desativarSessao(sessao, { agendarReconexao: false });
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
        return;
      }

      await new Promise((resolver) => {
        const temporizador = setTimeout(() => {
          servidorHttp.closeAllConnections?.();
        }, 500);

        servidorHttp.close(() => {
          clearTimeout(temporizador);
          resolver();
        });
      });
    })();

    return promessaDeEncerramento;
  }

  return Object.freeze({
    encerrar,
    iniciar,
    servidorHttp,
  });
}

async function iniciarPeloTerminal() {
  const aplicacao = criarServidor();
  const endereco = await aplicacao.iniciar();
  const porta = typeof endereco === "object" ? endereco.port : endereco;
  console.log(`IFighters disponível em http://localhost:${porta}`);
  for (const enderecoRede of listarEnderecosDaRede(porta)) {
    console.log(`Na mesma rede: ${enderecoRede}`);
  }

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
