"use strict";

const crypto = require("node:crypto");
const { Pool } = require("pg");
const LUTADORES = require("../data");
const EVENTOS = require("../protocol");
const REGRAS_BATALHA = require("../regras-batalha");

const INTERVALO_POLLING_MS = 700;
const PRAZO_RECONEXAO_MS = 180_000;
const MAX_EVENTOS = 512;
const MAX_COMANDOS = 256;
const CODIGO_SALA_VALIDO = /^[A-HJ-NP-Z2-9]{6}$/;
const TOKEN_RECONEXAO_VALIDO = /^[A-Za-z0-9_-]{43}$/;
const ID_SESSAO_VALIDO = /^[A-Za-z0-9_-]{43}$/;
const ID_COMANDO_VALIDO = /^[A-Za-z0-9_-]{22,64}$/;
const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LUTADORES_POR_ID = new Map(LUTADORES.map((lutador) => [lutador.id, lutador]));
const SITUACOES = Object.freeze({
  AGUARDANDO: "aguardando",
  SELECAO: "selecao",
  BATALHA: "batalha",
  ENCERRADA: "encerrada",
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

let pool;
let esquemaPronto;

function obterPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada para o multiplayer persistente.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

async function garantirEsquema(cliente) {
  if (esquemaPronto) return esquemaPronto;
  esquemaPronto = cliente.query(`
    CREATE TABLE IF NOT EXISTS ifighters_multiplayer_state (
      id integer PRIMARY KEY,
      estado jsonb NOT NULL,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO ifighters_multiplayer_state (id, estado)
    VALUES (1, '{"sessoes":{},"jogadores":{},"salas":{}}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `).catch((erro) => {
    esquemaPronto = null;
    throw erro;
  });
  return esquemaPronto;
}

function estadoVazio() {
  return { sessoes: {}, jogadores: {}, salas: {} };
}

function normalizarEstado(valor) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return estadoVazio();
  return {
    sessoes: valor.sessoes && typeof valor.sessoes === "object" ? valor.sessoes : {},
    jogadores: valor.jogadores && typeof valor.jogadores === "object" ? valor.jogadores : {},
    salas: valor.salas && typeof valor.salas === "object" ? valor.salas : {},
  };
}

async function carregarEstado(cliente, { bloquear = false } = {}) {
  await garantirEsquema(cliente);
  const resultado = await cliente.query(
    `SELECT estado FROM ifighters_multiplayer_state WHERE id = 1${bloquear ? " FOR UPDATE" : ""}`,
  );
  return normalizarEstado(resultado.rows[0]?.estado);
}

async function salvarEstado(cliente, estado) {
  await cliente.query(
    "UPDATE ifighters_multiplayer_state SET estado = $1::jsonb, atualizado_em = now() WHERE id = 1",
    [JSON.stringify(estado)],
  );
}

async function comTransacao(mutacao) {
  const cliente = await obterPool().connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query("SELECT pg_advisory_xact_lock(734817241)");
    const estado = await carregarEstado(cliente, { bloquear: true });
    limparExpirados(estado);
    const resultado = await mutacao(estado);
    await salvarEstado(cliente, estado);
    await cliente.query("COMMIT");
    return resultado;
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}

async function somenteLeitura(leitura) {
  const cliente = await obterPool().connect();
  try {
    const estado = await carregarEstado(cliente);
    return leitura(estado);
  } finally {
    cliente.release();
  }
}

function sha256(texto) {
  return crypto.createHash("sha256").update(String(texto)).digest("base64url");
}

function criarToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function criarCodigo(estado) {
  for (let tentativa = 0; tentativa < 100; tentativa += 1) {
    let codigo = "";
    for (let i = 0; i < 6; i += 1) {
      codigo += ALFABETO_CODIGO[crypto.randomInt(ALFABETO_CODIGO.length)];
    }
    if (!estado.salas[codigo]) return codigo;
  }
  throw new Error("Não foi possível gerar um código de sala.");
}

function limparExpirados(estado) {
  const agora = Date.now();
  for (const [sessaoId, sessao] of Object.entries(estado.sessoes)) {
    if (agora - Number(sessao.ultimaAtividade || 0) <= PRAZO_RECONEXAO_MS) continue;
    const jogador = estado.jogadores[sessao.jogadorId];
    if (jogador?.sessaoId === sessaoId) {
      jogador.sessaoId = null;
      jogador.conectado = false;
      jogador.desconectadoEm = agora;
    }
    delete estado.sessoes[sessaoId];
  }

  for (const [jogadorId, jogador] of Object.entries(estado.jogadores)) {
    if (jogador.sessaoId || !jogador.desconectadoEm) continue;
    if (agora - jogador.desconectadoEm <= PRAZO_RECONEXAO_MS) continue;
    removerJogadorDaSala(estado, jogador, "O adversário não retornou e saiu da sala.");
    delete estado.jogadores[jogadorId];
  }
}

function criarSessaoNoEstado(estado) {
  const sessaoId = criarToken();
  const chave = criarToken();
  const jogadorId = crypto.randomUUID();
  const tokenReconexao = criarToken();
  const agora = Date.now();

  estado.jogadores[jogadorId] = {
    id: jogadorId,
    tokenReconexao,
    codigoSala: null,
    equipe: [],
    lutadorAtivoId: null,
    acao: null,
    revanche: false,
    sessaoId,
    conectado: true,
    desconectadoEm: null,
  };
  estado.sessoes[sessaoId] = {
    id: sessaoId,
    chaveHash: sha256(chave),
    jogadorId,
    eventos: [],
    ultimoEventoId: 0,
    comandos: {},
    ordemComandos: [],
    ultimaAtividade: agora,
  };

  enviar(estado, jogadorId, EVENTOS.CONEXAO, {
    jogadorId,
    tokenReconexao,
    versaoProtocolo: EVENTOS.VERSAO_PROTOCOLO,
  });
  return { sessaoId, chave };
}

function autenticar(estado, sessaoId, autorizacao) {
  if (!ID_SESSAO_VALIDO.test(String(sessaoId || ""))) return null;
  const prefixo = "Bearer ";
  if (typeof autorizacao !== "string" || !autorizacao.startsWith(prefixo)) return null;
  const sessao = estado.sessoes[sessaoId];
  if (!sessao || sessao.chaveHash !== sha256(autorizacao.slice(prefixo.length))) return null;
  sessao.ultimaAtividade = Date.now();
  const jogador = estado.jogadores[sessao.jogadorId];
  if (jogador) {
    jogador.conectado = true;
    jogador.sessaoId = sessaoId;
    jogador.desconectadoEm = null;
  }
  return sessao;
}

function enviar(estado, jogadorId, tipo, dados = {}) {
  const jogador = estado.jogadores[jogadorId];
  const sessao = jogador?.sessaoId ? estado.sessoes[jogador.sessaoId] : null;
  if (!sessao) return false;
  sessao.ultimoEventoId += 1;
  sessao.eventos.push({ id: sessao.ultimoEventoId, tipo, dados });
  if (sessao.eventos.length > MAX_EVENTOS) {
    sessao.eventos.splice(0, sessao.eventos.length - MAX_EVENTOS);
  }
  return true;
}

function enviarErro(estado, jogadorId, mensagem, extras = {}) {
  enviar(estado, jogadorId, EVENTOS.ERRO_SALA, { mensagem, ...extras });
}

function obterSalaDoJogador(estado, jogador) {
  return jogador?.codigoSala ? estado.salas[jogador.codigoSala] || null : null;
}

function jogadoresDaSala(estado, sala) {
  return (sala?.jogadorIds || []).map((id) => estado.jogadores[id]).filter(Boolean);
}

function transmitir(estado, sala, tipo, dados) {
  for (const jogador of jogadoresDaSala(estado, sala)) enviar(estado, jogador.id, tipo, dados);
}

function jogadorConectado(estado, jogador) {
  return Boolean(jogador?.conectado && jogador.sessaoId && estado.sessoes[jogador.sessaoId]);
}

function jogadoresEstaoConectados(estado, sala) {
  const jogadores = jogadoresDaSala(estado, sala);
  return jogadores.length === 2 && jogadores.every((jogador) => jogadorConectado(estado, jogador));
}

function estadoDaSala(estado, sala, destinatarioId = null) {
  return {
    codigo: sala.codigo,
    situacao: sala.situacao,
    numeroTurno: sala.numeroTurno,
    jogadores: jogadoresDaSala(estado, sala).map((jogador) => {
      const ocultar = sala.situacao === SITUACOES.SELECAO && destinatarioId && jogador.id !== destinatarioId;
      return {
        conectado: jogadorConectado(estado, jogador),
        id: jogador.id,
        equipe: ocultar ? [] : jogador.equipe.map((membro) => ({ ...membro })),
        lutadorAtivoId: ocultar ? null : jogador.lutadorAtivoId,
        revanche: Boolean(jogador.revanche),
      };
    }),
  };
}

function zerarBatalha(jogador) {
  jogador.equipe = [];
  jogador.lutadorAtivoId = null;
  jogador.acao = null;
  jogador.revanche = false;
}

function removerJogadorDaSala(estado, jogador, mensagemAoOponente) {
  const sala = obterSalaDoJogador(estado, jogador);
  jogador.codigoSala = null;
  zerarBatalha(jogador);
  if (!sala) return false;
  sala.jogadorIds = sala.jogadorIds.filter((id) => id !== jogador.id);
  if (sala.jogadorIds.length === 0) {
    delete estado.salas[sala.codigo];
    return true;
  }
  sala.situacao = SITUACOES.AGUARDANDO;
  sala.numeroTurno = 0;
  sala.vencedorId = null;
  for (const restante of jogadoresDaSala(estado, sala)) zerarBatalha(restante);
  if (mensagemAoOponente) {
    transmitir(estado, sala, EVENTOS.OPONENTE_DESCONECTADO, {
      mensagem: mensagemAoOponente,
      prazoMs: 0,
      temporario: false,
    });
  }
  return true;
}

function membro(jogador, lutadorId) {
  return jogador.equipe.find((item) => item.lutadorId === lutadorId) || null;
}

function membroAtivo(jogador) {
  return membro(jogador, jogador.lutadorAtivoId);
}

function lutadorAtivo(jogador) {
  return LUTADORES_POR_ID.get(jogador.lutadorAtivoId) || null;
}

function temVivos(jogador) {
  return jogador.equipe.some((item) => item.vidaAtual > 0);
}

function iniciarBatalha(estado, sala) {
  const jogadores = jogadoresDaSala(estado, sala);
  if (
    jogadores.length !== 2 ||
    !jogadoresEstaoConectados(estado, sala) ||
    jogadores.some((j) => j.equipe.length !== 3 || j.equipe.some((m) => !LUTADORES_POR_ID.has(m.lutadorId)))
  ) return false;

  sala.situacao = SITUACOES.BATALHA;
  sala.numeroTurno = 1;
  sala.vencedorId = null;
  for (const jogador of jogadores) {
    for (const item of jogador.equipe) item.vidaAtual = LUTADORES_POR_ID.get(item.lutadorId).atributos.vida;
    jogador.lutadorAtivoId = jogador.equipe[0].lutadorId;
    jogador.acao = null;
    jogador.revanche = false;
  }
  transmitir(estado, sala, EVENTOS.BATALHA_INICIADA, { estado: estadoDaSala(estado, sala) });
  return true;
}

function ativarReserva(jogador, registros) {
  const reserva = jogador.equipe.find((item) => item.vidaAtual > 0);
  if (!reserva) return false;
  jogador.lutadorAtivoId = reserva.lutadorId;
  registros.push(`${LUTADORES_POR_ID.get(reserva.lutadorId).nome} entrou na batalha.`);
  return true;
}

function resolverTurno(estado, sala) {
  const jogadores = jogadoresDaSala(estado, sala);
  const numeroTurno = sala.numeroTurno;
  const registros = [];

  for (const jogador of jogadores) {
    if (jogador.acao?.tipo !== "troca") continue;
    const anterior = lutadorAtivo(jogador);
    const proximo = LUTADORES_POR_ID.get(jogador.acao.lutadorId);
    jogador.lutadorAtivoId = jogador.acao.lutadorId;
    registros.push(`${anterior.nome} recuou. ${proximo.nome} entrou na batalha.`);
  }

  const acoes = jogadores.filter((j) => j.acao?.tipo === "golpe").map((jogador) => {
    const atacante = lutadorAtivo(jogador);
    return {
      atacante,
      atacanteId: jogador.lutadorAtivoId,
      golpe: atacante.golpes[jogador.acao.indiceGolpe],
      jogador,
    };
  });
  const ordenadas = acoes.length === 2 ? REGRAS_BATALHA.ordenarAcoes(acoes[0], acoes[1], Math.random) : acoes;

  for (const acao of ordenadas) {
    const atacanteMembro = membro(acao.jogador, acao.atacanteId);
    if (acao.jogador.lutadorAtivoId !== acao.atacanteId || !atacanteMembro || atacanteMembro.vidaAtual <= 0) continue;
    const defensorJogador = jogadores.find((j) => j.id !== acao.jogador.id);
    const defensorMembro = membroAtivo(defensorJogador);
    if (!defensorJogador || !defensorMembro || defensorMembro.vidaAtual <= 0) break;
    const defensor = lutadorAtivo(defensorJogador);
    if (!REGRAS_BATALHA.golpeAcertou(acao.golpe, Math.random)) {
      registros.push(`${acao.atacante.nome} usou ${acao.golpe.nome}, mas errou.`);
      continue;
    }
    const resultado = REGRAS_BATALHA.calcularDanoDetalhado(acao.atacante, defensor, acao.golpe);
    defensorMembro.vidaAtual = Math.max(0, defensorMembro.vidaAtual - resultado.dano);
    if (resultado.imune) registros.push(`${acao.atacante.nome} usou ${acao.golpe.nome}, mas não afeta ${defensor.nome}.`);
    else if (resultado.multiplicadorEfetividade > 1) registros.push(`${acao.atacante.nome} usou ${acao.golpe.nome}. É super efetivo: ${resultado.dano} de dano.`);
    else if (resultado.multiplicadorEfetividade < 1) registros.push(`${acao.atacante.nome} usou ${acao.golpe.nome}. Não é muito efetivo: ${resultado.dano} de dano.`);
    else registros.push(`${acao.atacante.nome} usou ${acao.golpe.nome} e causou ${resultado.dano} de dano.`);
    if (defensorMembro.vidaAtual === 0) {
      registros.push(`${defensor.nome} foi derrotado.`);
      ativarReserva(defensorJogador, registros);
    }
  }

  for (const jogador of jogadores) jogador.acao = null;
  const derrotado = jogadores.find((j) => !temVivos(j));
  if (derrotado) {
    const vencedor = jogadores.find((j) => j.id !== derrotado.id);
    sala.situacao = SITUACOES.ENCERRADA;
    sala.vencedorId = vencedor.id;
    transmitir(estado, sala, EVENTOS.BATALHA_ENCERRADA, {
      estado: estadoDaSala(estado, sala), numeroTurno, registros, vencedorId: vencedor.id,
    });
    return;
  }
  sala.numeroTurno += 1;
  transmitir(estado, sala, EVENTOS.RESULTADO_TURNO, {
    estado: estadoDaSala(estado, sala), numeroTurno, registros,
  });
}

function criarSala(estado, jogador, dados) {
  if (dados && Object.keys(dados).length) return enviarErro(estado, jogador.id, "Dados inválidos para criar a sala.");
  if (jogador.codigoSala) return enviarErro(estado, jogador.id, "Você já está em uma sala.");
  zerarBatalha(jogador);
  const codigo = criarCodigo(estado);
  estado.salas[codigo] = { codigo, jogadorIds: [jogador.id], numeroTurno: 0, situacao: SITUACOES.AGUARDANDO, vencedorId: null };
  jogador.codigoSala = codigo;
  enviar(estado, jogador.id, EVENTOS.SALA_CRIADA, { codigo });
}

function entrarSala(estado, jogador, dados) {
  const codigo = typeof dados?.codigo === "string" ? dados.codigo.trim().toUpperCase() : "";
  if (!CODIGO_SALA_VALIDO.test(codigo)) return enviarErro(estado, jogador.id, "Informe um código de sala válido.");
  if (jogador.codigoSala) return enviarErro(estado, jogador.id, "Você já está em uma sala.");
  const sala = estado.salas[codigo];
  if (!sala) return enviarErro(estado, jogador.id, "Sala inexistente.");
  if (sala.jogadorIds.length >= 2) return enviarErro(estado, jogador.id, "A sala está cheia.");
  if (sala.situacao !== SITUACOES.AGUARDANDO) return enviarErro(estado, jogador.id, "A sala não está disponível para entrada.");
  zerarBatalha(jogador);
  jogador.codigoSala = codigo;
  sala.jogadorIds.push(jogador.id);
  sala.situacao = SITUACOES.SELECAO;
  transmitir(estado, sala, EVENTOS.SALA_ENTRADA, { codigo });
}

function reentrarSala(estado, jogadorNovo, dados) {
  const codigo = typeof dados?.codigo === "string" ? dados.codigo.trim().toUpperCase() : "";
  if (!CODIGO_SALA_VALIDO.test(codigo) || typeof dados?.jogadorId !== "string" || !TOKEN_RECONEXAO_VALIDO.test(String(dados?.tokenReconexao || ""))) {
    return enviarErro(estado, jogadorNovo.id, "Credenciais de reconexão inválidas.", { recuperavel: false });
  }
  const sala = estado.salas[codigo];
  const anterior = estado.jogadores[dados.jogadorId];
  if (!sala || !anterior || anterior.codigoSala !== codigo || anterior.tokenReconexao !== dados.tokenReconexao) {
    return enviarErro(estado, jogadorNovo.id, "Não foi possível retomar essa sessão.", { recuperavel: false });
  }

  const sessaoNova = estado.sessoes[jogadorNovo.sessaoId];
  const idNovoTemporario = jogadorNovo.id;
  if (anterior.sessaoId && estado.sessoes[anterior.sessaoId]) delete estado.sessoes[anterior.sessaoId];
  sessaoNova.jogadorId = anterior.id;
  anterior.sessaoId = sessaoNova.id;
  anterior.conectado = true;
  anterior.desconectadoEm = null;
  anterior.tokenReconexao = criarToken();
  delete estado.jogadores[idNovoTemporario];

  enviar(estado, anterior.id, EVENTOS.SALA_REENTRADA, {
    acaoPendente: Boolean(anterior.acao),
    equipeConfirmada: anterior.equipe.length === 3,
    estado: estadoDaSala(estado, sala, anterior.id),
    jogadorId: anterior.id,
    tokenReconexao: anterior.tokenReconexao,
    vencedorId: sala.vencedorId,
  });
  for (const oponente of jogadoresDaSala(estado, sala)) {
    if (oponente.id === anterior.id) continue;
    enviar(estado, oponente.id, EVENTOS.OPONENTE_RECONECTADO, {
      acaoPendente: Boolean(oponente.acao),
      equipeConfirmada: oponente.equipe.length === 3,
      estado: estadoDaSala(estado, sala, oponente.id),
      mensagem: "O adversário se reconectou.",
      vencedorId: sala.vencedorId,
    });
  }
}

function selecionarEquipe(estado, jogador, dados) {
  const ids = dados?.lutadorIds;
  if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3 || ids.some((id) => typeof id !== "string" || !LUTADORES_POR_ID.has(id))) {
    return enviarErro(estado, jogador.id, "Selecione exatamente três lutadores diferentes.");
  }
  const sala = obterSalaDoJogador(estado, jogador);
  if (!sala) return enviarErro(estado, jogador.id, "Entre em uma sala primeiro.");
  if (sala.situacao !== SITUACOES.SELECAO) return enviarErro(estado, jogador.id, "A sala não está na etapa de seleção.");
  if (!jogadoresEstaoConectados(estado, sala)) return enviarErro(estado, jogador.id, "Aguardando a reconexão do adversário.");
  if (jogador.equipe.length) return enviarErro(estado, jogador.id, "Você já confirmou sua equipe.");
  jogador.equipe = ids.map((lutadorId) => ({ lutadorId, vidaAtual: 0 }));
  jogador.lutadorAtivoId = ids[0];
  enviar(estado, jogador.id, EVENTOS.ACAO_ACEITA, { mensagem: "Equipe confirmada. Aguardando o adversário." });
  iniciarBatalha(estado, sala);
}

