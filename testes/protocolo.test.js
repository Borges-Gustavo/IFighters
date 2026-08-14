const { test } = require("node:test");
const assert = require("node:assert/strict");

const EVENTOS = require("../protocol");

test("o protocolo possui eventos únicos e serializáveis", () => {
  const eventos = Object.values(EVENTOS);

  assert.ok(Object.isFrozen(EVENTOS));
  assert.equal(new Set(eventos).size, eventos.length);

  for (const evento of eventos) {
    assert.match(evento, /^[a-z0-9_]+$/);
  }
});
