/* =====================================================================
   KRONOS · assistente interno da Modesto Growth Partners
   ---------------------------------------------------------------------
   Roda no servidor porque a chave da IA nunca pode aparecer no navegador.

   Duas regras de arquitetura sustentam tudo aqui:

   1. Toda leitura e toda escrita usam um cliente Supabase criado com a
      chave pública MAIS o Authorization de quem chamou. Ou seja: o
      Kronos herda a RLS da pessoa, ele não tem poder próprio. Não
      existe service_role nesta função.

   2. Ferramenta de escrita nunca executa dentro da conversa. O modelo só
      consegue PROPOR. A execução acontece numa segunda chamada, no modo
      "executar", depois que a pessoa confirmou na tela. Por isso o
      Kronos não tem como dizer que criou algo que não criou: quem
      relata o resultado é o banco, não o modelo.
   ===================================================================== */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STATUS = ["Não iniciado", "Entregas do dia", "Em Andamento",
  "Impeditivo/Aprovação", "Próximas entregas", "Feito", "Concluído Atendimento"];
const PRIORIDADES = ["Baixa", "Média", "Alta"];
/* as mesmas categorias que a tela de Documentos conhece */
const DOC_TIPOS = ["apresentacao", "proposta", "diagnostico", "weekly", "concorrencia"];
const DOC_ROTULO: Record<string, string> = {
  apresentacao: "Apresentação", proposta: "Proposta", diagnostico: "Diagnóstico",
  weekly: "Weekly", concorrencia: "Concorrência",
};

/* Lido a cada chamada, de propósito. Se fosse lido uma vez na carga do
   módulo, definir o segredo depois só passaria a valer quando o isolate
   fosse reciclado, e daria a impressão de que a chave não funcionou. */
function chave() { return Deno.env.get("ANTHROPIC_API_KEY") || ""; }
function modelo() { return Deno.env.get("KRONOS_MODEL") || "claude-sonnet-5"; }

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function falha(codigo: string, mensagem: string, status = 200) {
  return json({ ok: false, codigo, erro: mensagem }, status);
}

/* ---------------------------------------------------------------------
   Ferramentas
   --------------------------------------------------------------------- */
const LEITURA = [
  {
    name: "buscar_pessoas",
    description:
      "Lista as pessoas da plataforma que quem está falando tem direito de ver. Use para descobrir o id, o nome exato e o papel de alguém antes de citá-lo.",
    input_schema: {
      type: "object",
      properties: { termo: { type: "string", description: "parte do nome" } },
    },
  },
  {
    name: "buscar_clientes",
    description:
      "Lista os clientes visíveis. Use sempre antes de vincular uma demanda a um cliente, para confirmar que ele existe e pegar o id certo.",
    input_schema: {
      type: "object",
      properties: { termo: { type: "string" } },
    },
  },
  {
    name: "buscar_demandas",
    description:
      "Procura demandas (tabela tasks). Combine os filtros. Sem filtro nenhum devolve as mais recentes.",
    input_schema: {
      type: "object",
      properties: {
        termo: { type: "string", description: "texto no título ou na descrição" },
        cliente: { type: "string", description: "nome do cliente" },
        status: { type: "string", enum: STATUS },
        responsavel: { type: "string", description: "primeiro nome de quem responde" },
        apenas_abertas: { type: "boolean", description: "descarta Feito e Concluído Atendimento" },
        limite: { type: "integer" },
      },
    },
  },
  {
    name: "detalhe_demanda",
    description: "Abre uma demanda pelo id, com subtarefas e comentários.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "listar_projetos",
    description: "Lista projetos, opcionalmente de um cliente.",
    input_schema: {
      type: "object",
      properties: { cliente: { type: "string" } },
    },
  },
  {
    name: "ler_conversa",
    description:
      "Lê as mensagens recentes de uma conversa do MGP Chat. Só funciona em conversa que a pessoa já participa. Use para resumir ou para extrair contexto de uma conversa ou de uma thread.",
    input_schema: {
      type: "object",
      properties: {
        canal_id: { type: "string" },
        raiz_thread: { type: "string", description: "id da mensagem-raiz, para ler só a thread" },
        limite: { type: "integer" },
      },
      required: ["canal_id"],
    },
  },
];

