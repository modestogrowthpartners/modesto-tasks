/**
 * REPARO DA ABA "SERIE DIARIA" (21/09/2026)
 *
 * SINTOMA: 241 linhas na SERIE DIARIA sem a coluna Data. Tudo que filtra a
 * série por data lia zero dias: TENDENCIAS com "Dias c/ dado" = 0, o
 * tendencias_*.json com dias_com_dado = 0 (e por isso sem meta_receita,
 * roas_mes etc.), e o e-mail por conta com "gráfico indisponível" nos seis
 * gráficos, inclusive "sem meta de receita cadastrada" (graficosConta_ sai
 * cedo quando a série está vazia, antes de olhar a meta).
 *
 * CAUSA (provada em 21/09, 21:25, com diagnosticarSerieDiariaV3):
 *   A aba SERIE DIARIA estava com um FILTRO ativo (A1:Z246) que ocultava 240
 *   das 241 linhas. Em linha oculta por filtro, o Sheets DESCARTA gravação de
 *   objeto Date e mudança de formato de número, sem erro, mas ACEITA número.
 *   Por isso:
 *     - o backfill (reconstruirSerieDoMesAtual, que grava Date) só persistia
 *       na linha 69, a única visível;
 *     - a coluna K (Atualizado em, Date) ficava vazia;
 *     - o reparo v1 deste arquivo (gravava Date) não pegou;
 *     - o reparo v3 (grava NÚMERO DE SÉRIE) pegou nas 241.
 *   Defeito secundário, real mas não o bloqueio: a planilha estava SEM FUSO
 *   (getSpreadsheetTimeZone() = ""), o que derruba Utilities.formatDate.
 *   corrigirFusoDaPlanilha() põe America/Sao_Paulo.
 *
 * ORDEM DE USO (o que ainda vale depois do reparo):
 *   1. removerFiltroSerieDiaria      tira o filtro; nenhuma célula é tocada
 *   2. reconstruirSerieDoMesAtual    (tendencias.gs) regrava as 241 no lugar
 *   3. diagnosticarSerieDiariaV3     passo 1: "coluna K com Date=241";
 *                                    passo 2: "nenhum filtro"
 *   4. regerarTendenciasAgora        TENDENCIAS + tendencias_<ontem>.json
 *   5. testarEmailAmakha             e-mail com os seis gráficos, só p/ teste
 *
 * PARA NÃO VOLTAR: em tendencias.gs, no início de upsertSerie_, logo depois
 * de `const aba = obterAbaSerie_(ss);`, acrescente
 *     const filtro = aba.getFilter(); if (filtro) filtro.remove();
 * Quem abrir a aba e criar um filtro para olhar os dados não derruba mais a
 * gravação do dia seguinte.
 *
 * O reparo posicional (simular/repararDatasSerieDiaria) continua aqui como
 * ferramenta: grava número de série, que persiste mesmo em linha oculta, e
 * confere cada linha contra o "Inv. Realizado" da aba da conta.
 */

const REPARO_SERIE = {
  ABA_SERIE: 'SERIE DIARIA',
  ABA_PAINEL: 'PAINEL',
  FONTE_ALVO: 'backfill aba',
  LINHA_PLATAFORMAS: 17,   // B17.. = nomes das plataformas do bloco 2 (até TOTAL)
  LINHA_CABECALHO_DIARIO: 36,
  PRIMEIRA_LINHA_DIA: 37,  // A37 = dia 1
  TOLERANCIA: 0.011,
  MESES: ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho',
          'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
};

function simularReparoSerieDiaria() {
  repararDatasSerieDiaria_(true);
}

function repararDatasSerieDiaria() {
  repararDatasSerieDiaria_(false);
}

