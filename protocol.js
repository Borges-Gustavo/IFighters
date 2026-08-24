const EVENTOS = Object.freeze({
  CONEXAO: "conexao",
  CRIAR_SALA: "criar_sala",
  SALA_CRIADA: "sala_criada",
  ENTRAR_SALA: "entrar_sala",
  SALA_ENTRADA: "sala_entrada",
  REENTRAR_SALA: "reentrar_sala",
  SALA_REENTRADA: "sala_reentrada",
  ERRO_SALA: "erro_sala",
  SELECIONAR_EQUIPE: "selecionar_equipe",
  BATALHA_INICIADA: "batalha_iniciada",
  ESCOLHER_ACAO: "escolher_acao",
  ACAO_ACEITA: "acao_aceita",
  RESULTADO_TURNO: "resultado_turno",
  BATALHA_ENCERRADA: "batalha_encerrada",
  OPONENTE_DESCONECTADO: "oponente_desconectado",
  OPONENTE_RECONECTADO: "oponente_reconectado",
  SOLICITAR_REVANCHE: "solicitar_revanche",
  STATUS_REVANCHE: "status_revanche",
  SAIR_SALA: "sair_sala",
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = EVENTOS;
}
