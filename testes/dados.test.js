const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LUTADORES = require("../data");

const TIPOS = new Set([
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
]);

const IFDEX_ESPERADA = Object.freeze({
  arth: [7, "Squirtle", ["ÁGUA"], ["water-gun", "bite", "aqua-jet", "ice-beam"]],
  bertuol: [644, "Zekrom", ["DRAGÃO", "ELÉTRICO"], ["bolt-strike", "dragon-claw", "crunch", "zen-headbutt"]],
  bocussi: [920, "Lokix", ["INSETO", "SOMBRIO"], ["first-impression", "lunge", "throat-chop", "sucker-punch"]],
  "cara-da-ti": [500, "Emboar", ["FOGO", "LUTADOR"], ["flare-blitz", "hammer-arm", "head-smash", "wild-charge"]],
  caua: [260, "Swampert", ["ÁGUA", "TERRESTRE"], ["mud-shot", "liquidation", "earthquake", "ice-punch"]],
  cleci: [180, "Flaaffy", ["ELÉTRICO"], ["discharge", "power-gem", "thunder-punch", "thunderbolt"]],
  coelho: [815, "Cinderace", ["FOGO"], ["pyro-ball", "double-kick", "quick-attack", "u-turn"]],
  conceicao: [730, "Primarina", ["ÁGUA", "FADA"], ["sparkling-aria", "moonblast", "aqua-jet", "psychic"]],
  dalcin: [806, "Blacephalon", ["FOGO", "FANTASMA"], ["mind-blown", "shadow-ball", "flamethrower", "astonish"]],
  davi: [11, "Metapod", ["INSETO"], ["bug-bite", "electroweb", "tackle", "struggle"]],
  eraldo: [377, "Regirock", ["PEDRA"], ["stone-edge", "hammer-arm", "zap-cannon", "stomp"]],
  filipe: [467, "Magmortar", ["FOGO"], ["flamethrower", "thunderbolt", "psychic", "mach-punch"]],
  flores: [376, "Metagross", ["AÇO", "PSÍQUICO"], ["meteor-mash", "zen-headbutt", "bullet-punch", "earthquake"]],
  jeferson: [486, "Regigigas", ["NORMAL"], ["crush-grip", "giga-impact", "knock-off", "hammer-arm"]],
  kilder: [778, "Mimikyu", ["FANTASMA", "FADA"], ["play-rough", "shadow-claw", "shadow-sneak", "wood-hammer"]],
  kurt: [807, "Zeraora", ["ELÉTRICO"], ["plasma-fists", "close-combat", "volt-switch", "quick-attack"]],
  laura: [470, "Leafeon", ["PLANTA"], ["leaf-blade", "quick-attack", "dig", "x-scissor"]],
  lazzari: [1, "Bulbasaur", ["PLANTA", "VENENOSO"], ["vine-whip", "razor-leaf", "sludge-bomb", "seed-bomb"]],
  leonardo: [448, "Lucario", ["LUTADOR", "AÇO"], ["aura-sphere", "metal-claw", "bone-rush", "quick-attack"]],
  lima: [34, "Nidoking", ["VENENOSO", "TERRESTRE"], ["poison-jab", "earth-power", "megahorn", "ice-beam"]],
  lucas: [97, "Hypno", ["PSÍQUICO"], ["psychic", "psyshock", "zen-headbutt", "shadow-ball"]],
  luiz: [794, "Buzzwole", ["INSETO", "LUTADOR"], ["leech-life", "superpower", "lunge", "ice-punch"]],
  manfredini: [28, "Sandslash", ["TERRESTRE"], ["drill-run", "earthquake", "slash", "x-scissor"]],
  marcelo: [194, "Wooper", ["ÁGUA", "TERRESTRE"], ["water-gun", "mud-shot", "slam", "mud-bomb"]],
  marcos: [657, "Frogadier", ["ÁGUA"], ["water-pulse", "quick-attack", "bounce", "ice-beam"]],
  mateus: [650, "Chespin", ["PLANTA"], ["vine-whip", "bite", "pin-missile", "seed-bomb"]],
  mineia: [648, "Meloetta", ["NORMAL", "PSÍQUICO"], ["relic-song", "psychic", "hyper-voice", "quick-attack"]],
  mohamed: [214, "Heracross", ["INSETO", "LUTADOR"], ["megahorn", "close-combat", "bullet-seed", "aerial-ace"]],
  mussato: [274, "Nuzleaf", ["PLANTA", "SOMBRIO"], ["leaf-blade", "foul-play", "extrasensory", "razor-leaf"]],
  patrick: [493, "Arceus", ["NORMAL"], ["judgment", "extreme-speed", "earth-power", "shadow-claw"]],
  pedro: [151, "Mew", ["PSÍQUICO"], ["psychic", "aura-sphere", "ice-beam", "ancient-power"]],
  presidente: [471, "Glaceon", ["GELO"], ["ice-beam", "freeze-dry", "quick-attack", "shadow-ball"]],
  roque: [4, "Charmander", ["FOGO"], ["ember", "dragon-breath", "scratch", "flame-charge"]],
  sandro: [94, "Gengar", ["FANTASMA", "VENENOSO"], ["shadow-ball", "sludge-bomb", "lick", "dark-pulse"]],
  somacal: [724, "Decidueye", ["PLANTA", "FANTASMA"], ["spirit-shackle", "leaf-blade", "brave-bird", "shadow-sneak"]],
  tibolla: [479, "Rotom", ["ELÉTRICO", "FANTASMA"], ["thunderbolt", "shadow-ball", "discharge", "astonish"]],
  witt: [103, "Exeggutor", ["PLANTA", "DRAGÃO"], ["dragon-hammer", "dragon-pulse", "psychic", "solar-beam"]],
});

