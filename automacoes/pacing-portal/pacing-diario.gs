/**
 * PACING DIÁRIO — PARTE 2 DE 2: Meta, montagem, gráfico e publicação
 *
 * Onde roda: Google Apps Script (script.google.com).
 * Agende `main` para TODOS OS DIAS, 07:30, rodando `instalarAcionador()` uma
 * vez. A parte 1 (google-ads-gasto.js) roda às 07:00 dentro do Google Ads.
 *
 * Cole no mesmo projeto o arquivo `pacing-portal.gs`, que traz
 * `graficoProjecao`, `publicarPacingNoCanal` e `gravarPacingNoPortal`.
 *
 * Segredos, em Configurações do projeto > Propriedades do script:
 *   META_TOKEN     System User do Business Manager, com ads_read
 *   SUPABASE_URL   https://eeqaabwsheaiwyhujcqj.supabase.co
 *   SUPABASE_KEY   service_role key
 *
 * As metas e o mapa de contas NÃO ficam aqui. São lidos do contas.json no
 * repositório, que é a fonte única: mudou a verba, edite lá e o pacing do dia
 * seguinte já sai certo, sem mexer neste script.
 */

var CONTAS_JSON = 'https://raw.githubusercontent.com/modestogrowthpartners/'
                + 'modesto-tasks/main/automacoes/relatorio-semanal/contas.json';

var ARQUIVOS_GOOGLE = ['pacing-google-mgp.json', 'pacing-google-wondr.json'];

var API_META = 'v24.0';
var SIMBOLO = { BRL: 'R$', USD: 'US$', EUR: '€' };

// ————————————————————————————————————————————————————————————

function main() {
  var cfg = lerContas();
  var google = lerGoogleDoDrive();
  var hoje = new Date();
  var ano = Number(Utilities.formatDate(hoje, 'America/Sao_Paulo', 'yyyy'));
  var mes = Number(Utilities.formatDate(hoje, 'America/Sao_Paulo', 'MM'));
  var diaDeHoje = Number(Utilities.formatDate(hoje, 'America/Sao_Paulo', 'dd'));
  var diasNoMes = new Date(ano, mes, 0).getDate();

  // Só dias fechados entram na média. Hoje está em curso e sempre parece um
  // dia fraco: incluí-lo faria a projeção mentir todo dia, no mesmo sentido.
  var fechados = diaDeHoje - 1;
  if (fechados < 1) {
    Logger.log('Dia 1 do mês: ainda não há dia fechado. Nada a publicar.');
    return;
  }

  var chaveMes = ano + '-' + (mes < 10 ? '0' : '') + mes;
  var falhas = [];

  cfg.clientes.forEach(function (cli) {
    if (cli.so_tarefas) return;
    try {
      var linha = montarCliente(cli, google, chaveMes, fechados, diasNoMes);
      if (!linha) return;                       // cliente sem conta conectada
      publicarPacingNoCanal(linha.texto);
      gravarPacingNoPortal(linha.registro);
    } catch (e) {
      falhas.push(cli.rotulo + ': ' + e);
      Logger.log('ERRO em ' + cli.rotulo + ': ' + e);
    }
  });

  if (falhas.length) throw new Error('Falhas: ' + falhas.join(' | '));
  Logger.log('Pacing do dia publicado.');
}

/** Confere o texto sem publicar nada. */
function previa() {
  var cfg = lerContas(), google = lerGoogleDoDrive();
  var hoje = new Date();
  var ano = Number(Utilities.formatDate(hoje, 'America/Sao_Paulo', 'yyyy'));
  var mes = Number(Utilities.formatDate(hoje, 'America/Sao_Paulo', 'MM'));
  var dia = Number(Utilities.formatDate(hoje, 'America/Sao_Paulo', 'dd'));
  var chaveMes = ano + '-' + (mes < 10 ? '0' : '') + mes;
  cfg.clientes.forEach(function (cli) {
    if (cli.so_tarefas) return;
    var l = montarCliente(cli, google, chaveMes, dia - 1, new Date(ano, mes, 0).getDate());
    if (l) Logger.log(l.texto + '\n———');
  });
}

function instalarAcionador() {
  removerAcionadores();
  ScriptApp.newTrigger('main').timeBased().everyDays(1).atHour(7).create();
  Logger.log('Acionador diário criado, por volta das 7h, fuso ' +
             Session.getScriptTimeZone() + '.');
}

function removerAcionadores() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'main') { ScriptApp.deleteTrigger(t); n++ }
  });
  Logger.log(n + ' acionador(es) removido(s).');
}

// ————————————————————————————————————————————————————————————

function lerContas() {
  var r = UrlFetchApp.fetch(CONTAS_JSON, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) {
    throw new Error('contas.json ' + r.getResponseCode() +
                    '. Sem o mapa de contas não dá para montar o pacing.');
  }
  return JSON.parse(r.getContentText());
}

