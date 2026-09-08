/**
 * PACING NO PORTAL
 *
 * Cole estas funções no projeto do Pacing Bot MGP que já roda hoje, e chame
 * depois de montar o pacing de cada conta:
 *
 *   gravarPacingNoPortal(linha);    // alimenta a tela de Pacing do portal
 *   publicarPacingNoCanal(texto);   // espelha a mensagem no canal do portal
 *
 * Precisa das propriedades de script SUPABASE_URL e SUPABASE_KEY.
 * Veja README.md deste diretório para o contrato da tabela.
 */

var PACING_CANAL_PORTAL = '71608354-2fbf-4edb-a95d-250063ff4498'; // #controle-pacing-diario

/**
 * Grava uma conta no pacing do dia. Upsert por (conta, dia): rodar de novo no
 * mesmo dia corrige a linha em vez de duplicar.
 *
 * Exige o índice único, criado uma vez:
 *   create unique index if not exists pacing_conta_dia_uidx
 *     on public.pacing (conta, dia);
 *
 * @param {Object} linha  conta, dia, mes, moeda, dias_fechados, dias_no_mes,
 *                        canais[], receita, pedidos, conversoes, roas, roas_piso
 */
function gravarPacingNoPortal(linha) {
  if (!linha || !linha.conta || !linha.dia) {
    throw new Error('pacing precisa pelo menos de conta e dia');
  }

  var resp = UrlFetchApp.fetch(propriedade('SUPABASE_URL') + '/rest/v1/pacing', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: propriedade('SUPABASE_KEY'),
      Authorization: 'Bearer ' + propriedade('SUPABASE_KEY'),
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    payload: JSON.stringify(linha),
    muteHttpExceptions: true
  });

  var codigo = resp.getResponseCode();
  if (codigo !== 201 && codigo !== 200 && codigo !== 204) {
    throw new Error('pacing ' + codigo + ': ' + resp.getContentText());
  }
}

/**
 * Publica a mensagem de pacing no canal do portal.
 *
 * O portal usa a mesma marcação do Slack, então o texto que o bot já monta
 * serve. Duas correções são feitas aqui:
 *   - emoji em código (:red_circle:) vira emoji de verdade, porque o portal
 *     mostraria o literal;
 *   - o link do QuickChart continua link. O portal não renderiza imagem no
 *     corpo da mensagem; quem quiser o gráfico usa a tela de Pacing.
 */
function publicarPacingNoCanal(texto) {
  var resp = UrlFetchApp.fetch(propriedade('SUPABASE_URL') + '/rest/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: propriedade('SUPABASE_KEY'),
      Authorization: 'Bearer ' + propriedade('SUPABASE_KEY'),
      Prefer: 'return=minimal'
    },
    payload: JSON.stringify({
      channel_id: PACING_CANAL_PORTAL,
      author_id: null,
      author_name: 'Pacing Bot MGP',
      body: emojiDeVerdade(texto),
      kind: 'user'
    }),
    muteHttpExceptions: true
  });

  var codigo = resp.getResponseCode();
  if (codigo !== 201 && codigo !== 200) {
    throw new Error('canal ' + codigo + ': ' + resp.getContentText());
  }
}

var EMOJI = {
  ':large_orange_circle:': '🟠',
  ':red_circle:': '🔴',
  ':large_green_circle:': '🟢',
  ':white_check_mark:': '✅',
  ':warning:': '⚠️',
  ':point_right:': '👉',
  ':information_source:': 'ℹ️',
  ':chart_with_upwards_trend:': '📈',
  ':chart_with_downwards_trend:': '📉'
};

function emojiDeVerdade(texto) {
  var s = String(texto || '');
  Object.keys(EMOJI).forEach(function (codigo) {
    s = s.split(codigo).join(EMOJI[codigo]);
  });
  return s;
}

function propriedade(chave) {
  var v = PropertiesService.getScriptProperties().getProperty(chave);
  if (!v) throw new Error('Falta a propriedade de script ' + chave);
  return v;
}

/**
 * Exemplo do formato, com os números reais do post de 14/08 no Slack.
 * Rode uma vez para ver a tela de Pacing sair do estado vazio.
 */
function exemploPacing() {
  gravarPacingNoPortal({
    conta: 'Meu Rodapé',
    client_id: '25d38a74-41ec-4354-af16-6d165217be1d',
    dia: '2026-08-14',
    mes: '2026-08',
    moeda: 'BRL',
    dias_fechados: 13,
    dias_no_mes: 31,
    canais: [
      { canal: 'Google Ads', investido: 69435, meta: 162000, situacao: 'ok' },
      { canal: 'Meta Ads',   investido: 66311, meta: 138000, situacao: 'acima',
        sugestao_dia: 3983 }
    ],
    receita: 941184,
    pedidos: 2201,
    roas: 6.93,
    roas_piso: 4.5
  });
}
