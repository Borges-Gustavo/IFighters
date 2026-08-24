"use strict";

const CHAVE_CONFIGURACOES = "ifighters-configuracoes";
const CHAVE_RECONEXAO = "ifighters-reconexao";
const DURACOES = Object.freeze({
  aviso: 2600,
  conexao: 8000,
  anuncioGolpe: 650,
  erroGolpe: 600,
  dano: 700,
  intervaloReconexao: 900,
});
const CODIGO_SALA_VALIDO = /^[A-Z0-9]{6}$/;
const TAMANHO_EQUIPE = 3;
const consultaMovimentoReduzido = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);

function carregarConfiguracoes() {
  let configuracoesSalvas = {};

  try {
    const textoSalvo = localStorage.getItem(CHAVE_CONFIGURACOES);
    const valorSalvo = textoSalvo ? JSON.parse(textoSalvo) : {};

    if (
      valorSalvo &&
      typeof valorSalvo === "object" &&
      !Array.isArray(valorSalvo)
    ) {
      configuracoesSalvas = valorSalvo;
    }
  } catch {
    configuracoesSalvas = {};
  }

  return {
    animacoes:
      typeof configuracoesSalvas.animacoes === "boolean"
        ? configuracoesSalvas.animacoes
        : !consultaMovimentoReduzido.matches,
    contraste:
      typeof configuracoesSalvas.contraste === "boolean"
        ? configuracoesSalvas.contraste
        : false,
    reproduzirIntroducao:
      typeof configuracoesSalvas.reproduzirIntroducao === "boolean"
        ? configuracoesSalvas.reproduzirIntroducao
        : true,
    animacoesDefinidas:
      typeof configuracoesSalvas.animacoes === "boolean",
  };
}

function carregarCredenciaisReconexao() {
  try {
    const texto = sessionStorage.getItem(CHAVE_RECONEXAO);
    const credenciais = texto ? JSON.parse(texto) : null;

    if (
      ehObjeto(credenciais) &&
      codigoSalaEhValido(credenciais.codigo) &&
      typeof credenciais.jogadorId === "string" &&
      credenciais.jogadorId.length > 0 &&
      typeof credenciais.tokenReconexao === "string" &&
      credenciais.tokenReconexao.length >= 32
    ) {
      return credenciais;
    }
  } catch {
    // Uma sessão corrompida não deve impedir o jogo de iniciar.
  }

  return null;
}

function salvarCredenciaisReconexao() {
  const { codigoSala, jogadorId, tokenReconexao } =
    estadoAplicacao.multijogador;

  if (!codigoSala || !jogadorId || !tokenReconexao) {
    return;
  }

  try {
    sessionStorage.setItem(
      CHAVE_RECONEXAO,
      JSON.stringify({
        codigo: codigoSala,
        jogadorId,
        tokenReconexao,
      }),
    );
  } catch {
    // A partida continua; apenas a retomada automática fica indisponível.
  }
}

function limparCredenciaisReconexao() {
  try {
    sessionStorage.removeItem(CHAVE_RECONEXAO);
  } catch {
    // Não há estado adicional para limpar quando o armazenamento falha.
  }
}

function criarEstadoMultijogador() {
  return {
    sessaoId: null,
    chaveSessao: null,
    promessaConexao: null,
    filaEnvio: Promise.resolve(),
    pollingAtivo: false,
    temporizadorPolling: null,
    abortadorRequisicao: null,
    intervaloPollingMs: 300,
    ultimoEventoId: 0,
    falhasConsecutivas: 0,
    situacao: "desconectado",
    jogadorId: null,
    codigoSala: null,
    estadoRemoto: null,
    tokenReconexao: null,
    reconectando: false,
    tentativasReconexao: 0,
    temporizadorReconexao: null,
    oponenteAusente: false,
    equipeConfirmada: false,
    aguardandoAcao: false,
    revancheSolicitada: false,
  };
}

const estadoAplicacao = {
  telaAtual: "introducao",
  historicoTelas: [],
  indiceFoco: 0,
  quadroFoco: null,
  lutadoresSelecionadosIds: [],
  lutadorEmPreviaId: null,
  indiceIfdex: 0,
  filtroIfdex: "",
  painelBatalha: "acoes",
  modoBatalha: null,
  batalha: null,
  identificadorTurnoLocal: 0,
  temporizadorAviso: null,
  configuracoes: carregarConfiguracoes(),
  multijogador: criarEstadoMultijogador(),
};

function selecionar(seletor, raiz = document) {
  return raiz.querySelector(seletor);
}

function selecionarTodos(seletor, raiz = document) {
  return Array.from(raiz.querySelectorAll(seletor));
}

function exigirElemento(seletor, raiz = document) {
  const elemento = selecionar(seletor, raiz);

  if (!elemento) {
    throw new Error(`Elemento obrigatório não encontrado: ${seletor}`);
  }

  return elemento;
}

function criarElemento(etiqueta, texto = "", classes = []) {
  const elemento = document.createElement(etiqueta);

  if (texto) {
    elemento.textContent = texto;
  }

  if (classes.length) {
    elemento.classList.add(...classes);
  }

  return elemento;
}

