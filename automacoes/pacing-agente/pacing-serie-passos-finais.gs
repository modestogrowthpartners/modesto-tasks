/**
 * SERIE DIARIA: passos finais (21/09/2026). Cole por cima do arquivo
 * pacing-reparo-serie.gs.gs e rode, nesta ordem, uma função por vez:
 *   1. removerFiltroSerieDiaria      esperado: "Filtro A1:Z246 removido. Linhas ainda ocultas: 0"
 *   2. reconstruirSerieDoMesAtual    (já existe no tendencias.gs) esperado: "Backfill: 241 linha(s)"
 *   3. conferirSerieFinal            esperado: "241 com data · 241 com Atualizado em · filtro: nenhum"
 *   4. regerarTendenciasAgora        esperado: cada plataforma com "20d"
 *   5. testarEmailAmakha             e-mail com os seis gráficos, só para EMAILS_TESTE
 * Causa provada: filtro ativo na aba escondia 240 linhas e, em linha oculta,
 * o Sheets descarta gravação de Date. O arquivo completo está no repositório.
 */

function removerFiltroSerieDiaria() {
  const aba = SpreadsheetApp.getActive().getSheetByName('SERIE DIARIA');
  const f = aba.getFilter();
  if (!f) { Logger.log('SERIE DIARIA: não há filtro. Pode ir para o passo 2.'); return; }
  const range = f.getRange().getA1Notation();
  f.remove();
  SpreadsheetApp.flush();
  let ocultas = 0;
  for (let r = 2; r <= aba.getLastRow(); r++) if (aba.isRowHiddenByFilter(r) || aba.isRowHiddenByUser(r)) ocultas++;
  if (ocultas) { aba.showRows(2, aba.getLastRow() - 1); SpreadsheetApp.flush(); }
  Logger.log('Filtro ' + range + ' removido. Linhas ainda ocultas: ' + ocultas + (ocultas ? ' (reexibidas)' : '') + '. Agora rode reconstruirSerieDoMesAtual.');
}

function conferirSerieFinal() {
  const aba = SpreadsheetApp.getActive().getSheetByName('SERIE DIARIA');
  const n = aba.getLastRow() - 1;
  const v = aba.getRange(2, 1, n, 11).getValues();
  let comData = 0, comK = 0, linhas = 0;
  v.forEach(function (r) { if (!r[1]) return; linhas++; if (r[0] instanceof Date) comData++; if (r[10] instanceof Date) comK++; });
  Logger.log('SERIE DIARIA: ' + linhas + ' linhas · ' + comData + ' com data · ' + comK + ' com Atualizado em · filtro: ' + (aba.getFilter() ? 'AINDA EXISTE' : 'nenhum') +
    (comData === linhas && comK === linhas ? ' · OK, pode ir para o passo 4' : ' · ALGO FALTOU, me manda este log'));
}

function regerarTendenciasAgora() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const datas = calcularDatas_();
  const alertas = [];
  const painel = lerPainel_(ss, datas, alertas);
  let orcamentos = {};
  try { orcamentos = lerOrcamentosExternos_(); } catch (e) { Logger.log('orçamento externo não lido (segue sem): ' + e.message); }
  painel.contas.forEach(function (c) { analisarConta_(ss, c, datas, orcamentos, alertas); });
  const antes = alertas.length;
  const res = gerarTendencias_(ss, painel, datas, alertas);
  if (!res) { Logger.log('Tendências NÃO geradas: ' + alertas.slice(antes).map(function (a) { return a.titulo + ': ' + a.detalhe; }).join(' | ')); return; }
  const linhas = ['tendencias_' + res.data + '.json regerado em ' + res.gerado_em];
  Object.keys(res.contas).forEach(function (c) {
    const ps = res.contas[c].plataformas || {};
    linhas.push('  ' + c + ': ' + Object.keys(ps).map(function (p) { return p + ' ' + ps[p].dias_com_dado + 'd'; }).join(' · '));
  });
  Logger.log(linhas.join('\n'));
}

function testarEmailAmakha() { testarEmailConta('AMAKHA PARIS'); }
