"use strict";

const CHAVE_CONFIGURACOES = "ifighters-configuracoes";
const DURACOES = Object.freeze({
  aviso: 2600,
  conexao: 8000,
  anuncioGolpe: 650,
  erroGolpe: 600,
  dano: 700,
});
const CODIGO_SALA_VALIDO = /^[A-Z0-9]{6}$/;
const consultaMovimentoReduzido = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);

function carregarConfiguracoes() {
  let configuracoesSalvas = {};

  try {
    const textoSalvo = localStorage.getItem(CHAVE_CONFIGURACOES);
    const valorSalvo = textoSalvo ? JSON.parse(textoSalvo) : {};

    if (valorSalvo && typeof valorSalvo === "object" && !Array.isArray(valorSalvo)) {
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

function criarEstadoMultijogador() {
  return {
    soquete: null,
    promessaConexao: null,
    situacao: "desconectado",
    jogadorId: null,
    codigoSala: null,
    estadoRemoto: null,
    lutadorConfirmado: false,
    aguardandoGolpe: false,
    revancheSolicitada: false,
    ultimoIndiceGolpe: 0,
  };
}

const estadoAplicacao = {
  telaAtual: "introducao",
  historicoTelas: [],
  indiceFoco: 0,
  quadroFoco: null,
  lutadorSelecionadoId: null,
  indiceIfdex: 0,
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
  const lutadorSelecionado = obterLutador(
    estadoAplicacao.lutadorSelecionadoId,
  );

  lista.replaceChildren();
  previa.replaceChildren();

  if (!lutadorSelecionado) {
    lista.append(criarElemento("p", "Nenhum lutador disponível."));
    exigirElemento("#botao-confirmar-lutador").disabled = true;
    return;
  }

  const selecaoBloqueada =
    estadoAplicacao.modoBatalha === "multijogador" &&
    estadoAplicacao.multijogador.lutadorConfirmado;

  const botoes = LUTADORES.map((lutador) => {
    const selecionado = lutador.id === lutadorSelecionado.id;
    const botao = criarElemento("button", "", [
      "opcao-lutador",
      "selecionavel",
    ]);
    const imagem = criarElemento("img");
    const rotulo = criarElemento("span");
    const nome = criarElemento("strong", lutador.nome);
    const forma = criarElemento("small", lutador.forma);

    botao.type = "button";
    botao.disabled = selecaoBloqueada;
    botao.dataset.lutadorId = lutador.id;
    botao.setAttribute("aria-pressed", String(selecionado));
    botao.setAttribute(
      "aria-label",
      `${lutador.nome}, forma ${lutador.forma}`,
    );
    botao.classList.toggle("selecionado", selecionado);

    if (selecionado) {
      botao.dataset.focoInicial = "";
    }

    imagem.src = lutador.sprite;
    imagem.alt = "";
    rotulo.append(nome, document.createElement("br"), forma);
    botao.append(imagem, rotulo);
    return botao;
  });

  lista.append(...botoes);

  const imagemPrevia = criarElemento("img");
  imagemPrevia.src = lutadorSelecionado.sprite;
  imagemPrevia.alt = "";
  previa.append(
    imagemPrevia,
    criarElemento("h2", lutadorSelecionado.nome),
    criarElemento("p", lutadorSelecionado.forma),
    criarElemento("p", lutadorSelecionado.descricao),
  );

  const botaoConfirmar = exigirElemento("#botao-confirmar-lutador");
  botaoConfirmar.disabled = selecaoBloqueada;
  botaoConfirmar.textContent = selecaoBloqueada
    ? "AGUARDANDO ADVERSÁRIO"
    : "CONFIRMAR";
}

function selecionarLutador(lutadorId, botaoAnterior) {
  if (
    !obterLutador(lutadorId) ||
    estadoAplicacao.multijogador.lutadorConfirmado
  ) {
    return;
  }

  estadoAplicacao.lutadorSelecionadoId = lutadorId;
  renderizarEquipe();

  if (botaoAnterior) {
    const botaoAtual = selecionar(
      `[data-lutador-id="${lutadorId}"]`,
      exigirElemento("#lista-lutadores"),
    );
    focarElemento(botaoAtual);
  }
}

function renderizarIfdex() {
  const grade = exigirElemento("#grade-ifdex");
  const detalhe = exigirElemento("#detalhe-dex");

  grade.replaceChildren();
  detalhe.replaceChildren();

  if (!LUTADORES.length) {
    grade.append(criarElemento("p", "Nenhum lutador cadastrado."));
    return;
  }

  estadoAplicacao.indiceIfdex =
    (estadoAplicacao.indiceIfdex + LUTADORES.length) % LUTADORES.length;
  const lutadorAtual = LUTADORES[estadoAplicacao.indiceIfdex];

  const botoes = LUTADORES.map((lutador, indice) => {
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
  detalhe.append(
    imagemDetalhe,
    criarElemento("h2", lutadorAtual.nome),
    criarElemento("p", lutadorAtual.forma),
    criarElemento("p", lutadorAtual.descricao),
  );
}

function selecionarItemIfdex(indice, deveFocar = true) {
  if (!Number.isInteger(indice) || !LUTADORES[indice]) {
    return;
  }

  estadoAplicacao.indiceIfdex = indice;
  renderizarIfdex();

  if (deveFocar) {
    focarElemento(
      selecionar(
        `[data-indice-dex="${indice}"]`,
        exigirElemento("#grade-ifdex"),
      ),
    );
  }
}

function renderizarCartaoVida(seletor, participante) {
  const cartao = exigirElemento(seletor);
  const vidaMaxima = participante.lutador.atributos.vida;
  const vidaAtual = limitarNumero(participante.vidaAtual, 0, vidaMaxima);
  const percentual = Math.round((vidaAtual / vidaMaxima) * 100);
  const titulo = criarElemento("strong");
  const nivel = criarElemento("small", " NÍV. 50");
  const barra = criarElemento("div", "", ["barra-vida"]);
  const progresso = criarElemento("progress");
  const pontos = criarElemento(
    "small",
    `PV ${vidaAtual}/${vidaMaxima}`,
  );

  titulo.append(
    document.createTextNode(participante.lutador.nome.toUpperCase()),
    nivel,
  );
  barra.classList.toggle("alerta", percentual < 26);
  progresso.max = vidaMaxima;
  progresso.value = vidaAtual;
  progresso.textContent = `${percentual}%`;
  progresso.setAttribute(
    "aria-label",
    `Pontos de vida de ${participante.lutador.nome}`,
  );
  progresso.setAttribute("aria-valuetext", `${vidaAtual} de ${vidaMaxima}`);
  barra.append(progresso);
  cartao.replaceChildren(titulo, barra, pontos);
}

function atualizarDisponibilidadeGolpes() {
  const batalha = estadoAplicacao.batalha;

  if (!batalha) {
    return;
  }

  selecionarTodos("[data-golpe]", exigirElemento("#lista-golpes")).forEach(
    (botao) => {
      botao.disabled = batalha.ocupada || batalha.encerrada;
      botao.setAttribute("aria-disabled", String(botao.disabled));
    },
  );
}

function renderizarGolpes() {
  const batalha = estadoAplicacao.batalha;
  const lista = exigirElemento("#lista-golpes");

  lista.replaceChildren();

  if (!batalha) {
    return;
  }

  lista.dataset.lutadorId = batalha.jogador.lutador.id;

  const botoes = batalha.jogador.lutador.golpes.map((golpe, indice) => {
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
  atualizarDisponibilidadeGolpes();
}

function renderizarBatalha({ recriarGolpes = false } = {}) {
  const batalha = estadoAplicacao.batalha;

  if (!batalha) {
    return;
  }

  const spriteInimigo = exigirElemento("#sprite-inimigo");
  const spriteJogador = exigirElemento("#sprite-jogador");

  spriteInimigo.src = batalha.inimigo.lutador.sprite;
  spriteInimigo.alt = `${batalha.inimigo.lutador.nome}, ${batalha.inimigo.lutador.forma}`;
  spriteJogador.src = batalha.jogador.lutador.sprite;
  spriteJogador.alt = `${batalha.jogador.lutador.nome}, ${batalha.jogador.lutador.forma}`;

  renderizarCartaoVida("#cartao-inimigo", batalha.inimigo);
  renderizarCartaoVida("#cartao-jogador", batalha.jogador);

  const lista = exigirElemento("#lista-golpes");

  if (
    recriarGolpes ||
    lista.dataset.lutadorId !== batalha.jogador.lutador.id
  ) {
    renderizarGolpes();
  } else {
    atualizarDisponibilidadeGolpes();
  }
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
  estadoAplicacao.multijogador.lutadorConfirmado = false;
  renderizarEquipe();
  irParaTela("equipe");
}

function iniciarBatalhaLocal() {
  const indiceJogador = LUTADORES.findIndex(
    (lutador) => lutador.id === estadoAplicacao.lutadorSelecionadoId,
  );
  const lutadorJogador = LUTADORES[indiceJogador];

  if (!lutadorJogador || LUTADORES.length < 2) {
    mostrarAviso("São necessários ao menos dois lutadores para iniciar.");
    return;
  }

  cancelarTurnoLocal();
  const lutadorInimigo = LUTADORES[(indiceJogador + 1) % LUTADORES.length];

  estadoAplicacao.modoBatalha = "local";
  estadoAplicacao.batalha = {
    modo: "local",
    jogador: {
      lutador: lutadorJogador,
      vidaAtual: lutadorJogador.atributos.vida,
    },
    inimigo: {
      lutador: lutadorInimigo,
      vidaAtual: lutadorInimigo.atributos.vida,
    },
    ocupada: false,
    encerrada: false,
  };

  ocultarResultadoBatalha();
  renderizarBatalha({ recriarGolpes: true });
  irParaTela("batalha");
  mostrarMensagemBatalha(
    `${lutadorInimigo.nome} desafia você! Escolha um golpe.`,
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
  const golpeJogador = batalha?.jogador.lutador.golpes[indiceGolpe];

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
  atualizarDisponibilidadeGolpes();
  const identificador = ++estadoAplicacao.identificadorTurnoLocal;
  const golpesInimigos = batalha.inimigo.lutador.golpes;
  const golpeInimigo =
    golpesInimigos[Math.floor(Math.random() * golpesInimigos.length)];
  const acaoJogador = {
    atacante: batalha.jogador.lutador,
    defensor: batalha.inimigo.lutador,
    golpe: golpeJogador,
    alvo: "inimigo",
  };
  const acaoInimigo = {
    atacante: batalha.inimigo.lutador,
    defensor: batalha.jogador.lutador,
    golpe: golpeInimigo,
    alvo: "jogador",
  };
  const acoesOrdenadas = REGRAS_BATALHA.ordenarAcoes(
    acaoJogador,
    acaoInimigo,
  );

  for (const acao of acoesOrdenadas) {
    if (!turnoLocalAindaValido(identificador, batalha)) {
      return;
    }

    const alvo = batalha[acao.alvo];

    if (alvo.vidaAtual <= 0) {
      continue;
    }

    mostrarMensagemBatalha(
      `${acao.atacante.nome} usou ${acao.golpe.nome}!`,
    );
    await aguardarAnimacao(DURACOES.anuncioGolpe);

    if (!turnoLocalAindaValido(identificador, batalha)) {
      return;
    }

    if (!REGRAS_BATALHA.golpeAcertou(acao.golpe)) {
      mostrarMensagemBatalha("O golpe errou!");
      await aguardarAnimacao(DURACOES.erroGolpe);
      continue;
    }

    const dano = REGRAS_BATALHA.calcularDano(
      acao.atacante,
      acao.defensor,
      acao.golpe,
    );
    alvo.vidaAtual = Math.max(0, alvo.vidaAtual - dano);
    renderizarBatalha();
    mostrarMensagemBatalha(`O golpe causou ${dano} de dano.`);
    await aguardarAnimacao(DURACOES.dano);

    if (!turnoLocalAindaValido(identificador, batalha)) {
      return;
    }

    if (alvo.vidaAtual === 0) {
      batalha.encerrada = true;
      batalha.ocupada = false;
      renderizarBatalha();
      mostrarResultadoBatalha(acao.alvo === "inimigo");
      return;
    }
  }

  if (!turnoLocalAindaValido(identificador, batalha)) {
    return;
  }

  batalha.ocupada = false;
  renderizarBatalha();
  mostrarMensagemBatalha("Escolha seu próximo golpe.");
  focarElemento(
    selecionar(
      `[data-golpe="${indiceGolpe}"]`,
      exigirElemento("#lista-golpes"),
    ),
  );
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
    typeof valor.situacao !== "string" ||
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
    const lutador = ehObjeto(jogador)
      ? obterLutador(jogador.lutadorId)
      : null;

    if (
      !lutador ||
      typeof jogador.id !== "string" ||
      !jogador.id ||
      identificadores.has(jogador.id) ||
      !Number.isFinite(jogador.vidaAtual) ||
      jogador.vidaAtual < 0 ||
      jogador.vidaAtual > lutador.atributos.vida ||
      typeof jogador.revanche !== "boolean"
    ) {
      return null;
    }

    identificadores.add(jogador.id);
    jogadores.push({
      id: jogador.id,
      lutadorId: jogador.lutadorId,
      vidaAtual: jogador.vidaAtual,
      revanche: jogador.revanche,
    });
  }

  return {
    codigo,
    situacao: valor.situacao,
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

  const lutadorJogador = obterLutador(jogadorRemoto.lutadorId);
  const lutadorInimigo = obterLutador(inimigoRemoto.lutadorId);

  if (!lutadorJogador || !lutadorInimigo) {
    return null;
  }

  return {
    jogador: {
      id: jogadorRemoto.id,
      lutador: lutadorJogador,
      vidaAtual: jogadorRemoto.vidaAtual,
      revanche: jogadorRemoto.revanche,
    },
    inimigo: {
      id: inimigoRemoto.id,
      lutador: lutadorInimigo,
      vidaAtual: inimigoRemoto.vidaAtual,
      revanche: inimigoRemoto.revanche,
    },
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

  estadoAplicacao.multijogador.estadoRemoto = estadoRemoto;
  estadoAplicacao.multijogador.codigoSala = estadoRemoto.codigo;
  estadoAplicacao.batalha = {
    modo: "multijogador",
    jogador: participantes.jogador,
    inimigo: participantes.inimigo,
    ocupada: estadoAplicacao.multijogador.aguardandoGolpe,
    encerrada,
    vencedorId,
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

function obterEnderecoMultijogador() {
  if (!window.location.host) {
    throw new Error("Abra o jogo pelo servidor Node para usar o multijogador.");
  }

  const protocolo = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocolo}//${window.location.host}`;
}

function manipularFechamentoSoquete(soquete) {
  if (estadoAplicacao.multijogador.soquete !== soquete) {
    return;
  }

  const estavaEmFluxoMultijogador =
    estadoAplicacao.modoBatalha === "multijogador";
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
  if (!("WebSocket" in window)) {
    throw new Error("Este navegador não oferece suporte ao multijogador.");
  }

  const conexaoAtual = estadoAplicacao.multijogador.soquete;

  if (conexaoAtual?.readyState === WebSocket.OPEN) {
    return conexaoAtual;
  }

  if (estadoAplicacao.multijogador.promessaConexao) {
    return estadoAplicacao.multijogador.promessaConexao;
  }

  const soquete = new WebSocket(obterEnderecoMultijogador());
  estadoAplicacao.multijogador.soquete = soquete;
  estadoAplicacao.multijogador.situacao = "conectando";

  soquete.addEventListener("message", manipularMensagemMultijogador);
  soquete.addEventListener("close", () => manipularFechamentoSoquete(soquete));

  const promessa = new Promise((resolver, rejeitar) => {
    const temporizador = window.setTimeout(() => {
      rejeitar(new Error("O servidor demorou demais para responder."));
      soquete.close();
    }, DURACOES.conexao);

    soquete.addEventListener(
      "open",
      () => {
        clearTimeout(temporizador);

        if (estadoAplicacao.multijogador.soquete !== soquete) {
          soquete.close(1000, "Conexão cancelada pelo jogador");
          rejeitar(new Error("A conexão foi cancelada."));
          return;
        }

        estadoAplicacao.multijogador.situacao = "conectado";
        resolver(soquete);
      },
      { once: true },
    );
    soquete.addEventListener(
      "error",
      () => {
        clearTimeout(temporizador);
        rejeitar(new Error("Não foi possível conectar ao servidor."));
      },
      { once: true },
    );
  });

  estadoAplicacao.multijogador.promessaConexao = promessa;

  try {
    return await promessa;
  } finally {
    if (estadoAplicacao.multijogador.promessaConexao === promessa) {
      estadoAplicacao.multijogador.promessaConexao = null;
    }
  }
}

function enviarEvento(tipo, dados = {}) {
  const soquete = estadoAplicacao.multijogador.soquete;

  if (!soquete || soquete.readyState !== WebSocket.OPEN) {
    mostrarAviso("A conexão com o servidor não está disponível.");
    return false;
  }

  try {
    soquete.send(JSON.stringify({ tipo, dados }));
    return true;
  } catch {
    mostrarAviso("Não foi possível enviar a solicitação ao servidor.");
    return false;
  }
}

function desconectarMultijogador({ avisarServidor = true } = {}) {
  const soquete = estadoAplicacao.multijogador.soquete;

  if (
    avisarServidor &&
    estadoAplicacao.multijogador.codigoSala &&
    soquete?.readyState === WebSocket.OPEN
  ) {
    try {
      soquete.send(JSON.stringify({ tipo: EVENTOS.SAIR_SALA, dados: {} }));
    } catch {
      // O fechamento abaixo conclui a limpeza local mesmo sem envio.
    }
  }

  estadoAplicacao.multijogador = criarEstadoMultijogador();

  if (soquete && soquete.readyState < WebSocket.CLOSING) {
    soquete.close(1000, "Saída solicitada pelo jogador");
  }
}

async function abrirMultijogador() {
  cancelarTurnoLocal();
  estadoAplicacao.modoBatalha = "multijogador";
  mostrarEsperaSala("Conectando…");
  irParaTela("multijogador");
  const promessaConexao = conectarMultijogador();
  const soqueteEsperado = estadoAplicacao.multijogador.soquete;

  try {
    const soquete = await promessaConexao;

    if (
      estadoAplicacao.multijogador.soquete !== soquete ||
      estadoAplicacao.telaAtual !== "multijogador"
    ) {
      return;
    }

    mostrarAcoesSala();
  } catch (erro) {
    if (
      estadoAplicacao.modoBatalha !== "multijogador" ||
      estadoAplicacao.multijogador.soquete !== soqueteEsperado
    ) {
      return;
    }

    mostrarAcoesSala();
    mostrarAviso(erro instanceof Error ? erro.message : "Falha de conexão.");
  }
}

async function criarSala() {
  definirControlesSalaHabilitados(false);
  const promessaConexao = conectarMultijogador();
  const soqueteEsperado = estadoAplicacao.multijogador.soquete;

  try {
    const soquete = await promessaConexao;

    if (estadoAplicacao.multijogador.soquete !== soquete) {
      return;
    }

    mostrarEsperaSala("Criando sala…");

    if (!enviarEvento(EVENTOS.CRIAR_SALA)) {
      mostrarAcoesSala();
    }
  } catch (erro) {
    if (
      estadoAplicacao.modoBatalha !== "multijogador" ||
      estadoAplicacao.multijogador.soquete !== soqueteEsperado
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
  const promessaConexao = conectarMultijogador();
  const soqueteEsperado = estadoAplicacao.multijogador.soquete;

  try {
    const soquete = await promessaConexao;

    if (estadoAplicacao.multijogador.soquete !== soquete) {
      return;
    }

    mostrarEsperaSala("Entrando na sala…", codigo);

    if (!enviarEvento(EVENTOS.ENTRAR_SALA, { codigo })) {
      mostrarAcoesSala();
    }
  } catch (erro) {
    if (
      estadoAplicacao.modoBatalha !== "multijogador" ||
      estadoAplicacao.multijogador.soquete !== soqueteEsperado
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

function confirmarLutador() {
  const lutador = obterLutador(estadoAplicacao.lutadorSelecionadoId);

  if (!lutador) {
    mostrarAviso("Selecione um lutador válido.");
    return;
  }

  if (estadoAplicacao.modoBatalha === "multijogador") {
    if (estadoAplicacao.multijogador.lutadorConfirmado) {
      return;
    }

    if (
      enviarEvento(EVENTOS.SELECIONAR_LUTADOR, {
        lutadorId: lutador.id,
      })
    ) {
      estadoAplicacao.multijogador.lutadorConfirmado = true;
      renderizarEquipe();
      mostrarAviso("Lutador confirmado. Aguardando o adversário.");
    }
    return;
  }

  iniciarBatalhaLocal();
}

function usarGolpeMultijogador(indiceGolpe) {
  const batalha = estadoAplicacao.batalha;

  if (
    !batalha ||
    batalha.modo !== "multijogador" ||
    batalha.encerrada ||
    estadoAplicacao.multijogador.aguardandoGolpe ||
    !batalha.jogador.lutador.golpes[indiceGolpe]
  ) {
    return;
  }

  if (enviarEvento(EVENTOS.ESCOLHER_GOLPE, { indiceGolpe })) {
    estadoAplicacao.multijogador.aguardandoGolpe = true;
    estadoAplicacao.multijogador.ultimoIndiceGolpe = indiceGolpe;
    batalha.ocupada = true;
    atualizarDisponibilidadeGolpes();
    mostrarMensagemBatalha("Golpe enviado. Aguardando o adversário.");
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

function iniciarBatalhaMultijogador(dados) {
  const estadoRemoto = validarEstadoRemoto(dados?.estado, 2);

  if (!estadoRemoto) {
    mostrarAviso("O servidor enviou um estado de batalha inválido.");
    return;
  }

  estadoAplicacao.modoBatalha = "multijogador";
  estadoAplicacao.multijogador.situacao = "batalhando";
  estadoAplicacao.multijogador.aguardandoGolpe = false;
  estadoAplicacao.multijogador.revancheSolicitada = false;
  estadoAplicacao.multijogador.lutadorConfirmado = false;
  ocultarResultadoBatalha();

  if (!aplicarEstadoRemoto(estadoRemoto)) {
    mostrarAviso("Seu jogador não aparece no estado recebido.");
    return;
  }

  renderizarBatalha({ recriarGolpes: true });
  estadoAplicacao.historicoTelas = [];
  irParaTela("batalha", { registrarHistorico: false });
  mostrarMensagemBatalha("A batalha começou. Escolha um golpe.");
}

function aplicarResultadoTurno(dados) {
  const estadoRemoto = validarEstadoRemoto(dados?.estado, 2);
  const registros = validarRegistros(dados?.registros);

  if (!estadoRemoto || !registros) {
    mostrarAviso("O servidor enviou um resultado de turno inválido.");
    return;
  }

  estadoAplicacao.multijogador.aguardandoGolpe = false;

  if (!aplicarEstadoRemoto(estadoRemoto)) {
    mostrarAviso("Não foi possível atualizar a batalha.");
    return;
  }

  mostrarMensagemBatalha(
    registros.length ? registros.join(" ") : "Escolha seu próximo golpe.",
  );
  focarElemento(
    selecionar(
      `[data-golpe="${estadoAplicacao.multijogador.ultimoIndiceGolpe}"]`,
      exigirElemento("#lista-golpes"),
    ),
  );
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
  estadoAplicacao.multijogador.aguardandoGolpe = false;

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

function tratarOponenteDesconectado(dados) {
  const mensagem =
    typeof dados?.mensagem === "string" && dados.mensagem.length <= 500
      ? dados.mensagem
      : "O adversário se desconectou.";

  estadoAplicacao.multijogador.situacao = "aguardando";
  estadoAplicacao.multijogador.aguardandoGolpe = false;
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

  estadoAplicacao.multijogador.aguardandoGolpe = false;
  estadoAplicacao.multijogador.lutadorConfirmado = false;

  if (estadoAplicacao.telaAtual === "multijogador") {
    mostrarAcoesSala();
  } else if (estadoAplicacao.telaAtual === "equipe") {
    renderizarEquipe();
  } else if (estadoAplicacao.telaAtual === "batalha") {
    if (estadoAplicacao.batalha) {
      estadoAplicacao.batalha.ocupada = false;
      atualizarDisponibilidadeGolpes();
    }
    mostrarMensagemBatalha(mensagem);
  }

  mostrarAviso(mensagem);
}

function tratarEventoMultijogador(tipo, dados) {
  if (tipo === EVENTOS.CONEXAO) {
    if (typeof dados?.jogadorId !== "string" || !dados.jogadorId) {
      mostrarAviso("O servidor enviou uma identificação inválida.");
      return;
    }
    estadoAplicacao.multijogador.jogadorId = dados.jogadorId;
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
    estadoAplicacao.multijogador.lutadorConfirmado = false;
    estadoAplicacao.modoBatalha = "multijogador";
    renderizarEquipe();
    irParaTela("equipe", { registrarHistorico: false });
    mostrarAviso("Sala pronta. Escolha seu IFighter.");
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

  if (tipo === EVENTOS.OPONENTE_DESCONECTADO) {
    tratarOponenteDesconectado(dados);
    return;
  }

  if (tipo === EVENTOS.ERRO_SALA) {
    tratarErroSala(dados);
  }
}

function manipularMensagemMultijogador(evento) {
  if (typeof evento.data !== "string" || evento.data.length > 100_000) {
    mostrarAviso("O servidor enviou uma mensagem inválida.");
    return;
  }

  let mensagem;

  try {
    mensagem = JSON.parse(evento.data);
  } catch {
    mostrarAviso("O servidor enviou uma mensagem ilegível.");
    return;
  }

  if (
    !ehObjeto(mensagem) ||
    typeof mensagem.tipo !== "string" ||
    !Object.values(EVENTOS).includes(mensagem.tipo) ||
    (mensagem.dados !== undefined && !ehObjeto(mensagem.dados))
  ) {
    mostrarAviso("O servidor enviou uma mensagem fora do protocolo.");
    return;
  }

  tratarEventoMultijogador(mensagem.tipo, mensagem.dados ?? {});
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
  "confirmar-lutador": confirmarLutador,
  "ifdex-anterior": () =>
    selecionarItemIfdex(
      (estadoAplicacao.indiceIfdex - 1 + LUTADORES.length) % LUTADORES.length,
    ),
  "ifdex-proximo": () =>
    selecionarItemIfdex(
      (estadoAplicacao.indiceIfdex + 1) % LUTADORES.length,
    ),
  "sair-batalha": sairDaBatalha,
  "solicitar-revanche": solicitarRevanche,
  "rever-introducao": reverIntroducao,
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
    selecionarLutador(opcaoLutador.dataset.lutadorId, opcaoLutador);
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

  consultaMovimentoReduzido.addEventListener("change", (evento) => {
    if (!estadoAplicacao.configuracoes.animacoesDefinidas) {
      estadoAplicacao.configuracoes.animacoes = !evento.matches;
      aplicarConfiguracoes();
    }
  });

  window.addEventListener("pagehide", () => {
    desconectarMultijogador();
    cancelarTurnoLocal();
  });
}

function inicializar() {
  try {
    validarContratos();
    estadoAplicacao.lutadorSelecionadoId = LUTADORES[0].id;
    aplicarConfiguracoes();
    renderizarEquipe();
    renderizarIfdex();
    ocultarResultadoBatalha();
    registrarEventos();

    if (estadoAplicacao.configuracoes.reproduzirIntroducao) {
      prepararIntroducao();
      irParaTela("introducao", {
        registrarHistorico: false,
      });
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