function repararDatasSerieDiaria_(simular) {
  const ss = SpreadsheetApp.getActive();
  const serie = ss.getSheetByName(REPARO_SERIE.ABA_SERIE);
  if (!serie) throw new Error('aba "' + REPARO_SERIE.ABA_SERIE + '" não encontrada');

  const mes = mesDeReferencia_(ss);
  const ultima = serie.getLastRow();
  if (ultima < 2) { Logger.log('SERIE DIARIA vazia, nada a reparar.'); return; }

  const dados = serie.getRange(2, 1, ultima - 1, 10).getValues(); // A..J
  const colunaData = dados.map(function (l) { return [l[0]]; });

  const contador = {};
  const cacheBlocos = {};
  const res = { corrigidas: 0, reescritas: 0, jaCertas: 0, divergentes: [], semAba: {} , outrasFontes: 0 };

  for (let i = 0; i < dados.length; i++) {
    const l = dados[i];
    const conta = String(l[1] || '').trim();
    const plat = String(l[2] || '').trim();
    if (!conta) continue;
    if (String(l[9] || '').trim() !== REPARO_SERIE.FONTE_ALVO) { res.outrasFontes++; continue; }

    const chave = conta + '|' + plat;
    contador[chave] = (contador[chave] || 0) + 1;
    const dia = contador[chave];

    let blocos = cacheBlocos[conta];
    if (blocos === undefined) {
      blocos = blocosDaConta_(ss, conta);
      cacheBlocos[conta] = blocos;
    }
    if (!blocos) { res.semAba[conta] = true; continue; }
    const col = blocos[normalizarReparo_(plat)];
    if (!col) {
      res.divergentes.push('linha ' + (i + 2) + ': ' + conta + ' / ' + plat + ' não tem bloco "Inv. Realizado" na aba da conta');
      continue;
    }

    const ref = ss.getSheetByName(blocos.__nomeAba)
      .getRange(REPARO_SERIE.LINHA_CABECALHO_DIARIO + dia, col).getValue();
    const inv = Number(l[3]);
    if (typeof ref !== 'number' || isNaN(inv) || Math.abs(ref - inv) > REPARO_SERIE.TOLERANCIA) {
      res.divergentes.push('linha ' + (i + 2) + ': ' + conta + ' / ' + plat + ' dia ' + dia +
        ' investido ' + inv + ' x aba ' + ref + ' (não gravado)');
      continue;
    }

    // Número de série do Sheets: dias desde 30/12/1899. Não passa por fuso.
    const serial = serialDoDia_(mes.ano, mes.indice, dia);
    const atual = l[0];
    const atualSerial = serialDaCelula_(atual);
    if (atualSerial === serial) { res.jaCertas++; continue; }
    if (atualSerial !== null) res.reescritas++; else res.corrigidas++;
    colunaData[i] = [serial];
  }

  let posGravacao = null;
  if (!simular && (res.corrigidas + res.reescritas) > 0) {
    const alvo = serie.getRange(2, 1, ultima - 1, 1);
    alvo.setValues(colunaData);
    alvo.setNumberFormat('dd/MM/yyyy');
    SpreadsheetApp.flush();
    // Relê a coluna depois do flush. Se o número aqui não bater com o que foi
    // gravado, a escrita não persistiu e o log precisa dizer isso.
    posGravacao = serie.getRange(2, 1, ultima - 1, 1).getValues()
      .filter(function (l) { return serialDaCelula_(l[0]) !== null; }).length;
  }

  const linhas = [];
  linhas.push((simular ? 'SIMULAÇÃO (nada gravado)' : 'REPARO GRAVADO') + ' · mês de referência ' +
    (mes.indice + 1) + '/' + mes.ano + (mes.origem === 'painel' ? ' (PAINEL!B4)' : ' (mês atual, PAINEL!B4 não pôde ser lido)'));
  linhas.push('datas preenchidas: ' + res.corrigidas);
  linhas.push('datas erradas reescritas: ' + res.reescritas);
  linhas.push('já corretas: ' + res.jaCertas);
  linhas.push('linhas de outras fontes (não tocadas): ' + res.outrasFontes);
  if (posGravacao !== null) {
    const esperado = res.corrigidas + res.reescritas + res.jaCertas;
    linhas.push('CONFERÊNCIA PÓS-GRAVAÇÃO: ' + posGravacao + ' linhas com data na aba (esperado ' + esperado + ')' +
      (posGravacao === esperado ? ' · OK' : ' · NÃO BATEU, a escrita não persistiu'));
  }
  const semAba = Object.keys(res.semAba);
  if (semAba.length) linhas.push('CONTAS SEM ABA (não tocadas): ' + semAba.join(', '));
  if (res.divergentes.length) {
    linhas.push('DIVERGENTES (não gravadas), ' + res.divergentes.length + ':');
    res.divergentes.forEach(function (d) { linhas.push('  ' + d); });
  } else {
    linhas.push('divergentes: nenhuma');
  }
  linhas.push('Lembrete: corrija também a função de backfill, senão a próxima rodada regrava sem data.');
  Logger.log(linhas.join('\n'));
  return res;
}

