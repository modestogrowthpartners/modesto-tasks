/**
 * =====================================================================
 *  CONTROLE DE PACING  |  INGESTÃO DO AGENTE + ABA DE ALERTAS
 *  Modesto Growth Partners
 * =====================================================================
 *
 *  Complementa o `pacing_alertas.gs`. Não substitui nada dele.
 *
 *  O QUE FAZ
 *  O agente das 7:30 puxa Google, Meta e TikTok e larga um JSON numa pasta
 *  do Drive. Este arquivo lê esse JSON e escreve os números nas células
 *  certas, antes do `rodarAlertas` das 8h analisar.
 *
 *  Também monta a aba ALERTAS com as mensagens que foram enviadas, para
 *  ficar histórico dentro da própria planilha.
 *
 *  INSTALAÇÃO
 *  1. No projeto do Apps Script: Arquivos > + > Script, nome `ingestao`,
 *     cole este arquivo inteiro.
 *  2. Em `pacing_alertas.gs`, dentro de `executar_(opts)`, acrescente DUAS
 *     linhas. No começo, logo depois de `const alertas = [];`:
 *
 *         importarPacingDoDrive_(ss, datas, alertas);
 *         SpreadsheetApp.flush();
 *
 *     E no fim, logo depois de `enviar_(alertas, painel, datas, opts);`:
 *
 *         if (!opts.teste) escreverAbaAlertas_(ss, alertas, datas);
 *
 *  3. Confira `ING.PASTA_ID` abaixo.
 *  4. Rode `importarPacingAgora` uma vez para autorizar o acesso ao Drive.
 *
 *  POR QUE ASSIM, E NÃO O AGENTE ESCREVENDO DIRETO
 *  O conector de Drive do agente escreve metadados, não célula. Quem tem
 *  `SpreadsheetApp` é este script. O agente coleta, este arquivo grava.
 */

const ING = {
  // Pasta do Drive onde o agente larga o JSON do dia.
  PASTA_ID: '1Qahos1FUoplgwn5C5LI0twrBr5NsDHt0',

  // Nome do arquivo esperado: pacing_AAAA-MM-DD.json, data = dia lançado (D-1).
  PREFIXO: 'pacing_',

  ABA_ALERTAS: 'ALERTAS',

  // Linha 1 das abas brutas. Linha do dia N é N+1.
  OFFSET_BRUTA: 1,
  // Linha 36 é cabeçalho nas abas de cliente. Linha do dia N é 36+N.
  OFFSET_CLIENTE: 36,

  // Marca o JSON como consumido em vez de apagar, para dar para auditar depois.
  SUFIXO_PROCESSADO: '.processado'
};

/**
 * Para onde vai o dado de cada conta.
 *   { aba: 'X' }        grava na aba bruta X, a fórmula da aba do cliente propaga
 *   { aba: 'X', bloco } grava no bloco N da aba bruta (Ruminar tem dois)
 *   { manual: true }    grava direto na aba do cliente, no bloco do veículo
 *   null                a conta não tem esse veículo
 *
 * ALLIANCE LATAM fica com `meta: null` de propósito: a aba `ALI Meta` tem um
 * bloco só e é lida pelas duas abas de cliente. Quem grava é a ALLIANCE BR, com
 * o número somado das duas praças. Separar exige mudar a planilha.
 */
const ROTA = {
  'AMAKHA PARIS':     { google: { aba: 'AMK Google' },        meta: { aba: 'AMK Meta' } },
  'ALLIANCE BR':      { google: { aba: 'ALI Google BR' },     meta: { aba: 'ALI Meta' } },
  'ALLIANCE LATAM':   { google: { aba: ' ALI Google LATAM' }, meta: null },
  'D&G':              { google: { aba: 'DEG Google' },        meta: null },
  'RUMINAR':          { google: null,                         meta: { aba: 'RUM Meta', blocos: 2 } },
  'WONDR EXPERIENCE': { google: { aba: 'WDR Google' },        meta: { manual: true } },
  'BARBIE':           { google: { aba: 'BRB Google' },        meta: { manual: true } },
  'MEU RODAPE':       { google: { manual: true },             meta: { manual: true } },
  'DABELA SITE':      { google: { manual: true },             meta: { manual: true } },
  'DABELA REVENDA':   { google: null,                         meta: { manual: true } }
};

// Rótulos aceitos por campo. A busca é por igualdade depois de normalizar,
// nunca por posição: MEU RODAPE e BARBIE têm o bloco Meta deslocado uma coluna,
// e assumir posição colocaria gasto dentro de "Investimento Planejado".
const ROTULOS_BRUTA = {
  investido:  ['cost (spend)', 'amount spent'],
  impressoes: ['impressions'],
  cliques:    ['clicks', 'link clicks'],
  conversoes: ['all conv.', 'purchases', 'leads'],
  receita:    ['total conv. value', 'purchases conversion value']
};