function ehObjeto(valor) {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

function limitarNumero(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

function obterLutador(lutadorId) {
  return LUTADORES.find((lutador) => lutador.id === lutadorId) ?? null;
}

function aplicarConfiguracoes() {
  const { animacoes, contraste, reproduzirIntroducao } =
    estadoAplicacao.configuracoes;

  document.body.classList.toggle("movimento-reduzido", !animacoes);
  document.body.classList.toggle("alto-contraste", contraste);

  const alternarAnimacoes = selecionar("#alternar-animacoes");
  const alternarContraste = selecionar("#alternar-contraste");
  const alternarIntroducao = selecionar("#alternar-introducao");

  if (alternarAnimacoes) {
    alternarAnimacoes.checked = animacoes;
  }

  if (alternarContraste) {
    alternarContraste.checked = contraste;
  }

  if (alternarIntroducao) {
    alternarIntroducao.checked = reproduzirIntroducao;
  }
}

function salvarConfiguracoes() {
  const configuracoesPersistidas = {
    animacoes: estadoAplicacao.configuracoes.animacoes,
    contraste: estadoAplicacao.configuracoes.contraste,
    reproduzirIntroducao:
      estadoAplicacao.configuracoes.reproduzirIntroducao,
  };

  try {
    localStorage.setItem(
      CHAVE_CONFIGURACOES,
      JSON.stringify(configuracoesPersistidas),
    );
  } catch {
    mostrarAviso("Não foi possível salvar as configurações neste navegador.");
  }
}

function atualizarConfiguracoesPelaInterface() {
  estadoAplicacao.configuracoes = {
    animacoes: exigirElemento("#alternar-animacoes").checked,
    contraste: exigirElemento("#alternar-contraste").checked,
    reproduzirIntroducao: exigirElemento("#alternar-introducao").checked,
    animacoesDefinidas: true,
  };

  aplicarConfiguracoes();
  salvarConfiguracoes();
}

function mostrarAviso(texto, duracao = DURACOES.aviso) {
  const aviso = exigirElemento("#aviso");

  if (estadoAplicacao.temporizadorAviso !== null) {
    clearTimeout(estadoAplicacao.temporizadorAviso);
  }

  aviso.textContent = String(texto);
  aviso.hidden = false;

  estadoAplicacao.temporizadorAviso = window.setTimeout(() => {
    aviso.hidden = true;
    aviso.textContent = "";
    estadoAplicacao.temporizadorAviso = null;
  }, duracao);
}

function aguardarAnimacao(duracao) {
  const espera = estadoAplicacao.configuracoes.animacoes ? duracao : 0;
  return new Promise((resolver) => window.setTimeout(resolver, espera));
}

function obterTela(nomeTela) {
  return selecionarTodos("[data-tela]").find(
    (tela) => tela.dataset.tela === nomeTela,
  );
}

function elementoEstaVisivel(elemento) {
  return (
    !elemento.closest("[hidden]") &&
    !elemento.closest("[inert]") &&
    elemento.getClientRects().length > 0
  );
}

function obterItensNavegaveis() {
  const tela = obterTela(estadoAplicacao.telaAtual);

  if (!tela) {
    return [];
  }

  return selecionarTodos(".selecionavel:not([disabled])", tela).filter(
    elementoEstaVisivel,
  );
}

function marcarElementoComFoco(elemento) {
  selecionarTodos(".com-foco").forEach((item) => {
    item.classList.remove("com-foco");
  });

  if (!elemento) {
    return;
  }

  elemento.classList.add("com-foco");
  const itens = obterItensNavegaveis();
  const indice = itens.indexOf(elemento);

  if (indice >= 0) {
    estadoAplicacao.indiceFoco = indice;
  }
}

function focarElemento(elemento) {
  if (!elemento || typeof elemento.focus !== "function") {
    return;
  }

  elemento.focus({ preventScroll: false });
  marcarElementoComFoco(elemento);
}

function focarItemInicial(nomeTela = estadoAplicacao.telaAtual) {
  if (nomeTela !== estadoAplicacao.telaAtual) {
    return;
  }

  const tela = obterTela(nomeTela);

  if (!tela) {
    return;
  }

  const preferencial = selecionar(
    "[data-foco-inicial]:not([disabled])",
    tela,
  );
  const primeiro = preferencial ?? obterItensNavegaveis()[0];

  estadoAplicacao.indiceFoco = Math.max(
    0,
    obterItensNavegaveis().indexOf(primeiro),
  );
  focarElemento(primeiro);
}

function agendarFocoInicial(nomeTela) {
  if (estadoAplicacao.quadroFoco !== null) {
    cancelAnimationFrame(estadoAplicacao.quadroFoco);
  }

  estadoAplicacao.quadroFoco = requestAnimationFrame(() => {
    estadoAplicacao.quadroFoco = null;
    focarItemInicial(nomeTela);
  });
}

function irParaTela(
  proximaTela,
  { registrarHistorico = true, focar = true } = {},
) {
  const telaDestino = obterTela(proximaTela);
  const telaOrigem = obterTela(estadoAplicacao.telaAtual);

  if (!telaDestino) {
    mostrarAviso(`A tela “${proximaTela}” não está disponível.`);
    return false;
  }

  if (proximaTela === estadoAplicacao.telaAtual) {
    if (focar) {
      agendarFocoInicial(proximaTela);
    }
    return true;
  }

  if (registrarHistorico && telaOrigem) {
    estadoAplicacao.historicoTelas.push(estadoAplicacao.telaAtual);
  }

  selecionarTodos("[data-tela]").forEach((tela) => {
    const estaAtiva = tela === telaDestino;
    tela.classList.toggle("ativa", estaAtiva);
    tela.setAttribute("aria-hidden", String(!estaAtiva));
    tela.inert = !estaAtiva;
  });

  estadoAplicacao.telaAtual = proximaTela;
  estadoAplicacao.indiceFoco = 0;

  if (focar) {
    agendarFocoInicial(proximaTela);
  }

  return true;
}

function voltarTela() {
  if (
    estadoAplicacao.telaAtual === "equipe" &&
    estadoAplicacao.modoBatalha === "multijogador"
  ) {
    sairDoMultijogador("jogar");
    return;
  }

  if (estadoAplicacao.telaAtual === "batalha") {
    if (
      estadoAplicacao.painelBatalha !== "acoes" &&
      exigirElemento("#resultado-batalha").hidden
    ) {
      mostrarPainelBatalha("acoes");
      return;
    }

    sairDaBatalha();
    return;
  }

  const telaAnterior =
    estadoAplicacao.historicoTelas.at(-1) ?? "menu";

  if (
    irParaTela(telaAnterior, {
      registrarHistorico: false,
    })
  ) {
    estadoAplicacao.historicoTelas.pop();
  }
}

function moverFoco(direcao) {
  const itens = obterItensNavegaveis();

  if (!itens.length) {
    return;
  }

  const indiceElementoAtivo = itens.indexOf(document.activeElement);
  const indiceAtual =
    indiceElementoAtivo >= 0
      ? indiceElementoAtivo
      : limitarNumero(estadoAplicacao.indiceFoco, 0, itens.length - 1);
  const proximoIndice = (indiceAtual + direcao + itens.length) % itens.length;

  estadoAplicacao.indiceFoco = proximoIndice;
  focarElemento(itens[proximoIndice]);
}

function renderizarEquipe() {
  const lista = exigirElemento("#lista-lutadores");
  const previa = exigirElemento("#previa-lutador");
  const status = exigirElemento("#status-equipe");
  const selecionados = estadoAplicacao.lutadoresSelecionadosIds;
  const lutadorEmPrevia =
    obterLutador(estadoAplicacao.lutadorEmPreviaId) ?? LUTADORES[0] ?? null;

  lista.replaceChildren();
  previa.replaceChildren();

  if (!lutadorEmPrevia) {
    lista.append(criarElemento("p", "Nenhum lutador disponível."));
    status.textContent = "Nenhum IFighter disponível.";
    exigirElemento("#botao-confirmar-equipe").disabled = true;
    return;
  }

  const selecaoBloqueada =
    estadoAplicacao.modoBatalha === "multijogador" &&
    (estadoAplicacao.multijogador.equipeConfirmada ||
      estadoAplicacao.multijogador.oponenteAusente);

  const botoes = LUTADORES.map((lutador) => {
    const ordemNaEquipe = selecionados.indexOf(lutador.id);
    const selecionado = ordemNaEquipe >= 0;
    const limiteAtingido =
      selecionados.length >= TAMANHO_EQUIPE && !selecionado;
    const botao = criarElemento("button", "", [
      "opcao-lutador",
      "selecionavel",
    ]);
    const imagem = criarElemento("img");
    const rotulo = criarElemento("span");
    const nome = criarElemento("strong", lutador.nome);
    const forma = criarElemento("small", lutador.forma);

    botao.type = "button";
    botao.disabled = selecaoBloqueada || limiteAtingido;
    botao.dataset.lutadorId = lutador.id;
    botao.setAttribute("aria-pressed", String(selecionado));
    botao.setAttribute(
      "aria-label",
      selecionado
        ? `${lutador.nome}, forma ${lutador.forma}, posição ${ordemNaEquipe + 1} da equipe`
        : `${lutador.nome}, forma ${lutador.forma}`,
    );
    botao.classList.toggle("selecionado", selecionado);

    if (lutador.id === estadoAplicacao.lutadorEmPreviaId) {
      botao.dataset.focoInicial = "";
    }

    imagem.src = lutador.sprite;
    imagem.alt = "";
    rotulo.append(nome, document.createElement("br"), forma);

    if (selecionado) {
      rotulo.append(
        document.createElement("br"),
        criarElemento(
          "small",
          ordemNaEquipe === 0 ? "1 · INICIAL" : `${ordemNaEquipe + 1} · RESERVA`,
          ["ordem-equipe"],
        ),
      );
    }

    botao.append(imagem, rotulo);
    return botao;
  });

  lista.append(...botoes);

  const imagemPrevia = criarElemento("img");
  imagemPrevia.src = lutadorEmPrevia.sprite;
  imagemPrevia.alt = "";
  previa.append(
    imagemPrevia,
    criarElemento("h2", lutadorEmPrevia.nome),
    criarElemento("p", lutadorEmPrevia.forma),
    criarElemento("p", lutadorEmPrevia.descricao),
  );

  const botaoConfirmar = exigirElemento("#botao-confirmar-equipe");
  const equipeCompleta = selecionados.length === TAMANHO_EQUIPE;

  status.textContent = equipeCompleta
    ? "Equipe completa. O primeiro IFighter será o inicial."
    : `${selecionados.length} de ${TAMANHO_EQUIPE} IFighters escolhidos.`;
  botaoConfirmar.disabled = selecaoBloqueada || !equipeCompleta;
  botaoConfirmar.textContent = estadoAplicacao.multijogador.oponenteAusente
    ? "AGUARDANDO RECONEXÃO"
    : selecaoBloqueada
      ? "AGUARDANDO ADVERSÁRIO"
      : `CONFIRMAR EQUIPE (${selecionados.length}/${TAMANHO_EQUIPE})`;
}

function alternarLutadorDaEquipe(lutadorId, deveFocar = true) {
  const selecionados = estadoAplicacao.lutadoresSelecionadosIds;
  const indiceSelecionado = selecionados.indexOf(lutadorId);

  if (
    !obterLutador(lutadorId) ||
    estadoAplicacao.multijogador.equipeConfirmada ||
    estadoAplicacao.multijogador.oponenteAusente ||
    (indiceSelecionado < 0 && selecionados.length >= TAMANHO_EQUIPE)
  ) {
    return;
  }

  estadoAplicacao.lutadorEmPreviaId = lutadorId;

  if (indiceSelecionado >= 0) {
    selecionados.splice(indiceSelecionado, 1);
  } else {
    selecionados.push(lutadorId);
  }

  renderizarEquipe();

  if (deveFocar) {
    const botaoAtual = selecionar(
      `[data-lutador-id="${lutadorId}"]`,
      exigirElemento("#lista-lutadores"),
    );
    focarElemento(botaoAtual ?? exigirElemento("#botao-confirmar-equipe"));
  }
}

function renderizarIfdex() {
  const grade = exigirElemento("#grade-ifdex");
  const detalhe = exigirElemento("#detalhe-dex");
  const contador = exigirElemento("#contador-ifdex");
  const lutadoresFiltrados = obterLutadoresFiltradosIfdex();

  grade.replaceChildren();
  detalhe.replaceChildren();
  contador.textContent = `${lutadoresFiltrados.length} de ${LUTADORES.length}`;

  if (!lutadoresFiltrados.length) {
    grade.append(
      criarElemento(
        "p",
        "Nenhum IFighter corresponde à busca.",
        ["ifdex-vazia"],
      ),
    );
    detalhe.append(
      criarElemento("h2", "Nenhum resultado"),
      criarElemento("p", "Tente buscar pelo nome da pessoa, Pokémon, tipo ou número."),
    );
    return;
  }

  if (
    !lutadoresFiltrados.some(
      ({ indice }) => indice === estadoAplicacao.indiceIfdex,
    )
  ) {
    estadoAplicacao.indiceIfdex = lutadoresFiltrados[0].indice;
  }

  const lutadorAtual = LUTADORES[estadoAplicacao.indiceIfdex];

  const botoes = lutadoresFiltrados.map(({ lutador, indice }) => {
    const selecionado = indice === estadoAplicacao.indiceIfdex;
    const botao = criarElemento("button", "", ["opcao-dex", "selecionavel"]);
    const imagem = criarElemento("img");

    botao.type = "button";
    botao.dataset.indiceDex = String(indice);
    botao.setAttribute("aria-pressed", String(selecionado));
    botao.setAttribute("aria-label", `Ver detalhes de ${lutador.nome}`);
    botao.classList.toggle("selecionado", selecionado);

    if (selecionado) {
      botao.dataset.focoInicial = "";
    }

    imagem.src = lutador.sprite;
    imagem.alt = "";
    botao.append(imagem, criarElemento("small", lutador.nome));
    return botao;
  });

  grade.append(...botoes);

  const imagemDetalhe = criarElemento("img");
  imagemDetalhe.src = lutadorAtual.sprite;
  imagemDetalhe.alt = "";
  const identificacao = criarElemento(
    "p",
    `#${String(lutadorAtual.numero).padStart(4, "0")} · ${lutadorAtual.forma}${
      lutadorAtual.variante ? ` · ${lutadorAtual.variante}` : ""
    }`,
    ["identificacao-ifdex"],
  );
  const tipos = criarElemento("div", "", ["tipos-ifdex"]);
  const atributos = criarElemento("dl", "", ["atributos-ifdex"]);
  const golpes = criarElemento("ul", "", ["golpes-ifdex"]);

  for (const tipo of lutadorAtual.tipos) {
    tipos.append(criarElemento("span", tipo));
  }

  for (const [rotulo, chave] of [
    ["PV", "vida"],
    ["ATQ", "ataque"],
    ["DEF", "defesa"],
    ["VEL", "velocidade"],
  ]) {
    atributos.append(
      criarElemento("dt", rotulo),
      criarElemento("dd", String(lutadorAtual.atributos[chave])),
    );
  }

  for (const golpe of lutadorAtual.golpes) {
    const item = criarElemento("li");
    item.append(
      criarElemento("strong", golpe.nome),
      criarElemento(
        "small",
        `${golpe.nomeOriginal} · ${golpe.tipo} · POD ${golpe.poderBase}`,
      ),
    );
    golpes.append(item);
  }

  detalhe.append(
    imagemDetalhe,
    criarElemento("h2", lutadorAtual.nome),
    identificacao,
    tipos,
    criarElemento("p", lutadorAtual.descricao),
    atributos,
    criarElemento("h3", "Movimentos"),
    golpes,
  );
}

function normalizarBuscaIfdex(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function obterLutadoresFiltradosIfdex() {
  const busca = normalizarBuscaIfdex(estadoAplicacao.filtroIfdex);

  return LUTADORES.map((lutador, indice) => ({ lutador, indice })).filter(
    ({ lutador }) => {
      if (!busca) {
        return true;
      }

      return normalizarBuscaIfdex(
        [
          lutador.nome,
          lutador.forma,
          lutador.variante,
          lutador.numero,
          ...lutador.tipos,
        ].join(" "),
      ).includes(busca);
    },
  );
}

function navegarIfdex(direcao) {
  const lutadoresFiltrados = obterLutadoresFiltradosIfdex();

  if (!lutadoresFiltrados.length) {
    return;
  }

  const posicaoAtual = lutadoresFiltrados.findIndex(
    ({ indice }) => indice === estadoAplicacao.indiceIfdex,
  );
  const proximaPosicao =
    (Math.max(0, posicaoAtual) + direcao + lutadoresFiltrados.length) %
    lutadoresFiltrados.length;
  selecionarItemIfdex(lutadoresFiltrados[proximaPosicao].indice);
}

function selecionarItemIfdex(indice, deveFocar = true) {
  if (!Number.isInteger(indice) || !LUTADORES[indice]) {
    return;
  }

  estadoAplicacao.indiceIfdex = indice;
  renderizarIfdex();

  if (deveFocar) {
    const botao = selecionar(
      `[data-indice-dex="${indice}"]`,
      exigirElemento("#grade-ifdex"),
    );
    botao?.scrollIntoView({ block: "nearest", inline: "nearest" });
    focarElemento(botao);
  }
}

function criarMembroEquipe(lutador) {
  return {
    lutador,
    vidaAtual: lutador.atributos.vida,
  };
}

function criarParticipante(lutadores) {
  const equipe = lutadores.map(criarMembroEquipe);

  return {
    equipe,
    lutadorAtivoId: equipe[0]?.lutador.id ?? null,
  };
}

function obterMembroAtivo(participante) {
  return participante?.equipe?.find(
    (membro) => membro.lutador.id === participante.lutadorAtivoId,
  ) ?? null;
}

function obterMembrosVivos(participante) {
  return participante?.equipe?.filter((membro) => membro.vidaAtual > 0) ?? [];
}

function trocarMembroAtivo(participante, lutadorId) {
  const proximo = participante?.equipe?.find(
    (membro) => membro.lutador.id === lutadorId && membro.vidaAtual > 0,
  );

  if (!proximo || participante.lutadorAtivoId === lutadorId) {
    return null;
  }

  participante.lutadorAtivoId = lutadorId;
  return proximo;
}

function ativarProximoMembroVivo(participante) {
  const proximo = obterMembrosVivos(participante).find(
    (membro) => membro.lutador.id !== participante.lutadorAtivoId,
  );

  if (!proximo) {
    return null;
  }

  participante.lutadorAtivoId = proximo.lutador.id;
  return proximo;
}

function renderizarCartaoVida(seletor, participante) {
  const cartao = exigirElemento(seletor);
  const membroAtivo = obterMembroAtivo(participante);

  if (!membroAtivo) {
    cartao.replaceChildren();
    return;
  }

  const vidaMaxima = membroAtivo.lutador.atributos.vida;
  const vidaAtual = limitarNumero(membroAtivo.vidaAtual, 0, vidaMaxima);
  const percentual = Math.round((vidaAtual / vidaMaxima) * 100);
  const titulo = criarElemento("strong");
  const nivel = criarElemento("small", " NÍV. 50");
  const equipe = criarElemento(
    "small",
    ` · ${obterMembrosVivos(participante).length}/${participante.equipe.length}`,
  );
  const barra = criarElemento("div", "", ["barra-vida"]);
  const progresso = criarElemento("progress");
  const pontos = criarElemento(
    "small",
    `PV ${vidaAtual}/${vidaMaxima}`,
  );

  titulo.append(
    document.createTextNode(membroAtivo.lutador.nome.toUpperCase()),
    nivel,
    equipe,
  );
  barra.classList.toggle("alerta", percentual < 26);
  progresso.max = vidaMaxima;
  progresso.value = vidaAtual;
  progresso.textContent = `${percentual}%`;
  progresso.setAttribute(
    "aria-label",
    `Pontos de vida de ${membroAtivo.lutador.nome}`,
  );
  progresso.setAttribute("aria-valuetext", `${vidaAtual} de ${vidaMaxima}`);
  barra.append(progresso);
  cartao.replaceChildren(titulo, barra, pontos);
}

function atualizarDisponibilidadeComandos() {
  const batalha = estadoAplicacao.batalha;

  if (!batalha) {
    return;
  }

  const indisponivel = batalha.ocupada || batalha.encerrada;

  selecionarTodos(
    "#menu-acoes-batalha button, #painel-golpes button",
  ).forEach((botao) => {
    botao.disabled = indisponivel;
    botao.setAttribute("aria-disabled", String(botao.disabled));
  });

  selecionarTodos(
    "[data-trocar-lutador]",
    exigirElemento("#lista-equipe-batalha"),
  ).forEach((botao) => {
    const membro = batalha.jogador.equipe.find(
      (item) => item.lutador.id === botao.dataset.trocarLutador,
    );
    const ehAtivo =
      botao.dataset.trocarLutador === batalha.jogador.lutadorAtivoId;

    botao.disabled = indisponivel || ehAtivo || !membro || membro.vidaAtual <= 0;
    botao.setAttribute("aria-disabled", String(botao.disabled));
  });
}

function renderizarGolpes() {
  const batalha = estadoAplicacao.batalha;
  const lista = exigirElemento("#lista-golpes");

  lista.replaceChildren();

  if (!batalha) {
    return;
  }

  const membroAtivo = obterMembroAtivo(batalha.jogador);

  if (!membroAtivo) {
    return;
  }

  lista.dataset.lutadorId = membroAtivo.lutador.id;

  const botoes = membroAtivo.lutador.golpes.map((golpe, indice) => {
    const botao = criarElemento("button", "", ["selecionavel"]);
    const detalhes = criarElemento(
      "small",
      `${golpe.tipo} · ${golpe.poder > 0 ? golpe.poder : "—"}`,
    );

    botao.type = "button";
    botao.dataset.golpe = String(indice);
    botao.setAttribute(
      "aria-label",
      `${golpe.nome}, tipo ${golpe.tipo}, poder ${golpe.poder}`,
    );
    botao.append(document.createTextNode(`${golpe.nome} `), detalhes);

    if (indice === 0) {
      botao.dataset.focoInicial = "";
    }

    return botao;
  });

  lista.append(...botoes);
  atualizarDisponibilidadeComandos();
}

function renderizarEquipeBatalha() {
  const batalha = estadoAplicacao.batalha;
  const lista = exigirElemento("#lista-equipe-batalha");

  lista.replaceChildren();

  if (!batalha) {
    return;
  }

  let focoTrocaDefinido = false;
  const botoes = batalha.jogador.equipe.map((membro) => {
    const ehAtivo = membro.lutador.id === batalha.jogador.lutadorAtivoId;
    const derrotado = membro.vidaAtual <= 0;
    const botao = criarElemento("button", "", [
      "selecionavel",
      "membro-equipe-batalha",
    ]);
    const imagem = criarElemento("img");
    const texto = criarElemento("span");
    const vidaMaxima = membro.lutador.atributos.vida;

    botao.type = "button";
    botao.dataset.trocarLutador = membro.lutador.id;
    botao.classList.toggle("ativo", ehAtivo);
    botao.classList.toggle("derrotado", derrotado);
    botao.setAttribute("aria-current", ehAtivo ? "true" : "false");
    botao.setAttribute(
      "aria-label",
      `${membro.lutador.nome}, ${membro.vidaAtual} de ${vidaMaxima} pontos de vida${ehAtivo ? ", em batalha" : ""}${derrotado ? ", derrotado" : ""}`,
    );

    if (!ehAtivo && !derrotado && !focoTrocaDefinido) {
      botao.dataset.focoInicial = "";
      focoTrocaDefinido = true;
    }

    imagem.src = membro.lutador.sprite;
    imagem.alt = "";
    texto.append(
      criarElemento("strong", membro.lutador.nome),
      criarElemento(
        "small",
        ehAtivo
          ? "EM BATALHA"
          : derrotado
            ? "DERROTADO"
            : `PV ${membro.vidaAtual}/${vidaMaxima}`,
      ),
    );
    botao.append(imagem, texto);
    return botao;
  });

  lista.append(...botoes);
  atualizarDisponibilidadeComandos();
}

function mostrarPainelBatalha(nomePainel = "acoes", { focar = true } = {}) {
  const paineis = {
    acoes: exigirElemento("#menu-acoes-batalha"),
    golpes: exigirElemento("#painel-golpes"),
    pokemon: exigirElemento("#painel-equipe-batalha"),
  };
  const painel = paineis[nomePainel] ?? paineis.acoes;

  estadoAplicacao.painelBatalha =
    Object.hasOwn(paineis, nomePainel) ? nomePainel : "acoes";

  Object.values(paineis).forEach((item) => {
    const visivel = item === painel;
    item.hidden = !visivel;
    item.setAttribute("aria-hidden", String(!visivel));
  });

  atualizarDisponibilidadeComandos();

  if (focar && estadoAplicacao.telaAtual === "batalha") {
    requestAnimationFrame(() => {
      const preferencial = selecionar(
        "[data-foco-inicial]:not([disabled])",
        painel,
      );
      focarElemento(
        preferencial ?? selecionar(".selecionavel:not([disabled])", painel),
      );
    });
  }
}

function renderizarBatalha({ recriarGolpes = false } = {}) {
  const batalha = estadoAplicacao.batalha;

  if (!batalha) {
    return;
  }

  const spriteInimigo = exigirElemento("#sprite-inimigo");
  const spriteJogador = exigirElemento("#sprite-jogador");
  const membroInimigo = obterMembroAtivo(batalha.inimigo);
  const membroJogador = obterMembroAtivo(batalha.jogador);

  if (!membroInimigo || !membroJogador) {
    return;
  }

  spriteInimigo.src = membroInimigo.lutador.sprite;
  spriteInimigo.alt = `${membroInimigo.lutador.nome}, ${membroInimigo.lutador.forma}`;
  spriteJogador.src = membroJogador.lutador.sprite;
  spriteJogador.alt = `${membroJogador.lutador.nome}, ${membroJogador.lutador.forma}`;

  renderizarCartaoVida("#cartao-inimigo", batalha.inimigo);
  renderizarCartaoVida("#cartao-jogador", batalha.jogador);

  const lista = exigirElemento("#lista-golpes");

  if (
    recriarGolpes ||
    lista.dataset.lutadorId !== membroJogador.lutador.id
  ) {
    renderizarGolpes();
  } else {
    atualizarDisponibilidadeComandos();
  }

  renderizarEquipeBatalha();
}

function mostrarMensagemBatalha(texto) {
  exigirElemento("#mensagem-batalha").textContent = String(texto);
}

function ocultarResultadoBatalha() {
  const resultado = exigirElemento("#resultado-batalha");
  const conteudo = exigirElemento("#conteudo-batalha");
  const botaoRevanche = exigirElemento("#botao-revanche");

  resultado.hidden = true;
  conteudo.inert = false;
  conteudo.removeAttribute("aria-hidden");
  botaoRevanche.disabled = false;
  botaoRevanche.textContent = "REVANCHE";
}

function mostrarResultadoBatalha(vitoria) {
  const resultado = exigirElemento("#resultado-batalha");
  const conteudo = exigirElemento("#conteudo-batalha");
  const titulo = exigirElemento("#titulo-resultado");
  const texto = exigirElemento("#texto-resultado");
  const botaoRevanche = exigirElemento("#botao-revanche");
  const ehMultijogador = estadoAplicacao.modoBatalha === "multijogador";

  titulo.textContent = vitoria ? "VITÓRIA!" : "DERROTA";
  texto.textContent = vitoria
    ? "Você venceu a batalha."
    : "Seu IFighter precisa de uma revanche.";
  botaoRevanche.textContent = ehMultijogador
    ? "SOLICITAR REVANCHE"
    : "REVANCHE";
  botaoRevanche.disabled = false;
  conteudo.inert = true;
  conteudo.setAttribute("aria-hidden", "true");
  resultado.hidden = false;

  requestAnimationFrame(() => focarElemento(botaoRevanche));
}

function cancelarTurnoLocal() {
  estadoAplicacao.identificadorTurnoLocal += 1;

  if (estadoAplicacao.batalha?.modo === "local") {
    estadoAplicacao.batalha.ocupada = false;
  }
}

function iniciarSelecaoLocal() {
  cancelarTurnoLocal();
  estadoAplicacao.modoBatalha = "local";
  estadoAplicacao.batalha = null;
  estadoAplicacao.multijogador.equipeConfirmada = false;
  renderizarEquipe();
  irParaTela("equipe");
}

function iniciarBatalhaLocal() {
  const idsJogador = estadoAplicacao.lutadoresSelecionadosIds;
  const equipeJogador = idsJogador.map(obterLutador).filter(Boolean);

  if (
    equipeJogador.length !== TAMANHO_EQUIPE ||
    new Set(idsJogador).size !== TAMANHO_EQUIPE ||
    LUTADORES.length < TAMANHO_EQUIPE * 2
  ) {
    mostrarAviso("Escolha três IFighters diferentes para iniciar a batalha.");
    return;
  }

  cancelarTurnoLocal();
  const idsJogadorSet = new Set(idsJogador);
  const indiceInicial = LUTADORES.findIndex(
    (lutador) => lutador.id === idsJogador[0],
  );
  const equipeInimiga = [];

  for (
    let deslocamento = 1;
    deslocamento <= LUTADORES.length;
    deslocamento += 1
  ) {
    const candidato =
      LUTADORES[(indiceInicial + deslocamento) % LUTADORES.length];

    if (!idsJogadorSet.has(candidato.id)) {
      equipeInimiga.push(candidato);
    }

    if (equipeInimiga.length === TAMANHO_EQUIPE) {
      break;
    }
  }

  estadoAplicacao.modoBatalha = "local";
  estadoAplicacao.batalha = {
    modo: "local",
    jogador: criarParticipante(equipeJogador),
    inimigo: criarParticipante(equipeInimiga),
    ocupada: false,
    encerrada: false,
  };

  ocultarResultadoBatalha();
  renderizarBatalha({ recriarGolpes: true });
  irParaTela("batalha");
  mostrarPainelBatalha("acoes", { focar: false });
  const inimigoAtivo = obterMembroAtivo(estadoAplicacao.batalha.inimigo);
  mostrarMensagemBatalha(
    `${inimigoAtivo.lutador.nome} desafia você! O que você fará?`,
  );
}

function turnoLocalAindaValido(identificador, batalha) {
  return (
    estadoAplicacao.identificadorTurnoLocal === identificador &&
    estadoAplicacao.batalha === batalha &&
    estadoAplicacao.telaAtual === "batalha" &&
    batalha.modo === "local"
  );
}

async function usarGolpeLocal(indiceGolpe) {
  const batalha = estadoAplicacao.batalha;
  const membroJogador = obterMembroAtivo(batalha?.jogador);
  const golpeJogador = membroJogador?.lutador.golpes[indiceGolpe];

  if (
    !batalha ||
    batalha.modo !== "local" ||
    batalha.ocupada ||
    batalha.encerrada ||
    !golpeJogador
  ) {
    return;
  }

  batalha.ocupada = true;
  mostrarPainelBatalha("acoes", { focar: false });
  atualizarDisponibilidadeComandos();
  const identificador = ++estadoAplicacao.identificadorTurnoLocal;
  const acaoJogador = criarAcaoLocal(
    "jogador",
    "inimigo",
    golpeJogador,
    batalha,
  );
  const acaoInimigo = criarAcaoInimigaLocal(batalha);
  const acoesOrdenadas = REGRAS_BATALHA.ordenarAcoes(
    acaoJogador,
    acaoInimigo,
  );

  for (const acao of acoesOrdenadas) {
    if (
      !turnoLocalAindaValido(identificador, batalha) ||
      (await executarAtaqueLocal(acao, identificador, batalha))
    ) {
      return;
    }
  }

  concluirTurnoLocal(identificador, batalha);
}

function criarAcaoLocal(ladoAtacante, ladoAlvo, golpe, batalha) {
  const atacante = obterMembroAtivo(batalha[ladoAtacante]);

  return {
    atacante: atacante.lutador,
    atacanteId: atacante.lutador.id,
    golpe,
    ladoAtacante,
    ladoAlvo,
  };
}

function criarAcaoInimigaLocal(batalha) {
  const membroInimigo = obterMembroAtivo(batalha.inimigo);
  const golpes = membroInimigo.lutador.golpes;
  const golpe = golpes[Math.floor(Math.random() * golpes.length)];

  return criarAcaoLocal("inimigo", "jogador", golpe, batalha);
}

async function resolverDesmaioLocal(lado, identificador, batalha) {
  const participante = batalha[lado];
  const membroDerrotado = obterMembroAtivo(participante);

  if (!membroDerrotado || membroDerrotado.vidaAtual > 0) {
    return false;
  }

  mostrarMensagemBatalha(`${membroDerrotado.lutador.nome} foi derrotado!`);
  await aguardarAnimacao(DURACOES.erroGolpe);

  if (!turnoLocalAindaValido(identificador, batalha)) {
    return true;
  }

  const proximo = ativarProximoMembroVivo(participante);

  if (!proximo) {
    batalha.encerrada = true;
    batalha.ocupada = false;
    renderizarBatalha();
    mostrarResultadoBatalha(lado === "inimigo");
    return true;
  }

  renderizarBatalha({ recriarGolpes: lado === "jogador" });
  mostrarMensagemBatalha(`${proximo.lutador.nome} entrou na batalha!`);
  await aguardarAnimacao(DURACOES.anuncioGolpe);
  return !turnoLocalAindaValido(identificador, batalha);
}

async function executarAtaqueLocal(acao, identificador, batalha) {
  const membroAtacante = obterMembroAtivo(batalha[acao.ladoAtacante]);

  if (
    !membroAtacante ||
    membroAtacante.vidaAtual <= 0 ||
    membroAtacante.lutador.id !== acao.atacanteId
  ) {
    return false;
  }

  mostrarMensagemBatalha(
    `${membroAtacante.lutador.nome} usou ${acao.golpe.nome}!`,
  );
  await aguardarAnimacao(DURACOES.anuncioGolpe);

  if (!turnoLocalAindaValido(identificador, batalha)) {
    return true;
  }

  if (!REGRAS_BATALHA.golpeAcertou(acao.golpe)) {
    mostrarMensagemBatalha("O ataque errou!");
    await aguardarAnimacao(DURACOES.erroGolpe);
    return !turnoLocalAindaValido(identificador, batalha);
  }

  const membroAlvo = obterMembroAtivo(batalha[acao.ladoAlvo]);

  if (!membroAlvo) {
    return true;
  }

  const dano = REGRAS_BATALHA.calcularDano(
    membroAtacante.lutador,
    membroAlvo.lutador,
    acao.golpe,
  );
  membroAlvo.vidaAtual = Math.max(0, membroAlvo.vidaAtual - dano);
  renderizarBatalha();
  mostrarMensagemBatalha(`O ataque causou ${dano} de dano.`);
  await aguardarAnimacao(DURACOES.dano);

  if (!turnoLocalAindaValido(identificador, batalha)) {
    return true;
  }

  return resolverDesmaioLocal(acao.ladoAlvo, identificador, batalha);
}

function concluirTurnoLocal(identificador, batalha) {
  if (!turnoLocalAindaValido(identificador, batalha) || batalha.encerrada) {
    return;
  }

  batalha.ocupada = false;
  renderizarBatalha();
  mostrarMensagemBatalha("O que você fará agora?");
  mostrarPainelBatalha("acoes");
}

async function trocarLutadorLocal(lutadorId) {
  const batalha = estadoAplicacao.batalha;
  const membroAtual = obterMembroAtivo(batalha?.jogador);
  const proximo = batalha?.jogador.equipe.find(
    (membro) => membro.lutador.id === lutadorId,
  );

  if (
    !batalha ||
    batalha.modo !== "local" ||
    batalha.ocupada ||
    batalha.encerrada ||
    !membroAtual ||
    !proximo ||
    proximo.vidaAtual <= 0 ||
    proximo === membroAtual
  ) {
    return;
  }

  batalha.ocupada = true;
  const identificador = ++estadoAplicacao.identificadorTurnoLocal;
  trocarMembroAtivo(batalha.jogador, lutadorId);
  mostrarPainelBatalha("acoes", { focar: false });
  renderizarBatalha({ recriarGolpes: true });
  mostrarMensagemBatalha(
    `${membroAtual.lutador.nome}, volte! ${proximo.lutador.nome}, eu escolho você!`,
  );
  await aguardarAnimacao(DURACOES.anuncioGolpe);

  if (!turnoLocalAindaValido(identificador, batalha)) {
    return;
  }

  const acaoInimiga = criarAcaoInimigaLocal(batalha);

  if (await executarAtaqueLocal(acaoInimiga, identificador, batalha)) {
    return;
  }

  concluirTurnoLocal(identificador, batalha);
}

function normalizarCodigoSala(valor) {
  return String(valor ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function codigoSalaEhValido(codigo) {
  return CODIGO_SALA_VALIDO.test(codigo);
}

function validarCodigoRecebido(codigo) {
  const codigoNormalizado = normalizarCodigoSala(codigo);
  return codigoSalaEhValido(codigoNormalizado) ? codigoNormalizado : null;
}

function validarEstadoRemoto(valor, quantidadeMinimaJogadores = 1) {
  if (
    !ehObjeto(valor) ||
    !["aguardando", "selecao", "batalha", "encerrada"].includes(
      valor.situacao,
    ) ||
    !Number.isInteger(valor.numeroTurno) ||
    valor.numeroTurno < 0 ||
    !Array.isArray(valor.jogadores) ||
    valor.jogadores.length < quantidadeMinimaJogadores ||
    valor.jogadores.length > 2
  ) {
    return null;
  }

  const codigo = validarCodigoRecebido(valor.codigo);

  if (!codigo) {
    return null;
  }

  const jogadores = [];
  const identificadores = new Set();

  for (const jogador of valor.jogadores) {
    if (
      !ehObjeto(jogador) ||
      typeof jogador.id !== "string" ||
      !jogador.id ||
      identificadores.has(jogador.id) ||
      typeof jogador.lutadorAtivoId !== "string" ||
      !Array.isArray(jogador.equipe) ||
      jogador.equipe.length !== TAMANHO_EQUIPE ||
      typeof jogador.revanche !== "boolean"
    ) {
      return null;
    }

    const idsEquipe = new Set();
    const equipe = [];

    for (const membro of jogador.equipe) {
      const lutador = ehObjeto(membro) ? obterLutador(membro.lutadorId) : null;

      if (
        !lutador ||
        idsEquipe.has(lutador.id) ||
        !Number.isFinite(membro.vidaAtual) ||
        membro.vidaAtual < 0 ||
        membro.vidaAtual > lutador.atributos.vida
      ) {
        return null;
      }

      idsEquipe.add(lutador.id);
      equipe.push({
        lutadorId: lutador.id,
        vidaAtual: membro.vidaAtual,
      });
    }

    if (!idsEquipe.has(jogador.lutadorAtivoId)) {
      return null;
    }

    identificadores.add(jogador.id);
    jogadores.push({
      id: jogador.id,
      lutadorAtivoId: jogador.lutadorAtivoId,
      equipe,
      revanche: jogador.revanche,
      conectado: jogador.conectado !== false,
    });
  }

  return {
    codigo,
    situacao: valor.situacao,
    numeroTurno: valor.numeroTurno,
    jogadores,
  };
}

function validarRegistros(valor) {
  if (
    !Array.isArray(valor) ||
    valor.length > 20 ||
    valor.some(
      (registro) => typeof registro !== "string" || registro.length > 500,
    )
  ) {
    return null;
  }

  return valor;
}

function obterParticipantesRemotos(estadoRemoto) {
  const jogadorRemoto = estadoRemoto.jogadores.find(
    (jogador) => jogador.id === estadoAplicacao.multijogador.jogadorId,
  );
  const inimigoRemoto = estadoRemoto.jogadores.find(
    (jogador) => jogador.id !== estadoAplicacao.multijogador.jogadorId,
  );

  if (!jogadorRemoto || !inimigoRemoto) {
    return null;
  }

  const criarParticipanteRemoto = (jogador) => ({
    id: jogador.id,
    equipe: jogador.equipe.map((membro) => ({
      lutador: obterLutador(membro.lutadorId),
      vidaAtual: membro.vidaAtual,
    })),
    lutadorAtivoId: jogador.lutadorAtivoId,
    revanche: jogador.revanche,
    conectado: jogador.conectado,
  });

  return {
    jogador: criarParticipanteRemoto(jogadorRemoto),
    inimigo: criarParticipanteRemoto(inimigoRemoto),
  };
}

function aplicarEstadoRemoto(
  estadoRemoto,
  { encerrada = false, vencedorId = null } = {},
) {
  const participantes = obterParticipantesRemotos(estadoRemoto);

  if (!participantes) {
    return false;
  }

  const turnoAnterior =
    estadoAplicacao.multijogador.estadoRemoto?.numeroTurno ?? -1;

  if (estadoRemoto.numeroTurno < turnoAnterior) {
    return false;
  }

  estadoAplicacao.multijogador.estadoRemoto = estadoRemoto;
  estadoAplicacao.multijogador.codigoSala = estadoRemoto.codigo;
  estadoAplicacao.batalha = {
    modo: "multijogador",
    jogador: participantes.jogador,
    inimigo: participantes.inimigo,
    ocupada: estadoAplicacao.multijogador.aguardandoAcao,
    encerrada,
    vencedorId,
    numeroTurno: estadoRemoto.numeroTurno,
  };
  renderizarBatalha();
  return true;
}

function mostrarAcoesSala() {
  exigirElemento("#acoes-sala").hidden = false;
  exigirElemento("#espera-sala").hidden = true;
  definirControlesSalaHabilitados(true);

  if (estadoAplicacao.telaAtual === "multijogador") {
    agendarFocoInicial("multijogador");
  }
}

function mostrarEsperaSala(mensagem, codigo = null) {
  exigirElemento("#acoes-sala").hidden = true;
  exigirElemento("#espera-sala").hidden = false;
  exigirElemento("#status-sala").textContent = mensagem;
  exigirElemento("#codigo-sala-exibido").textContent = codigo ?? "------";
}

function definirControlesSalaHabilitados(habilitados) {
  selecionarTodos(
    "#acoes-sala button, #codigo-sala",
  ).forEach((controle) => {
    controle.disabled = !habilitados;
  });
}

const CAMINHO_API_MULTIJOGADOR = "/api/multijogador";

async function requisitarApiMultijogador(
  caminho,
  {
    metodo = "GET",
    corpo = null,
    sessao = null,
    sinal = undefined,
    manterAoSair = false,
  } = {},
) {
  if (!window.location.host) {
    throw new Error("Abra o jogo pelo servidor Node para usar o multijogador.");
  }

  const cabecalhos = { Accept: "application/json" };
  if (corpo !== null) {
    cabecalhos["Content-Type"] = "application/json";
  }
  if (sessao?.sessaoId && sessao?.chaveSessao) {
    cabecalhos.Authorization = `Bearer ${sessao.chaveSessao}`;
  }

  const controlador = new AbortController();
  const abortarPeloSinalExterno = () => controlador.abort();
  if (sinal?.aborted) {
    controlador.abort();
  } else {
    sinal?.addEventListener("abort", abortarPeloSinalExterno, { once: true });
  }
  const temporizador = window.setTimeout(
    () => controlador.abort(),
    DURACOES.conexao,
  );

  try {
    const resposta = await fetch(caminho, {
      body: corpo === null ? undefined : JSON.stringify(corpo),
      cache: "no-store",
      headers: cabecalhos,
      keepalive: manterAoSair,
      method: metodo,
      signal: controlador.signal,
    });
    const texto = await resposta.text();
    let dados = {};

    if (texto) {
      try {
        dados = JSON.parse(texto);
      } catch {
        throw new Error("O servidor enviou uma resposta ilegível.");
      }
    }

    if (!resposta.ok) {
      const erro = new Error(
        typeof dados.erro === "string"
          ? dados.erro
          : "O servidor recusou a solicitação.",
      );
      erro.codigoHttp = resposta.status;
      erro.dados = dados;
      throw erro;
    }

    return dados;
  } finally {
    clearTimeout(temporizador);
    sinal?.removeEventListener("abort", abortarPeloSinalExterno);
  }
}

function validarLoteEventos(sessao, lote) {
  if (
    !ehObjeto(lote) ||
    !Array.isArray(lote.eventos) ||
    lote.eventosPerdidos === true
  ) {
    throw new Error("A sincronização da partida ficou incompleta.");
  }

  for (const mensagem of lote.eventos) {
    if (
      !ehObjeto(mensagem) ||
      !Number.isSafeInteger(mensagem.id) ||
      mensagem.id <= 0 ||
      typeof mensagem.tipo !== "string" ||
      !Object.values(EVENTOS).includes(mensagem.tipo) ||
      (mensagem.dados !== undefined && !ehObjeto(mensagem.dados))
    ) {
      throw new Error("O servidor enviou um evento fora do protocolo.");
    }

    if (mensagem.id <= sessao.ultimoEventoId) {
      continue;
    }

    sessao.ultimoEventoId = mensagem.id;
    tratarEventoMultijogador(mensagem.tipo, mensagem.dados ?? {});
  }
}

function cancelarPolling(sessao = estadoAplicacao.multijogador) {
  sessao.pollingAtivo = false;
  if (sessao.temporizadorPolling !== null) {
    clearTimeout(sessao.temporizadorPolling);
    sessao.temporizadorPolling = null;
  }
  sessao.abortadorRequisicao?.abort();
  sessao.abortadorRequisicao = null;
}

function cancelarTemporizadorReconexao() {
  const temporizador = estadoAplicacao.multijogador.temporizadorReconexao;

  if (temporizador !== null) {
    clearTimeout(temporizador);
    estadoAplicacao.multijogador.temporizadorReconexao = null;
  }
}

function agendarReconexao() {
  const multijogador = estadoAplicacao.multijogador;

  if (!multijogador.reconectando || multijogador.temporizadorReconexao !== null) {
    return;
  }

  if (multijogador.tentativasReconexao >= 6) {
    mostrarAviso("Não foi possível retomar a conexão com a partida.");
    sairDoMultijogador("jogar");
    return;
  }

  multijogador.tentativasReconexao += 1;
  const espera = Math.min(
    DURACOES.intervaloReconexao * multijogador.tentativasReconexao,
    3000,
  );

  multijogador.temporizadorReconexao = window.setTimeout(() => {
    multijogador.temporizadorReconexao = null;
    void retomarMultijogador();
  }, espera);
}

async function retomarMultijogador() {
  if (!estadoAplicacao.multijogador.reconectando) {
    return;
  }

  try {
    await conectarMultijogador();
  } catch {
    agendarReconexao();
  }
}

function manipularPerdaDaSessao(sessao) {
  if (estadoAplicacao.multijogador !== sessao) {
    return;
  }

  const multijogador = estadoAplicacao.multijogador;
  const estavaEmFluxoMultijogador =
    estadoAplicacao.modoBatalha === "multijogador";

  cancelarPolling(multijogador);
  multijogador.sessaoId = null;
  multijogador.chaveSessao = null;
  multijogador.promessaConexao = null;

  if (
    estavaEmFluxoMultijogador &&
    multijogador.codigoSala &&
    multijogador.jogadorId &&
    multijogador.tokenReconexao
  ) {
    multijogador.reconectando = true;
    multijogador.situacao = "reconectando";

    if (estadoAplicacao.batalha) {
      estadoAplicacao.batalha.ocupada = true;
      atualizarDisponibilidadeComandos();
      mostrarMensagemBatalha("Conexão perdida. Tentando retomar a partida…");
    } else {
      mostrarAviso("Conexão perdida. Tentando retomar a sala…");
    }

    agendarReconexao();
    return;
  }

  estadoAplicacao.multijogador = criarEstadoMultijogador();

  if (estavaEmFluxoMultijogador) {
    estadoAplicacao.batalha = null;
    estadoAplicacao.modoBatalha = null;
    ocultarResultadoBatalha();
    mostrarAviso("A conexão com o servidor foi encerrada.");
    estadoAplicacao.historicoTelas = [];
    irParaTela("jogar", { registrarHistorico: false });
  }
}

async function conectarMultijogador() {
  const multijogador = estadoAplicacao.multijogador;
  if (multijogador.sessaoId && multijogador.chaveSessao) {
    return multijogador;
  }

  if (multijogador.promessaConexao) {
    return multijogador.promessaConexao;
  }

  multijogador.situacao = "conectando";
  const promessa = (async () => {
    const resposta = await requisitarApiMultijogador(
      `${CAMINHO_API_MULTIJOGADOR}/sessoes`,
      { metodo: "POST" },
    );
    if (
      typeof resposta.sessaoId !== "string" ||
      typeof resposta.chaveSessao !== "string" ||
      !Array.isArray(resposta.eventos)
    ) {
      throw new Error("O servidor não criou uma sessão válida.");
    }

    if (estadoAplicacao.multijogador !== multijogador) {
      void encerrarSessaoRemota({
        chaveSessao: resposta.chaveSessao,
        sessaoId: resposta.sessaoId,
      });
      throw new Error("A conexão foi cancelada.");
    }

    Object.assign(multijogador, {
      chaveSessao: resposta.chaveSessao,
      falhasConsecutivas: 0,
      filaEnvio: Promise.resolve(),
      intervaloPollingMs: Number.isInteger(resposta.intervaloPollingMs)
        ? limitarNumero(resposta.intervaloPollingMs, 150, 2_000)
        : 300,
      pollingAtivo: true,
      sessaoId: resposta.sessaoId,
      situacao: "conectado",
      ultimoEventoId: 0,
    });
    validarLoteEventos(multijogador, resposta);
    agendarPolling(multijogador, 0);
    return multijogador;
  })();

  multijogador.promessaConexao = promessa;

  try {
    return await promessa;
  } catch (erro) {
    if (estadoAplicacao.multijogador === multijogador) {
      cancelarPolling(multijogador);
      void encerrarSessaoRemota(multijogador);
      multijogador.sessaoId = null;
      multijogador.chaveSessao = null;
    }
    throw erro;
  } finally {
    if (multijogador.promessaConexao === promessa) {
      multijogador.promessaConexao = null;
    }
  }
}

function agendarPolling(sessao, atraso = sessao.intervaloPollingMs) {
  if (
    estadoAplicacao.multijogador !== sessao ||
    !sessao.pollingAtivo ||
    sessao.temporizadorPolling !== null
  ) {
    return;
  }

  sessao.temporizadorPolling = window.setTimeout(() => {
    sessao.temporizadorPolling = null;
    void consultarEventosMultijogador(sessao);
  }, atraso);
}

async function consultarEventosMultijogador(sessao) {
  if (
    estadoAplicacao.multijogador !== sessao ||
    !sessao.pollingAtivo ||
    !sessao.sessaoId
  ) {
    return;
  }

  const controlador = new AbortController();
  sessao.abortadorRequisicao = controlador;
  try {
    const resposta = await requisitarApiMultijogador(
      `${CAMINHO_API_MULTIJOGADOR}/sessoes/${sessao.sessaoId}` +
        `/eventos?desde=${sessao.ultimoEventoId}`,
      { sessao, sinal: controlador.signal },
    );
    validarLoteEventos(sessao, resposta);
    sessao.falhasConsecutivas = 0;
  } catch (erro) {
    if (controlador.signal.aborted || estadoAplicacao.multijogador !== sessao) {
      return;
    }

    sessao.falhasConsecutivas += 1;
    if (erro?.codigoHttp === 401 || sessao.falhasConsecutivas >= 3) {
      manipularPerdaDaSessao(sessao);
      return;
    }
  } finally {
    if (sessao.abortadorRequisicao === controlador) {
      sessao.abortadorRequisicao = null;
    }
  }

  agendarPolling(
    sessao,
    sessao.falhasConsecutivas
      ? Math.min(sessao.intervaloPollingMs * 3, 2_000)
      : sessao.intervaloPollingMs,
  );
}

async function enviarEventoHttp(sessao, tipo, dados) {
  try {
    const resposta = await requisitarApiMultijogador(
      `${CAMINHO_API_MULTIJOGADOR}/sessoes/${sessao.sessaoId}/eventos`,
      {
        corpo: { dados, desde: sessao.ultimoEventoId, tipo },
        metodo: "POST",
        sessao,
      },
    );
    if (estadoAplicacao.multijogador !== sessao) {
      return;
    }
    validarLoteEventos(sessao, resposta);
    sessao.falhasConsecutivas = 0;
  } catch (erro) {
    if (
      estadoAplicacao.multijogador === sessao &&
      ehObjeto(erro?.dados) &&
      Array.isArray(erro.dados.eventos)
    ) {
      try {
        validarLoteEventos(sessao, erro.dados);
      } catch {
        // A falha original continua sendo a informação mais útil.
      }
    }

    if (erro?.codigoHttp === 401) {
      manipularPerdaDaSessao(sessao);
    } else if (!Number.isInteger(erro?.codigoHttp)) {
      sessao.falhasConsecutivas += 1;
    }
  }
}

function enviarEvento(tipo, dados = {}) {
  const sessao = estadoAplicacao.multijogador;

  if (!sessao.sessaoId || !sessao.chaveSessao) {
    mostrarAviso("A conexão com o servidor não está disponível.");
    return false;
  }

  sessao.filaEnvio = sessao.filaEnvio.then(() =>
    enviarEventoHttp(sessao, tipo, dados),
  );
  return true;
}

async function encerrarSessaoRemota(sessao, { manterAoSair = false } = {}) {
  if (!sessao?.sessaoId || !sessao?.chaveSessao) {
    return;
  }

  try {
    await requisitarApiMultijogador(
      `${CAMINHO_API_MULTIJOGADOR}/sessoes/${sessao.sessaoId}`,
      {
        manterAoSair,
        metodo: "DELETE",
        sessao,
      },
    );
  } catch {
    // O servidor também expira sessões que deixam de fazer polling.
  }
}

async function sairEEncerrarSessao(sessao) {
  try {
    await requisitarApiMultijogador(
      `${CAMINHO_API_MULTIJOGADOR}/sessoes/${sessao.sessaoId}/eventos`,
      {
        corpo: {
          dados: {},
          desde: sessao.ultimoEventoId,
          tipo: EVENTOS.SAIR_SALA,
        },
        metodo: "POST",
        sessao,
      },
    );
  } catch {
    // A expiração da sessão também libera a sala se o aviso falhar.
  } finally {
    await encerrarSessaoRemota(sessao);
  }
}

function desconectarMultijogador(
  { avisarServidor = true, preservarCredenciais = false } = {},
) {
  const sessao = estadoAplicacao.multijogador;

  cancelarTemporizadorReconexao();
  cancelarPolling(sessao);

  if (
    avisarServidor &&
    estadoAplicacao.multijogador.codigoSala &&
    sessao.sessaoId
  ) {
    void sairEEncerrarSessao(sessao);
  } else {
    void encerrarSessaoRemota(sessao);
  }

  if (!preservarCredenciais) {
    limparCredenciaisReconexao();
  }

  estadoAplicacao.multijogador = criarEstadoMultijogador();
}

async function abrirMultijogador() {
  cancelarTurnoLocal();
  estadoAplicacao.modoBatalha = "multijogador";
  mostrarEsperaSala("Conectando…");
  irParaTela("multijogador");
  const sessaoEsperada = estadoAplicacao.multijogador;
  const promessaConexao = conectarMultijogador();

  try {
    const sessao = await promessaConexao;

    if (
      estadoAplicacao.multijogador !== sessao ||
      estadoAplicacao.telaAtual !== "multijogador"
    ) {
      return;
    }

    mostrarAcoesSala();
  } catch (erro) {
    if (
      estadoAplicacao.modoBatalha !== "multijogador" ||
      estadoAplicacao.multijogador !== sessaoEsperada
    ) {
      return;
    }

    mostrarAcoesSala();
    mostrarAviso(erro instanceof Error ? erro.message : "Falha de conexão.");
  }
}

async function criarSala() {
  definirControlesSalaHabilitados(false);
  const sessaoEsperada = estadoAplicacao.multijogador;
  const promessaConexao = conectarMultijogador();

  try {
    const sessao = await promessaConexao;

    if (estadoAplicacao.multijogador !== sessao) {
      return;
    }

    mostrarEsperaSala("Criando sala…");

    if (!enviarEvento(EVENTOS.CRIAR_SALA)) {
      mostrarAcoesSala();
    }
  } catch (erro) {
    if (
      estadoAplicacao.modoBatalha !== "multijogador" ||
      estadoAplicacao.multijogador !== sessaoEsperada
    ) {
      return;
    }

    mostrarAcoesSala();
    mostrarAviso(erro instanceof Error ? erro.message : "Falha de conexão.");
  }
}

async function entrarSala() {
  const campoCodigo = exigirElemento("#codigo-sala");
  const codigo = normalizarCodigoSala(campoCodigo.value);
  campoCodigo.value = codigo;

  if (!codigoSalaEhValido(codigo)) {
    campoCodigo.setAttribute("aria-invalid", "true");
    mostrarAviso("Informe um código de sala com seis letras ou números.");
    focarElemento(campoCodigo);
    return;
  }

  campoCodigo.removeAttribute("aria-invalid");
  definirControlesSalaHabilitados(false);
  const sessaoEsperada = estadoAplicacao.multijogador;
  const promessaConexao = conectarMultijogador();

  try {
    const sessao = await promessaConexao;

    if (estadoAplicacao.multijogador !== sessao) {
      return;
    }

    mostrarEsperaSala("Entrando na sala…", codigo);

    if (!enviarEvento(EVENTOS.ENTRAR_SALA, { codigo })) {
      mostrarAcoesSala();
    }
  } catch (erro) {
    if (
      estadoAplicacao.modoBatalha !== "multijogador" ||
      estadoAplicacao.multijogador !== sessaoEsperada
    ) {
      return;
    }

    mostrarAcoesSala();
    mostrarAviso(erro instanceof Error ? erro.message : "Falha de conexão.");
  }
}

async function copiarCodigoSala() {
  const codigo = estadoAplicacao.multijogador.codigoSala;

  if (!codigo) {
    mostrarAviso("Ainda não há um código de sala para copiar.");
    return;
  }

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Área de transferência indisponível.");
    }

    await navigator.clipboard.writeText(codigo);
    mostrarAviso("Código da sala copiado.");
  } catch {
    mostrarAviso(`Código da sala: ${codigo}`);
  }
}

function sairDoMultijogador(telaDestino = "jogar") {
  desconectarMultijogador();
  cancelarTurnoLocal();
  estadoAplicacao.batalha = null;
  estadoAplicacao.modoBatalha = null;
  estadoAplicacao.historicoTelas = [];
  ocultarResultadoBatalha();
  irParaTela(telaDestino, { registrarHistorico: false });
}

function confirmarEquipe() {
  const lutadorIds = estadoAplicacao.lutadoresSelecionadosIds;

  if (
    lutadorIds.length !== TAMANHO_EQUIPE ||
    new Set(lutadorIds).size !== TAMANHO_EQUIPE ||
    lutadorIds.some((lutadorId) => !obterLutador(lutadorId))
  ) {
    mostrarAviso("Selecione exatamente três IFighters diferentes.");
    return;
  }

  if (estadoAplicacao.modoBatalha === "multijogador") {
    if (
      estadoAplicacao.multijogador.equipeConfirmada ||
      estadoAplicacao.multijogador.oponenteAusente
    ) {
      return;
    }

    if (
      enviarEvento(EVENTOS.SELECIONAR_EQUIPE, {
        lutadorIds: [...lutadorIds],
      })
    ) {
      estadoAplicacao.multijogador.equipeConfirmada = true;
      renderizarEquipe();
      mostrarAviso("Equipe confirmada. Aguardando o adversário.");
    }
    return;
  }

  iniciarBatalhaLocal();
}

function usarGolpeMultijogador(indiceGolpe) {
  const batalha = estadoAplicacao.batalha;
  const membroAtivo = obterMembroAtivo(batalha?.jogador);

  if (
    !batalha ||
    batalha.modo !== "multijogador" ||
    batalha.encerrada ||
    estadoAplicacao.multijogador.aguardandoAcao ||
    !membroAtivo?.lutador.golpes[indiceGolpe]
  ) {
    return;
  }

  if (
    enviarEvento(EVENTOS.ESCOLHER_ACAO, {
      acao: { tipo: "golpe", indiceGolpe },
    })
  ) {
    estadoAplicacao.multijogador.aguardandoAcao = true;
    batalha.ocupada = true;
    mostrarPainelBatalha("acoes", { focar: false });
    atualizarDisponibilidadeComandos();
    mostrarMensagemBatalha("Ataque enviado. Aguardando o adversário.");
  }
}

function trocarLutadorMultijogador(lutadorId) {
  const batalha = estadoAplicacao.batalha;
  const membro = batalha?.jogador.equipe.find(
    (item) => item.lutador.id === lutadorId,
  );

  if (
    !batalha ||
    batalha.modo !== "multijogador" ||
    batalha.encerrada ||
    estadoAplicacao.multijogador.aguardandoAcao ||
    !membro ||
    membro.vidaAtual <= 0 ||
    lutadorId === batalha.jogador.lutadorAtivoId
  ) {
    return;
  }

  if (
    enviarEvento(EVENTOS.ESCOLHER_ACAO, {
      acao: { tipo: "troca", lutadorId },
    })
  ) {
    estadoAplicacao.multijogador.aguardandoAcao = true;
    batalha.ocupada = true;
    mostrarPainelBatalha("acoes", { focar: false });
    atualizarDisponibilidadeComandos();
    mostrarMensagemBatalha("Troca enviada. Aguardando o adversário.");
  }
}

function usarGolpe(indiceGolpe) {
  if (!Number.isInteger(indiceGolpe) || indiceGolpe < 0) {
    return;
  }

  if (estadoAplicacao.modoBatalha === "multijogador") {
    usarGolpeMultijogador(indiceGolpe);
  } else {
    void usarGolpeLocal(indiceGolpe);
  }
}

function trocarLutador(lutadorId) {
  if (typeof lutadorId !== "string" || !lutadorId) {
    return;
  }

  if (estadoAplicacao.modoBatalha === "multijogador") {
    trocarLutadorMultijogador(lutadorId);
  } else {
    void trocarLutadorLocal(lutadorId);
  }
}

function iniciarBatalhaMultijogador(dados) {
  const estadoRemoto = validarEstadoRemoto(dados?.estado, 2);

  if (!estadoRemoto) {
    mostrarAviso("O servidor enviou um estado de batalha inválido.");
    return;
  }

  estadoAplicacao.modoBatalha = "multijogador";
  estadoAplicacao.multijogador.situacao = "batalhando";
  estadoAplicacao.multijogador.aguardandoAcao = false;
  estadoAplicacao.multijogador.revancheSolicitada = false;
  estadoAplicacao.multijogador.equipeConfirmada = false;
  estadoAplicacao.multijogador.estadoRemoto = null;
  ocultarResultadoBatalha();

  if (!aplicarEstadoRemoto(estadoRemoto)) {
    mostrarAviso("Seu jogador não aparece no estado recebido.");
    return;
  }

  renderizarBatalha({ recriarGolpes: true });
  estadoAplicacao.historicoTelas = [];
  irParaTela("batalha", { registrarHistorico: false });
  mostrarPainelBatalha("acoes", { focar: false });
  mostrarMensagemBatalha("A batalha começou. O que você fará?");
}

function aplicarResultadoTurno(dados) {
  const estadoRemoto = validarEstadoRemoto(dados?.estado, 2);
  const registros = validarRegistros(dados?.registros);

  if (!estadoRemoto || !registros) {
    mostrarAviso("O servidor enviou um resultado de turno inválido.");
    return;
  }

  estadoAplicacao.multijogador.aguardandoAcao = false;

  if (!aplicarEstadoRemoto(estadoRemoto)) {
    mostrarAviso("Não foi possível atualizar a batalha.");
    return;
  }

  mostrarMensagemBatalha(
    registros.length ? registros.join(" ") : "O que você fará agora?",
  );
  mostrarPainelBatalha("acoes");
}

function encerrarBatalhaMultijogador(dados) {
  const estadoRemoto = validarEstadoRemoto(dados?.estado, 2);
  const registros = validarRegistros(dados?.registros);
  const vencedorId =
    typeof dados?.vencedorId === "string" ? dados.vencedorId : null;

  if (
    !estadoRemoto ||
    !registros ||
    !vencedorId ||
    !estadoRemoto.jogadores.some((jogador) => jogador.id === vencedorId)
  ) {
    mostrarAviso("O servidor enviou um encerramento de batalha inválido.");
    return;
  }

  estadoAplicacao.multijogador.situacao = "finalizado";
  estadoAplicacao.multijogador.aguardandoAcao = false;

  if (!aplicarEstadoRemoto(estadoRemoto, { encerrada: true, vencedorId })) {
    mostrarAviso("Não foi possível encerrar a batalha.");
    return;
  }

  if (registros.length) {
    mostrarMensagemBatalha(registros.join(" "));
  }

  mostrarResultadoBatalha(
    vencedorId === estadoAplicacao.multijogador.jogadorId,
  );
}

function atualizarStatusRevanche(dados) {
  const estadoRemoto = validarEstadoRemoto(dados?.estado, 2);

  if (!estadoRemoto) {
    mostrarAviso("O servidor enviou um estado de revanche inválido.");
    return;
  }

  const vencedorId = estadoAplicacao.batalha?.vencedorId ?? null;

  if (!aplicarEstadoRemoto(estadoRemoto, { encerrada: true, vencedorId })) {
    return;
  }

  const jogadorAtual = estadoRemoto.jogadores.find(
    (jogador) => jogador.id === estadoAplicacao.multijogador.jogadorId,
  );
  const adversario = estadoRemoto.jogadores.find(
    (jogador) => jogador.id !== estadoAplicacao.multijogador.jogadorId,
  );
  const botaoRevanche = exigirElemento("#botao-revanche");

  estadoAplicacao.multijogador.revancheSolicitada = Boolean(
    jogadorAtual?.revanche,
  );
  botaoRevanche.disabled = estadoAplicacao.multijogador.revancheSolicitada;
  botaoRevanche.textContent = estadoAplicacao.multijogador.revancheSolicitada
    ? "AGUARDANDO ADVERSÁRIO"
    : "SOLICITAR REVANCHE";

  if (jogadorAtual?.revanche && !adversario?.revanche) {
    mostrarMensagemBatalha("Pedido enviado. Aguardando o adversário.");
  } else if (!jogadorAtual?.revanche && adversario?.revanche) {
    mostrarMensagemBatalha("O adversário solicitou uma revanche.");
  }
}

function solicitarRevanche() {
  if (estadoAplicacao.modoBatalha === "local") {
    iniciarBatalhaLocal();
    return;
  }

  if (
    estadoAplicacao.modoBatalha !== "multijogador" ||
    estadoAplicacao.multijogador.revancheSolicitada
  ) {
    return;
  }

  if (enviarEvento(EVENTOS.SOLICITAR_REVANCHE)) {
    estadoAplicacao.multijogador.revancheSolicitada = true;
    const botao = exigirElemento("#botao-revanche");
    botao.disabled = true;
    botao.textContent = "AGUARDANDO ADVERSÁRIO";
    mostrarMensagemBatalha("Pedido de revanche enviado.");
  }
}

function restaurarFluxoMultijogador(estado, acaoPendente, mensagem) {
  if (
    !ehObjeto(estado) ||
    !["aguardando", "selecao", "batalha", "encerrada"].includes(
      estado.situacao,
    )
  ) {
    mostrarAviso("O servidor enviou uma retomada inválida.");
    return false;
  }

  const codigo = validarCodigoRecebido(estado.codigo);

  if (!codigo) {
    mostrarAviso("O servidor enviou uma sala inválida na retomada.");
    return false;
  }

  estadoAplicacao.modoBatalha = "multijogador";
  estadoAplicacao.multijogador.codigoSala = codigo;
  estadoAplicacao.multijogador.situacao = estado.situacao;
  estadoAplicacao.multijogador.aguardandoAcao = Boolean(acaoPendente);
  estadoAplicacao.multijogador.oponenteAusente = false;
  estadoAplicacao.historicoTelas = [];

  if (["batalha", "encerrada"].includes(estado.situacao)) {
    const estadoRemoto = validarEstadoRemoto(estado, 2);

    if (!estadoRemoto) {
      mostrarAviso("Não foi possível restaurar o estado da batalha.");
      return false;
    }

    const encerrada = estado.situacao === "encerrada";
    const jogadoresVivos = estadoRemoto.jogadores.filter((jogador) =>
      jogador.equipe.some((membro) => membro.vidaAtual > 0),
    );
    const vencedorId =
      encerrada && jogadoresVivos.length === 1
        ? jogadoresVivos[0].id
        : null;

    ocultarResultadoBatalha();

    if (!aplicarEstadoRemoto(estadoRemoto, { encerrada, vencedorId })) {
      mostrarAviso("O estado retomado é anterior ao estado já exibido.");
      return false;
    }

    irParaTela("batalha", { registrarHistorico: false });
    mostrarPainelBatalha("acoes", { focar: !acaoPendente && !encerrada });

    if (encerrada && vencedorId) {
      mostrarResultadoBatalha(
        vencedorId === estadoAplicacao.multijogador.jogadorId,
      );
    } else {
      mostrarMensagemBatalha(
        acaoPendente
          ? "Ação recuperada. Aguardando o adversário."
          : mensagem,
      );
    }

    return true;
  }

  estadoAplicacao.batalha = null;
  ocultarResultadoBatalha();

  if (estado.situacao === "selecao") {
    const jogador = Array.isArray(estado.jogadores)
      ? estado.jogadores.find(
          (participante) =>
            participante?.id === estadoAplicacao.multijogador.jogadorId,
        )
      : null;
    const ids = Array.isArray(jogador?.equipe)
      ? jogador.equipe.map((membro) => membro?.lutadorId)
      : [];
    const equipeValida =
      ids.length === TAMANHO_EQUIPE &&
      new Set(ids).size === TAMANHO_EQUIPE &&
      ids.every((id) => obterLutador(id));

    estadoAplicacao.lutadoresSelecionadosIds = equipeValida ? ids : [];
    estadoAplicacao.multijogador.equipeConfirmada = equipeValida;
    renderizarEquipe();
    irParaTela("equipe", { registrarHistorico: false });
    mostrarAviso(
      equipeValida
        ? "Equipe recuperada. Aguardando o adversário."
        : "Sala recuperada. Escolha sua equipe.",
    );
    return true;
  }

  mostrarEsperaSala(mensagem, codigo);
  irParaTela("multijogador", { registrarHistorico: false });
  return true;
}

function tratarSalaReentrada(dados) {
  if (
    typeof dados?.jogadorId !== "string" ||
    !dados.jogadorId ||
    typeof dados.tokenReconexao !== "string" ||
    dados.tokenReconexao.length < 32
  ) {
    mostrarAviso("O servidor não confirmou a retomada da sessão.");
    return;
  }

  const multijogador = estadoAplicacao.multijogador;
  multijogador.jogadorId = dados.jogadorId;
  multijogador.tokenReconexao = dados.tokenReconexao;
  multijogador.reconectando = false;
  multijogador.tentativasReconexao = 0;
  cancelarTemporizadorReconexao();

  if (
    restaurarFluxoMultijogador(
      dados.estado,
      dados.acaoPendente,
      "Conexão retomada. Escolha sua ação.",
    )
  ) {
    salvarCredenciaisReconexao();
    mostrarAviso("Partida retomada.");
  }
}

function tratarOponenteReconectado(dados) {
  const mensagem =
    typeof dados?.mensagem === "string" && dados.mensagem.length <= 500
      ? dados.mensagem
      : "O adversário se reconectou.";

  if (
    restaurarFluxoMultijogador(
      dados?.estado,
      dados?.acaoPendente,
      `${mensagem} Escolha sua ação.`,
    )
  ) {
    mostrarAviso(mensagem);
  }
}

function tratarOponenteDesconectado(dados) {
  const mensagem =
    typeof dados?.mensagem === "string" && dados.mensagem.length <= 500
      ? dados.mensagem
      : "O adversário se desconectou.";

  if (dados?.temporario === true) {
    estadoAplicacao.multijogador.oponenteAusente = true;

    if (estadoAplicacao.batalha) {
      estadoAplicacao.batalha.ocupada = true;
      atualizarDisponibilidadeComandos();
      mostrarMensagemBatalha(mensagem);
    } else if (estadoAplicacao.telaAtual === "equipe") {
      renderizarEquipe();
    }

    mostrarAviso(mensagem);
    return;
  }

  estadoAplicacao.multijogador.situacao = "aguardando";
  estadoAplicacao.multijogador.oponenteAusente = false;
  estadoAplicacao.multijogador.aguardandoAcao = false;
  estadoAplicacao.multijogador.revancheSolicitada = false;
  estadoAplicacao.batalha = null;
  ocultarResultadoBatalha();
  mostrarEsperaSala(
    mensagem,
    estadoAplicacao.multijogador.codigoSala,
  );
  estadoAplicacao.historicoTelas = [];
  irParaTela("multijogador", { registrarHistorico: false });
  mostrarAviso(mensagem);
}

function tratarErroSala(dados) {
  const mensagem =
    typeof dados?.mensagem === "string" && dados.mensagem.length <= 500
      ? dados.mensagem
      : "O servidor recusou a solicitação.";

  if (estadoAplicacao.multijogador.reconectando) {
    const sessao = estadoAplicacao.multijogador;
    cancelarPolling(sessao);
    void encerrarSessaoRemota(sessao);
    sessao.sessaoId = null;
    sessao.chaveSessao = null;
    sessao.promessaConexao = null;

    agendarReconexao();
    mostrarAviso(mensagem);
    return;
  }

  estadoAplicacao.multijogador.aguardandoAcao = false;
  estadoAplicacao.multijogador.equipeConfirmada = false;

  if (estadoAplicacao.telaAtual === "multijogador") {
    mostrarAcoesSala();
  } else if (estadoAplicacao.telaAtual === "equipe") {
    renderizarEquipe();
  } else if (estadoAplicacao.telaAtual === "batalha") {
    if (estadoAplicacao.batalha) {
      estadoAplicacao.batalha.ocupada = false;
      atualizarDisponibilidadeComandos();
      mostrarPainelBatalha("acoes");
    }
    mostrarMensagemBatalha(mensagem);
  }

  mostrarAviso(mensagem);
}

function tratarEventoMultijogador(tipo, dados) {
  if (tipo === EVENTOS.CONEXAO) {
    if (
      typeof dados?.jogadorId !== "string" ||
      !dados.jogadorId ||
      typeof dados.tokenReconexao !== "string" ||
      dados.tokenReconexao.length < 32 ||
      dados.versaoProtocolo !== 3
    ) {
      mostrarAviso("O servidor enviou uma identificação inválida.");
      return;
    }

    const multijogador = estadoAplicacao.multijogador;

    if (multijogador.reconectando) {
      enviarEvento(EVENTOS.REENTRAR_SALA, {
        codigo: multijogador.codigoSala,
        jogadorId: multijogador.jogadorId,
        tokenReconexao: multijogador.tokenReconexao,
      });
      return;
    }

    multijogador.jogadorId = dados.jogadorId;
    multijogador.tokenReconexao = dados.tokenReconexao;
    return;
  }

  if (tipo === EVENTOS.SALA_CRIADA) {
    const codigo = validarCodigoRecebido(dados?.codigo);
    if (!codigo) {
      mostrarAviso("O servidor enviou um código de sala inválido.");
      return;
    }
    estadoAplicacao.multijogador.codigoSala = codigo;
    estadoAplicacao.multijogador.situacao = "aguardando";
    salvarCredenciaisReconexao();
    mostrarEsperaSala("Aguardando outro jogador…", codigo);
    return;
  }

  if (tipo === EVENTOS.SALA_ENTRADA) {
    const codigo = validarCodigoRecebido(dados?.codigo);
    if (!codigo) {
      mostrarAviso("O servidor enviou um código de sala inválido.");
      return;
    }
    estadoAplicacao.multijogador.codigoSala = codigo;
    estadoAplicacao.multijogador.situacao = "selecionando";
    estadoAplicacao.multijogador.equipeConfirmada = false;
    estadoAplicacao.lutadoresSelecionadosIds = [];
    estadoAplicacao.lutadorEmPreviaId = LUTADORES[0]?.id ?? null;
    estadoAplicacao.modoBatalha = "multijogador";
    salvarCredenciaisReconexao();
    renderizarEquipe();
    irParaTela("equipe", { registrarHistorico: false });
    mostrarAviso("Sala pronta. Escolha sua equipe de três IFighters.");
    return;
  }

  if (tipo === EVENTOS.ACAO_ACEITA) {
    const mensagem =
      typeof dados?.mensagem === "string" && dados.mensagem.length <= 500
        ? dados.mensagem
        : "Ação aceita pelo servidor.";
    if (estadoAplicacao.telaAtual === "batalha") {
      mostrarMensagemBatalha(mensagem);
    } else {
      mostrarAviso(mensagem);
    }
    return;
  }

  if (tipo === EVENTOS.BATALHA_INICIADA) {
    iniciarBatalhaMultijogador(dados);
    return;
  }

  if (tipo === EVENTOS.RESULTADO_TURNO) {
    aplicarResultadoTurno(dados);
    return;
  }

  if (tipo === EVENTOS.BATALHA_ENCERRADA) {
    encerrarBatalhaMultijogador(dados);
    return;
  }

  if (tipo === EVENTOS.STATUS_REVANCHE) {
    atualizarStatusRevanche(dados);
    return;
  }

  if (tipo === EVENTOS.SALA_REENTRADA) {
    tratarSalaReentrada(dados);
    return;
  }

  if (tipo === EVENTOS.OPONENTE_DESCONECTADO) {
    tratarOponenteDesconectado(dados);
    return;
  }

  if (tipo === EVENTOS.OPONENTE_RECONECTADO) {
    tratarOponenteReconectado(dados);
    return;
  }

  if (tipo === EVENTOS.ERRO_SALA) {
    tratarErroSala(dados);
  }
}

function sairDaBatalha() {
  if (estadoAplicacao.modoBatalha === "multijogador") {
    sairDoMultijogador("menu");
    return;
  }

  cancelarTurnoLocal();
  estadoAplicacao.batalha = null;
  estadoAplicacao.modoBatalha = null;
  estadoAplicacao.historicoTelas = [];
  ocultarResultadoBatalha();
  irParaTela("menu", { registrarHistorico: false });
}

function prepararIntroducao() {
  const video = exigirElemento("#video-introducao");
  const tela = exigirElemento(".introducao");

  video.pause();
  tela.classList.remove("reproduzindo");

  try {
    video.currentTime = 0;
  } catch {
    // Alguns navegadores só permitem alterar o tempo após carregar os metadados.
  }
}

function pularIntroducao() {
  prepararIntroducao();
  irParaTela("abertura", { registrarHistorico: false });
}

async function reproduzirIntroducao() {
  const video = exigirElemento("#video-introducao");
  const tela = exigirElemento(".introducao");

  if (tela.classList.contains("reproduzindo")) {
    pularIntroducao();
    return;
  }

  tela.classList.add("reproduzindo");

  try {
    await video.play();
  } catch {
    tela.classList.remove("reproduzindo");
    mostrarAviso("Não foi possível reproduzir o vídeo. Você pode continuar o jogo.");
    focarElemento(exigirElemento("#botao-iniciar-introducao"));
  }
}

function reverIntroducao() {
  prepararIntroducao();
  irParaTela("introducao");
  void reproduzirIntroducao();
}

const ACOES = Object.freeze({
  "abrir-menu": () => irParaTela("menu"),
  "abrir-jogar": () => irParaTela("jogar"),
  "iniciar-local": iniciarSelecaoLocal,
  "abrir-multijogador": () => void abrirMultijogador(),
  "criar-sala": () => void criarSala(),
  "entrar-sala": () => void entrarSala(),
  "copiar-codigo": () => void copiarCodigoSala(),
  "sair-sala": () => sairDoMultijogador("jogar"),
  "abrir-ifdex": () => {
    renderizarIfdex();
    irParaTela("ifdex");
  },
  "abrir-configuracoes": () => irParaTela("configuracoes"),
  "abrir-creditos": () => irParaTela("creditos"),
  voltar: voltarTela,
  "confirmar-equipe": confirmarEquipe,
  "ifdex-anterior": () => navegarIfdex(-1),
  "ifdex-proximo": () => navegarIfdex(1),
  "sair-batalha": sairDaBatalha,
  "solicitar-revanche": solicitarRevanche,
  "rever-introducao": reverIntroducao,
  "batalha-lutar": () => {
    if (
      !estadoAplicacao.batalha?.ocupada &&
      !estadoAplicacao.batalha?.encerrada
    ) {
      renderizarGolpes();
      mostrarPainelBatalha("golpes");
    }
  },
  "batalha-pokemon": () => {
    if (
      !estadoAplicacao.batalha?.ocupada &&
      !estadoAplicacao.batalha?.encerrada
    ) {
      renderizarEquipeBatalha();
      mostrarPainelBatalha("pokemon");
    }
  },
  "batalha-voltar": () => mostrarPainelBatalha("acoes"),
});

function executarAcao(nomeAcao) {
  const acao = ACOES[nomeAcao];

  if (!acao) {
    mostrarAviso(`A ação “${nomeAcao}” não está disponível.`);
    return;
  }

  try {
    acao();
  } catch (erro) {
    mostrarAviso(
      erro instanceof Error
        ? erro.message
        : "Não foi possível concluir a ação.",
    );
  }
}

function manipularClique(evento) {
  if (!(evento.target instanceof Element)) {
    return;
  }

  const elementoAcao = evento.target.closest("[data-acao]");
  if (elementoAcao instanceof HTMLButtonElement && !elementoAcao.disabled) {
    executarAcao(elementoAcao.dataset.acao);
    return;
  }

  const opcaoLutador = evento.target.closest("[data-lutador-id]");
  if (opcaoLutador instanceof HTMLButtonElement && !opcaoLutador.disabled) {
    alternarLutadorDaEquipe(opcaoLutador.dataset.lutadorId);
    return;
  }

  const opcaoDex = evento.target.closest("[data-indice-dex]");
  if (opcaoDex instanceof HTMLButtonElement && !opcaoDex.disabled) {
    selecionarItemIfdex(Number(opcaoDex.dataset.indiceDex));
    return;
  }

  const opcaoGolpe = evento.target.closest("[data-golpe]");
  if (opcaoGolpe instanceof HTMLButtonElement && !opcaoGolpe.disabled) {
    usarGolpe(Number(opcaoGolpe.dataset.golpe));
    return;
  }

  const opcaoTroca = evento.target.closest("[data-trocar-lutador]");
  if (opcaoTroca instanceof HTMLButtonElement && !opcaoTroca.disabled) {
    trocarLutador(opcaoTroca.dataset.trocarLutador);
  }
}

function elementoEhCampoDeEntrada(elemento) {
  const tiposEditaveis = new Set([
    "text",
    "search",
    "email",
    "url",
    "tel",
    "password",
    "number",
  ]);

  return (
    (elemento instanceof HTMLInputElement && tiposEditaveis.has(elemento.type)) ||
    elemento instanceof HTMLTextAreaElement ||
    elemento instanceof HTMLSelectElement ||
    elemento?.isContentEditable
  );
}

function manterFocoNoDialogo(evento) {
  const resultado = exigirElemento("#resultado-batalha");

  if (resultado.hidden || evento.key !== "Tab") {
    return false;
  }

  const itens = selecionarTodos(
    ".selecionavel:not([disabled])",
    resultado,
  ).filter(elementoEstaVisivel);

  if (!itens.length) {
    evento.preventDefault();
    focarElemento(resultado);
    return true;
  }

  const primeiro = itens[0];
  const ultimo = itens.at(-1);

  if (evento.shiftKey && document.activeElement === primeiro) {
    evento.preventDefault();
    focarElemento(ultimo);
    return true;
  }

  if (!evento.shiftKey && document.activeElement === ultimo) {
    evento.preventDefault();
    focarElemento(primeiro);
    return true;
  }

  return false;
}

function manipularTeclado(evento) {
  if (manterFocoNoDialogo(evento)) {
    return;
  }

  const alvo = evento.target;
  const controleNativo = elementoEhCampoDeEntrada(alvo);

  if (estadoAplicacao.telaAtual === "introducao") {
    if (evento.key === "Escape") {
      evento.preventDefault();
      pularIntroducao();
      return;
    }

    if (
      !controleNativo &&
      (evento.key === "Enter" || evento.key === " ")
    ) {
      evento.preventDefault();
      void reproduzirIntroducao();
    }
    return;
  }

  if (controleNativo) {
    return;
  }

  if (
    estadoAplicacao.telaAtual === "abertura" &&
    evento.key === "Enter"
  ) {
    evento.preventDefault();
    executarAcao("abrir-menu");
    return;
  }

  if (["ArrowDown", "s", "S"].includes(evento.key)) {
    evento.preventDefault();
    moverFoco(1);
    return;
  }

  if (["ArrowUp", "w", "W"].includes(evento.key)) {
    evento.preventDefault();
    moverFoco(-1);
    return;
  }

  if (["Escape", "Backspace"].includes(evento.key)) {
    evento.preventDefault();
    voltarTela();
  }
}

function manipularFoco(evento) {
  if (evento.target instanceof Element && evento.target.matches(".selecionavel")) {
    marcarElementoComFoco(evento.target);
  }
}

function validarContratos() {
  if (!Array.isArray(LUTADORES) || !LUTADORES.length) {
    throw new Error("A lista de lutadores não foi carregada corretamente.");
  }

  if (!ehObjeto(EVENTOS) || !ehObjeto(REGRAS_BATALHA)) {
    throw new Error("Os contratos compartilhados do jogo não foram carregados.");
  }

  const ids = new Set();

  for (const lutador of LUTADORES) {
    if (
      !ehObjeto(lutador) ||
      typeof lutador.id !== "string" ||
      ids.has(lutador.id) ||
      typeof lutador.nome !== "string" ||
      typeof lutador.forma !== "string" ||
      typeof lutador.sprite !== "string" ||
      typeof lutador.descricao !== "string" ||
      !ehObjeto(lutador.atributos) ||
      !Array.isArray(lutador.golpes) ||
      !lutador.golpes.length
    ) {
      throw new Error("Há um lutador inválido na base de dados.");
    }
    ids.add(lutador.id);
  }
}

function registrarEventos() {
  document.addEventListener("click", manipularClique);
  document.addEventListener("keydown", manipularTeclado);
  document.addEventListener("focusin", manipularFoco);

  exigirElemento("#botao-iniciar-introducao").addEventListener(
    "click",
    () => void reproduzirIntroducao(),
  );
  exigirElemento("#video-introducao").addEventListener("ended", pularIntroducao);
  exigirElemento(".introducao").addEventListener("click", (evento) => {
    if (
      evento.target === exigirElemento("#video-introducao") &&
      exigirElemento(".introducao").classList.contains("reproduzindo")
    ) {
      pularIntroducao();
    }
  });

  exigirElemento("#alternar-animacoes").addEventListener(
    "change",
    atualizarConfiguracoesPelaInterface,
  );
  exigirElemento("#alternar-contraste").addEventListener(
    "change",
    atualizarConfiguracoesPelaInterface,
  );
  exigirElemento("#alternar-introducao").addEventListener(
    "change",
    atualizarConfiguracoesPelaInterface,
  );

  exigirElemento("#codigo-sala").addEventListener("input", (evento) => {
    evento.target.value = normalizarCodigoSala(evento.target.value);
    evento.target.removeAttribute("aria-invalid");
  });
  exigirElemento("#codigo-sala").addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      void entrarSala();
    }
  });

  exigirElemento("#busca-ifdex").addEventListener("input", (evento) => {
    estadoAplicacao.filtroIfdex = evento.target.value;
    renderizarIfdex();
  });

  consultaMovimentoReduzido.addEventListener("change", (evento) => {
    if (!estadoAplicacao.configuracoes.animacoesDefinidas) {
      estadoAplicacao.configuracoes.animacoes = !evento.matches;
      aplicarConfiguracoes();
    }
  });

  window.addEventListener("pagehide", () => {
    salvarCredenciaisReconexao();
    const sessao = estadoAplicacao.multijogador;
    cancelarPolling(sessao);
    void encerrarSessaoRemota(sessao, { manterAoSair: true });

    cancelarTurnoLocal();
  });
}

