/**
 * REPARO DA ABA "SERIE DIARIA" (21/09/2026)
 *
 * O que aconteceu: o backfill que povoou a SERIE DIARIA a partir das abas de
 * conta gravou 241 linhas SEM a coluna Data. A coluna A do bloco diário das
 * abas de conta (A37:A67) guarda o NÚMERO do dia (1, 2, 3...), não uma data,
 * e o backfill não converteu esse número em data com o mês do PAINEL.
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
 *   1. Cole este arquivo no projeto do Apps Script (Arquivo > Novo > Script).
 *   2. Rode `simularReparoSerieDiaria` e leia o log: nada é gravado.
 *   3. Rode `repararDatasSerieDiaria`. Grava a coluna A.
 *   4. Rode de novo a geração das tendências / o e-mail por conta.
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

    const nova = new Date(mes.ano, mes.indice, dia);
    const atual = l[0];
    if (atual instanceof Date && mesmaData_(atual, nova)) { res.jaCertas++; continue; }
    if (atual instanceof Date) res.reescritas++; else res.corrigidas++;
    colunaData[i] = [nova];
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
      .filter(function (l) { return l[0] instanceof Date; }).length;
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

function mesmaData_(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
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
    if (l[0] instanceof Date) {
      comData++; g.com++;
      if (!g.min || l[0] < g.min) g.min = l[0];
      if (!g.max || l[0] > g.max) g.max = l[0];
    } else { semData++; g.sem++; }
  });
  const fuso = ss.getSpreadsheetTimeZone();
  const fmt = function (d) { return d ? Utilities.formatDate(d, fuso, 'dd/MM/yyyy') : 'n/d'; };
  const linhas = ['SERIE DIARIA em ' + Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm:ss') +
    ' · planilha ' + ss.getName() + ' (' + ss.getId() + ')',
    'linhas com data: ' + comData + ' · sem data: ' + semData];
  Object.keys(grupos).sort().forEach(function (k) {
    const g = grupos[k];
    linhas.push('  ' + k + ': ' + g.com + ' com data (' + fmt(g.min) + ' a ' + fmt(g.max) + '), ' + g.sem + ' sem data');
  });
  Logger.log(linhas.join('\n'));
}
