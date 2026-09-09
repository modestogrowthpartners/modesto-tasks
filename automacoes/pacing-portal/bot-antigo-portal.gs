/**
 * PACING NO PORTAL — encaixe no bot antigo (v16 Slack + e-mail)
 * ============================================================
 * Este arquivo NÃO coleta nada e NÃO calcula nada. Ele lê o `results` que o
 * bot já monta com o Windsor e manda a mesma leitura para o portal:
 *
 *   • canal #controle-pacing-diario, uma mensagem por bloco, com gráfico vivo
 *   • tabela public.pacing, que alimenta a tela de Pacing do portal
 *
 * O bot continua sendo a única fonte do número. Nada aqui recalcula gasto,
 * receita ou ritmo: se recalculasse, um dia divergiria do Slack e ninguém
 * saberia em qual acreditar.
 *
 * INSTALAÇÃO
 *   1. Cole este arquivo no MESMO projeto do bot (Arquivos > + > Script).
 *   2. Propriedades do script: SUPABASE_URL e SUPABASE_KEY (service_role).
 *   3. No arquivo do bot, acrescente `portal:true` nas chamadas de run_ e o
 *      bloco do portal dentro de run_. Os dois trechos estão no README.
 *   4. No Supabase, uma vez:
 *        create unique index if not exists pacing_conta_dia_uidx
 *          on public.pacing (conta, dia);
 *
 * POR QUE chartUrlLong_ E NÃO chartUrlShort_
 *   O portal desenha o gráfico de novo, com Chart.js, lendo a configuração do
 *   parâmetro `c` da URL. A URL curta do QuickChart não carrega esse parâmetro,
 *   só a imagem pronta. Com a longa o portal entrega gráfico com tooltip; com a
 *   curta, entregaria uma figura. O Slack continua com a curta, que é o que ele
 *   precisa.
 */

var PORTAL = {
  canal: '71608354-2fbf-4edb-a95d-250063ff4498',   // #controle-pacing-diario
  autor: 'Pacing Bot MGP',

  // Bloco do UNITS -> empresa no portal. Dabela e Alliance são dois blocos
  // cada, apontando para a mesma empresa de propósito: o portal filtra por
  // empresa, o canal mostra os dois separados.
  clientes: {
    amakha_ecom:    'cbb0c902-f262-42be-8a6c-9264dd2fdc93',
    dabela_ecom:    '547fa98b-d336-4d73-ae79-66bef94fc34f',
    dabela_revend:  '547fa98b-d336-4d73-ae79-66bef94fc34f',
    alliance_br:    'ca04692e-41f4-4b10-a07c-18ab0cb1209c',
    alliance_latam: 'ca04692e-41f4-4b10-a07c-18ab0cb1209c',
    ruminar:        '29c5ddc1-0146-4222-99c1-cd49b4b56311',
    meu_rodape:     '25d38a74-41ec-4354-af16-6d165217be1d',
    wondr:          'abbf1611-06e7-49e7-8920-3ce0bfc86146',
    botoclinic:     null,     // ainda não existe como empresa no portal
    dolce_gabbana:  '1e3ead69-3b53-4443-8dc4-9222815a4ec3'
  }
};

var PORTAL_MOEDA = { 'R$': 'BRL', 'US$': 'USD', '€': 'EUR' };

/** Roda só o portal, sem mexer em Slack nem e-mail. Útil para conferir. */
function atualizarPortal() { run_({ slack:false, email:false, portal:true, manual:true }); }

// ═══════════════════════ SAÍDA: PORTAL ═══════════════════════

function sendPortal_(results, ctx) {
  var props = PropertiesService.getScriptProperties();
  var hoje = Utilities.formatDate(ctx.today, TZ, 'yyyy-MM-dd');
  var mesmoDia = props.getProperty('PORTAL_DATE') === hoje;
  var falhas = [];

  results.forEach(function (res) {
    try {
      portalMensagem_(props, 'PORTAL_ID_' + res.u.key, mesmoDia,
                      portalTexto_(res, ctx));
      portalPacing_(portalRegistro_(res, ctx));
    } catch (e) {
      // Um bloco que falha não derruba os outros: o resto do canal ainda
      // atualiza, e o log diz exatamente qual ficou para trás.
      falhas.push(res.u.nome + ': ' + e.message);
      Logger.log('Portal, ' + res.u.nome + ': ' + e);
    }
  });

  props.setProperty('PORTAL_DATE', hoje);
  if (falhas.length) throw new Error(falhas.join(' | '));
}

function portalTag_(d) {
  if (d === 'OK')      return '✅ no ritmo';
  if (d === 'SEGURAR') return '🔴 gastando rápido, segurar';
  if (d === 'VERBA')   return '🟡 abaixo por teto de verba, subir resolve';
  if (d === 'ENTREGA') return '🟠 abaixo por entrega, subir verba não resolve';
  return '';
}

