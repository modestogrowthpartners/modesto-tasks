/**
 * REPARO DA ABA "SERIE DIARIA" (21/09/2026)
 *
 * O que aconteceu: a SERIE DIARIA tem 241 linhas SEM a coluna Data.
 *
 * Causa provável (21/09, 20:42): a planilha está SEM FUSO HORÁRIO válido.
 * getSpreadsheetTimeZone() volta vazio. Sem fuso, o Apps Script não converte
 * objeto Date em número de série e o setValues grava VAZIO, sem erro nenhum.
 * A primeira versão deste reparo "gravou" 240 datas e a releitura achou 0.
 * A única célula com data (A69) guarda 14/09/2026 03:00, uma meia-noite UTC
 * deslocada para o lado errado, o que confirma que o fuso está quebrado.
 * O backfill original muito provavelmente sofreu do mesmo problema.
 *
 * Por isso este reparo grava o NÚMERO DE SÉRIE (dias desde 30/12/1899), que
 * não depende de fuso, e existe uma função separada para corrigir o fuso da
 * planilha, para que os outros scripts (backfill, importação) voltem a
 * conseguir gravar datas.
 *
 * Consequência: tudo que filtra a série por data lê zero dias. É a causa de:
 *   - TENDENCIAS com "Dias c/ dado" = 0 em todas as plataformas;
 *   - tendencias_*.json com dias_com_dado = 0 (e por isso sem meta_receita,
 *     roas_mes etc., que só são calculados quando há série);
 *   - e-mail por conta com "gráfico indisponível: sem série diária do mês",
 *     "sem série diária", "sem receita na série", "sem impressões e cliques
 *     na série" e, por tabela, "sem meta de receita cadastrada".
 *
 * O que esta função faz: para cada linha da SERIE DIARIA com Fonte
 * "backfill aba", descobre o dia pela POSIÇÃO da linha dentro do grupo
 * (conta, plataforma) e CONFERE contra a aba da conta: o "Inv. Realizado"
 * daquele dia tem que bater com o Investido da linha (tolerância de 1 centavo).
 * Só grava a data quando bate. Se não bater, não toca na linha e lista no log.
 * Conferido fora do Apps Script em 21/09/2026: 241 de 241 linhas batem.
 *
 * Linhas com outra Fonte (importação diária) não são tocadas.
 *
 * COMO USAR
 *   1. Rode `conferirSerieDiaria`: só lê; mostra o fuso e o estado da aba.
 *   2. Rode `corrigirFusoDaPlanilha`: põe America/Sao_Paulo no fuso.
 *   3. Rode `repararDatasSerieDiaria`: grava a coluna A e confere depois.
 *   4. Rode `conferirSerieDiaria` de novo: tem que mostrar 241 com data.
 *   5. Rode de novo a geração das tendências / o e-mail por conta.
 *
 * ATENÇÃO: isto conserta o DADO, não a CAUSA. Se a função de backfill rodar
 * de novo sem a correção (converter o número do dia em data), ela apaga ou
 * regrava as linhas sem data outra vez. A correção do backfill é uma linha:
 *   data = new Date(ano, mesIndice, Number(numeroDoDia))
 * onde ano e mesIndice vêm do "Mês de referência" do PAINEL (B4).
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
 * Corrige o fuso da planilha. Sem fuso válido, nenhum script consegue gravar
 * Date nesta planilha (backfill, importação diária, este reparo). Mostra o
 * valor anterior no log. Não mexe em nenhuma célula.
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
 * DIAGNÓSTICO (21/09, 21:10): o backfill regravou só a linha 69; as outras 240
 * não persistiram, com o fuso já em America/Sao_Paulo. Então a diferença é na
 * célula, não na planilha. Esta função testa, de dentro do script, e LOGA A
 * CADA PASSO (a primeira versão morreu com "erro desconhecido" sem log):
 *   1. o que getValues devolve na coluna A (Date x número x vazio);
 *   2. formatos, validações, proteções e filtro que possam bloquear a escrita;
 *   3. gravação real: um Date em A2, um número em A3 e um Date em M2 (fora da
 *      tabela), com releitura depois do flush. Restaura tudo no fim.
 * Cada passo está em try/catch: se um quebrar, o log diz qual, e segue.
 */
