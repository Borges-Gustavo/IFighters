const { test } = require("node:test");
const assert = require("node:assert/strict");

const REGRAS_BATALHA = require("../regras-batalha");

function criarLutador({
  ataque = 80,
  defesa = 60,
  golpes = [],
  tipos = [],
  velocidade = 50,
} = {}) {
  return {
    atributos: {
      ataque,
      defesa,
      velocidade,
    },
    golpes,
    tipos,
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
    31,
  );

  assert.equal(
    REGRAS_BATALHA.calcularDano(
      criarLutador({ ataque: 1 }),
      criarLutador({ defesa: 100 }),
      { poder: 1 },
    ),
    2,
  );

  assert.equal(
    REGRAS_BATALHA.calcularDano(atacante, defensor, { poder: 0 }),
    0,
  );
});

test("expõe a tabela completa com os dezoito tipos usados pelo jogo", () => {
  const tipos = [
    "AÇO",
    "ÁGUA",
    "DRAGÃO",
    "ELÉTRICO",
    "FADA",
    "FANTASMA",
    "FOGO",
    "GELO",
    "INSETO",
    "LUTADOR",
    "NORMAL",
    "PEDRA",
    "PLANTA",
    "PSÍQUICO",
    "SOMBRIO",
    "TERRESTRE",
    "VENENOSO",
    "VOADOR",
  ];

  assert.deepEqual(
    Object.keys(REGRAS_BATALHA.TABELA_EFETIVIDADE).sort(),
    [...tipos].sort(),
  );
  assert.equal(Object.isFrozen(REGRAS_BATALHA.TABELA_EFETIVIDADE), true);

  for (const tipo of tipos) {
    const relacoes = REGRAS_BATALHA.TABELA_EFETIVIDADE[tipo];
    assert.equal(
      Object.isFrozen(relacoes),
      true,
      tipo,
    );

    for (const [tipoDefensor, multiplicador] of Object.entries(relacoes)) {
      assert.ok(tipos.includes(tipoDefensor), `${tipo} contra ${tipoDefensor}`);
      assert.ok(
        [0, 0.5, 2].includes(multiplicador),
        `${tipo} contra ${tipoDefensor}`,
      );
    }
  }
});

test("calcula efetividade neutra, resistência, fraqueza e dupla tipagem", () => {
  assert.equal(REGRAS_BATALHA.calcularEfetividade("NORMAL", ["NORMAL"]), 1);
  assert.equal(REGRAS_BATALHA.calcularEfetividade("FOGO", ["ÁGUA"]), 0.5);
  assert.equal(REGRAS_BATALHA.calcularEfetividade("ÁGUA", ["FOGO"]), 2);
  assert.equal(
    REGRAS_BATALHA.calcularEfetividade("PLANTA", ["ÁGUA", "TERRESTRE"]),
    4,
  );
  assert.equal(
    REGRAS_BATALHA.calcularEfetividade("PLANTA", ["FOGO", "VOADOR"]),
    0.25,
  );
});

test("respeita todas as imunidades entre tipos", () => {
  const imunidades = [
    ["NORMAL", "FANTASMA"],
    ["ELÉTRICO", "TERRESTRE"],
    ["LUTADOR", "FANTASMA"],
    ["VENENOSO", "AÇO"],
    ["TERRESTRE", "VOADOR"],
    ["PSÍQUICO", "SOMBRIO"],
    ["FANTASMA", "NORMAL"],
    ["DRAGÃO", "FADA"],
  ];

  for (const [tipoGolpe, tipoDefensor] of imunidades) {
    assert.equal(
      REGRAS_BATALHA.calcularEfetividade(tipoGolpe, [tipoDefensor]),
      0,
      `${tipoGolpe} contra ${tipoDefensor}`,
    );
  }
});

test("o dano detalhado aplica STAB, efetividade e imunidade", () => {
  const atacante = criarLutador({ tipos: ["FOGO"] });
  const defensor = criarLutador({ tipos: ["PLANTA"] });
  const golpe = { poder: 50, precisao: 100, tipo: "FOGO" };
  const detalhe = REGRAS_BATALHA.calcularDanoDetalhado(
    atacante,
    defensor,
    golpe,
  );

  assert.deepEqual(detalhe, {
    dano: 93,
    danoBase: 31,
    imune: false,
    multiplicadorEfetividade: 2,
    multiplicadorStab: 1.5,
    multiplicadorTotal: 3,
  });
  assert.equal(REGRAS_BATALHA.calcularDano(atacante, defensor, golpe), 93);

  const imune = REGRAS_BATALHA.calcularDanoDetalhado(
    criarLutador({ tipos: ["ELÉTRICO"] }),
    criarLutador({ tipos: ["TERRESTRE"] }),
    { poder: 50, precisao: 100, tipo: "ELÉTRICO" },
  );
  assert.equal(imune.dano, 0);
  assert.equal(imune.imune, true);
  assert.equal(imune.multiplicadorEfetividade, 0);
});

test("pontua golpes da IA pelo dano esperado, incluindo a precisão", () => {
  const atacante = criarLutador({ tipos: ["NORMAL"] });
  const defensor = criarLutador({ tipos: ["NORMAL"] });
  const arriscado = {
    id: "arriscado",
    poder: 100,
    precisao: 50,
    tipo: "NORMAL",
  };
  const confiavel = {
    id: "confiavel",
    poder: 50,
    precisao: 100,
    tipo: "NORMAL",
  };

  assert.equal(
    REGRAS_BATALHA.pontuarGolpeIA(atacante, defensor, arriscado),
    45,
  );
  assert.equal(
    REGRAS_BATALHA.pontuarGolpeIA(atacante, defensor, confiavel),
    46,
  );

  atacante.golpes = [arriscado, confiavel];
  let sorteios = 0;
  assert.equal(
    REGRAS_BATALHA.escolherGolpeIA(atacante, defensor, () => {
      sorteios += 1;
      return 0;
    }),
    confiavel,
  );
  assert.equal(sorteios, 0);
});

test("a IA evita imunidade e usa o RNG injetado somente para desempatar", () => {
  const imune = {
    id: "imune",
    poder: 100,
    precisao: 100,
    tipo: "ELÉTRICO",
  };
  const primeiro = {
    id: "primeiro",
    poder: 50,
    precisao: 100,
    tipo: "NORMAL",
  };
  const segundo = { ...primeiro, id: "segundo" };
  const atacante = criarLutador({
    golpes: [imune, primeiro, segundo],
    tipos: ["ELÉTRICO"],
  });
  const defensor = criarLutador({ tipos: ["TERRESTRE"] });

  assert.equal(
    REGRAS_BATALHA.escolherGolpeIA(atacante, defensor, () => 0),
    primeiro,
  );
  assert.equal(
    REGRAS_BATALHA.escolherGolpeIA(atacante, defensor, () => 0.9999),
    segundo,
  );
  assert.equal(
    REGRAS_BATALHA.escolherGolpeIA(
      criarLutador({ golpes: [] }),
      defensor,
    ),
    null,
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
