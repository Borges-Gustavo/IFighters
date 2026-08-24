const { test } = require("node:test");
const assert = require("node:assert/strict");

const LUTADORES = require("../data");
const REGRAS_BATALHA = require("../regras-batalha");

function criarAleatorio(sementeInicial) {
  let semente = sementeInicial >>> 0;

  return () => {
    semente = (1664525 * semente + 1013904223) >>> 0;
    return semente / 2 ** 32;
  };
}

function simularBatalha(equipeA, equipeB, aleatorio) {
  const equipes = [equipeA, equipeB];
  const vidas = equipes.map((equipe) =>
    equipe.map((lutador) => lutador.atributos.vida),
  );
  const ativos = [0, 0];

  for (let turno = 1; turno <= 80; turno += 1) {
    const lutadoresAtivos = equipes.map(
      (equipe, lado) => equipe[ativos[lado]],
    );
    const golpes = [
      REGRAS_BATALHA.escolherGolpeIA(
        lutadoresAtivos[0],
        lutadoresAtivos[1],
        aleatorio,
      ),
      REGRAS_BATALHA.escolherGolpeIA(
        lutadoresAtivos[1],
        lutadoresAtivos[0],
        aleatorio,
      ),
    ];
    const acoes = REGRAS_BATALHA.ordenarAcoes(
      { atacante: lutadoresAtivos[0], golpe: golpes[0], lado: 0 },
      { atacante: lutadoresAtivos[1], golpe: golpes[1], lado: 1 },
      aleatorio,
    );

    for (const acao of acoes) {
      const alvo = acao.lado === 0 ? 1 : 0;
      if (
        vidas[acao.lado][ativos[acao.lado]] <= 0 ||
        vidas[alvo][ativos[alvo]] <= 0 ||
        !REGRAS_BATALHA.golpeAcertou(acao.golpe, aleatorio)
      ) {
        continue;
      }

      const dano = REGRAS_BATALHA.calcularDano(
        acao.atacante,
        equipes[alvo][ativos[alvo]],
        acao.golpe,
      );
      vidas[alvo][ativos[alvo]] = Math.max(
        0,
        vidas[alvo][ativos[alvo]] - dano,
      );
    }

    for (let lado = 0; lado < 2; lado += 1) {
      while (
        ativos[lado] < equipes[lado].length &&
        vidas[lado][ativos[lado]] <= 0
      ) {
        ativos[lado] += 1;
      }
    }

    const derrotados = ativos.map(
      (indiceAtivo, lado) => indiceAtivo >= equipes[lado].length,
    );
    if (derrotados.some(Boolean)) {
      return {
        empate: derrotados.every(Boolean),
        turno,
        vencedor: derrotados[0] ? 1 : 0,
      };
    }
  }

  return null;
}

test("todo confronto da IFDEX possui ao menos um golpe capaz de causar dano", () => {
  for (const atacante of LUTADORES) {
    for (const defensor of LUTADORES) {
      if (atacante === defensor) {
        continue;
      }

      const danos = atacante.golpes.map((golpe) =>
        REGRAS_BATALHA.calcularDano(atacante, defensor, golpe),
      );
      assert.ok(
        danos.some((dano) => dano > 0),
        `${atacante.id} não consegue atingir ${defensor.id}`,
      );

      const escolhaDaIa = REGRAS_BATALHA.escolherGolpeIA(
        atacante,
        defensor,
        () => 0.5,
      );
      assert.ok(
        REGRAS_BATALHA.calcularDano(atacante, defensor, escolhaDaIa) > 0,
        `a IA de ${atacante.id} escolheu uma imunidade contra ${defensor.id}`,
      );
    }
  }
});

test("equipes completas controladas pela IA sempre encerram a batalha", () => {
  const duracoes = [];

  for (let indice = 0; indice < LUTADORES.length; indice += 1) {
    const obter = (deslocamento) =>
      LUTADORES[(indice + deslocamento) % LUTADORES.length];
    const resultado = simularBatalha(
      [obter(0), obter(1), obter(2)],
      [obter(3), obter(4), obter(5)],
      criarAleatorio(0x1f17e000 + indice),
    );

    assert.ok(resultado, `a simulação ${indice + 1} não terminou`);
    assert.equal(resultado.empate, false, `empate simultâneo na simulação ${indice + 1}`);
    duracoes.push(resultado.turno);
  }

  assert.ok(Math.max(...duracoes) < 30, "há uma batalha excessivamente longa");
  assert.ok(
    duracoes.reduce((total, duracao) => total + duracao, 0) /
      duracoes.length <
      15,
    "a duração média das batalhas está acima do esperado",
  );
});