const ESCRITA = [
  {
    name: "criar_demanda",
    description:
      "Propõe a criação de uma demanda. NÃO cria nada sozinho: a pessoa ainda vai confirmar na tela. Escreva um título curto e objetivo e uma descrição estruturada.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "título curto, no imperativo" },
        description: { type: "string", description: "descrição estruturada do que precisa ser feito" },
        cliente: { type: "string", description: "nome do cliente, quando houver" },
        priority: { type: "string", enum: PRIORIDADES },
        status: { type: "string", enum: STATUS },
        responsaveis: { type: "array", items: { type: "string" }, description: "nomes de pessoas da plataforma" },
        due: { type: "string", description: "data de entrega no formato AAAA-MM-DD" },
        urgente: { type: "boolean" },
        passos: {
          type: "array",
          items: { type: "string" },
          description:
            "passo a passo do que precisa ser feito, uma frase por passo, na ordem de execução. Vira a lista de subtarefas da demanda.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "atualizar_demanda",
    description: "Propõe alterar campos de uma demanda existente. Passe só o que muda.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: STATUS },
        priority: { type: "string", enum: PRIORIDADES },
        due: { type: "string" },
        responsaveis: { type: "array", items: { type: "string" } },
        urgente: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "comentar_demanda",
    description: "Propõe adicionar um comentário a uma demanda.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" }, body: { type: "string" } },
      required: ["task_id", "body"],
    },
  },
  {
    name: "criar_documento",
    description:
      "Propõe criar um documento no acervo de um cliente: apresentação, proposta, diagnóstico, weekly ou análise de concorrência. NÃO cria nada sozinho. Escreva a descrição do documento e, quando fizer sentido, o conteúdo dele em texto.",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string", description: "título do documento" },
        cliente: { type: "string", description: "nome da empresa dona do documento" },
        tipo: { type: "string", enum: DOC_TIPOS, description: "categoria do documento" },
        descricao: { type: "string", description: "do que trata este documento, em uma ou duas frases" },
        conteudo: {
          type: "string",
          description:
            "o texto do documento, quando você tiver o que escrever. Use linhas em branco entre parágrafos. Deixe vazio se o documento vai ser preenchido depois.",
        },
      },
      required: ["titulo", "cliente", "descricao"],
    },
  },
  {
    name: "criar_projeto",
    description: "Propõe criar um projeto para um cliente.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        cliente: { type: "string" },
        descricao: { type: "string" },
      },
      required: ["nome", "cliente"],
    },
  },
];

const ESCRITA_NOMES = new Set(ESCRITA.map((f) => f.name));

/* ---------------------------------------------------------------------
   Execução das ferramentas de leitura, sempre sob a RLS de quem chamou
   --------------------------------------------------------------------- */
