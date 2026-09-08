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
 * Gráfico de projeção até o fim do mês: três linhas no acumulado.
 *
 *   Plano de mídia   reta pontilhada, a verba do mês distribuída por dia
 *   Realizado        linha cheia, só até o último dia FECHADO
 *   Projeção         pontilhada, o ritmo atual estendido até o fim do mês
 *
 * O dia de hoje fica de fora da média de propósito. Ele está em curso e
 * sempre parece um dia fraco, então entra na média puxando a projeção para
 * baixo e faz a conta mentir todo dia, sempre no mesmo sentido.
 *
 * @param {Object} o
 *   o.conta      nome que vai no título
 *   o.diario     array com o gasto de cada dia do mês, índice 0 = dia 1.
 *                Inclua o dia de hoje: ele é desenhado, só não entra na média.
 *   o.fechados   quantos dias já fecharam (normalmente ontem)
 *   o.diasNoMes  28, 30, 31
 *   o.meta       verba do mês. Zero ou ausente esconde a linha do plano.
 *   o.moeda      'R$', 'US$', '€'
 * @return {Object} { url, realizado, media, projecao, percentualDoPlano }
 */
function graficoProjecao(o) {
  var diasNoMes = o.diasNoMes || 30;
  var fechados = Math.max(1, Math.min(o.fechados || 1, diasNoMes));
  var moeda = o.moeda || 'R$';

  var acumulado = [], soma = 0;
  for (var i = 0; i < o.diario.length; i++) {
    soma += Number(o.diario[i]) || 0;
    acumulado.push(Math.round(soma * 100) / 100);
  }

  var realizadoFechado = acumulado[fechados - 1] || 0;
  var media = realizadoFechado / fechados;
  var projecao = media * diasNoMes;

  var rotulos = [], plano = [], real = [], proj = [];
  for (var d = 1; d <= diasNoMes; d++) {
    rotulos.push(String(d));
    plano.push(o.meta ? Math.round((o.meta / diasNoMes) * d * 100) / 100 : null);
    real.push(d <= fechados ? acumulado[d - 1] : null);
    // A projeção começa no último ponto do realizado, para as linhas se
    // encostarem em vez de aparecer um degrau entre elas.
    proj.push(d < fechados ? null
      : Math.round((realizadoFechado + media * (d - fechados)) * 100) / 100);
  }

  var conjuntos = [];
  if (o.meta) {
    conjuntos.push({ label: 'Plano de mídia', data: plano, borderColor: '#8a8578',
      borderDash: [4, 4], borderWidth: 2, fill: false, pointRadius: 0 });
  }
  conjuntos.push({ label: 'Realizado', data: real, borderColor: '#1a1a18',
    borderWidth: 3, fill: false, pointRadius: 0 });
  conjuntos.push({ label: 'Projeção no ritmo', data: proj, borderColor: '#c2a15b',
    borderDash: [2, 3], borderWidth: 2, fill: false, pointRadius: 0 });

  var cfg = {
    type: 'line',
    data: { labels: rotulos, datasets: conjuntos },
    options: {
      plugins: {
        title: { display: true, text: o.conta + ' · investimento acumulado no mês' },
        legend: { position: 'bottom' }
      }
    }
  };

  return {
    url: 'https://quickchart.io/chart?w=560&h=300&c=' +
         encodeURIComponent(JSON.stringify(cfg)),
    realizado: realizadoFechado,
    media: media,
    projecao: projecao,
    percentualDoPlano: o.meta ? (projecao / o.meta) * 100 : null,
    resumo: '*Realizado* ' + moeda + ' ' + Math.round(realizadoFechado).toLocaleString('pt-BR') +
            ' em ' + fechados + ' dias fechados · média ' + moeda + ' ' +
            Math.round(media).toLocaleString('pt-BR') + '/dia' +
            (o.meta ? '\n*Projeção no mês* ' + moeda + ' ' +
              Math.round(projecao).toLocaleString('pt-BR') + ' · ' +
              Math.round((projecao / o.meta) * 100) + '% do plano' : '')
  };
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
