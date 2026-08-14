const REGRAS_BATALHA = Object.freeze({
  calcularDano(atacante, defensor, golpe) {
    if (!golpe || golpe.poder <= 0) {
      return 0;
    }

    const danoBase =
      (golpe.poder +
        atacante.atributos.ataque -
        defensor.atributos.defesa / 2) *
      0.7;

    return Math.max(8, Math.floor(danoBase));
  },

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
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = REGRAS_BATALHA;
}