async function lerFerramenta(sb: SupabaseClient, nome: string, a: any): Promise<any> {
  const lim = (n: any, p = 20) => Math.min(Math.max(parseInt(n) || p, 1), 60);

  if (nome === "buscar_pessoas") {
    let q = sb.from("user_directory").select("id,nome,role,client_id,email").limit(20);
    if (a?.termo) q = q.ilike("nome", `%${a.termo}%`);
    const { data, error } = await q;
    if (error) throw error;
    return { pessoas: data ?? [] };
  }

  if (nome === "buscar_clientes") {
    let q = sb.from("clients").select("id,nome,resumo,plano_midia").order("nome").limit(30);
    if (a?.termo) q = q.ilike("nome", `%${a.termo}%`);
    const { data, error } = await q;
    if (error) throw error;
    return { clientes: data ?? [] };
  }

  if (nome === "buscar_demandas") {
    let cid: string | null = null;
    if (a?.cliente) {
      const c = await acharCliente(sb, a.cliente);
      if (!c.ok) return c;
      cid = c.cliente.id;
    }
    let q = sb.from("tasks")
      .select("id,title,description,status,priority,assignees,due,client_id,urgente,archived,created_at")
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(lim(a?.limite, 20));
    if (cid) q = q.eq("client_id", cid);
    if (a?.status) q = q.eq("status", a.status);
    if (a?.termo) q = q.or(`title.ilike.%${a.termo}%,description.ilike.%${a.termo}%`);
    if (a?.responsavel) q = q.contains("assignees", [a.responsavel]);
    if (a?.apenas_abertas) q = q.not("status", "in", '("Feito","Concluído Atendimento")');
    const { data, error } = await q;
    if (error) throw error;
    return { demandas: await comNomeDeCliente(sb, data ?? []) };
  }

  if (nome === "detalhe_demanda") {
    const { data, error } = await sb.from("tasks").select("*").eq("id", a.id).maybeSingle();
    if (error) throw error;
    if (!data) return { erro: "Não encontrei nenhuma demanda com esse id." };
    const { data: notas } = await sb.from("task_notes")
      .select("author_name,body,created_at").eq("task_id", a.id)
      .order("created_at", { ascending: true }).limit(30);
    const [d] = await comNomeDeCliente(sb, [data]);
    return { demanda: d, comentarios: notas ?? [] };
  }

  if (nome === "listar_projetos") {
    let q = sb.from("projects").select("id,nome,descricao,status,client_id,inicio,fim").limit(40);
    if (a?.cliente) {
      const c = await acharCliente(sb, a.cliente);
      if (!c.ok) return c;
      q = q.eq("client_id", c.cliente.id);
    }
    const { data, error } = await q;
    if (error) throw error;
    return { projetos: data ?? [] };
  }

  if (nome === "ler_conversa") {
    let q = sb.from("messages")
      .select("id,author_id,author_name,body,kind,reply_to,created_at")
      .eq("channel_id", a.canal_id)
      .order("created_at", { ascending: false })
      .limit(lim(a?.limite, 40));
    if (a?.raiz_thread) q = q.or(`id.eq.${a.raiz_thread},reply_to.eq.${a.raiz_thread}`);
    const { data, error } = await q;
    if (error) throw error;
    const linhas = (data ?? []).reverse();
    if (!linhas.length) {
      return { erro: "Não consegui ler esta conversa. Ou ela está vazia, ou você não participa dela." };
    }
    const ids = [...new Set(linhas.map((m: any) => m.author_id).filter(Boolean))];
    const { data: pes } = await sb.from("user_directory").select("id,nome").in("id", ids.length ? ids : [crypto.randomUUID()]);
    const porId = new Map((pes ?? []).map((p: any) => [p.id, p.nome]));
    return {
      mensagens: linhas.map((m: any) => ({
        autor: m.kind === "kronos" ? "Kronos" : (porId.get(m.author_id) || m.author_name || "Desconhecido"),
        texto: m.body,
        em: m.created_at,
        id: m.id,
      })),
    };
  }

  return { erro: `Ferramenta desconhecida: ${nome}` };
}

async function comNomeDeCliente(sb: SupabaseClient, linhas: any[]) {
  const ids = [...new Set(linhas.map((t) => t.client_id).filter(Boolean))];
  if (!ids.length) return linhas;
  const { data } = await sb.from("clients").select("id,nome").in("id", ids);
  const m = new Map((data ?? []).map((c: any) => [c.id, c.nome]));
  return linhas.map((t) => ({ ...t, cliente: t.client_id ? (m.get(t.client_id) || null) : null }));
}

async function acharCliente(sb: SupabaseClient, termo: string): Promise<any> {
  const { data, error } = await sb.from("clients").select("id,nome").ilike("nome", `%${termo}%`).limit(5);
  if (error) throw error;
  const n = data?.length ?? 0;
  if (n === 0) return { ok: false, erro: `Não encontrei nenhum cliente com "${termo}". Não invente: peça o nome certo.` };
  if (n > 1) {
    return { ok: false, erro: `"${termo}" bate com mais de um cliente: ${data!.map((c: any) => c.nome).join(", ")}. Pergunte qual é.` };
  }
  return { ok: true, cliente: data![0] };
}

/* Nomes de responsáveis são gravados como texto em tasks.assignees.
   Resolvemos contra o diretório para que ninguém inventado entre lá. */
async function acharPessoas(sb: SupabaseClient, nomes: string[]) {
  const { data, error } = await sb.from("user_directory").select("id,nome");
  if (error) throw error;
  const dir = data ?? [];
  const norm = (s: string) =>
    String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const achados: string[] = [];
  const perdidos: string[] = [];
  for (const n of nomes) {
    const alvo = norm(n);
    const p = dir.find((x: any) => norm(x.nome) === alvo) ||
              dir.find((x: any) => norm(x.nome).split(/\s+/)[0] === alvo) ||
              dir.find((x: any) => norm(x.nome).includes(alvo));
    if (p) achados.push(String(p.nome).trim().split(/\s+/)[0]);
    else perdidos.push(n);
  }
  return { achados: [...new Set(achados)], perdidos };
}

