const { test } = require("node:test");
const assert = require("node:assert/strict");

const REGRAS_BATALHA = require("../regras-batalha");

function criarLutador({ ataque = 80, defesa = 60, velocidade = 50 } = {}) {
  return {
    atributos: {
      ataque,
      defesa,
      velocidade,
    },
  };
}

function criarAcao({ velocidade, prioridade = 0 } = {}) {
  return {
    atacante: criarLutador({ velocidade }),
    golpe: {
      prioridade,
    },
  };
}

test("calcula o dano e respeita o valor mínimo", () => {
  const atacante = criarLutador({ ataque: 80 });
  const defensor = criarLutador({ defesa: 60 });

  assert.equal(
    REGRAS_BATALHA.calcularDano(atacante, defensor, { poder: 50 }),
    70,
  );

  assert.equal(
    REGRAS_BATALHA.calcularDano(
      criarLutador({ ataque: 1 }),
      criarLutador({ defesa: 100 }),
      { poder: 1 },
    ),
    8,
  );

  assert.equal(
    REGRAS_BATALHA.calcularDano(atacante, defensor, { poder: 0 }),
    0,
  );
});

test("considera a precisão nos limites corretos", () => {
  const golpe = { precisao: 95 };

  assert.equal(REGRAS_BATALHA.golpeAcertou(golpe, () => 0.9499), true);
  assert.equal(REGRAS_BATALHA.golpeAcertou(golpe, () => 0.95), false);
});

test("ordena por prioridade antes da velocidade", () => {
  const rapido = criarAcao({ velocidade: 100, prioridade: 0 });
  const prioritario = criarAcao({ velocidade: 10, prioridade: 1 });

  assert.deepEqual(
    REGRAS_BATALHA.ordenarAcoes(rapido, prioritario),
    [prioritario, rapido],
  );
});

test("ordena por velocidade quando a prioridade empata", () => {
  const lento = criarAcao({ velocidade: 10, prioridade: 0 });
  const rapido = criarAcao({ velocidade: 100, prioridade: 0 });

  assert.deepEqual(REGRAS_BATALHA.ordenarAcoes(lento, rapido), [rapido, lento]);
});

test("usa o desempate aleatório somente quando necessário", () => {
  const primeira = criarAcao({ velocidade: 50, prioridade: 0 });
  const segunda = criarAcao({ velocidade: 50, prioridade: 0 });

  assert.deepEqual(
    REGRAS_BATALHA.ordenarAcoes(primeira, segunda, () => 0.1),
    [primeira, segunda],
  );
  assert.deepEqual(
    REGRAS_BATALHA.ordenarAcoes(primeira, segunda, () => 0.9),
    [segunda, primeira],
  );
});
