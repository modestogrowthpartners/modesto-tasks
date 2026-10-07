/**
 * PACING NO PORTAL — versão para o script "Alertas de pacing V1" (v3.2)
 * =====================================================================
 *
 * Substitui a tentativa antiga (bot-antigo-portal.gs, pacing-diario.gs):
 * aquele código foi escrito para o "Pacing Bot MGP" antigo, que não existe
 * mais. O sistema atual (pacing_alertas.gs + ingestao.gs + tendencias.gs +
 * conta.gs) nunca teve ponte com a plataforma. Este arquivo cria essa ponte.
 *
 * O QUE FAZ
 * Depois que `analisarConta_` já calculou cada conta do PAINEL (budget,
 * investido, receita, ROAS por veículo), soma as contas do MESMO CLIENTE
 * num único registro e grava em:
 *   - tabela `public.pacing` do Supabase (alimenta a aba Pacing/Relatórios)
 *   - canal `controle-pacing-diario` do portal, como mensagem de texto
 *
 * POR QUE POR CLIENTE, E NÃO POR CONTA
 * A tela de Relatórios do portal (index.html, `ultimo()`) usa só a linha
 * MAIS RECENTE de public.pacing por client_id — não soma linhas do mesmo
 * dia. Gravar "WONDR EXPERIENCE" e "BARBIE" como duas linhas com o mesmo
 * client_id faria a tela mostrar uma e esconder a outra, sem erro nenhum.
 * Por isso as contas do mesmo cliente são somadas ANTES de gravar.
 *
 * ⚠️ CONFIRA antes de instalar: os nomes em CONTA_CLIENTE abaixo (AMAKHA
 * PARIS, ALLIANCE BR, etc.) foram inferidos de `ROTA` em ingestao.gs, não
 * conferidos contra o texto literal da coluna A (Cliente) da aba PAINEL.
 * Se o nome na aba for diferente (acento, abreviação, maiúscula), a conta
 * cai com client_id nulo: ainda aparece na aba Pacing geral, mas não na
 * aba de Relatórios por cliente. Ajuste as chaves para bater exatamente.
 *
 * INSTALAÇÃO
 * 1. No projeto do Apps Script "Alertas de pacing V1": Arquivos > + >
 *    Script, nome `portal`, cole este arquivo inteiro.
 * 2. Configurações do projeto > Propriedades do script, acrescente:
 *      SUPABASE_URL   https://eeqaabwsheaiwyhujcqj.supabase.co
 *      SUPABASE_KEY   service_role key do projeto (eeqaabwsheaiwyhujcqj)
 *    (SLACK_WEBHOOK_URL, SLACK_BOT_TOKEN etc. continuam os mesmos, não mexe.)
 * 3. Em pacing_alertas.gs (arquivo "Alerta de pacing.gs"), dentro de
 *    `executar_(opts)`, logo depois da linha:
 *        painel.contas.forEach(c => analisarConta_(ss, c, datas, orcamentos, alertas));
 *    acrescente:
 *        if (!opts.teste) gravarPacingNoPortalTudo_(painel, datas);
 *    (fora do modo teste, pelo mesmo motivo que a ingestão: teste não deve
 *    gravar nada fora da própria planilha)
 * 4. Rode `testarGravarPacingNoPortal` uma vez para conferir sem esperar o
 *    gatilho das 8h. Ele não precisa que o dia tenha rodado de verdade: usa
 *    o `painel` já calculado na sessão.
 *
 * Não recalcula nada. Usa os números que `analisarConta_` já deixou em cada
 * `c.veiculos[]` — a mesma régua que vai para o e-mail e o Slack. Se este
 * arquivo calculasse de novo, um dia divergiria do e-mail da diretoria e
 * ninguém saberia em qual confiar.
 */

const PORTAL_CANAL = '71608354-2fbf-4edb-a95d-250063ff4498'; // #controle-pacing-diario

/** conta do PAINEL -> cliente no portal. Empresas com mais de uma conta
 *  (Wondr/Barbie/PB, Alliance BR/LATAM) apontam para o mesmo client_id de
 *  propósito: é o que faz a soma virar uma linha só. */
