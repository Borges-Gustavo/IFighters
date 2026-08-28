"use strict";

const { criarServidor } = require("../server");

const CHAVE_RUNTIME = Symbol.for("ifighters.runtime.multijogador.vercel");

function obterRuntime() {
  if (!globalThis[CHAVE_RUNTIME]) {
    globalThis[CHAVE_RUNTIME] = criarServidor({
      host: "127.0.0.1",
      porta: 0,
    });
  }

  return globalThis[CHAVE_RUNTIME];
}

function obterRota(requisicao) {
  const valor = requisicao.query?.rota;
  const partes = Array.isArray(valor) ? valor : [valor];
  return partes
    .filter((parte) => typeof parte === "string" && parte.length > 0)
    .join("/");
}

function reconstruirUrl(requisicao) {
  const rota = obterRota(requisicao);
  const urlOriginal = new URL(requisicao.url || "/", "https://ifighters.local");
  const consulta = new URLSearchParams(urlOriginal.searchParams);
  consulta.delete("rota");

  const caminho = rota
    ? `/api/multijogador/${rota}`
    : "/api/multijogador/status";
  const textoConsulta = consulta.toString();
  return textoConsulta ? `${caminho}?${textoConsulta}` : caminho;
}

module.exports = async function multijogador(requisicao, resposta) {
  const runtime = obterRuntime();
  requisicao.url = reconstruirUrl(requisicao);

  await new Promise((resolver) => {
    let concluida = false;
    const concluir = () => {
      if (concluida) {
        return;
      }
      concluida = true;
      resposta.off("finish", concluir);
      resposta.off("close", concluir);
      resolver();
    };

    resposta.once("finish", concluir);
    resposta.once("close", concluir);
    runtime.servidorHttp.emit("request", requisicao, resposta);
  });
};
