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

test("o protocolo descreve equipes, ações tipadas e retomada de sessão", () => {
  assert.equal(EVENTOS.VERSAO_PROTOCOLO, 4);
  assert.equal(EVENTOS.SELECIONAR_EQUIPE, "selecionar_equipe");
  assert.equal(EVENTOS.ESCOLHER_ACAO, "escolher_acao");
  assert.equal(EVENTOS.REENTRAR_SALA, "reentrar_sala");
  assert.equal(EVENTOS.SALA_REENTRADA, "sala_reentrada");
  assert.equal(EVENTOS.OPONENTE_RECONECTADO, "oponente_reconectado");

  assert.equal(EVENTOS.SELECIONAR_LUTADOR, undefined);
  assert.equal(EVENTOS.ESCOLHER_GOLPE, undefined);
});
