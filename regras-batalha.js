"use strict";

const TABELA_EFETIVIDADE = Object.freeze({
  NORMAL: Object.freeze({ PEDRA: 0.5, FANTASMA: 0, "AÇO": 0.5 }),
  FOGO: Object.freeze({
    FOGO: 0.5,
    "ÁGUA": 0.5,
    PLANTA: 2,
    GELO: 2,
    INSETO: 2,
    PEDRA: 0.5,
    DRAGÃO: 0.5,
    "AÇO": 2,
  }),
  "ÁGUA": Object.freeze({
    FOGO: 2,
    "ÁGUA": 0.5,
    PLANTA: 0.5,
    TERRESTRE: 2,
    PEDRA: 2,
    DRAGÃO: 0.5,
  }),
  "ELÉTRICO": Object.freeze({
    "ÁGUA": 2,
    "ELÉTRICO": 0.5,
    PLANTA: 0.5,
    TERRESTRE: 0,
    VOADOR: 2,
    DRAGÃO: 0.5,
  }),
  PLANTA: Object.freeze({
    FOGO: 0.5,
    "ÁGUA": 2,
    PLANTA: 0.5,
    VENENOSO: 0.5,
    TERRESTRE: 2,
    VOADOR: 0.5,
    INSETO: 0.5,
    PEDRA: 2,
    DRAGÃO: 0.5,
    "AÇO": 0.5,
  }),
  GELO: Object.freeze({
    FOGO: 0.5,
    "ÁGUA": 0.5,
    PLANTA: 2,
    GELO: 0.5,
    TERRESTRE: 2,
    VOADOR: 2,
    DRAGÃO: 2,
    "AÇO": 0.5,
  }),
  LUTADOR: Object.freeze({
    NORMAL: 2,
    GELO: 2,
    VENENOSO: 0.5,
    VOADOR: 0.5,
    "PSÍQUICO": 0.5,
    INSETO: 0.5,
    PEDRA: 2,
    FANTASMA: 0,
    SOMBRIO: 2,
    "AÇO": 2,
    FADA: 0.5,
  }),
  VENENOSO: Object.freeze({
    PLANTA: 2,
    VENENOSO: 0.5,
    TERRESTRE: 0.5,
    PEDRA: 0.5,
    FANTASMA: 0.5,
    "AÇO": 0,
    FADA: 2,
  }),
  TERRESTRE: Object.freeze({
    FOGO: 2,
    "ELÉTRICO": 2,
    PLANTA: 0.5,
    VENENOSO: 2,
    VOADOR: 0,
    INSETO: 0.5,
    PEDRA: 2,
    "AÇO": 2,
  }),
  VOADOR: Object.freeze({
    "ELÉTRICO": 0.5,
    PLANTA: 2,
    LUTADOR: 2,
    INSETO: 2,
    PEDRA: 0.5,
    "AÇO": 0.5,
  }),
  "PSÍQUICO": Object.freeze({
    LUTADOR: 2,
    VENENOSO: 2,
    "PSÍQUICO": 0.5,
    SOMBRIO: 0,
    "AÇO": 0.5,
  }),
  INSETO: Object.freeze({
    FOGO: 0.5,
    PLANTA: 2,
    LUTADOR: 0.5,
    VENENOSO: 0.5,
    VOADOR: 0.5,
    "PSÍQUICO": 2,
    FANTASMA: 0.5,
    SOMBRIO: 2,
    "AÇO": 0.5,
    FADA: 0.5,
  }),
  PEDRA: Object.freeze({
    FOGO: 2,
    GELO: 2,
    LUTADOR: 0.5,
    TERRESTRE: 0.5,
    VOADOR: 2,
    INSETO: 2,
    "AÇO": 0.5,
  }),
  FANTASMA: Object.freeze({
    NORMAL: 0,
    "PSÍQUICO": 2,
    FANTASMA: 2,
    SOMBRIO: 0.5,
  }),
  DRAGÃO: Object.freeze({ DRAGÃO: 2, "AÇO": 0.5, FADA: 0 }),
  SOMBRIO: Object.freeze({
    LUTADOR: 0.5,
    "PSÍQUICO": 2,
    FANTASMA: 2,
    SOMBRIO: 0.5,
    FADA: 0.5,
  }),
  "AÇO": Object.freeze({
    FOGO: 0.5,
    "ÁGUA": 0.5,
    "ELÉTRICO": 0.5,
    GELO: 2,
    PEDRA: 2,
    "AÇO": 0.5,
    FADA: 2,
  }),
  FADA: Object.freeze({
    FOGO: 0.5,
    LUTADOR: 2,
    VENENOSO: 0.5,
    DRAGÃO: 2,
    SOMBRIO: 2,
    "AÇO": 0.5,
  }),
});