function escolherAcao(estado, jogador, dados) {
  const sala = obterSalaDoJogador(estado, jogador);
  if (!sala) return enviarErro(estado, jogador.id, "Entre em uma sala primeiro.");
  if (sala.situacao !== SITUACOES.BATALHA) return enviarErro(estado, jogador.id, "A batalha não está em andamento.");
  if (!jogadoresEstaoConectados(estado, sala)) return enviarErro(estado, jogador.id, "Aguardando a reconexão do adversário.");
  if (jogador.acao) return enviarErro(estado, jogador.id, "Você já escolheu uma ação neste turno.");
  if (!Number.isInteger(dados?.numeroTurno) || dados.numeroTurno !== sala.numeroTurno) return enviarErro(estado, jogador.id, "Essa ação não pertence ao turno atual.");
  const acao = dados?.acao;
  let valida = null;
  if (acao?.tipo === "golpe" && Number.isInteger(acao.indiceGolpe) && lutadorAtivo(jogador)?.golpes[acao.indiceGolpe]) {
    valida = { tipo: "golpe", indiceGolpe: acao.indiceGolpe };
  } else if (acao?.tipo === "troca" && typeof acao.lutadorId === "string") {
    const alvo = membro(jogador, acao.lutadorId);
    if (alvo && alvo.vidaAtual > 0 && alvo.lutadorId !== jogador.lutadorAtivoId) valida = { tipo: "troca", lutadorId: alvo.lutadorId };
  }
  if (!valida) return enviarErro(estado, jogador.id, "Ação de batalha inválida.");
  jogador.acao = valida;
  enviar(estado, jogador.id, EVENTOS.ACAO_ACEITA, { mensagem: "Ação aceita. Aguardando o adversário.", numeroTurno: sala.numeroTurno });
  if (jogadoresDaSala(estado, sala).every((j) => j.acao)) resolverTurno(estado, sala);
}

