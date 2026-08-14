const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(RAIZ, "main.html"), "utf8");
const CSS = fs.readFileSync(path.join(RAIZ, "style.css"), "utf8");

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