const ROTULOS_CLIENTE = {
  investido:  ['inv. realizado'],
  impressoes: ['impressoes', 'impressões'],
  cliques:    ['cliques'],
  conversoes: ['conversoes', 'conversões', 'leads'],
  receita:    ['receita']
};

// ---------------------------------------------------------------------
//  PONTOS DE ENTRADA
// ---------------------------------------------------------------------

/** Roda a ingestão à mão, sem alertas. Use para autorizar e para testar. */
function importarPacingAgora() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const datas = calcularDatas_();
  const alertas = [];
  const res = importarPacingDoDrive_(ss, datas, alertas);
  SpreadsheetApp.flush();
  const msg = res.ok
    ? 'Importadas ' + res.gravadas + ' células de ' + res.contas + ' contas, arquivo ' + res.arquivo
    : 'Nada importado: ' + res.motivo;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return res;
}

/** Monta a aba ALERTAS à mão, a partir da última execução. */
function escreverAbaAlertasAgora() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  escreverAbaAlertas_(ss, [], calcularDatas_());
}

// ---------------------------------------------------------------------
//  INGESTÃO
// ---------------------------------------------------------------------

/**
 * Procura o JSON do dia lançado e grava. Não levanta exceção: falha vira
 * alerta, porque derrubar a execução às 8h calaria também os alertas das
 * contas que estão certas.
 */
function importarPacingDoDrive_(ss, datas, alertas) {
  const dia = Utilities.formatDate(datas.ontem, CONFIG.FUSO, 'yyyy-MM-dd');
  const nome = ING.PREFIXO + dia + '.json';
  const res = { ok: false, arquivo: nome, contas: 0, gravadas: 0, puladas: [], motivo: '' };

  let arquivo;
  try {
    const it = DriveApp.getFolderById(ING.PASTA_ID).getFilesByName(nome);
    if (!it.hasNext()) {
      res.motivo = 'arquivo ' + nome + ' não encontrado na pasta de ingestão';
      alertas.push(alerta_(NIVEL.CRITICO, 'GERAL', 'Coleta do agente não chegou',
        'O agente das 7:30 não deixou o arquivo ' + nome + ' na pasta de ingestão. ' +
        'A planilha está com os números de ontem, e todo alerta abaixo pode estar defasado.',
        'ingestao_ausente'));
      return res;
    }
    arquivo = it.next();
  } catch (e) {
    res.motivo = 'pasta de ingestão inacessível: ' + e.message;
    alertas.push(alerta_(NIVEL.CRITICO, 'GERAL', 'Pasta de ingestão inacessível', res.motivo, 'ingestao_pasta'));
    return res;
  }

  let dados;
  try {
    dados = JSON.parse(arquivo.getBlob().getDataAsString('UTF-8'));
  } catch (e) {
    res.motivo = 'JSON inválido: ' + e.message;
    alertas.push(alerta_(NIVEL.CRITICO, 'GERAL', 'Coleta do agente ilegível', res.motivo, 'ingestao_json'));
    return res;
  }

  if (dados.data !== dia) {
    res.motivo = 'o arquivo diz ' + dados.data + ' e o dia a lançar é ' + dia;
    alertas.push(alerta_(NIVEL.CRITICO, 'GERAL', 'Coleta com data errada',
      res.motivo + '. Nada foi gravado, para não lançar o dia errado na linha errada.', 'ingestao_data'));
    return res;
  }

  const numeroDoDia = Number(Utilities.formatDate(datas.ontem, CONFIG.FUSO, 'd'));

  Object.keys(dados.contas || {}).forEach(function (nomeConta) {
    const rota = ROTA[nomeConta];
    if (!rota) {
      res.puladas.push(nomeConta + ': sem rota definida');
      return;
    }
    const conta = dados.contas[nomeConta] || {};
    res.contas++;

    ['google', 'meta'].forEach(function (veiculo) {
      const destino = rota[veiculo];
      const valores = conta[veiculo];
      if (!destino || !valores) return;

      try {
        if (destino.manual) {
          res.gravadas += gravarNaAbaCliente_(ss, nomeConta, veiculo, numeroDoDia, valores, res);
        } else if (destino.blocos) {
          res.gravadas += gravarRuminar_(ss, destino.aba, numeroDoDia, conta, res, datas.ontem);
        } else {
          res.gravadas += gravarNaAbaBruta_(ss, destino.aba, numeroDoDia, valores, res, datas.ontem);
        }
      } catch (e) {
        res.puladas.push(nomeConta + ' / ' + veiculo + ': ' + e.message);
        alertas.push(alerta_(NIVEL.ATENCAO, nomeConta, 'Lançamento falhou',
          'Veículo ' + veiculo + ': ' + e.message, 'ing_' + nomeConta + '_' + veiculo));
      }
    });
  });

  if (res.puladas.length) {
    alertas.push(alerta_(NIVEL.ATENCAO, 'GERAL', 'Lançamentos pulados',
      res.puladas.join(' · '), 'ingestao_puladas'));
  }

  try {
    arquivo.setName(nome + ING.SUFIXO_PROCESSADO);
  } catch (e) {
    Logger.log('Não consegui renomear o arquivo consumido: ' + e.message);
  }

  res.ok = true;
  Logger.log('Ingestão: %s células, %s contas, arquivo %s', res.gravadas, res.contas, nome);
  return res;
}