const CONTA_CLIENTE = {
  'AMAKHA PARIS':    { id: 'cbb0c902-f262-42be-8a6c-9264dd2fdc93', empresa: 'Amakha Paris' },
  'ALLIANCE BR':     { id: 'ca04692e-41f4-4b10-a07c-18ab0cb1209c', empresa: 'Alliance Laundry' },
  'ALLIANCE LATAM':  { id: 'ca04692e-41f4-4b10-a07c-18ab0cb1209c', empresa: 'Alliance Laundry' },
  'D&G':             { id: '1e3ead69-3b53-4443-8dc4-9222815a4ec3', empresa: 'Dolce & Gabbana' },
  'RUMINAR':         { id: '29c5ddc1-0146-4222-99c1-cd49b4b56311', empresa: 'Ruminar' },
  'WONDR EXPERIENCE':{ id: 'abbf1611-06e7-49e7-8920-3ce0bfc86146', empresa: 'Wondr/Barbie/PB' },
  'BARBIE':          { id: 'abbf1611-06e7-49e7-8920-3ce0bfc86146', empresa: 'Wondr/Barbie/PB' },
  'MEU RODAPE':      { id: '25d38a74-41ec-4354-af16-6d165217be1d', empresa: 'Meu Rodapé' },
  'DABELA SITE':     { id: '547fa98b-d336-4d73-ae79-66bef94fc34f', empresa: 'Dabela' },
  'DABELA REVENDA':  { id: '547fa98b-d336-4d73-ae79-66bef94fc34f', empresa: 'Dabela' }
};

// ---------------------------------------------------------------------
//  PONTO DE ENTRADA
// ---------------------------------------------------------------------

/** Chama para todas as contas do painel já analisado, agrupando por cliente. */
function gravarPacingNoPortalTudo_(painel, datas) {
  const porCliente = {};
  (painel.contas || []).forEach(function (c) {
    const dest = CONTA_CLIENTE[normalizarPortal_(c.nome)] || null;
    // Sem mapa conhecido, a conta ainda grava sozinha (client_id nulo), para
    // não perder o dado por falta de cadastro — só fica fora da aba de
    // Relatórios por cliente até alguém completar o mapa acima.
    const chave = dest ? dest.empresa : c.nome;
    if (!porCliente[chave]) porCliente[chave] = { empresa: chave, client_id: dest ? dest.id : null, contas: [] };
    porCliente[chave].contas.push(c);
  });

  Object.keys(porCliente).forEach(function (empresa) {
    try {
      const linha = montarLinhaPortal_(porCliente[empresa], datas);
      if (!linha) return; // nada investido nesse cliente, não grava linha vazia
      gravarPacingNoPortal_(linha);
      publicarPacingNoCanal_(linha);
    } catch (e) {
      Logger.log('Portal, ' + empresa + ': ' + e.message);
    }
  });
}

/** Roda à mão, sem esperar o gatilho das 8h. Usa o painel desta sessão. */
function testarGravarPacingNoPortal() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const datas = calcularDatas_();
  const alertas = [];
  let orcamentos = {};
  try { orcamentos = lerOrcamentosExternos_(); } catch (e) {}
  const painel = lerPainel_(ss, datas, alertas);
  painel.contas.forEach(function (c) { analisarConta_(ss, c, datas, orcamentos, alertas); });
  gravarPacingNoPortalTudo_(painel, datas);
  Logger.log('Gravação de teste concluída. Confira a tabela public.pacing e o canal controle-pacing-diario.');
}

// ---------------------------------------------------------------------
//  MONTAGEM DA LINHA (soma por cliente)
// ---------------------------------------------------------------------
function normalizarPortal_(s) {
  return String(s || '').toUpperCase().trim();
}

/** Soma os veículos de todas as contas do mesmo cliente num só registro. */
function montarLinhaPortal_(grupo, datas) {
  const canais = {}; // nome do veículo -> {canal, investido, meta, situacao}
  let receita = 0, temReceita = false;
  const moeda = 'BRL'; // todas as abas de PAINEL hoje são BRL; ajuste aqui se entrar conta em outra moeda

  grupo.contas.forEach(function (c) {
    (c.veiculos || []).forEach(function (v) {
      if (!v.investido && !v.budget) return;
      const k = v.nome;
      if (!canais[k]) canais[k] = { canal: k, investido: 0, meta: 0, situacao: 'ok' };
      canais[k].investido += Number(v.investido) || 0;
      canais[k].meta += Number(v.budget) || 0;
    });
    if (c.receita) { receita += Number(c.receita) || 0; temReceita = true; }
  });

  const listaCanais = Object.keys(canais).map(function (k) { return canais[k]; });
  if (!listaCanais.length) return null;

  const investidoTotal = listaCanais.reduce(function (s, x) { return s + x.investido; }, 0);

  return {
    conta: grupo.empresa,
    client_id: grupo.client_id,
    dia: Utilities.formatDate(datas.ontem, CONFIG.FUSO, 'yyyy-MM-dd'),
    mes: Utilities.formatDate(datas.ontem, CONFIG.FUSO, 'yyyy-MM'),
    moeda: moeda,
    dias_fechados: datas.diasDecorridos,
    dias_no_mes: datas.diasNoMes,
    canais: listaCanais,
    receita: temReceita ? Math.round(receita * 100) / 100 : null,
    roas: (temReceita && investidoTotal > 0) ? Math.round((receita / investidoTotal) * 100) / 100 : null
  };
}