function diagnosticarSerieDiaria() {
  const ss = SpreadsheetApp.getActive();
  const aba = ss.getSheetByName(REPARO_SERIE.ABA_SERIE);
  const ultima = aba.getLastRow();
  const n = ultima - 1;
  const passo = function (nome, fn) {
    try { Logger.log('[' + nome + '] ' + fn()); }
    catch (e) { Logger.log('[' + nome + '] QUEBROU: ' + (e && e.message ? e.message : e)); }
  };

  passo('0 contexto', function () {
    let fusoPl; try { fusoPl = ss.getSpreadsheetTimeZone(); } catch (e) { fusoPl = 'erro: ' + e; }
    return 'planilha ' + ss.getId() + ' · fuso planilha=' + JSON.stringify(fusoPl) + ' · fuso script=' + Session.getScriptTimeZone() + ' · linhas=' + n;
  });

  let a = null;
  passo('1 tipos via getValues', function () {
    a = aba.getRange(2, 1, n, 11).getValues();
    const t = { A_date: 0, A_num: 0, A_vazio: 0, A_outro: 0, K_date: 0 };
    a.forEach(function (r) {
      const v = r[0];
      if (v instanceof Date) t.A_date++; else if (typeof v === 'number') t.A_num++; else if (v === '') t.A_vazio++; else t.A_outro++;
      if (r[10] instanceof Date) t.K_date++;
    });
    return 'coluna A: Date=' + t.A_date + ' número=' + t.A_num + ' vazio=' + t.A_vazio + ' outro=' + t.A_outro + ' · K com Date=' + t.K_date +
      ' · A2=' + JSON.stringify(a[0][0]) + ' (' + typeof a[0][0] + ') · A69=' + JSON.stringify(a[67][0]) + ' (' + typeof a[67][0] + ')';
  });

  passo('2a formatos coluna A', function () {
    const fmts = aba.getRange(2, 1, n, 1).getNumberFormats();
    const fc = {}; fmts.forEach(function (r) { fc[r[0]] = (fc[r[0]] || 0) + 1; });
    return JSON.stringify(fc) + ' · A2=' + fmts[0][0] + ' · A69=' + fmts[67][0];
  });

  passo('2b validações', function () {
    const dv = aba.getRange(2, 1, n, 11).getDataValidations();
    let nDv = 0, ex = '';
    dv.forEach(function (r, i) { r.forEach(function (v, j) { if (v) { nDv++; if (!ex) ex = 'ex.: linha ' + (i + 2) + ' col ' + (j + 1) + ' tipo ' + v.getCriteriaType() + ' rejeita=' + !v.getAllowInvalid(); } }); });
    return nDv + ' célula(s) com validação' + (ex ? ' (' + ex + ')' : '');
  });

  passo('2c proteções e filtro', function () {
    const prot = aba.getProtections(SpreadsheetApp.ProtectionType.RANGE).map(function (p) { return p.getRange().getA1Notation() + (p.isWarningOnly() ? ' (aviso)' : ' (bloqueia)') + ' posso editar=' + p.canEdit(); });
    const protAba = aba.getProtections(SpreadsheetApp.ProtectionType.SHEET).map(function (p) { return 'ABA INTEIRA' + (p.isWarningOnly() ? ' (aviso)' : ' (bloqueia)') + ' posso editar=' + p.canEdit(); });
    const f = aba.getFilter();
    return (prot.concat(protAba).join('; ') || 'nenhuma proteção') + ' · filtro=' + (f ? f.getRange().getA1Notation() : 'nenhum');
  });

  passo('2d linhas ocultas 2..10', function () {
    const oc = [2, 3, 4, 5, 6, 7, 8, 9, 10].filter(function (r) { return aba.isRowHiddenByUser(r) || aba.isRowHiddenByFilter(r); });
    return oc.length ? oc.join(',') : 'nenhuma';
  });

  // 3. gravação real com releitura, uma célula por vez, cada uma protegida
  const testar = function (rotulo, a1, valor) {
    let antes = null;
    passo('3 ' + rotulo, function () {
      const rng = aba.getRange(a1);
      antes = rng.getValue();
      rng.setValue(valor);
      SpreadsheetApp.flush();
      const depois = rng.getValue();
      const ok = (depois instanceof Date && valor instanceof Date && depois.getTime() === valor.getTime()) || depois === valor;
      return 'gravei ' + JSON.stringify(valor) + ' em ' + a1 + ' · antes=' + JSON.stringify(antes) + ' (' + typeof antes + ') · depois=' + JSON.stringify(depois) + ' (' + typeof depois + ') · ' + (ok ? 'PERSISTIU' : 'NÃO PERSISTIU');
    });
    return antes;
  };
  const restaurar = function (a1, antes) {
    passo('4 restaurar ' + a1, function () {
      const rng = aba.getRange(a1);
      if (antes === null) return 'nada a restaurar (o teste nem leu a célula)';
      if (antes instanceof Date) rng.setValue(serialDoDia_(antes.getFullYear(), antes.getMonth(), antes.getDate()));
      else if (antes === '' || antes === undefined) rng.clearContent();
      else rng.setValue(antes);
      SpreadsheetApp.flush();
      return 'agora=' + JSON.stringify(rng.getValue());
    });
  };
  const a2antes = testar('Date em A2', 'A2', new Date(2026, 8, 1));
  restaurar('A2', a2antes);
  const a3antes = testar('número em A3', 'A3', 46266);
  restaurar('A3', a3antes);
  const m2antes = testar('Date em M2 (fora da tabela)', 'M2', new Date(2026, 8, 1));
  restaurar('M2', m2antes);
  Logger.log('[fim] diagnóstico concluído');
}