/** Grava numa aba de dados brutos. Linha do dia N é N+1, cabeçalho na linha 1. */
function gravarNaAbaBruta_(ss, nomeAba, dia, valores, res, dataRef) {
  const aba = ss.getSheetByName(nomeAba);
  if (!aba) throw new Error('aba ' + nomeAba + ' não existe');

  const cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
  const linha = dia + ING.OFFSET_BRUTA;
  let n = 0;

  Object.keys(ROTULOS_BRUTA).forEach(function (campo) {
    if (valores[campo] === undefined || valores[campo] === null) return;
    const col = acharColunaPorRotulo_(cab, ROTULOS_BRUTA[campo]);
    if (col < 0) return;
    if (escreverSeNaoForFormula_(aba, linha, col, valores[campo], nomeAba, res)) n++;
  });

  gravarDataDaLinha_(aba, cab, linha, dataRef, 0);
  return n;
}

/**
 * Ruminar soma duas contas Meta. Blocos G:K e M:Q. A:E é fórmula que soma os
 * dois, e não se toca nela.
 */
function gravarRuminar_(ss, nomeAba, dia, conta, res, dataRef) {
  const aba = ss.getSheetByName(nomeAba);
  if (!aba) throw new Error('aba ' + nomeAba + ' não existe');
  const linha = dia + ING.OFFSET_BRUTA;
  const cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];

  // Primeira ocorrência dos rótulos é A:E (consolidado, fórmula). Os blocos de
  // origem são a segunda e a terceira ocorrência.
  const blocos = [
    { chave: 'meta_lead',     ocorrencia: 1 },
    { chave: 'meta_whatsapp', ocorrencia: 2 }
  ];

  let n = 0;
  blocos.forEach(function (b) {
    const valores = conta[b.chave];
    if (!valores) return;
    Object.keys(ROTULOS_BRUTA).forEach(function (campo) {
      if (valores[campo] === undefined || valores[campo] === null) return;
      const col = acharColunaPorRotulo_(cab, ROTULOS_BRUTA[campo], b.ocorrencia);
      if (col < 0) return;
      if (escreverSeNaoForFormula_(aba, linha, col, valores[campo], nomeAba, res)) n++;
    });
    gravarDataDaLinha_(aba, cab, linha, dataRef, b.ocorrencia);
  });
  return n;
}

/**
 * Grava direto na aba do cliente, nas contas em modo manual.
 * A coluna sai do cabeçalho da linha 36 DENTRO do bloco do veículo, que a
 * linha 35 delimita. Meu Rodapé e Barbie têm o bloco Meta deslocado uma coluna
 * em relação às outras abas, então posição fixa está fora de questão.
 */
function gravarNaAbaCliente_(ss, nomeAba, veiculo, dia, valores, res) {
  const aba = ss.getSheetByName(nomeAba);
  if (!aba) throw new Error('aba ' + nomeAba + ' não existe');

  const ultima = aba.getLastColumn();
  const linhaBloco = aba.getRange(35, 1, 1, ultima).getValues()[0];
  const cab = aba.getRange(36, 1, 1, ultima).getValues()[0];

  const alvo = veiculo === 'google' ? 'google ads' : 'meta ads';
  let ini = -1, fim = ultima;
  for (let i = 0; i < linhaBloco.length; i++) {
    const v = normalizar_(String(linhaBloco[i] || ''));
    if (!v) continue;
    if (v === alvo) ini = i;
    else if (ini >= 0 && i > ini) { fim = i; break; }
  }
  if (ini < 0) throw new Error('bloco ' + alvo + ' não encontrado na linha 35 de ' + nomeAba);

  const linha = ING.OFFSET_CLIENTE + dia;
  let n = 0;

  Object.keys(ROTULOS_CLIENTE).forEach(function (campo) {
    if (valores[campo] === undefined || valores[campo] === null) return;
    let col = -1;
    for (let i = ini; i < fim; i++) {
      if (ROTULOS_CLIENTE[campo].indexOf(normalizar_(String(cab[i] || ''))) >= 0) { col = i; break; }
    }
    if (col < 0) return;
    if (escreverSeNaoForFormula_(aba, linha, col, valores[campo], nomeAba, res)) n++;
  });
  return n;
}