// ---------------------------------------------------------------------
//  ESCRITA NO SUPABASE
// ---------------------------------------------------------------------

/**
 * Upsert por (conta, dia): rodar de novo no mesmo dia corrige a linha em
 * vez de duplicar. Índice único já existe no banco novo (pacing_conta_dia_key).
 */
function gravarPacingNoPortal_(linha) {
  const resp = UrlFetchApp.fetch(propriedadePortal_('SUPABASE_URL') + '/rest/v1/pacing', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: propriedadePortal_('SUPABASE_KEY'),
      Authorization: 'Bearer ' + propriedadePortal_('SUPABASE_KEY'),
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    payload: JSON.stringify(linha),
    muteHttpExceptions: true
  });
  const codigo = resp.getResponseCode();
  if (codigo !== 201 && codigo !== 200 && codigo !== 204) {
    throw new Error('pacing ' + codigo + ': ' + resp.getContentText());
  }
}

/**
 * Espelha o resumo no canal do portal. Edita a mensagem do dia em vez de
 * empilhar: reexecução no mesmo dia faz o texto atual substituir o anterior
 * (mesma regra do bot antigo), procurando por uma mensagem do "Pacing Bot MGP"
 * para esta conta já publicada hoje.
 */
function publicarPacingNoCanal_(linha) {
  const texto = resumoPortalTexto_(linha);
  const url = propriedadePortal_('SUPABASE_URL');
  const key = propriedadePortal_('SUPABASE_KEY');

  const existente = UrlFetchApp.fetch(
    url + '/rest/v1/messages?channel_id=eq.' + PORTAL_CANAL +
    '&author_name=eq.' + encodeURIComponent('Pacing Bot MGP') +
    '&body=like.' + encodeURIComponent('%23%20' + linha.conta + '%0A_pacing%20de%20' + linha.dia + '%25') +
    '&select=id&limit=1',
    { headers: { apikey: key, Authorization: 'Bearer ' + key }, muteHttpExceptions: true }
  );
  let idExistente = null;
  try {
    const arr = JSON.parse(existente.getContentText());
    if (arr && arr.length) idExistente = arr[0].id;
  } catch (e) { /* segue e publica nova */ }

  const payload = { body: texto };
  let resp;
  if (idExistente) {
    resp = UrlFetchApp.fetch(url + '/rest/v1/messages?id=eq.' + idExistente, {
      method: 'patch', contentType: 'application/json',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
  } else {
    resp = UrlFetchApp.fetch(url + '/rest/v1/messages', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
      payload: JSON.stringify({ channel_id: PORTAL_CANAL, author_id: null, author_name: 'Pacing Bot MGP', body: texto, kind: 'user' }),
      muteHttpExceptions: true
    });
  }
  const codigo = resp.getResponseCode();
  if (codigo !== 201 && codigo !== 200 && codigo !== 204) {
    throw new Error('canal ' + codigo + ': ' + resp.getContentText());
  }
}

function resumoPortalTexto_(linha) {
  const inv = linha.canais.reduce(function (s, c) { return s + c.investido; }, 0);
  const meta = linha.canais.reduce(function (s, c) { return s + c.meta; }, 0);
  const l = ['# ' + linha.conta, '_pacing de ' + linha.dia + '_', ''];
  l.push('*Realizado* ' + brlPortal_(inv, linha.moeda) + ' em ' + linha.dias_fechados + ' dias fechados');
  if (meta > 0) {
    const ritmoIdeal = meta / linha.dias_no_mes;
    const projecao = (inv / linha.dias_fechados) * linha.dias_no_mes;
    const pct = Math.round((projecao / meta) * 100);
    l.push('*Plano do mês* ' + brlPortal_(meta, linha.moeda) + ' · ritmo ideal ' + brlPortal_(ritmoIdeal, linha.moeda) + '/dia');
    l.push('*Projeção no ritmo atual* ' + brlPortal_(projecao, linha.moeda) + ' · ' + pct + '% do plano');
  }
  if (linha.receita) l.push('*Receita* ' + brlPortal_(linha.receita, linha.moeda) + (linha.roas ? ' · ROAS ' + linha.roas.toFixed(2) : ''));
  return l.join('\n');
}

function brlPortal_(v, moeda) {
  const s = { BRL: 'R$', USD: 'US$', EUR: '€' }[moeda] || moeda;
  return s + ' ' + Math.round(v).toLocaleString('pt-BR');
}

function propriedadePortal_(chave) {
  const v = PropertiesService.getScriptProperties().getProperty(chave);
  if (!v) throw new Error('Falta a propriedade de script ' + chave);
  return v;
}
