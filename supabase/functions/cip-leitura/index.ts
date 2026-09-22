/* =====================================================================
   CIP · LEITURA DA MODESTO
   ---------------------------------------------------------------------
   Recebe as respostas de uma pesquisa do Customer Intelligence Program
   (Pré-Discovery, Client Discovery ou Revisão de Parceria), já montadas
   pela tela num dossiê de texto, e devolve a leitura interna: o que o
   cliente quis dizer, o que pesa, o que sustenta, hipóteses, perguntas
   para a próxima reunião e ações.

   Roda no servidor porque a chave da IA nunca aparece no navegador. Só
   a equipe pode chamar: o papel é lido do diretório com a sessão de quem
   chamou, e cliente recebe recusa antes de qualquer custo. Não tem
   ferramenta nem escrita: entra texto, sai texto. Quem grava o resultado
   é a tela, na tabela interna que o cliente não alcança.
   ===================================================================== */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TIPOS = new Set(["pre_discovery", "client_discovery", "mgpr"]);
const LIMITE = 24000;   /* caracteres do dossiê; mais que isso não é uma pesquisa */

function chave() { return Deno.env.get("ANTHROPIC_API_KEY") || ""; }
function modelo() { return Deno.env.get("KRONOS_MODEL") || "claude-sonnet-5"; }

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function falha(codigo: string, mensagem: string, status = 200) {
  return json({ ok: false, codigo, erro: mensagem }, status);
}

const SISTEMA = `Você é a leitura interna da Modesto Growth Partners, agência de growth e mídia de performance.
Você recebe as respostas que um cliente deu num formulário do Customer Intelligence Program
(Pré-Discovery, Client Discovery ou Revisão de Parceria) e traduz, para o time da Modesto,
o que o cliente quis dizer com aquelas respostas, para o time conseguir agir.

Regras:
- Escreva em português do Brasil, direto, sem jargão e sem elogiar a Modesto.
- Use só o que está nas respostas. Não invente dado, nome, número ou contexto.
- Quando uma nota e a frase escolhida se contradizem, aponte a contradição.
- Quando a resposta estiver em branco, diga que ficou em branco em vez de supor.
- Nunca use travessão. Use vírgula, dois-pontos ou ponto.
- No máximo 380 palavras.

Formato, com estes títulos exatamente, cada um numa linha começando por "## ":
## Em três linhas
## O que pesa
## O que sustenta
## Hipóteses de trabalho
## Perguntas para a próxima reunião
## Ações para as próximas duas semanas

Debaixo de cada título, itens de lista começando por "- ". Em "Em três linhas", três itens.
Em "Ações para as próximas duas semanas", cada item começa por um verbo no infinitivo.`;

async function chamarModelo(corpo: unknown) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": chave(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(corpo),
  });
  const txt = await r.text();
  if (!r.ok) {
    let detalhe = txt.slice(0, 300);
    try { detalhe = JSON.parse(txt)?.error?.message || detalhe; } catch { /* texto puro */ }
    const e: any = new Error(detalhe);
    e.status = r.status;
    throw e;
  }
  return JSON.parse(txt);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return falha("metodo", "Use POST.", 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth) return falha("sem_sessao", "Faça login para pedir a leitura.", 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
  const { data: sessao, error: erroSessao } = await sb.auth.getUser();
  if (erroSessao || !sessao?.user) return falha("sem_sessao", "Sua sessão expirou. Entre de novo.", 401);

  const { data: perfil } = await sb.from("user_directory")
    .select("id,role").eq("id", sessao.user.id).maybeSingle();
  if (!perfil || !["admin", "equipe"].includes(String(perfil.role))) {
    return falha("sem_permissao", "A leitura interna é só da equipe.", 403);
  }

  let entrada: any = {};
  try { entrada = await req.json(); } catch { return falha("payload", "Não entendi o pedido."); }

  const tipo = String(entrada.tipo || "");
  const dossie = String(entrada.dossie || "").trim();
  if (!TIPOS.has(tipo)) return falha("payload", "Tipo de pesquisa inválido.");
  if (!dossie) return falha("payload", "O dossiê veio vazio.");
  if (dossie.length > LIMITE) return falha("payload", "O dossiê é grande demais para uma pesquisa.");

  if (!chave()) {
    return falha(
      "sem_chave",
      "A leitura ainda não tem chave de IA configurada. Um administrador precisa definir o segredo ANTHROPIC_API_KEY no projeto Supabase.",
    );
  }

  const rotulo = tipo === "mgpr" ? "Revisão de Parceria (MGPR)"
    : tipo === "client_discovery" ? "Client Discovery" : "Pré-Discovery";
  const pedido = `Pesquisa: ${rotulo}.\n\nDossiê com as respostas do cliente:\n\n${dossie}\n\nEscreva a leitura interna no formato combinado.`;

  try {
    const resp = await chamarModelo({
      model: modelo(),
      max_tokens: 1600,
      system: SISTEMA,
      messages: [{ role: "user", content: pedido }],
    });
    const texto = (resp.content || []).filter((b: any) => b.type === "text")
      .map((b: any) => b.text).join("\n").trim();
    if (!texto) return falha("vazio", "O modelo não devolveu texto.");
    return json({ ok: true, tipo: "texto", texto, modelo: modelo() });
  } catch (e: any) {
    const status = Number(e?.status || 0);
    if (status === 401 || status === 403) {
      return falha("chave_invalida", "A chave de IA foi recusada pelo provedor. Um administrador precisa revisar o segredo ANTHROPIC_API_KEY.");
    }
    if (status === 429 || status >= 500) {
      return falha("ia_indisponivel", "O provedor de IA está fora do ar ou no limite. Tenta de novo em instantes.");
    }
    return falha("ia", `Não consegui gerar a leitura: ${e?.message || "erro desconhecido"}.`);
  }
});