function portalTexto_(res, ctx) {
  var u = res.u, cur = u.cur, l = [];

  l.push('# ' + u.nome);
  l.push('_pacing de ' + MONTHS_PT[ctx.today.getMonth()] + ' · ' + ctx.elapsed +
         ' de ' + ctx.dim + ' dias fechados, até ' + ctx.dateBR + '_');
  l.push('');

  res.channels.forEach(function (c) {
    var lbl = c.ch === 'google' ? 'Google Ads' : 'Meta Ads';
    if (c.inv.has) {
      l.push('*' + lbl + '* · ' + portalTag_(c.inv.diag));
      l.push('Investimento ' + money_(c.agg.spend, cur) + ' de ' +
             money_(c.inv.budget, cur) + ' · ritmo ideal ' +
             money_(c.inv.idealDay, cur) + '/dia · necessário ' +
             money_(c.inv.neededDay, cur) + '/dia nos ' + ctx.remain +
             ' dias que faltam');
      if (c.inv.diag === 'VERBA') {
        l.push('👉 subir o teto para cerca de ' + money_(c.inv.neededDay, cur) + '/dia');
      } else if (c.inv.diag === 'ENTREGA') {
        l.push('👉 não subir verba' +
               (c.inv.cap ? ' (o teto já está em cerca de ' + money_(c.inv.cap, cur) + '/dia)' : '') +
               '. O gargalo é criativo, segmentação ou leilão');
      } else if (c.inv.diag === 'SEGURAR') {
        l.push('👉 reduzir para cerca de ' + money_(c.inv.neededDay, cur) + '/dia');
      }
    } else {
      l.push('*' + lbl + '*');
      l.push('Investimento ' + money_(c.agg.spend, cur) +
             ' _(sem meta na planilha, número real sem semáforo)_');
    }
    l.push('');
    l.push(chartUrlLong_(chartCfg_(u.nome + ' · ' + lbl + ' · investimento',
      c.agg.cumSpend, c.inv.has ? c.inv.budget : null, '#4a9eed', ctx)));
    l.push('');
  });

  if (u.ecommerce) {
    var abaixo = res.roasPiso != null && res.roas < res.roasPiso;
    l.push('*Receita e ROAS*');
    l.push('Receita ' + money_(res.totRev, cur) + ' · pedidos ' +
           Math.round(res.totOrd) + ' · ROAS *' + res.roas.toFixed(2) + 'x*' +
           (res.roasPiso != null ? ' (piso ' + res.roasPiso + 'x)' : '') +
           (abaixo ? ' ⚠️ abaixo do piso' : ''));
    l.push('');
    l.push(chartUrlLong_(chartCfg_(u.nome + ' · receita acumulada',
      res.revCum || [], res.metaReceita, '#2eb67d', ctx)));
  } else if (u.leadgen) {
    l.push('*Leads* ' + Math.round(res.totOrd) +
           ' _(lead-gen, sem receita monetária: ROAS não se aplica)_');
  }

  return l.join('\n');
}

function portalRegistro_(res, ctx) {
  var u = res.u;
  var canais = res.channels.map(function (c) {
    return {
      canal: c.ch === 'google' ? 'Google Ads' : 'Meta Ads',
      investido: Math.round(c.agg.spend * 100) / 100,
      meta: c.inv.has ? c.inv.budget : 0,
      situacao: c.inv.has ? c.inv.diag.toLowerCase() : 'sem meta'
    };
  });

  return {
    conta: u.nome,
    client_id: PORTAL.clientes[u.key] || null,
    dia: Utilities.formatDate(ctx.today, TZ, 'yyyy-MM-dd'),
    mes: Utilities.formatDate(ctx.today, TZ, 'yyyy-MM'),
    moeda: PORTAL_MOEDA[u.cur] || 'BRL',
    dias_fechados: ctx.elapsed,
    dias_no_mes: ctx.dim,
    canais: canais,
    receita:    u.ecommerce ? Math.round(res.totRev * 100) / 100 : null,
    pedidos:    u.ecommerce ? Math.round(res.totOrd) : null,
    conversoes: Math.round(res.totOrd),
    roas:       u.ecommerce ? Math.round(res.roas * 100) / 100 : null,
    roas_piso:  res.roasPiso != null ? res.roasPiso : null
  };
}

// ═══════════════════════ SUPABASE ═══════════════════════

function portalProp_(chave) {
  var v = PropertiesService.getScriptProperties().getProperty(chave);
  if (!v) throw new Error('falta a propriedade de script ' + chave);
  return v;
}

function portalFetch_(caminho, metodo, corpo, prefer) {
  var resp = UrlFetchApp.fetch(portalProp_('SUPABASE_URL') + '/rest/v1/' + caminho, {
    method: metodo,
    contentType: 'application/json',
    headers: {
      apikey: portalProp_('SUPABASE_KEY'),
      Authorization: 'Bearer ' + portalProp_('SUPABASE_KEY'),
      Prefer: prefer
    },
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true
  });
  var c = resp.getResponseCode();
  if (c < 200 || c > 299) throw new Error('supabase ' + c + ': ' + resp.getContentText().slice(0, 300));
  return resp.getContentText();
}

/**
 * Upsert por (conta, dia): rodar de novo no mesmo dia corrige a linha em vez
 * de empilhar uma nova. Depende do índice único pacing_conta_dia_uidx.
 */
function portalPacing_(linha) {
  portalFetch_('pacing', 'post', linha, 'resolution=merge-duplicates,return=minimal');
}

/**
 * Uma mensagem por bloco por dia. Dentro do mesmo dia, reexecução edita o
 * corpo em vez de postar de novo, igual ao que o bot faz no Slack: o canal
 * precisa mostrar o estado de hoje, não o histórico das tentativas de hoje.
 */
function portalMensagem_(props, chaveId, mesmoDia, texto) {
  var id = mesmoDia ? props.getProperty(chaveId) : null;

  if (id) {
    try {
      portalFetch_('messages?id=eq.' + encodeURIComponent(id), 'patch',
                   { body: texto }, 'return=minimal');
      return;
    } catch (e) {
      // Mensagem apagada no portal, por exemplo. Cai para criar uma nova.
      Logger.log('Portal: edição falhou (' + e.message + '), postando nova.');
    }
  }

  var criada = portalFetch_('messages', 'post', {
    channel_id: PORTAL.canal,
    author_id: null,
    author_name: PORTAL.autor,
    body: texto,
    kind: 'user'
  }, 'return=representation');

  var linhas = JSON.parse(criada);
  if (linhas && linhas[0] && linhas[0].id) props.setProperty(chaveId, linhas[0].id);
}