/** Lê "Setembro/2026" do PAINEL!B4. Se não conseguir, usa o mês atual e avisa. */
function mesDeReferencia_(ss) {
  const hoje = new Date();
  const painel = ss.getSheetByName(REPARO_SERIE.ABA_PAINEL);
  if (painel) {
    const bruto = painel.getRange('B4').getValue();
    if (bruto instanceof Date) return { ano: bruto.getFullYear(), indice: bruto.getMonth(), origem: 'painel' };
    const txt = normalizarReparo_(String(bruto || ''));
    const m = txt.match(/([a-z]+)\s*\/\s*(\d{4})/);
    if (m) {
      const idx = REPARO_SERIE.MESES.indexOf(m[1]);
      if (idx >= 0) return { ano: Number(m[2]), indice: idx, origem: 'painel' };
    }
  }
  return { ano: hoje.getFullYear(), indice: hoje.getMonth(), origem: 'hoje' };
}

/**
 * Mapa plataforma normalizada -> coluna (1-based) do "Inv. Realizado" no bloco
 * diário da aba da conta. A k-ésima ocorrência de "Inv. Realizado" na linha 36
 * corresponde à k-ésima plataforma listada em B17, C17, ... (até TOTAL).
 * Isso segura o deslocamento de colunas do MEU RODAPE (3 plataformas) e da
 * BARBIE (bloco Meta começa uma coluna depois).
 */
function blocosDaConta_(ss, conta) {
  const aba = acharAbaReparo_(ss, conta);
  if (!aba) return null;
  const largura = aba.getLastColumn();
  const plats = aba.getRange(REPARO_SERIE.LINHA_PLATAFORMAS, 2, 1, largura - 1).getValues()[0]
    .map(function (v) { return String(v || '').trim(); });
  const nomes = [];
  for (let i = 0; i < plats.length; i++) {
    if (!plats[i] || normalizarReparo_(plats[i]) === 'total') break;
    nomes.push(plats[i]);
  }
  const cab = aba.getRange(REPARO_SERIE.LINHA_CABECALHO_DIARIO, 1, 1, largura).getValues()[0];
  const cols = [];
  for (let c = 0; c < cab.length; c++) {
    if (normalizarReparo_(String(cab[c] || '')) === 'inv. realizado') cols.push(c + 1);
  }
  const mapa = { __nomeAba: aba.getName() };
  for (let k = 0; k < nomes.length && k < cols.length; k++) mapa[normalizarReparo_(nomes[k])] = cols[k];
  return mapa;
}

function acharAbaReparo_(ss, nome) {
  const direta = ss.getSheetByName(nome);
  if (direta) return direta;
  const alvo = normalizarReparo_(nome);
  const abas = ss.getSheets();
  for (let i = 0; i < abas.length; i++) {
    if (normalizarReparo_(abas[i].getName()) === alvo) return abas[i];
  }
  return null;
}

