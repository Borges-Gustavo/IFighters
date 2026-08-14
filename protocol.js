const EVENTOS = Object.freeze({
  CONEXAO: "conexao",
  CRIAR_SALA: "criar_sala",
  SALA_CRIADA: "sala_criada",
  ENTRAR_SALA: "entrar_sala",
  SALA_ENTRADA: "sala_entrada",
  ERRO_SALA: "erro_sala",
  SELECIONAR_LUTADOR: "selecionar_lutador",
  BATALHA_INICIADA: "batalha_iniciada",
  ESCOLHER_GOLPE: "escolher_golpe",
  ACAO_ACEITA: "acao_aceita",
  RESULTADO_TURNO: "resultado_turno",
  BATALHA_ENCERRADA: "batalha_encerrada",
  OPONENTE_DESCONECTADO: "oponente_desconectado",
  SOLICITAR_REVANCHE: "solicitar_revanche",
  STATUS_REVANCHE: "status_revanche",
  SAIR_SALA: "sair_sala",
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = EVENTOS;
}