function normalizarTipos(tipos) {
  if (typeof tipos === "string") {
    return [tipos];
  }

  return Array.isArray(tipos) ? [...new Set(tipos)] : [];
}

function calcularEfetividade(tipoGolpe, tiposDefensor) {
  const relacoes = TABELA_EFETIVIDADE[tipoGolpe];

  return normalizarTipos(tiposDefensor).reduce(
    (multiplicador, tipoDefensor) =>
      multiplicador * (relacoes?.[tipoDefensor] ?? 1),
    1,
  );
}

function calcularDanoDetalhado(atacante, defensor, golpe) {
  const multiplicadorEfetividade = calcularEfetividade(
    golpe?.tipo,
    defensor?.tipos,
  );
  const multiplicadorStab = normalizarTipos(atacante?.tipos).includes(
    golpe?.tipo,
  )
    ? 1.5
    : 1;
  const multiplicadorTotal =
    multiplicadorStab * multiplicadorEfetividade;

  if (
    !golpe ||
    !Number.isFinite(golpe.poder) ||
    golpe.poder <= 0 ||
    !Number.isFinite(atacante?.atributos?.ataque) ||
    !Number.isFinite(defensor?.atributos?.defesa)
  ) {
    return {
      dano: 0,
      danoBase: 0,
      imune: multiplicadorEfetividade === 0,
      multiplicadorEfetividade,
      multiplicadorStab,
      multiplicadorTotal,
    };
  }

  const nivel = 50;
  const defesa = Math.max(1, defensor.atributos.defesa);
  const danoBase = Math.max(
    2,
    Math.floor(
      (((2 * nivel) / 5 + 2) *
        golpe.poder *
        atacante.atributos.ataque) /
        defesa /
        50 +
        2,
    ),
  );
  const dano =
    multiplicadorEfetividade === 0
      ? 0
      : Math.max(1, Math.floor(danoBase * multiplicadorTotal));

  return {
    dano,
    danoBase,
    imune: multiplicadorEfetividade === 0,
    multiplicadorEfetividade,
    multiplicadorStab,
    multiplicadorTotal,
  };
}

function pontuarGolpeIA(atacante, defensor, golpe) {
  if (!Number.isFinite(golpe?.precisao) || golpe.precisao <= 0) {
    return 0;
  }

  const { dano } = calcularDanoDetalhado(atacante, defensor, golpe);
  const chanceDeAcerto = Math.min(100, golpe.precisao) / 100;
  return dano * chanceDeAcerto;
}

function escolherGolpeIA(atacante, defensor, aleatorio = Math.random) {
  const golpes = Array.isArray(atacante?.golpes) ? atacante.golpes : [];

  if (!golpes.length) {
    return null;
  }

  const pontuacoes = golpes.map((golpe) =>
    pontuarGolpeIA(atacante, defensor, golpe),
  );
  const melhorPontuacao = Math.max(...pontuacoes);
  const melhoresGolpes = golpes.filter(
    (_golpe, indice) => pontuacoes[indice] === melhorPontuacao,
  );

  if (melhoresGolpes.length === 1) {
    return melhoresGolpes[0];
  }

  const sorteio = Number(aleatorio());
  const valorSeguro = Number.isFinite(sorteio)
    ? Math.min(Math.max(sorteio, 0), 1 - Number.EPSILON)
    : 0;

  return melhoresGolpes[Math.floor(valorSeguro * melhoresGolpes.length)];
}

const REGRAS_BATALHA = Object.freeze({
  TABELA_EFETIVIDADE,
  calcularDano(atacante, defensor, golpe) {
    return calcularDanoDetalhado(atacante, defensor, golpe).dano;
  },
  calcularDanoDetalhado,
  calcularEfetividade,
  escolherGolpeIA,

  golpeAcertou(golpe, aleatorio = Math.random) {
    return aleatorio() * 100 < golpe.precisao;
  },

  ordenarAcoes(primeiraAcao, segundaAcao, aleatorio = Math.random) {
    const diferencaPrioridade =
      segundaAcao.golpe.prioridade - primeiraAcao.golpe.prioridade;

    if (diferencaPrioridade !== 0) {
      return diferencaPrioridade < 0
        ? [primeiraAcao, segundaAcao]
        : [segundaAcao, primeiraAcao];
    }

    const diferencaVelocidade =
      segundaAcao.atacante.atributos.velocidade -
      primeiraAcao.atacante.atributos.velocidade;

    if (diferencaVelocidade !== 0) {
      return diferencaVelocidade < 0
        ? [primeiraAcao, segundaAcao]
        : [segundaAcao, primeiraAcao];
    }

    return aleatorio() < 0.5
      ? [primeiraAcao, segundaAcao]
      : [segundaAcao, primeiraAcao];
  },
  pontuarGolpeIA,
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = REGRAS_BATALHA;
}