function inicializar() {
  try {
    validarContratos();
    estadoAplicacao.lutadorEmPreviaId = LUTADORES[0].id;
    aplicarConfiguracoes();
    renderizarEquipe();
    renderizarIfdex();
    ocultarResultadoBatalha();
    registrarEventos();

    const credenciaisReconexao = carregarCredenciaisReconexao();

    if (credenciaisReconexao) {
      Object.assign(estadoAplicacao.multijogador, {
        codigoSala: credenciaisReconexao.codigo,
        jogadorId: credenciaisReconexao.jogadorId,
        tokenReconexao: credenciaisReconexao.tokenReconexao,
        reconectando: true,
        situacao: "reconectando",
      });
      estadoAplicacao.modoBatalha = "multijogador";
      mostrarEsperaSala("Retomando a partida…", credenciaisReconexao.codigo);
      irParaTela("multijogador", { registrarHistorico: false });
      agendarReconexao();
      return;
    }

    if (estadoAplicacao.configuracoes.reproduzirIntroducao) {
      prepararIntroducao();
      irParaTela("introducao", {
        registrarHistorico: false,
      });
      void reproduzirIntroducao();
    } else {
      irParaTela("abertura", {
        registrarHistorico: false,
      });
    }
  } catch (erro) {
    const mensagem =
      erro instanceof Error
        ? erro.message
        : "Não foi possível iniciar o IFighters.";
    mostrarAviso(mensagem, 8000);
    console.error(erro);
  }
}

inicializar();