function solicitarRevanche(estado, jogador, dados) {
  if (dados && Object.keys(dados).length) return enviarErro(estado, jogador.id, "Dados inválidos para solicitar revanche.");
  const sala = obterSalaDoJogador(estado, jogador);
  if (!sala) return enviarErro(estado, jogador.id, "Entre em uma sala primeiro.");
  if (sala.situacao !== SITUACOES.ENCERRADA) return enviarErro(estado, jogador.id, "A revanche só pode ser solicitada após a batalha.");
  if (jogador.revanche) return enviarErro(estado, jogador.id, "Você já solicitou uma revanche.");
  jogador.revanche = true;
  transmitir(estado, sala, EVENTOS.STATUS_REVANCHE, { estado: estadoDaSala(estado, sala) });
  if (jogadoresDaSala(estado, sala).every((j) => j.revanche)) iniciarBatalha(estado, sala);
}

function processarEvento(estado, jogador, tipo, dados) {
  switch (tipo) {
    case EVENTOS.CRIAR_SALA: return criarSala(estado, jogador, dados);
    case EVENTOS.ENTRAR_SALA: return entrarSala(estado, jogador, dados);
    case EVENTOS.REENTRAR_SALA: return reentrarSala(estado, jogador, dados);
    case EVENTOS.SELECIONAR_EQUIPE: return selecionarEquipe(estado, jogador, dados);
    case EVENTOS.ESCOLHER_ACAO: return escolherAcao(estado, jogador, dados);
    case EVENTOS.SOLICITAR_REVANCHE: return solicitarRevanche(estado, jogador, dados);
    case EVENTOS.SAIR_SALA: return removerJogadorDaSala(estado, jogador, "O adversário saiu da sala.");
    default: return enviarErro(estado, jogador.id, "Evento não reconhecido.");
  }
}

