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
 * Gráfico de pacing do mês: quatro séries no acumulado.
 *
 *   Plano            tracejado cinza, a verba do mês distribuída por dia
 *   Real acumulado   área azul preenchida, só até o último dia FECHADO
 *   Sem ajuste       pontilhado laranja, o ritmo atual até o fim do mês
 *   Com ajuste       pontilhado verde, o ritmo necessário para fechar na verba
 *
 * A pergunta que o gráfico responde não é "quanto gastei", é "mantendo este
 * ritmo eu fecho na verba, e se não, quanto por dia preciso passar a gastar".
 * Por isso a linha verde: ela é a recomendação, não uma projeção.
 *
 * O dia de hoje fica de fora da média de propósito. Ele está em curso e
 * sempre parece um dia fraco, então entra na média puxando a projeção para
 * baixo e faz a conta mentir todo dia, sempre no mesmo sentido.
 *
 * Sem meta, o gráfico sai com duas séries e sem semáforo. Melhor não desenhar
 * plano nenhum do que desenhar um plano inventado.
 *
 * @param {Object} o
 *   o.conta      nome que vai no título
 *   o.diario     gasto de cada dia do mês, índice 0 = dia 1, incluindo hoje
 *   o.fechados   quantos dias já fecharam (normalmente ontem)
 *   o.diasNoMes  28, 30, 31
 *   o.meta       verba do mês; 0 ou ausente esconde plano, ajuste e semáforo
 *   o.moeda      'R$', 'US$', '€'
 * @return {Object} { url, realizado, media, projecao, ajuste, percentualDoPlano, resumo }
 */
function graficoProjecao(o) {
  var diasNoMes = o.diasNoMes || 30;
  var fechados = Math.max(1, Math.min(o.fechados || 1, diasNoMes));
  var moeda = o.moeda || 'R$';
  var restantes = diasNoMes - fechados;

  var acumulado = [], soma = 0;
  for (var i = 0; i < o.diario.length; i++) {
    soma += Number(o.diario[i]) || 0;
    acumulado.push(Math.round(soma * 100) / 100);
  }

  var realizado = acumulado[fechados - 1] || 0;
  var media = realizado / fechados;
  var projecao = media * diasNoMes;
  var ajuste = (o.meta && restantes > 0) ? (o.meta - realizado) / restantes : null;

  function din(v) {
    return moeda + ' ' + Math.round(v).toLocaleString('pt-BR');
  }

  var rotulos = [], plano = [], real = [], semAj = [], comAj = [];
  for (var d = 1; d <= diasNoMes; d++) {
    rotulos.push(d + '/' + (o.mes || '09'));
    plano.push(o.meta ? Math.round((o.meta / diasNoMes) * d) : null);
    real.push(d <= fechados ? Math.round(acumulado[d - 1]) : null);
    // As projeções começam no último ponto do realizado, para as linhas se
    // encostarem em vez de aparecer um degrau entre elas.
    semAj.push(d < fechados ? null : Math.round(realizado + media * (d - fechados)));
    comAj.push((ajuste === null || d < fechados) ? null
      : Math.round(realizado + ajuste * (d - fechados)));
  }

  var ds = [];
  if (o.meta) {
    ds.push({ label: 'Plano · ' + din(o.meta), data: plano, borderColor: '#8a8578',
      borderDash: [6, 4], borderWidth: 2, fill: false, pointRadius: 0 });
  }
  ds.push({ label: 'Real acumulado', data: real, borderColor: '#3b6fd4',
    backgroundColor: 'rgba(59,111,212,0.18)', borderWidth: 3, fill: true, pointRadius: 0 });
  ds.push({ label: 'Sem ajuste · ' + din(media) + '/dia', data: semAj, borderColor: '#d98324',
    borderDash: [2, 3], borderWidth: 2, fill: false, pointRadius: 0 });
  if (ajuste !== null) {
    ds.push({ label: 'Com ajuste · ' + din(ajuste) + '/dia', data: comAj, borderColor: '#2e9e6b',
      borderDash: [2, 3], borderWidth: 2, fill: false, pointRadius: 0 });
  }

  var cfg = {
    type: 'line',
    data: { labels: rotulos, datasets: ds },
    options: {
      plugins: {
        // Fonte grande no título de propósito: o gráfico é lido no meio de um
        // canal de chat, muitas vezes no celular, onde o padrão do Chart.js
        // fica pequeno demais para se distinguir do resto da mensagem.
        title: { display: true, text: o.conta + ' · pacing do mes',
                 font: { size: 22, weight: 'bold' }, padding: 14 },
        legend: { position: 'top', labels: { boxWidth: 14, font: { size: 13 } } }
      },
      scales: { x: { ticks: { maxTicksLimit: 10 } } }
    }
  };

  var pct = o.meta ? (projecao / o.meta) * 100 : null;
  var linhas = ['*Realizado* ' + din(realizado) + ' em ' + fechados +
                ' dias fechados · média ' + din(media) + '/dia'];
  if (o.meta) {
    var sinal = (pct >= 95 && pct <= 105) ? '🟢' : (pct > 105 ? '🔴' : '🟠');
    linhas.push('*Plano do mês* ' + din(o.meta) + ' · ritmo ideal ' + din(o.meta / diasNoMes) + '/dia');
    linhas.push('*Projeção no ritmo atual* ' + din(projecao) + ' · ' + sinal + ' ' +
                Math.round(pct) + '% do plano');
    linhas.push('*Para fechar na verba* ' + (ajuste < media ? 'reduzir' : 'subir') +
                ' para ' + din(ajuste) + '/dia nos ' + restantes + ' dias que faltam');
  } else {
    linhas.push('*Plano do mês* não informado. Sem linha de plano e sem semáforo.');
  }

  return {
    url: 'https://quickchart.io/chart?w=620&h=320&c=' + encodeURIComponent(JSON.stringify(cfg)),
    realizado: realizado, media: media, projecao: projecao, ajuste: ajuste,
    percentualDoPlano: pct, resumo: linhas.join('\n')
  };
}