const NOMES_ESPERADOS = [
  "Arth",
  "Bertuol",
  "Bocussi",
  "Cara da TI",
  "Cauã",
  "Cleci",
  "Coelho",
  "Conceição",
  "Dalcin",
  "Davi",
  "Eraldo",
  "Filipe",
  "Flores",
  "Jeferson",
  "Kilder",
  "Kurt",
  "Laura",
  "Lazzari",
  "Leonardo",
  "Lima",
  "Lucas",
  "Luiz",
  "Manfredini",
  "Marcelo",
  "Marcos",
  "Mateus",
  "Mineia",
  "Mohamed",
  "Mussato",
  "Patrick",
  "Pedro",
  "Presidente",
  "Roque",
  "Sandro",
  "Somacal",
  "Tibolla",
  "Witt",
];

function caminhoNoProjeto(caminho) {
  return path.resolve(__dirname, "..", caminho);
}

function slugDoNomeOriginal(nome) {
  return nome
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, "-");
}

test("a IFDEX contém todos os sprites e está em ordem alfabética", () => {
  const compararNomes = new Intl.Collator("pt-BR", {
    sensitivity: "base",
  }).compare;

  assert.equal(LUTADORES.length, 37);
  assert.deepEqual(
    LUTADORES.map(({ nome }) => nome),
    NOMES_ESPERADOS,
  );
  assert.deepEqual(NOMES_ESPERADOS, [...NOMES_ESPERADOS].sort(compararNomes));
  assert.deepEqual(
    LUTADORES.map(({ id }) => id),
    Object.keys(IFDEX_ESPERADA),
  );

  const pastaSprites = caminhoNoProjeto("img/sprites");
  const arquivosDeSprite = fs.readdirSync(pastaSprites);
  assert.ok(
    arquivosDeSprite.every((arquivo) => arquivo.endsWith(".png")),
    "todos os sprites devem usar PNG",
  );
  const spritesNoDisco = arquivosDeSprite
    .map((arquivo) => `img/sprites/${arquivo}`)
    .sort();
  const spritesCatalogados = LUTADORES.map(({ sprite }) => sprite).sort();

  assert.deepEqual(spritesCatalogados, spritesNoDisco);
});