/* ---------------------------------------------------------------------
   Ferramentas de escrita: primeiro resolver, depois (noutra chamada) executar
   --------------------------------------------------------------------- */
async function resolverEscrita(sb: SupabaseClient, nome: string, a: any): Promise<any> {
  const dataOk = (d: any) => !d || /^\d{4}-\d{2}-\d{2}$/.test(String(d));

  if (nome === "criar_demanda" || nome === "atualizar_demanda") {
    const campos: any = {};
    if (nome === "atualizar_demanda") {
      if (!a?.id) return { ok: false, erro: "Falta o id da demanda." };
      const { data, error } = await sb.from("tasks").select("id,title,client_id").eq("id", a.id).maybeSingle();
      if (error) throw error;
      if (!data) return { ok: false, erro: "Não encontrei essa demanda." };
      campos.__alvo = data;
    }
    if (a?.title !== undefined) {
      if (!String(a.title || "").trim()) return { ok: false, erro: "O título não pode ficar vazio." };
      campos.title = String(a.title).trim();
    }
    if (a?.description !== undefined) campos.description = String(a.description || "");
    if (a?.status !== undefined) {
      if (!STATUS.includes(a.status)) return { ok: false, erro: `Status inválido. Os válidos são: ${STATUS.join(", ")}.` };
      campos.status = a.status;
    }
    if (a?.priority !== undefined) {
      if (!PRIORIDADES.includes(a.priority)) return { ok: false, erro: `Prioridade inválida. Use: ${PRIORIDADES.join(", ")}.` };
      campos.priority = a.priority;
    }
    if (a?.due !== undefined && a.due !== null && a.due !== "") {
      if (!dataOk(a.due)) return { ok: false, erro: "A data de entrega precisa estar em AAAA-MM-DD." };
      campos.due = a.due;
    }
    if (a?.urgente !== undefined) campos.urgente = !!a.urgente;
    if (a?.cliente) {
      const c = await acharCliente(sb, a.cliente);
      if (!c.ok) return c;
      campos.client_id = c.cliente.id;
      campos.__cliente = c.cliente.nome;
    }
    if (Array.isArray(a?.responsaveis) && a.responsaveis.length) {
      const r = await acharPessoas(sb, a.responsaveis);
      if (r.perdidos.length) {
        return { ok: false, erro: `Não achei essas pessoas na plataforma: ${r.perdidos.join(", ")}. Não invente responsável.` };
      }
      campos.assignees = r.achados;
    }
    if (Array.isArray(a?.passos) && a.passos.length) {
      /* o passo a passo vira subtarefa de verdade, no mesmo formato que a
         tela usa: assim ele aparece com caixa de marcar, e não como texto
         solto dentro da descrição */
      const passos = a.passos
        .map((p: any) => String(p || "").trim())
        .filter(Boolean)
        .slice(0, 30);
      if (passos.length) campos.subtasks = passos.map((text: string) => ({ text, done: false }));
    }
    if (nome === "criar_demanda") {
      if (!campos.title) return { ok: false, erro: "Falta o título da demanda." };
      campos.status = campos.status || "Não iniciado";
      campos.priority = campos.priority || "Média";
      campos.description = campos.description || "";
    }
    return { ok: true, argumentos: campos };
  }

  if (nome === "criar_documento") {
    if (!String(a?.titulo || "").trim()) return { ok: false, erro: "Falta o título do documento." };
    if (!String(a?.descricao || "").trim()) {
      return { ok: false, erro: "Falta a descrição do documento. Diga em uma ou duas frases do que ele trata." };
    }
    const c = await acharCliente(sb, a.cliente);
    if (!c.ok) return c;
    const tipo = DOC_TIPOS.includes(a?.tipo) ? a.tipo : "apresentacao";
    return {
      ok: true,
      argumentos: {
        titulo: String(a.titulo).trim(),
        tipo,
        descricao: String(a.descricao).trim(),
        conteudo: String(a?.conteudo || ""),
        client_id: c.cliente.id,
        __cliente: c.cliente.nome,
      },
    };
  }

  if (nome === "comentar_demanda") {
    if (!a?.task_id) return { ok: false, erro: "Falta o id da demanda." };
    if (!String(a?.body || "").trim()) return { ok: false, erro: "O comentário está vazio." };
    const { data, error } = await sb.from("tasks").select("id,title").eq("id", a.task_id).maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, erro: "Não encontrei essa demanda." };
    return { ok: true, argumentos: { task_id: a.task_id, body: String(a.body).trim(), __alvo: data } };
  }

  if (nome === "criar_projeto") {
    if (!String(a?.nome || "").trim()) return { ok: false, erro: "Falta o nome do projeto." };
    const c = await acharCliente(sb, a.cliente);
    if (!c.ok) return c;
    return {
      ok: true,
      argumentos: {
        nome: String(a.nome).trim(),
        descricao: String(a.descricao || ""),
        client_id: c.cliente.id,
        __cliente: c.cliente.nome,
      },
    };
  }

  return { ok: false, erro: `Ação desconhecida: ${nome}` };
}

