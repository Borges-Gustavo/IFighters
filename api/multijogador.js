"use strict";

const { criarServidor } = require("../server");

const CHAVE_RUNTIME = Symbol.for("ifighters.runtime.multijogador.vercel");
const INTERVALO_POLLING_VERCEL = 1200;

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

function responderStatus(resposta) {
  resposta.setHeader("Cache-Control", "no-store");
  resposta.setHeader("Content-Type", "application/json; charset=utf-8");
  resposta.statusCode = 200;
  resposta.end(
    JSON.stringify({
      ambiente: "vercel",
      intervaloPollingMs: INTERVALO_POLLING_VERCEL,
      transporte: "http",
      status: "online",
    }),
  );
}

function adaptarRespostaServerless(requisicao, resposta) {
  const caminho = requisicao.url.split("?", 1)[0];
  const rotaSessao = caminho.startsWith("/api/multijogador/sessoes");
  const criacaoSessao =
    requisicao.method === "POST" && caminho === "/api/multijogador/sessoes";

  const writeHeadOriginal = resposta.writeHead.bind(resposta);
  resposta.writeHead = (statusCode, ...argumentos) => {
    let codigo = statusCode;

    // Em funções serverless uma requisição pode cair em uma instância diferente.
    // Um 401 por sessão ausente nessa instância é transitório; o cliente já possui
    // retry/backoff para 5xx e não deve destruir a partida imediatamente.
    if (rotaSessao && statusCode === 401) {
      codigo = 503;
      resposta.setHeader("Retry-After", "1");
    }

    return writeHeadOriginal(codigo, ...argumentos);
  };

  if (!criacaoSessao) {
    return;
  }

  const endOriginal = resposta.end.bind(resposta);
  resposta.end = (corpo, ...argumentos) => {
    if (typeof corpo === "string" || Buffer.isBuffer(corpo)) {
      try {
        const dados = JSON.parse(Buffer.isBuffer(corpo) ? corpo.toString("utf8") : corpo);
        if (dados && typeof dados === "object" && "intervaloPollingMs" in dados) {
          dados.intervaloPollingMs = INTERVALO_POLLING_VERCEL;
          const novoCorpo = Buffer.from(JSON.stringify(dados), "utf8");
          resposta.removeHeader("Content-Length");
          resposta.setHeader("Content-Length", novoCorpo.length);
          return endOriginal(novoCorpo, ...argumentos);
        }
      } catch {
        // Mantém a resposta original caso não seja JSON.
      }
    }

    return endOriginal(corpo, ...argumentos);
  };
}

module.exports = async function multijogador(requisicao, resposta) {
  requisicao.url = reconstruirUrl(requisicao);

  if (
    requisicao.method === "GET" &&
    requisicao.url.split("?", 1)[0] === "/api/multijogador/status"
  ) {
    responderStatus(resposta);
    return;
  }

  const runtime = obterRuntime();
  adaptarRespostaServerless(requisicao, resposta);

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
