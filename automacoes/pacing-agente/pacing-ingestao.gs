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

  // Canal #controle_pacing_diário. Conferido na API do Slack em 14/09/2026.
  SLACK_CANAL: 'C0BG2NK56UC',
  SLACK_CANAL_NOME: '#controle_pacing_diário',

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
  const datas = ingDatas_();
  const alertas = [];
  const res = importarPacingDoDrive_(ss, datas, alertas);
  SpreadsheetApp.flush();
  const msg = res.ok
    ? 'Importadas ' + res.gravadas + ' células de ' + res.contas + ' contas, arquivo ' + res.arquivo
    : 'Nada importado: ' + res.motivo;
  Logger.log(msg);

  // O que foi pulado é a informação que importa quando o número vem menor do
  // que o esperado. Sem isso, a execução diz "importadas 20 células" e parece
  // sucesso, quando na verdade 40 falharam em silêncio.
  if (res.puladas && res.puladas.length) {
    Logger.log('PULADAS (%s):', res.puladas.length);
    res.puladas.forEach(function (x) { Logger.log('  - %s', x); });
  } else {
    Logger.log('Nenhuma célula pulada.');
  }
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return res;
}

/** Monta a aba ALERTAS à mão, a partir da última execução. */
function escreverAbaAlertasAgora() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  escreverAbaAlertas_(ss, [], ingDatas_());
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
  const dia = Utilities.formatDate(datas.ontem, ingCfg_().FUSO, 'yyyy-MM-dd');
  const nome = ING.PREFIXO + dia + '.json';
  const res = { ok: false, arquivo: nome, contas: 0, gravadas: 0, puladas: [], motivo: '' };

  let arquivo;
  try {
    const it = DriveApp.getFolderById(ING.PASTA_ID).getFilesByName(nome);
    if (!it.hasNext()) {
      res.motivo = 'arquivo ' + nome + ' não encontrado na pasta de ingestão';
      alertas.push(ingAlerta_(ingNivel_().CRITICO, 'GERAL', 'Coleta do agente não chegou',
        'O agente das 7:30 não deixou o arquivo ' + nome + ' na pasta de ingestão. ' +
        'A planilha está com os números de ontem, e todo alerta abaixo pode estar defasado.',
        'ingestao_ausente'));
      return res;
    }
    arquivo = it.next();
  } catch (e) {
    res.motivo = 'pasta de ingestão inacessível: ' + e.message;
    alertas.push(ingAlerta_(ingNivel_().CRITICO, 'GERAL', 'Pasta de ingestão inacessível', res.motivo, 'ingestao_pasta'));
    return res;
  }

  let dados;
  try {
    dados = JSON.parse(arquivo.getBlob().getDataAsString('UTF-8'));
  } catch (e) {
    res.motivo = 'JSON inválido: ' + e.message;
    alertas.push(ingAlerta_(ingNivel_().CRITICO, 'GERAL', 'Coleta do agente ilegível', res.motivo, 'ingestao_json'));
    return res;
  }

  if (dados.data !== dia) {
    res.motivo = 'o arquivo diz ' + dados.data + ' e o dia a lançar é ' + dia;
    alertas.push(ingAlerta_(ingNivel_().CRITICO, 'GERAL', 'Coleta com data errada',
      res.motivo + '. Nada foi gravado, para não lançar o dia errado na linha errada.', 'ingestao_data'));
    return res;
  }

  const numeroDoDia = Number(Utilities.formatDate(datas.ontem, ingCfg_().FUSO, 'd'));

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
        res.puladas.push(nomeConta + ' / ' + veiculo + ' -> ' + (destino.aba || 'aba do cliente') +
                         ': ' + e.message);
        alertas.push(ingAlerta_(ingNivel_().ATENCAO, nomeConta, 'Lançamento falhou',
          'Veículo ' + veiculo + ': ' + e.message, 'ing_' + nomeConta + '_' + veiculo));
      }
    });
  });

  if (res.puladas.length) {
    alertas.push(ingAlerta_(ingNivel_().ATENCAO, 'GERAL', 'Lançamentos pulados',
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
  const aba = acharAba_(ss, nomeAba);
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
  const aba = acharAba_(ss, nomeAba);
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
  const aba = acharAba_(ss, nomeAba);
  const ultima = aba.getLastColumn();
  const linhaBloco = aba.getRange(35, 1, 1, ultima).getValues()[0];
  const cab = aba.getRange(36, 1, 1, ultima).getValues()[0];

  const alvo = veiculo === 'google' ? 'google ads' : 'meta ads';
  let ini = -1, fim = ultima;
  for (let i = 0; i < linhaBloco.length; i++) {
    const v = ingNormalizar_(String(linhaBloco[i] || ''));
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
      if (ROTULOS_CLIENTE[campo].indexOf(ingNormalizar_(String(cab[i] || ''))) >= 0) { col = i; break; }
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

/**
 * Acha a aba pelo nome, tolerando diferença de espaço, caixa e acento.
 *
 * `getSheetByName` exige o nome byte a byte. Uma aba chamada "AMK Google " com
 * espaço no fim, ou com espaço não separável no meio, não é encontrada e o
 * erro diz apenas "não existe", que manda o leitor procurar a aba errada.
 * Aqui, se a busca exata falhar, a comparação normalizada resolve, e se ainda
 * assim não achar, o erro lista os nomes que existem de verdade.
 */
function acharAba_(ss, nome) {
  const direta = ss.getSheetByName(nome);
  if (direta) return direta;

  const alvo = ingNormalizar_(nome).replace(/\s+/g, ' ');
  const abas = ss.getSheets();
  for (let i = 0; i < abas.length; i++) {
    if (ingNormalizar_(abas[i].getName()).replace(/\s+/g, ' ') === alvo) return abas[i];
  }

  throw new Error('aba "' + nome + '" não encontrada. Existem: ' +
    abas.map(function (a) { return '"' + a.getName() + '"'; }).join(', '));
}

/** Acha a coluna pelo rótulo, na N-ésima ocorrência (0 = primeira). */
function acharColunaPorRotulo_(cab, rotulos, ocorrencia) {
  const alvo = ocorrencia || 0;
  let vistas = 0;
  for (let i = 0; i < cab.length; i++) {
    if (rotulos.indexOf(ingNormalizar_(String(cab[i] || ''))) >= 0) {
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
  const CAB = ['Data', 'Enviado em', 'Nível', 'Conta', 'Título', 'Detalhe', 'Persistência', 'Chave'];
  let aba = ss.getSheetByName(ING.ABA_ALERTAS);

  if (!aba) {
    aba = ss.insertSheet(ING.ABA_ALERTAS);
    aba.getRange(1, 1, 1, CAB.length).setValues([CAB])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3864');
    aba.setFrozenRows(1);
    aba.setColumnWidth(5, 280);
    aba.setColumnWidth(6, 520);
  }

  const dia = Utilities.formatDate(datas.ontem, ingCfg_().FUSO, 'yyyy-MM-dd');
  const agora = Utilities.formatDate(new Date(), ingCfg_().FUSO, 'yyyy-MM-dd HH:mm');

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
            a.persistencia || '', a.chave || ''];
  });
  aba.getRange(aba.getLastRow() + 1, 1, linhas.length, CAB.length).setValues(linhas);

  // Crítico em vermelho, atenção em amarelo. É o que o olho procura primeiro.
  const inicio = aba.getLastRow() - linhas.length + 1;
  linhas.forEach(function (l, i) {
    const cor = l[2] === ingNivel_().CRITICO ? '#FFC7CE' : (l[2] === ingNivel_().ATENCAO ? '#FFF2CC' : null);
    if (cor) aba.getRange(inicio + i, 1, 1, CAB.length).setBackground(cor);
  });
}

// ---------------------------------------------------------------------
//  SLACK COM RESERVA
// ---------------------------------------------------------------------

/**
 * Posta no canal de pacing por webhook e, se não houver webhook, pela API com
 * o bot token.
 *
 * O `enviar_` original só tenta o webhook e, quando ele não está configurado,
 * escreve uma linha no Logger e segue. Ninguém lê Logger. O e-mail sai dizendo
 * que está tudo certo e o canal fica mudo, e a falha só aparece quando alguém
 * repara que faz semanas que não chega nada no Slack.
 *
 * Aqui a falha de Slack vira alerta no dia seguinte e linha na aba ALERTAS.
 *
 * @return {{ok: boolean, via: string, erro: string}}
 */
function postarNoCanalPacing_(blocos, alertas) {
  const props = PropertiesService.getScriptProperties();
  const webhook = props.getProperty('SLACK_WEBHOOK_URL');
  const token = props.getProperty('SLACK_BOT_TOKEN');
  const canal = props.getProperty('SLACK_CANAL_PACING') || ING.SLACK_CANAL;
  const res = { ok: false, via: '', erro: '' };

  if (webhook) {
    try {
      blocos.forEach(function (txt) { ingPostSlack_(webhook, { text: txt }); });
      res.ok = true; res.via = 'webhook';
      return res;
    } catch (e) {
      res.erro = 'webhook falhou: ' + e.message + '. ';
    }
  }

  if (token && canal) {
    try {
      blocos.forEach(function (txt) { ingPostSlackApi_(token, canal, txt); });
      res.ok = true; res.via = 'bot token em ' + canal;
      return res;
    } catch (e) {
      res.erro += 'API falhou: ' + e.message;
    }
  } else if (!webhook) {
    res.erro += 'nem SLACK_WEBHOOK_URL nem SLACK_BOT_TOKEN configurados nas Propriedades do script';
  }

  if (alertas) {
    alertas.push(ingAlerta_(ingNivel_().ATENCAO, 'GERAL', 'Slack não recebeu o alerta',
      'O resumo foi por e-mail mas não chegou em ' + ING.SLACK_CANAL_NOME + '. ' + res.erro,
      'slack_falhou'));
  }
  Logger.log('Slack não enviado: %s', res.erro);
  return res;
}

// ---------------------------------------------------------------------
//  COMPATIBILIDADE
// ---------------------------------------------------------------------
/*
 * Este arquivo depende do `pacing_alertas.gs` para CONFIG, NIVEL, alerta_,
 * normalizar_, calcularDatas_, postSlack_ e postSlackApi_.
 *
 * Quando o companheiro não está no projeto, o Apps Script derruba a execução
 * com `ReferenceError: X is not defined`, que não diz o que fazer. Os
 * acessores abaixo existem para o erro virar uma frase em português dizendo
 * qual arquivo falta, e para as funções que dá para reproduzir sozinho
 * continuarem funcionando.
 *
 * Nenhum deles redeclara função do outro arquivo. Redeclarar faria a última
 * definição carregada vencer em silêncio, e um dia o pacing rodaria com a
 * régua errada sem ninguém saber.
 */

/** Lista o que está faltando. Rode para diagnosticar. */
function conferirInstalacao() {
  const dependencias = ['CONFIG', 'NIVEL', 'alerta_', 'normalizar_', 'calcularDatas_',
                        'postSlack_', 'postSlackApi_', 'executar_'];
  const faltando = dependencias.filter(function (n) {
    try { return eval('typeof ' + n) === 'undefined'; } catch (e) { return true; }
  });
  const msg = faltando.length
    ? 'Falta o arquivo pacing_alertas.gs neste projeto. Sem ele: ' + faltando.join(', ') +
      '. Adicione Arquivos > + > Script e cole o pacing_alertas.gs.'
    : 'Instalação completa: pacing_alertas.gs e ingestao no mesmo projeto.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return { ok: !faltando.length, faltando: faltando };
}

function ingCfg_() {
  if (typeof CONFIG !== 'undefined') return CONFIG;
  // Só o fuso é indispensável para a ingestão, então ela sobrevive sem o resto.
  return { FUSO: 'America/Sao_Paulo' };
}

function ingNivel_() {
  if (typeof NIVEL !== 'undefined') return NIVEL;
  return { CRITICO: 'CRITICO', ATENCAO: 'ATENCAO', INFO: 'INFO' };
}

function ingAlerta_(nivel, conta, titulo, detalhe, chave) {
  if (typeof alerta_ === 'function') return alerta_(nivel, conta, titulo, detalhe, chave);
  return { nivel: nivel, conta: conta, titulo: titulo, detalhe: detalhe, chave: chave, persistencia: 'NOVO' };
}

function ingNormalizar_(s) {
  if (typeof normalizar_ === 'function') return normalizar_(s);
  return String(s === null || s === undefined ? '' : s)
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function ingDatas_() {
  if (typeof calcularDatas_ === 'function') return calcularDatas_();
  const fuso = ingCfg_().FUSO;
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 24 * 60 * 60 * 1000);
  return {
    hoje: hoje,
    ontem: ontem,
    labelHoje: Utilities.formatDate(hoje, fuso, 'dd/MM/yyyy'),
    labelOntem: Utilities.formatDate(ontem, fuso, 'dd/MM/yyyy')
  };
}

function ingPostSlack_(webhook, payload) {
  if (typeof postSlack_ === 'function') return postSlack_(webhook, payload);
  const r = UrlFetchApp.fetch(webhook, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (r.getResponseCode() >= 300) throw new Error('Slack webhook ' + r.getResponseCode() + ': ' + r.getContentText());
}

function ingPostSlackApi_(token, canal, texto) {
  if (typeof postSlackApi_ === 'function') return postSlackApi_(token, canal, texto);
  const r = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post', contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ channel: canal, text: texto }), muteHttpExceptions: true
  });
  if (r.getContentText().indexOf('"ok":true') < 0) throw new Error('Slack API: ' + r.getContentText());
}