async function executarEscrita(sb: SupabaseClient, nome: string, arg: any, quem: any) {
  const limpo = { ...arg };
  delete limpo.__cliente; delete limpo.__alvo;

  if (nome === "criar_demanda") {
    const { data, error } = await sb.from("tasks").insert(limpo).select("id,title,status,priority,due,client_id,assignees").single();
    if (error) throw error;
    return { criou: "demanda", demanda: data };
  }
  if (nome === "atualizar_demanda") {
    const id = limpo.id ?? arg.__alvo?.id;
    delete limpo.id;
    if (!Object.keys(limpo).length) throw new Error("Nada para alterar.");
    const { data, error } = await sb.from("tasks").update(limpo).eq("id", id).select("id,title,status,priority,due,assignees").single();
    if (error) throw error;
    return { atualizou: "demanda", demanda: data };
  }
  if (nome === "comentar_demanda") {
    const { data, error } = await sb.from("task_notes")
      .insert({ task_id: limpo.task_id, body: limpo.body, author_id: quem.id, author_name: quem.nome })
      .select("id,task_id,body,created_at").single();
    if (error) throw error;
    return { criou: "comentário", comentario: data };
  }
  if (nome === "criar_projeto") {
    const { data, error } = await sb.from("projects")
      .insert({ ...limpo, criado_por: quem.nome }).select("id,nome,client_id").single();
    if (error) throw error;
    return { criou: "projeto", projeto: data };
  }
  if (nome === "criar_documento") {
    /* O documento nasce como HTML autocontido no bucket, do mesmo jeito
       que os enviados à mão, e a linha em `documents` aponta para ele.
       Quando não há conteúdo escrito, gravamos só a ficha: o arquivo
       entra depois, pela tela de Documentos. */
    let storage_path: string | null = null;
    const texto = String(limpo.conteudo || "").trim();
    if (texto) {
      const html = documentoHTML(limpo.titulo, DOC_ROTULO[limpo.tipo] || limpo.tipo,
                                 arg.__cliente || "", limpo.descricao, texto, quem.nome);
      const id = crypto.randomUUID();
      const caminho = `${limpo.client_id}/documentos/${id}.html`;
      const up = await sb.storage.from("documents")
        .upload(caminho, new Blob([html], { type: "text/html;charset=utf-8" }),
                { upsert: false, contentType: "text/html;charset=utf-8" });
      if (up.error) throw up.error;
      storage_path = caminho;
    }
    const { data, error } = await sb.from("documents").insert({
      client_id: limpo.client_id,
      titulo: limpo.titulo,
      tipo: limpo.tipo,
      storage_path,
      metadata: { descricao: limpo.descricao, por: quem.nome, origem: "kronos" },
    }).select("id,titulo,tipo,client_id,storage_path").single();
    if (error) throw error;
    return { criou: "documento", documento: data };
  }
  throw new Error(`Ação desconhecida: ${nome}`);
}

/* O documento que o Kronos escreve. HTML autocontido, com estilo de
   impressão: abre na plataforma e salva em PDF pelo próprio navegador. */