function normalizarReparo_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Serial do Sheets para uma data civil: dias desde 30/12/1899, sem fuso. */
function serialDoDia_(ano, mesIndice, dia) {
  return Math.round((Date.UTC(ano, mesIndice, dia) - Date.UTC(1899, 11, 30)) / 86400000);
}

/**
 * Serial (dia inteiro) do que está na célula, ou null se não é data.
 * Aceita Date (planilha com fuso ok) e número (planilha sem fuso, em que o
 * getValues pode devolver o serial cru). Ignora a hora: 46279.125 vira 46279.
 */
function serialDaCelula_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return serialDoDia_(v.getFullYear(), v.getMonth(), v.getDate());
  }
  if (typeof v === 'number' && v > 30000 && v < 80000) return Math.floor(v);
  return null;
}

/**
 * Corrige o fuso da planilha. Sem fuso válido, Utilities.formatDate lança
 * erro e qualquer conversão de data fica imprevisível. Mostra o valor
 * anterior no log. Não mexe em nenhuma célula.
 */
function corrigirFusoDaPlanilha() {
  const ss = SpreadsheetApp.getActive();
  let antes;
  try { antes = ss.getSpreadsheetTimeZone(); } catch (e) { antes = 'erro ao ler: ' + e; }
  ss.setSpreadsheetTimeZone('America/Sao_Paulo');
  SpreadsheetApp.flush();
  let depois;
  try { depois = ss.getSpreadsheetTimeZone(); } catch (e) { depois = 'erro ao ler: ' + e; }
  Logger.log('fuso da planilha ' + ss.getName() + '\n  antes:  ' + JSON.stringify(antes) +
    ' (' + typeof antes + ')\n  depois: ' + JSON.stringify(depois) + ' (' + typeof depois + ')');
}

/**
 * Conferência independente: lê a SERIE DIARIA agora e diz, por conta e
 * plataforma, quantas linhas têm data e qual o intervalo. Não grava nada.
 * Serve para provar, de dentro do Apps Script, o que a planilha tem neste
 * instante, sem depender de export ou cache.
 */
function conferirSerieDiaria() {
  const ss = SpreadsheetApp.getActive();
  const serie = ss.getSheetByName(REPARO_SERIE.ABA_SERIE);
  if (!serie) throw new Error('aba "' + REPARO_SERIE.ABA_SERIE + '" não encontrada');
  const ultima = serie.getLastRow();
  const dados = ultima < 2 ? [] : serie.getRange(2, 1, ultima - 1, 10).getValues();
  const grupos = {};
  let semData = 0, comData = 0;
  dados.forEach(function (l) {
    const conta = String(l[1] || '').trim();
    if (!conta) return;
    const chave = conta + ' / ' + String(l[2] || '').trim();
    const g = grupos[chave] || (grupos[chave] = { com: 0, sem: 0, min: null, max: null });
    const sr = serialDaCelula_(l[0]);
    if (sr !== null) {
      comData++; g.com++;
      if (g.min === null || sr < g.min) g.min = sr;
      if (g.max === null || sr > g.max) g.max = sr;
    } else { semData++; g.sem++; }
  });
  // Fuso fixo para formatar o log: o da planilha pode estar vazio (é o bug).
  const fuso = 'America/Sao_Paulo';
  const fmt = function (sr) {
    if (sr === null) return 'n/d';
    const d = new Date(Date.UTC(1899, 11, 30) + sr * 86400000);
    return Utilities.formatDate(d, 'UTC', 'dd/MM/yyyy');
  };
  let fusoPlanilha;
  try { fusoPlanilha = ss.getSpreadsheetTimeZone(); } catch (e) { fusoPlanilha = 'erro ao ler: ' + e; }
  const linhas = ['SERIE DIARIA em ' + Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm:ss') +
    ' · planilha ' + ss.getName() + ' (' + ss.getId() + ')',
    'fuso da planilha: ' + JSON.stringify(fusoPlanilha) + ' (' + typeof fusoPlanilha + ')' +
      (typeof fusoPlanilha === 'string' && fusoPlanilha ? '' : '  <- VAZIO: é isso que impede gravar datas'),
    'linhas com data: ' + comData + ' · sem data: ' + semData];
  Object.keys(grupos).sort().forEach(function (k) {
    const g = grupos[k];
    linhas.push('  ' + k + ': ' + g.com + ' com data (' + fmt(g.min) + ' a ' + fmt(g.max) + '), ' + g.sem + ' sem data');
  });
  Logger.log(linhas.join('\n'));
}