function loteEventos(sessao, desde) {
  const primeiroId = sessao.eventos[0]?.id ?? sessao.ultimoEventoId + 1;
  return {
    eventos: sessao.eventos.filter((evento) => evento.id > desde),
    eventosPerdidos: desde < primeiroId - 1,
    ultimoEventoId: sessao.ultimoEventoId,
  };
}

function assinaturaComando(tipo, dados) {
  return sha256(JSON.stringify({ tipo, dados: dados ?? {} }));
}

function responderJson(res, codigo, dados, extras = {}) {
  res.statusCode = codigo;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [chave, valor] of Object.entries(extras)) res.setHeader(chave, valor);
  res.end(JSON.stringify(dados));
}

function obterRota(req) {
  const valor = req.query?.rota;
  const partes = Array.isArray(valor) ? valor : [valor];
  return partes.filter((p) => typeof p === "string" && p).join("/");
}

function caminhoEConsulta(req) {
  const rota = obterRota(req);
  const original = new URL(req.url || "/", "https://ifighters.local");
  const caminho = rota ? `/api/multijogador/${rota}` : "/api/multijogador/status";
  return { caminho, consulta: original.searchParams };
}

async function lerCorpo(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const partes = [];
  for await (const parte of req) partes.push(parte);
  if (!partes.length) return {};
  return JSON.parse(Buffer.concat(partes).toString("utf8"));
}

