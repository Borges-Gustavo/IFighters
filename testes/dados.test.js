const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LUTADORES = require("../data");

test("todos os lutadores têm dados completos e um sprite existente", () => {
  assert.ok(Array.isArray(LUTADORES));
  assert.ok(LUTADORES.length >= 2);

  const identificadores = new Set();

  for (const lutador of LUTADORES) {
    assert.match(lutador.id, /^[a-z0-9-]+$/);
    assert.equal(identificadores.has(lutador.id), false);
    identificadores.add(lutador.id);

    assert.ok(lutador.nome.length > 0);
    assert.ok(lutador.forma.length > 0);
    assert.ok(lutador.descricao.length > 0);
    assert.match(lutador.sprite, /^img\/sprites\/[a-z0-9-]+\.(png|jpe?g)$/);

    const caminhoSprite = path.resolve(__dirname, "..", lutador.sprite);
    assert.equal(fs.existsSync(caminhoSprite), true, lutador.sprite);

    for (const atributo of ["vida", "ataque", "defesa", "velocidade"]) {
      assert.ok(Number.isFinite(lutador.atributos[atributo]));
      assert.ok(lutador.atributos[atributo] > 0);
    }

    assert.equal(lutador.golpes.length, 4);

    for (const golpe of lutador.golpes) {
      assert.ok(golpe.nome.length > 0);
      assert.ok(golpe.tipo.length > 0);
      assert.ok(golpe.poder > 0);
      assert.ok(golpe.precisao > 0 && golpe.precisao <= 100);
      assert.ok(Number.isInteger(golpe.prioridade));
    }
  }
});