// ---------------------------------------------------------------------
//  ATALHOS PARA VALIDAR HOJE, SEM DISPARAR PRODUÇÃO (21/09/2026)
//  Dependem de Código.gs (calcularDatas_, lerPainel_, analisarConta_,
//  lerOrcamentosExternos_), tendencias.gs (gerarTendencias_) e conta.gs
//  (testarEmailConta). Nenhum deles manda e-mail ao time, posta no Slack,
//  escreve ALERTAS/HISTORICO ou mexe na fila de e-mails por cliente.
// ---------------------------------------------------------------------

/**
 * Regera a aba TENDENCIAS e o tendencias_<ontem>.json no Drive a partir da
 * SERIE DIARIA já reparada. É exatamente o passo 3b do executar_ (Código.gs),
 * isolado: sem ingestão, sem sincronizar budgets, sem alertas, sem e-mail.
 * O arquivo antigo do mesmo dia vai para a lixeira (comportamento do
 * salvarJsonNoDrive_). O agente de análise das 9h05 de HOJE já leu o antigo;
 * o de amanhã lê o que o rodarAlertas das 8h gerar.
 */
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
  if (!res) {
    Logger.log('Tendências NÃO geradas: ' + alertas.slice(antes).map(function (a) { return a.titulo + ': ' + a.detalhe; }).join(' | '));
    return null;
  }
  const linhas = ['tendencias_' + res.data + '.json regerado em ' + res.gerado_em + ' · detalhe_disponivel=' + res.detalhe_disponivel];
  Object.keys(res.contas).forEach(function (c) {
    const ps = res.contas[c].plataformas || {};
    linhas.push('  ' + c + ': ' + Object.keys(ps).map(function (p) {
      const t = ps[p];
      return p + ' ' + t.dias_com_dado + 'd' + (t.suficiente ? '' : ' (insuficiente)') + (t.dado_inconsistente ? ' (inconsistente)' : '');
    }).join(' · '));
  });
  linhas.push('Confira a aba TENDENCIAS: "Dias c/ dado" deve estar em 20 nas plataformas com histórico.');
  Logger.log(linhas.join('\n'));
  return res;
}

/** E-mail de teste da AMAKHA PARIS (a conta do print com os gráficos vazios). Vai só para CONFIG.EMAILS_TESTE. */
function testarEmailAmakha() { testarEmailConta('AMAKHA PARIS'); }

/** E-mail de teste do MEU RODAPE. Vai só para CONFIG.EMAILS_TESTE. */
function testarEmailMeuRodape() { testarEmailConta('MEU RODAPE'); }

/**
 * DIAGNÓSTICO v3 (21/09, 21:25). A rodada anterior mostrou: filtro ativo em
 * A1:Z246 na SERIE DIARIA, linhas 2..10 ocultas por ele, formato dd/mm/yyyy em
 * 240 células e dd/MM/yyyy na A69, zero validações, zero proteções. E os meus
 * testes de gravação usaram valores iguais aos que já estavam na célula, o que
 * não prova nada. Esta versão:
 *   1. lista o critério do filtro por coluna e quantas linhas ele oculta;
 *   2. grava valores DIFERENTES dos atuais, cruzando linha oculta x visível e
 *      formato dd/mm/yyyy x dd/MM/yyyy, e relê cada um; restaura tudo no fim.
 * AUTOSSUFICIENTE: pode ficar sozinha no arquivo.
 */