test("cada IFighter possui identidade, tipos, atributos e learnset válidos", () => {
  const ids = new Set();
  const numeros = new Set();

  for (const lutador of LUTADORES) {
    const [numero, forma, tipos, golpes] = IFDEX_ESPERADA[lutador.id];

    assert.match(lutador.id, /^[a-z0-9-]+$/);
    assert.equal(ids.has(lutador.id), false, lutador.id);
    ids.add(lutador.id);

    assert.equal(lutador.numero, numero, lutador.id);
    assert.equal(numeros.has(numero), false, `número ${numero}`);
    numeros.add(numero);
    assert.equal(lutador.forma, forma, lutador.id);
    assert.deepEqual(lutador.tipos, tipos, lutador.id);
    assert.ok(lutador.tipos.every((tipo) => TIPOS.has(tipo)), lutador.id);
    assert.equal(new Set(lutador.tipos).size, lutador.tipos.length, lutador.id);

    assert.ok(lutador.nome.length > 0);
    assert.ok(lutador.descricao.length >= 20, lutador.id);
    assert.match(lutador.sprite, /^img\/sprites\/[a-z0-9-]+\.png$/);
    assert.equal(fs.existsSync(caminhoNoProjeto(lutador.sprite)), true, lutador.sprite);

    for (const atributo of ["vida", "ataque", "defesa", "velocidade"]) {
      assert.ok(Number.isInteger(lutador.atributos[atributo]), `${lutador.id}.${atributo}`);
      assert.ok(lutador.atributos[atributo] > 0, `${lutador.id}.${atributo}`);
    }

    assert.deepEqual(
      lutador.golpes.map(({ id }) => id),
      golpes,
      lutador.id,
    );
    assert.equal(new Set(golpes).size, 4, lutador.id);
    assert.equal(Object.isFrozen(lutador), true, lutador.id);
    assert.equal(Object.isFrozen(lutador.tipos), true, lutador.id);
    assert.equal(Object.isFrozen(lutador.atributos), true, lutador.id);
    assert.equal(Object.isFrozen(lutador.golpes), true, lutador.id);
  }
});

test("os golpes mantêm referência canônica e valores seguros para a batalha", () => {
  const golpesPorId = new Map();

  for (const golpe of LUTADORES.flatMap(({ golpes }) => golpes)) {
    const golpeConhecido = golpesPorId.get(golpe.id);

    if (golpeConhecido) {
      assert.equal(golpe, golpeConhecido, golpe.id);
      continue;
    }

    golpesPorId.set(golpe.id, golpe);
    assert.equal(slugDoNomeOriginal(golpe.nomeOriginal), golpe.id);
    assert.ok(golpe.nome.length > 0, golpe.id);
    assert.ok(TIPOS.has(golpe.tipo), golpe.id);
    assert.ok(["FÍSICO", "ESPECIAL"].includes(golpe.categoria), golpe.id);
    assert.ok(Number.isInteger(golpe.poderBase) && golpe.poderBase > 0, golpe.id);
    assert.equal(
      golpe.poder,
      Math.min(65, Math.round(30 + golpe.poderBase * 0.25)),
      golpe.id,
    );
    assert.ok(golpe.precisao > 0 && golpe.precisao <= 100, golpe.id);
    assert.ok(Number.isInteger(golpe.prioridade), golpe.id);
    assert.equal(Object.isFrozen(golpe), true, golpe.id);
  }

  assert.ok(golpesPorId.size >= 80);
});

test("os nomes corrigidos não regridem para traduções inventadas", () => {
  const esperados = {
    "aura-sphere": ["Aura Esférica", "Aura Sphere"],
    "bolt-strike": ["Ataque de Raios", "Bolt Strike"],
    "dragon-hammer": ["Martelo Dragão", "Dragon Hammer"],
    "leaf-blade": ["Lâmina de Folha", "Leaf Blade"],
    liquidation: ["Aquaríete", "Liquidation"],
    "metal-claw": ["Garra de Metal", "Metal Claw"],
    "meteor-mash": ["Meteoro Esmagador", "Meteor Mash"],
    "mind-blown": ["Explosão Mental", "Mind Blown"],
    "pyro-ball": ["Bola Incendiária", "Pyro Ball"],
    "spirit-shackle": ["Manilha Sombria", "Spirit Shackle"],
    thunderbolt: ["Relâmpago", "Thunderbolt"],
    "water-gun": ["Revólver d'Água", "Water Gun"],
  };
  const golpes = new Map(
    LUTADORES.flatMap(({ golpes: movimentos }) =>
      movimentos.map((golpe) => [golpe.id, golpe]),
    ),
  );

  for (const [id, [nome, nomeOriginal]] of Object.entries(esperados)) {
    assert.equal(golpes.get(id)?.nome, nome, id);
    assert.equal(golpes.get(id)?.nomeOriginal, nomeOriginal, id);
  }
});