/**
 * Escreve só se a célula não tiver fórmula.
 *
 * As células de entrada são amarelas, mas nas contas em modo fórmula a amarela
 * JÁ CONTÉM a fórmula que puxa da aba bruta. Sobrescrever com número mata o
 * vínculo para o mês inteiro, que é exatamente o que a aba INSTRUCOES avisa na
 * legenda de cores. Na dúvida, não escreve e registra.
 */
function escreverSeNaoForFormula_(aba, linha, colZeroBased, valor, nomeAba, res) {
  const cel = aba.getRange(linha, colZeroBased + 1);
  if (cel.getFormula()) {
    res.puladas.push(nomeAba + '!' + cel.getA1Notation() + ': tem fórmula, não sobrescrevi');
    return false;
  }
  cel.setValue(valor);
  return true;
}

/**
 * Carimba a data na coluna Day da linha, se estiver vazia.
 *
 * A data é a âncora da conferência: linha do dia N deve mostrar o dia N. Se um
 * dia a linha e a data discordarem, é porque o mês virou e o offset saiu do
 * lugar, e é melhor descobrir por aqui do que por um pacing errado.
 */
function gravarDataDaLinha_(aba, cab, linha, dataRef, ocorrencia) {
  if (!dataRef) return;
  const col = acharColunaPorRotulo_(cab, ['day', 'data'], ocorrencia || 0);
  if (col < 0) return;
  const cel = aba.getRange(linha, col + 1);
  if (cel.getFormula() || cel.getValue()) return;
  cel.setValue(dataRef);
}

/** Acha a coluna pelo rótulo, na N-ésima ocorrência (0 = primeira). */
function acharColunaPorRotulo_(cab, rotulos, ocorrencia) {
  const alvo = ocorrencia || 0;
  let vistas = 0;
  for (let i = 0; i < cab.length; i++) {
    if (rotulos.indexOf(normalizar_(String(cab[i] || ''))) >= 0) {
      if (vistas === alvo) return i;
      vistas++;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------
//  ABA DE ALERTAS
// ---------------------------------------------------------------------

/**
 * Registra na aba ALERTAS o que foi enviado. Empilha por dia, uma linha por
 * alerta, e reexecução no mesmo dia substitui as linhas do dia em vez de
 * duplicar.
 */
function escreverAbaAlertas_(ss, alertas, datas) {
  const CAB = ['Data', 'Enviado em', 'Nível', 'Conta', 'Título', 'Detalhe', 'Persistente', 'Chave'];
  let aba = ss.getSheetByName(ING.ABA_ALERTAS);

  if (!aba) {
    aba = ss.insertSheet(ING.ABA_ALERTAS);
    aba.getRange(1, 1, 1, CAB.length).setValues([CAB])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3864');
    aba.setFrozenRows(1);
    aba.setColumnWidth(5, 280);
    aba.setColumnWidth(6, 520);
  }

  const dia = Utilities.formatDate(datas.ontem, CONFIG.FUSO, 'yyyy-MM-dd');
  const agora = Utilities.formatDate(new Date(), CONFIG.FUSO, 'yyyy-MM-dd HH:mm');

  // Tira as linhas deste mesmo dia, de baixo para cima, para o índice não andar.
  const ultima = aba.getLastRow();
  if (ultima > 1) {
    const col = aba.getRange(2, 1, ultima - 1, 1).getDisplayValues();
    for (let i = col.length - 1; i >= 0; i--) {
      if (col[i][0] === dia) aba.deleteRow(i + 2);
    }
  }

  if (!alertas.length) {
    aba.appendRow([dia, agora, 'INFO', 'GERAL', 'Sem alteração', 'Nenhum alerta hoje.', '', 'sem_alerta']);
    return;
  }

  const linhas = alertas.map(function (a) {
    return [dia, agora, a.nivel, a.conta, a.titulo, a.detalhe,
            a.persistente ? 'sim' : '', a.chave || ''];
  });
  aba.getRange(aba.getLastRow() + 1, 1, linhas.length, CAB.length).setValues(linhas);

  // Crítico em vermelho, atenção em amarelo. É o que o olho procura primeiro.
  const inicio = aba.getLastRow() - linhas.length + 1;
  linhas.forEach(function (l, i) {
    const cor = l[2] === NIVEL.CRITICO ? '#FFC7CE' : (l[2] === NIVEL.ATENCAO ? '#FFF2CC' : null);
    if (cor) aba.getRange(inicio + i, 1, 1, CAB.length).setBackground(cor);
  });
}