function diagnosticarSerieDiariaV3() {
  const ss = SpreadsheetApp.getActive();
  const aba = ss.getSheetByName('SERIE DIARIA');
  if (!aba) throw new Error('aba "SERIE DIARIA" não encontrada');
  const ultima = aba.getLastRow();
  const n = ultima - 1;
  const serialDia = function (d) { return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000); };
  const comoSerial = function (v) { if (v instanceof Date) return serialDia(v); if (typeof v === 'number') return Math.floor(v); return null; };
  const passo = function (nome, fn) {
    try { Logger.log('[' + nome + '] ' + fn()); }
    catch (e) { Logger.log('[' + nome + '] QUEBROU: ' + (e && e.message ? e.message : e)); }
  };

  passo('0 contexto', function () {
    return 'fuso planilha=' + JSON.stringify(ss.getSpreadsheetTimeZone()) + ' · fuso script=' + Session.getScriptTimeZone() + ' · linhas=' + n;
  });

  passo('1 tipos via getValues', function () {
    const a = aba.getRange(2, 1, n, 11).getValues();
    let ad = 0, an = 0, av = 0, kd = 0;
    a.forEach(function (r) { if (r[0] instanceof Date) ad++; else if (typeof r[0] === 'number') an++; else if (r[0] === '') av++; if (r[10] instanceof Date) kd++; });
    return 'coluna A: Date=' + ad + ' número=' + an + ' vazio=' + av + ' · coluna K (Atualizado em) com Date=' + kd;
  });

  let ocultas = [], visiveis = [];
  passo('2 filtro', function () {
    const f = aba.getFilter();
    if (!f) return 'nenhum filtro';
    const crit = [];
    for (let c = 1; c <= 11; c++) {
      const cr = f.getColumnFilterCriteria(c);
      if (!cr) continue;
      let desc = 'col ' + c + ': tipo=' + cr.getCriteriaType();
      try { desc += ' valores=' + JSON.stringify(cr.getCriteriaValues()); } catch (e) {}
      try { const hv = cr.getHiddenValues(); if (hv && hv.length) desc += ' ocultos=' + JSON.stringify(hv.slice(0, 5)) + (hv.length > 5 ? '...(' + hv.length + ')' : ''); } catch (e) {}
      try { const vv = cr.getVisibleValues(); if (vv && vv.length) desc += ' visíveis=' + JSON.stringify(vv.slice(0, 5)) + (vv.length > 5 ? '...(' + vv.length + ')' : ''); } catch (e) {}
      crit.push(desc);
    }
    for (let r = 2; r <= ultima; r++) { if (aba.isRowHiddenByFilter(r)) ocultas.push(r); else visiveis.push(r); }
    return 'range=' + f.getRange().getA1Notation() + ' · critérios: ' + (crit.join(' | ') || 'nenhum por coluna') +
      ' · linhas ocultas=' + ocultas.length + ' · visíveis=' + visiveis.length + ' (' + visiveis.slice(0, 12).join(',') + (visiveis.length > 12 ? '...' : '') + ')';
  });

  // 3. gravação com valores diferentes dos atuais, cruzando oculta/visível e formato
  const rOculta = ocultas.length ? ocultas[0] : 2;
  const rVisivel = visiveis.length ? visiveis[0] : 69;
  const testar = function (rotulo, a1, valor, formato) {
    let antes = null, fmtAntes = null;
    passo('3 ' + rotulo, function () {
      const rng = aba.getRange(a1);
      antes = rng.getValue(); fmtAntes = rng.getNumberFormat();
      if (formato) { rng.setNumberFormat(formato); SpreadsheetApp.flush(); }
      rng.setValue(valor);
      SpreadsheetApp.flush();
      const depois = rng.getValue();
      const esperado = comoSerial(valor), lido = comoSerial(depois);
      const ok = esperado !== null ? lido === esperado : depois === valor;
      return a1 + (formato ? ' (formato forçado ' + formato + ', ficou ' + rng.getNumberFormat() + ')' : ' (formato ' + fmtAntes + ')') +
        ': gravei ' + (valor instanceof Date ? 'Date ' + valor.toISOString() : JSON.stringify(valor)) + ' · antes=' + JSON.stringify(antes) +
        ' · depois=' + JSON.stringify(depois) + ' (' + typeof depois + ') · ' + (ok ? 'PERSISTIU' : 'NÃO PERSISTIU');
    });
    return { antes: antes, fmt: fmtAntes };
  };
  const restaurar = function (a1, est) {
    passo('4 restaurar ' + a1, function () {
      const rng = aba.getRange(a1);
      if (!est || est.antes === null) return 'nada a restaurar';
      if (est.antes instanceof Date) rng.setValue(serialDia(est.antes));
      else if (est.antes === '' || est.antes === undefined) rng.clearContent();
      else rng.setValue(est.antes);
      if (est.fmt) rng.setNumberFormat(est.fmt);
      SpreadsheetApp.flush();
      return 'agora=' + JSON.stringify(rng.getValue()) + ' formato=' + rng.getNumberFormat();
    });
  };

  const d2 = new Date(2026, 8, 2), d15 = new Date(2026, 8, 15);
  // oculta, formato como está (dd/mm/yyyy)
  let e = testar('Date em linha OCULTA ' + rOculta + ', formato atual', 'A' + rOculta, d2); restaurar('A' + rOculta, e);
  // oculta, número
  e = testar('número em linha OCULTA ' + rOculta, 'A' + rOculta, 46267); restaurar('A' + rOculta, e);
  // oculta, formato forçado dd/MM/yyyy
  e = testar('Date em linha OCULTA ' + rOculta + ', formato dd/MM/yyyy', 'A' + rOculta, d2, 'dd/MM/yyyy'); restaurar('A' + rOculta, e);
  // oculta, coluna vazia M
  e = testar('Date em M' + rOculta + ' (OCULTA, coluna vazia)', 'M' + rOculta, d2); restaurar('M' + rOculta, e);
  // visível, formato como está
  e = testar('Date em linha VISÍVEL ' + rVisivel + ', formato atual', 'A' + rVisivel, d15); restaurar('A' + rVisivel, e);
  // visível, coluna vazia M
  e = testar('Date em M' + rVisivel + ' (VISÍVEL, coluna vazia)', 'M' + rVisivel, d15); restaurar('M' + rVisivel, e);
  Logger.log('[fim] diagnóstico v3 concluído');
}

/**
 * Remove o filtro da SERIE DIARIA. A aba é interna (o script escreve e lê);
 * filtro ali só serve para quem abre a aba na tela, e está escondendo 240
 * linhas. Não apaga nem altera nenhuma célula. Rode só depois do diagnóstico
 * v3 mostrar que a gravação falha nas linhas ocultas.
 */
function removerFiltroSerieDiaria() {
  const aba = SpreadsheetApp.getActive().getSheetByName('SERIE DIARIA');
  const f = aba.getFilter();
  if (!f) { Logger.log('SERIE DIARIA: não há filtro.'); return; }
  const range = f.getRange().getA1Notation();
  f.remove();
  SpreadsheetApp.flush();
  let ocultas = 0;
  for (let r = 2; r <= aba.getLastRow(); r++) if (aba.isRowHiddenByFilter(r) || aba.isRowHiddenByUser(r)) ocultas++;
  Logger.log('Filtro ' + range + ' removido. Linhas ainda ocultas: ' + ocultas + '. Agora rode reconstruirSerieDoMesAtual e depois diagnosticarSerieDiariaV3 (passo 1: "coluna K com Date" tem que dar 241).');
}