function lerGoogleDoDrive() {
  var porRotulo = {};
  ARQUIVOS_GOOGLE.forEach(function (nome) {
    var f = DriveApp.getFilesByName(nome);
    if (!f.hasNext()) { Logger.log('AVISO: ' + nome + ' não está no Drive.'); return }
    var d = JSON.parse(f.next().getBlob().getDataAsString());
    (d.contas || []).forEach(function (c) { porRotulo[c.rotulo] = c });
  });
  return porRotulo;
}

/** Gasto diário de uma conta Meta no mês, via Graph API. */
function gastoMeta(contaId, chaveMes, diasNoMes) {
  var url = 'https://graph.facebook.com/' + API_META + '/' + contaId + '/insights' +
    '?fields=spend&level=account&time_increment=1' +
    '&time_range=' + encodeURIComponent(JSON.stringify({
      since: chaveMes + '-01',
      until: chaveMes + '-' + (diasNoMes < 10 ? '0' : '') + diasNoMes
    })) +
    '&access_token=' + encodeURIComponent(propriedade('META_TOKEN'));

  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var corpo = JSON.parse(r.getContentText());
  if (corpo.error) throw new Error('Meta ' + contaId + ': ' + corpo.error.message);

  var dias = {};
  (corpo.data || []).forEach(function (l) { dias[l.date_start] = Number(l.spend) || 0 });
  return dias;
}

function montarCliente(cli, google, chaveMes, fechados, diasNoMes) {
  var temGoogle = (cli.google_ads || []).length > 0;
  var temMeta = (cli.meta_ads || []).length > 0;
  if (!temGoogle && !temMeta) return null;

  var moeda = (cli.meta_mes && cli.meta_mes.moeda)
    || (cli.google_ads[0] || cli.meta_ads[0]).moeda || 'BRL';
  var s = SIMBOLO[moeda] || moeda;

  // Um vetor por dia do mês, somando Google e Meta de todas as contas do
  // cliente. Wondr soma duas contas Meta, Ruminar soma duas: por isso soma,
  // e não substituição.
  var diario = [];
  for (var d = 0; d < diasNoMes; d++) diario.push(0);
  var avisos = [];

  var g = google[cli.rotulo];
  if (temGoogle) {
    if (!g) avisos.push('Google: coleta do dia não chegou ao Drive');
    else if (g.erro) avisos.push('Google: ' + g.erro);
    else somar(diario, g.dias, chaveMes);
  }

  (cli.meta_ads || []).forEach(function (c) {
    try { somar(diario, gastoMeta(c.id, chaveMes, diasNoMes), chaveMes) }
    catch (e) { avisos.push('Meta (' + c.nome + '): ' + e) }
  });

  var meta = cli.meta_mes && cli.meta_mes.valor ? cli.meta_mes.valor : 0;
  var r = graficoProjecao({
    conta: cli.rotulo, diario: diario, fechados: fechados,
    diasNoMes: diasNoMes, meta: meta, moeda: s,
    mes: chaveMes.slice(5)
  });

  var texto = '# ' + cli.rotulo + '\n_pacing de ' + nomeDoMes(chaveMes) + '_\n\n'
            + r.url + '\n\n' + r.resumo;
  if (meta && cli.meta_mes.origem) {
    texto += '\n\n_Plano: ' + cli.meta_mes.origem + '. Curva linear._';
  }
  // Falha de coleta nunca sai calada: sem isso, conta que não respondeu
  // apareceria como conta que não gastou, que é outra coisa.
  if (avisos.length) texto += '\n\n⚠️ ' + avisos.join(' · ');

  var canais = [];
  if (temGoogle && g && !g.erro) canais.push({
    canal: 'Google Ads', investido: soma(g.dias), meta: 0, situacao: 'ok' });
  if (temMeta) canais.push({
    canal: 'Meta Ads', investido: Math.round((r.realizado - (canais[0] ? canais[0].investido : 0)) * 100) / 100,
    meta: 0, situacao: 'ok' });

  return {
    texto: texto,
    registro: {
      conta: cli.rotulo,
      client_id: cli.supabase_client_id || null,
      dia: Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd'),
      mes: chaveMes,
      moeda: moeda,
      dias_fechados: fechados,
      dias_no_mes: diasNoMes,
      canais: canais
    }
  };
}

function somar(vetor, dias, chaveMes) {
  Object.keys(dias || {}).forEach(function (data) {
    if (data.indexOf(chaveMes) !== 0) return;
    var i = Number(data.slice(8, 10)) - 1;
    if (i >= 0 && i < vetor.length) vetor[i] += Number(dias[data]) || 0;
  });
}

function soma(dias) {
  var t = 0;
  Object.keys(dias || {}).forEach(function (k) { t += Number(dias[k]) || 0 });
  return Math.round(t * 100) / 100;
}

function nomeDoMes(chaveMes) {
  var m = ['janeiro','fevereiro','março','abril','maio','junho',
           'julho','agosto','setembro','outubro','novembro','dezembro'];
  return m[Number(chaveMes.slice(5, 7)) - 1] || chaveMes;
}