function documentoHTML(titulo: string, tipo: string, cliente: string,
                       descricao: string, texto: string, por: string): string {
  const esc = (v: string) =>
    String(v ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const paragrafos = texto.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title><style>
*{box-sizing:border-box}
body{margin:0;background:#f4f1ea;color:#23211d;font:15px/1.7 'Hanken Grotesk',system-ui,sans-serif}
.folha{max-width:820px;margin:0 auto;background:#fff;padding:52px 56px 64px;
  box-shadow:0 20px 60px -30px rgba(0,0,0,.3)}
header{border-bottom:2px solid #c2a15b;padding-bottom:18px;margin-bottom:26px}
h1{font:500 27px/1.2 Georgia,serif;margin:0}
.meta{font-size:12.5px;color:#8a8271;margin-top:7px}
.resumo{background:#faf7f0;border:1px solid #e6ded0;border-radius:12px;padding:16px 18px;
  margin-bottom:26px;font-size:14px}
p{margin:0 0 14px;white-space:pre-wrap}
.rodape{margin-top:40px;padding-top:16px;border-top:1px solid #eee7da;font-size:11.5px;color:#8a8271}
.imprimir{position:fixed;right:20px;top:20px;background:#c2a15b;color:#131311;border:0;border-radius:10px;
  padding:11px 18px;font:600 13px/1 system-ui,sans-serif;cursor:pointer}
@media print{body{background:#fff}.folha{box-shadow:none;padding:0;max-width:none}.imprimir{display:none}}
</style></head><body>
<button class="imprimir" onclick="window.print()">Salvar em PDF</button>
<div class="folha">
<header><h1>${esc(titulo)}</h1>
<div class="meta">${esc(tipo)}${cliente ? " · " + esc(cliente) : ""} · escrito pelo Kronos a pedido de ${esc(por)}</div></header>
<div class="resumo">${esc(descricao)}</div>
${paragrafos}
<div class="rodape">Documento gerado na plataforma MGP. Confira antes de enviar ao cliente.</div>
</div></body></html>`;
}

/* Resumo legível montado do lado do servidor, a partir do que foi
   RESOLVIDO no banco. O modelo não escreve este texto, então ele não
   consegue prometer um cliente ou um responsável que não existe. */
function resumirAcao(nome: string, a: any) {
  const l: Array<[string, string]> = [];
  const put = (r: string, v: any) => { if (v !== undefined && v !== null && v !== "") l.push([r, String(v)]); };
  if (nome === "criar_demanda" || nome === "atualizar_demanda") {
    if (a.__alvo) put("Demanda", a.__alvo.title);
    put("Título", a.title);
    put("Descrição", a.description);
    put("Cliente", a.__cliente);
    put("Prioridade", a.priority);
    put("Status", a.status);
    put("Responsáveis", Array.isArray(a.assignees) ? a.assignees.join(", ") : undefined);
    put("Entrega", a.due);
    if (a.urgente !== undefined) put("Urgente", a.urgente ? "sim" : "não");
  } else if (nome === "comentar_demanda") {
    put("Demanda", a.__alvo?.title);
    put("Comentário", a.body);
  } else if (nome === "criar_projeto") {
    put("Projeto", a.nome);
    put("Cliente", a.__cliente);
    put("Descrição", a.descricao);
  } else if (nome === "criar_documento") {
    put("Documento", a.titulo);
    put("Tipo", DOC_ROTULO[a.tipo] || a.tipo);
    put("Cliente", a.__cliente);
    put("Descrição", a.descricao);
    if (a.conteudo) put("Conteúdo", `${String(a.conteudo).trim().split(/\s+/).length} palavras escritas`);
  }
  return l.map(([r, v]) => ({ rotulo: r, valor: v }));
}

const TITULOS: Record<string, string> = {
  criar_demanda: "Criar demanda",
  atualizar_demanda: "Alterar demanda",
  comentar_demanda: "Comentar na demanda",
  criar_projeto: "Criar projeto",
  criar_documento: "Criar documento",
};

/* ---------------------------------------------------------------------
   Instrução do assistente
   --------------------------------------------------------------------- */
function instrucao(quem: any, ctx: any) {
  return `Você é o Kronos, assistente interno da Modesto Growth Partners (MGP), dentro da plataforma MGP.

Quem está falando com você: ${quem.nome} (id ${quem.id}, papel ${quem.papel === "admin" ? "equipe" : "cliente"}).
Hoje é ${new Date().toISOString().slice(0, 10)}.
${ctx?.canal_nome ? `Conversa aberta agora: "${ctx.canal_nome}" (canal_id ${ctx.canal_id}).` : ""}
${ctx?.raiz_thread ? `A pessoa está dentro de uma thread, cuja mensagem-raiz é ${ctx.raiz_thread}.` : ""}

Como você trabalha:
- Responda em português do Brasil, direto e curto. Nada de floreio.
- Para falar de qualquer dado da plataforma, CONSULTE com as ferramentas. Nunca responda de memória, nunca invente cliente, pessoa, demanda, número ou data.
- Se a consulta não achar nada, diga exatamente isso: que não encontrou. Não preencha lacuna com suposição.
- Quando faltar informação essencial, pergunte antes de propor qualquer coisa.
- Ao resumir conversa ou thread, leia primeiro com ler_conversa.

Sobre criar e alterar dados:
- As ferramentas criar_demanda, atualizar_demanda, comentar_demanda, criar_projeto e criar_documento NÃO executam nada. Elas apenas montam uma proposta que aparece na tela para a pessoa confirmar.
- Quando pedirem uma demanda, entregue ela pronta para trabalhar: título curto no imperativo, uma descrição com o contexto (o porquê e o que já se sabe) e o passo a passo em "passos", uma frase por passo, na ordem de execução. Não deixe a demanda como uma linha solta.
- Quando pedirem um documento, escreva o conteúdo dele em "conteudo" se você tiver o que escrever, e sempre preencha "descricao" dizendo do que ele trata. Se faltar informação para escrever o conteúdo, crie só a ficha com a descrição e diga o que falta.
- Por isso você NUNCA deve dizer que criou, alterou ou salvou alguma coisa. Diga que preparou a proposta e que ela está aguardando confirmação.
- Se uma ferramenta devolver erro, relate o erro como ele é. Não tente contornar inventando dados.
- Você não tem poder próprio no banco: você opera com as mesmas permissões de ${quem.nome}. Se ela não pode fazer algo manualmente, você também não pode.

Ao transformar um pedido solto em demanda, gere um título curto no imperativo e uma descrição organizada, com o que precisa ser feito e o critério de pronto.`;
}

/* ---------------------------------------------------------------------
   Chamada ao modelo
   --------------------------------------------------------------------- */
async function chamarModelo(corpo: any) {
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

/* ---------------------------------------------------------------------
   Entrada
   --------------------------------------------------------------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return falha("metodo", "Use POST.", 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth) return falha("sem_sessao", "Faça login para falar com o Kronos.", 401);

  /* chave pública + Authorization da pessoa: a RLS dela vale aqui dentro */
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );

  const { data: sessao, error: erroSessao } = await sb.auth.getUser();
  if (erroSessao || !sessao?.user) {
    return falha("sem_sessao", "Sua sessão expirou. Entre de novo.", 401);
  }
  const { data: perfil } = await sb.from("user_directory")
    .select("id,nome,role").eq("id", sessao.user.id).maybeSingle();
  const quem = {
    id: sessao.user.id,
    nome: perfil?.nome || sessao.user.email || "Você",
    papel: perfil?.role || "client",
  };

  let entrada: any = {};
  try { entrada = await req.json(); } catch { return falha("payload", "Não entendi o pedido."); }

  /* ---- modo executar: a pessoa confirmou, agora o banco decide ---- */
  if (entrada.modo === "executar") {
    const nome = String(entrada?.acao?.ferramenta || "");
    if (!ESCRITA_NOMES.has(nome)) return falha("acao_invalida", "Essa ação não existe.");
    const arg = entrada?.acao?.argumentos || {};
    const { data: registro } = await sb.from("assistant_actions")
      .insert({ user_id: quem.id, ferramenta: nome, argumentos: arg, status: "pendente" })
      .select("id").maybeSingle();
    try {
      const resultado = await executarEscrita(sb, nome, arg, quem);
      if (registro) {
        await sb.from("assistant_actions").update({ status: "ok", resultado }).eq("id", registro.id);
      }
      return json({ ok: true, tipo: "resultado", resultado });
    } catch (e: any) {
      const msg = e?.message || "erro desconhecido";
      const negado = /row-level security|permission denied|violates/i.test(msg);
      if (registro) {
        await sb.from("assistant_actions").update({ status: "erro", erro: msg }).eq("id", registro.id);
      }
      return json({
        ok: false,
        codigo: negado ? "sem_permissao" : "banco",
        erro: negado
          ? "O banco recusou: você não tem permissão para isso. Nada foi criado."
          : `O banco recusou: ${msg}. Nada foi criado.`,
      });
    }
  }

  /* ---- modo conversar ---- */
  if (!chave()) {
    return falha(
      "sem_chave",
      "O Kronos ainda não tem chave de IA configurada. Um administrador precisa definir o segredo ANTHROPIC_API_KEY no projeto Supabase.",
    );
  }

  const ctx = entrada.contexto || {};
  const historico = Array.isArray(entrada.mensagens) ? entrada.mensagens.slice(-16) : [];
  const msgs: any[] = historico
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
    .map((m: any) => ({ role: m.role, content: String(m.content) }));
  if (!msgs.length) return falha("payload", "Escreva alguma coisa para o Kronos.");

  const ferramentas = [...LEITURA, ...ESCRITA];
  const passos: any[] = [];

  try {
    for (let volta = 0; volta < 6; volta++) {
      const resp = await chamarModelo({
        model: modelo(),
        max_tokens: 2000,
        system: instrucao(quem, ctx),
        tools: ferramentas,
        messages: msgs,
      });

      const usos = (resp.content || []).filter((b: any) => b.type === "tool_use");
      const texto = (resp.content || []).filter((b: any) => b.type === "text")
        .map((b: any) => b.text).join("\n").trim();

      if (!usos.length) {
        return json({ ok: true, tipo: "texto", texto: texto || "Não consegui formular uma resposta.", passos });
      }

      /* uma proposta de escrita interrompe o laço e vai para a confirmação */
      const escrita = usos.find((u: any) => ESCRITA_NOMES.has(u.name));
      if (escrita) {
        const r = await resolverEscrita(sb, escrita.name, escrita.input || {});
        if (r.ok) {
          return json({
            ok: true,
            tipo: "confirmar",
            texto: texto || "Preparei isto. Confere antes de eu executar:",
            acao: { ferramenta: escrita.name, argumentos: r.argumentos },
            titulo: TITULOS[escrita.name] || escrita.name,
            campos: resumirAcao(escrita.name, r.argumentos),
            passos,
          });
        }
        /* não resolveu: devolve o erro ao modelo para ele contar a verdade */
        msgs.push({ role: "assistant", content: resp.content });
        msgs.push({
          role: "user",
          content: usos.map((u: any) => ({
            type: "tool_result",
            tool_use_id: u.id,
            content: JSON.stringify(u.id === escrita.id ? { erro: r.erro } : { erro: "não executado" }),
            is_error: true,
          })),
        });
        passos.push({ ferramenta: escrita.name, falhou: r.erro });
        continue;
      }

      const resultados: any[] = [];
      for (const u of usos) {
        let saida: any;
        try {
          saida = await lerFerramenta(sb, u.name, u.input || {});
        } catch (e: any) {
          saida = { erro: `A consulta falhou: ${e?.message || "erro no banco"}` };
        }
        passos.push({ ferramenta: u.name, argumentos: u.input });
        resultados.push({
          type: "tool_result",
          tool_use_id: u.id,
          content: JSON.stringify(saida).slice(0, 20000),
        });
      }
      msgs.push({ role: "assistant", content: resp.content });
      msgs.push({ role: "user", content: resultados });
    }
    return falha("laco", "Me perdi consultando os dados. Reformula o pedido?");
  } catch (e: any) {
    const st = e?.status;
    if (st === 401 || st === 403) {
      return falha("chave_invalida", "A chave de IA foi recusada pelo provedor. Um administrador precisa revisar o segredo ANTHROPIC_API_KEY.");
    }
    if (st === 429) return falha("limite", "O provedor de IA está limitando as chamadas agora. Tenta de novo em instantes.");
    if (st && st >= 500) return falha("ia_indisponivel", "O provedor de IA está fora do ar. Tenta de novo em instantes.");
    return falha("ia_indisponivel", `Não consegui falar com a IA: ${e?.message || "erro desconhecido"}.`);
  }
});
