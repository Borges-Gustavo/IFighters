const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(RAIZ, "main.html"), "utf8");
const CSS = fs.readFileSync(path.join(RAIZ, "style.css"), "utf8");
const APP = fs.readFileSync(path.join(RAIZ, "app.js"), "utf8");

function capturarTodos(expressao, texto) {
  return [...texto.matchAll(expressao)].map((resultado) => resultado[1]);
}

test("o HTML usa português e não repete identificadores", () => {
  assert.match(HTML, /<html lang="pt-BR">/);

  const identificadores = capturarTodos(/\sid="([^"]+)"/g, HTML);
  assert.equal(new Set(identificadores).size, identificadores.length);

  const telas = capturarTodos(/\sdata-tela="([^"]+)"/g, HTML);
  assert.ok(telas.length > 0);
  assert.equal(new Set(telas).size, telas.length);
});

test("todas as referências locais do HTML existem", () => {
  const referencias = capturarTodos(/\s(?:href|src)="([^"]+)"/g, HTML)
    .filter((referencia) => !/^(?:[a-z]+:|#)/i.test(referencia));

  for (const referencia of referencias) {
    const caminho = path.resolve(RAIZ, decodeURIComponent(referencia));
    assert.equal(fs.existsSync(caminho), true, referencia);
  }
});

test("os relacionamentos ARIA apontam para elementos existentes", () => {
  const identificadores = new Set(
    capturarTodos(/\sid="([^"]+)"/g, HTML),
  );
  const relacionamentos = capturarTodos(
    /\saria-(?:describedby|labelledby)="([^"]+)"/g,
    HTML,
  );

  for (const relacionamento of relacionamentos) {
    for (const identificador of relacionamento.split(/\s+/)) {
      assert.equal(identificadores.has(identificador), true, identificador);
    }
  }
});

test("as classes estáticas do HTML possuem regras de estilo", () => {
  const classes = new Set(
    capturarTodos(/\sclass="([^"]+)"/g, HTML).flatMap((valor) =>
      valor.split(/\s+/),
    ),
  );

  for (const classe of classes) {
    assert.ok(CSS.includes(`.${classe}`), classe);
  }
});

test("os módulos compartilhados carregam antes da aplicação", () => {
  const scripts = capturarTodos(/<script src="([^"]+)"/g, HTML);

  assert.deepEqual(scripts, [
    "data.js",
    "protocol.js",
    "regras-batalha.js",
    "app.js",
  ]);
});

test("todas as ações declaradas no HTML possuem um manipulador", () => {
  const acoes = new Set(capturarTodos(/\sdata-acao="([^"]+)"/g, HTML));

  for (const acao of acoes) {
    const chave = acao.includes("-") ? `"${acao}"` : `${acao}:`;
    assert.ok(APP.includes(chave), acao);
  }
});

test("o menu principal de cada turno mostra somente Lutar e Pokémon", () => {
  const menu = HTML.match(
    /<div\s+id="menu-acoes-batalha"[\s\S]*?<\/div>/,
  )?.[0];

  assert.ok(menu);
  const rotulos = capturarTodos(
    /<button[\s\S]*?data-acao="batalha-[^"]+"[\s\S]*?>\s*([^<]+?)\s*<\/button>/g,
    menu,
  ).map((rotulo) => rotulo.trim());

  assert.deepEqual(rotulos, ["LUTAR", "POKÉMON"]);
  assert.match(HTML, /id="painel-golpes"[\s\S]*?hidden/);
  assert.match(HTML, /id="painel-equipe-batalha"[\s\S]*?hidden/);
});

test("a interface monta equipes de três e envia ações tipadas", () => {
  assert.match(HTML, /Escolha exatamente 3 IFighters/);
  assert.match(APP, /const TAMANHO_EQUIPE = 3;/);
  assert.match(APP, /EVENTOS\.SELECIONAR_EQUIPE/);
  assert.match(APP, /EVENTOS\.ESCOLHER_ACAO/);
  assert.match(APP, /tipo: "golpe", indiceGolpe/);
  assert.match(APP, /tipo: "troca", lutadorId/);
  assert.doesNotMatch(APP, /EVENTOS\.(?:SELECIONAR_LUTADOR|ESCOLHER_GOLPE)/);
});

test("a IFDEX oferece busca e exibe dados técnicos dos movimentos", () => {
  assert.match(HTML, /id="busca-ifdex"[^>]+type="search"/);
  assert.match(HTML, /id="contador-ifdex"/);
  assert.match(APP, /function obterLutadoresFiltradosIfdex\(\)/);
  assert.match(APP, /golpe\.nomeOriginal/);
  assert.match(APP, /golpe\.poderBase/);
  assert.match(APP, /lutadorAtual\.atributos/);
});

test("a introdução continua sendo a tela inicial automática", () => {
  assert.match(HTML, /class="tela introducao ativa"/);
  assert.match(APP, /telaAtual: "introducao"/);
  assert.match(
    APP,
    /configuracoes\.reproduzirIntroducao\) \{[\s\S]*?prepararIntroducao\(\)[\s\S]*?reproduzirIntroducao\(\)/,
  );
});

test("o cliente sincroniza por HTTP e retoma sessões interrompidas", () => {
  assert.match(APP, /const CAMINHO_API_MULTIJOGADOR/);
  assert.match(APP, /fetch\(caminho/);
  assert.match(APP, /function consultarEventosMultijogador/);
  assert.match(APP, /sessionStorage\.setItem\(\s*CHAVE_RECONEXAO/);
  assert.match(APP, /EVENTOS\.REENTRAR_SALA/);
  assert.match(APP, /EVENTOS\.SALA_REENTRADA/);
  assert.match(APP, /EVENTOS\.OPONENTE_RECONECTADO/);
  assert.match(APP, /dados\?\.temporario === true/);
  assert.doesNotMatch(APP, /\bwss?:/i);
});