module.exports = async function multijogador(req, res) {
  try {
    const { caminho, consulta } = caminhoEConsulta(req);

    if (caminho === "/api/multijogador/status") {
      if (req.method !== "GET") return responderJson(res, 405, { erro: "Método não permitido." }, { Allow: "GET" });
      await somenteLeitura(() => null);
      return responderJson(res, 200, {
        ambiente: "vercel-postgres",
        intervaloPollingMs: INTERVALO_POLLING_MS,
        transporte: "http",
        persistencia: "postgres",
        status: "online",
        versaoProtocolo: EVENTOS.VERSAO_PROTOCOLO,
      });
    }

    if (caminho === "/api/multijogador/sessoes") {
      if (req.method !== "POST") return responderJson(res, 405, { erro: "Método não permitido." }, { Allow: "POST" });
      const criada = await comTransacao((estado) => criarSessaoNoEstado(estado));
      const resposta = await somenteLeitura((estado) => {
        const sessao = estado.sessoes[criada.sessaoId];
        return { chaveSessao: criada.chave, sessaoId: criada.sessaoId, intervaloPollingMs: INTERVALO_POLLING_MS, ...loteEventos(sessao, 0) };
      });
      return responderJson(res, 201, resposta);
    }

    const correspondencia = /^\/api\/multijogador\/sessoes\/([^/]+)(\/eventos)?$/.exec(caminho);
    if (!correspondencia) return responderJson(res, 404, { erro: "Recurso não encontrado." });
    const sessaoId = correspondencia[1];
    const rotaEventos = Boolean(correspondencia[2]);

    if (!rotaEventos && req.method === "DELETE") {
      const ok = await comTransacao((estado) => {
        const sessao = autenticar(estado, sessaoId, req.headers.authorization);
        if (!sessao) return false;
        const jogador = estado.jogadores[sessao.jogadorId];
        if (jogador) {
          jogador.conectado = false;
          jogador.sessaoId = null;
          jogador.desconectadoEm = Date.now();
          const sala = obterSalaDoJogador(estado, jogador);
          if (sala) transmitir(estado, sala, EVENTOS.OPONENTE_DESCONECTADO, {
            mensagem: "O adversário se desconectou. Aguardando reconexão…",
            prazoMs: PRAZO_RECONEXAO_MS,
            temporario: true,
          });
        }
        delete estado.sessoes[sessaoId];
        return true;
      });
      return ok ? (res.statusCode = 204, res.end()) : responderJson(res, 401, { erro: "Sessão inválida ou expirada." });
    }

    if (!rotaEventos) return responderJson(res, 405, { erro: "Método não permitido." }, { Allow: "DELETE" });

    if (req.method === "GET") {
      const desde = Number(consulta.get("desde") || 0);
      if (!Number.isSafeInteger(desde) || desde < 0) return responderJson(res, 400, { erro: "Cursor de eventos inválido." });
      const resultado = await comTransacao((estado) => {
        const sessao = autenticar(estado, sessaoId, req.headers.authorization);
        if (!sessao) return null;
        return loteEventos(sessao, desde);
      });
      return resultado ? responderJson(res, 200, resultado) : responderJson(res, 401, { erro: "Sessão inválida ou expirada." });
    }

    if (req.method !== "POST") return responderJson(res, 405, { erro: "Método não permitido." }, { Allow: "GET, POST" });
    const corpo = await lerCorpo(req);
    const desde = Number(corpo?.desde ?? 0);
    if (!Number.isSafeInteger(desde) || desde < 0 || typeof corpo?.tipo !== "string" || !EVENTOS_RECEBIDOS.has(corpo.tipo) || typeof corpo?.idComando !== "string" || !ID_COMANDO_VALIDO.test(corpo.idComando)) {
      return responderJson(res, 400, { erro: "A requisição de evento é inválida." });
    }

    const resultado = await comTransacao((estado) => {
      const sessao = autenticar(estado, sessaoId, req.headers.authorization);
      if (!sessao) return { codigo: 401, dados: { erro: "Sessão inválida ou expirada." } };
      const assinatura = assinaturaComando(corpo.tipo, corpo.dados);
      const anterior = sessao.comandos[corpo.idComando];
      if (anterior) {
        if (anterior.assinatura !== assinatura) return { codigo: 409, dados: { erro: "O identificador do comando já foi usado com outro conteúdo." } };
        return { codigo: anterior.codigo, dados: loteEventos(sessao, desde) };
      }
      const jogador = estado.jogadores[sessao.jogadorId];
      if (!jogador) return { codigo: 401, dados: { erro: "Jogador da sessão não existe." } };
      processarEvento(estado, jogador, corpo.tipo, corpo.dados ?? {});
      sessao.comandos[corpo.idComando] = { assinatura, codigo: 200 };
      sessao.ordemComandos.push(corpo.idComando);
      while (sessao.ordemComandos.length > MAX_COMANDOS) {
        delete sessao.comandos[sessao.ordemComandos.shift()];
      }
      return { codigo: 200, dados: loteEventos(sessao, desde) };
    });
    return responderJson(res, resultado.codigo, resultado.dados);
  } catch (erro) {
    console.error("Falha no multiplayer persistente:", erro);
    return responderJson(res, 503, {
      erro: process.env.DATABASE_URL
        ? "O serviço multiplayer está temporariamente indisponível."
        : "O multiplayer persistente ainda não foi configurado no servidor.",
    }, { "Retry-After": "1" });
  }
};
