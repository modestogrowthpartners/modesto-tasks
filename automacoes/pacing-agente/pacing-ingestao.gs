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
  CAB_ALERTAS: ['Data', 'Nível', 'Conta', 'Título', 'Detalhe',
                'Enviar', 'Enviado em', 'Persistência', 'Chave'],

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
  'AMAKHA PARIS':     { google: { aba: '[AMK] Google' },        meta: { aba: '[AMK] Meta' } },
  'ALLIANCE BR':      { google: { aba: '[ALI] Google BR' },     meta: { aba: '[ALI] Meta' } },
  'ALLIANCE LATAM':   { google: { aba: ' [ALI] Google LATAM' }, meta: null },
  'D&G':              { google: { aba: '[DEG] Google' },        meta: null },
  'RUMINAR':          { google: null,                         meta: { aba: '[RUM] Meta', blocos: 2 } },
  'WONDR EXPERIENCE': { google: { aba: '[WDR] Google', manual: true }, meta: { manual: true } },
  'BARBIE':           { google: { aba: '[BRB] Google', manual: true }, meta: { manual: true } },
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
      if (!destino) return;

      const valores = conta[veiculo];
      // A Ruminar não tem a chave "meta": tem meta_lead e meta_whatsapp, e
      // quem sabe disso é gravarRuminar_. Exigir conta[veiculo] aqui fazia a
      // conta inteira ser ignorada em silêncio, sem entrar nem nas puladas.
      if (!destino.blocos && !valores) return;

      try {
        if (destino.blocos) {
          res.gravadas += gravarRuminar_(ss, destino.aba, numeroDoDia, conta, res, datas.ontem);
        } else {
          // `aba` e `manual` não são exclusivos. Wondr e Barbie têm aba bruta
          // de Google E célula fixa na aba do cliente: a fórmula que ligaria
          // as duas não existe, então gravar só na bruta não chega no pacing.
          if (destino.aba) {
            res.gravadas += gravarNaAbaBruta_(ss, destino.aba, numeroDoDia, valores, res, datas.ontem);
          }
          if (destino.manual) {
            res.gravadas += gravarNaAbaCliente_(ss, nomeConta, veiculo, numeroDoDia, valores, res);
          }
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

  // Colchetes entram na normalização porque o export da planilha para .xlsx
  // os remove: o Excel não aceita [ ] em nome de aba. Quem monta o mapa lendo
  // um export acaba com "AMK Google" quando a aba real é "[AMK] Google", e a
  // busca falha sem nenhuma pista do porquê.
  const limpa = function (x) {
    return ingNormalizar_(x).replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
  };
  const alvo = limpa(nome);
  const abas = ss.getSheets();
  for (let i = 0; i < abas.length; i++) {
    if (limpa(abas[i].getName()) === alvo) return abas[i];
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
 * Monta a fila de envio do dia na aba ALERTAS.
 *
 * A aba é a FONTE do que vai ser enviado, não o registro do que já saiu. O
 * fluxo é escrever aqui, ler de volta e mandar o que a aba disser. Assim, numa
 * execução manual, dá para abrir a aba, marcar "não" na coluna Enviar de uma
 * linha e ela não chega no time.
 *
 * Reexecução no mesmo dia substitui as linhas do dia, não empilha.
 */
function escreverAbaAlertas_(ss, alertas, datas) {
  const CAB = ING.CAB_ALERTAS;
  let aba = ss.getSheetByName(ING.ABA_ALERTAS);

  if (!aba) {
    aba = ss.insertSheet(ING.ABA_ALERTAS);
    aba.getRange(1, 1, 1, CAB.length).setValues([CAB])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3864');
    aba.setFrozenRows(1);
    aba.setColumnWidth(4, 260);
    aba.setColumnWidth(5, 520);
  }

  const dia = Utilities.formatDate(datas.ontem, ingCfg_().FUSO, 'yyyy-MM-dd');

  // De baixo para cima, senão o índice anda a cada linha removida.
  const ultima = aba.getLastRow();
  if (ultima > 1) {
    const col = aba.getRange(2, 1, ultima - 1, 1).getDisplayValues();
    for (let i = col.length - 1; i >= 0; i--) {
      if (col[i][0] === dia) aba.deleteRow(i + 2);
    }
  }

  if (!alertas.length) {
    aba.appendRow([dia, ingNivel_().INFO, 'GERAL', 'Sem alteração',
                   'Nenhum alerta hoje.', 'não', '', '', 'sem_alerta']);
    return;
  }

  const linhas = alertas.map(function (a) {
    return [dia, a.nivel, a.conta, a.titulo, a.detalhe, 'sim', '',
            a.persistencia || '', a.chave || ''];
  });
  aba.getRange(aba.getLastRow() + 1, 1, linhas.length, CAB.length).setValues(linhas);

  // Crítico em vermelho, atenção em amarelo. É o que o olho procura primeiro.
  const inicio = aba.getLastRow() - linhas.length + 1;
  linhas.forEach(function (l, i) {
    const cor = l[1] === ingNivel_().CRITICO ? '#FFC7CE'
              : (l[1] === ingNivel_().ATENCAO ? '#FFF2CC' : null);
    if (cor) aba.getRange(inicio + i, 1, 1, CAB.length).setBackground(cor);
  });
}

/**
 * Lê de volta a fila do dia. Linha com "não" na coluna Enviar fica de fora:
 * é o botão que uma pessoa tem para barrar um alerta antes dele sair.
 */
function lerAbaAlertas_(ss, datas) {
  const aba = ss.getSheetByName(ING.ABA_ALERTAS);
  if (!aba) return [];
  const ultima = aba.getLastRow();
  if (ultima < 2) return [];

  const dia = Utilities.formatDate(datas.ontem, ingCfg_().FUSO, 'yyyy-MM-dd');
  const dados = aba.getRange(2, 1, ultima - 1, ING.CAB_ALERTAS.length).getDisplayValues();
  const out = [];

  dados.forEach(function (l) {
    if (l[0] !== dia) return;
    if (ingNormalizar_(l[5]) === 'nao') return;
    if (l[8] === 'sem_alerta') return;
    out.push({ nivel: l[1], conta: l[2], titulo: l[3], detalhe: l[4],
               persistencia: l[7], chave: l[8] });
  });
  return out;
}

/**
 * Carimba a hora do envio nas linhas que saíram, e acrescenta alertas que
 * nasceram durante o próprio envio.
 *
 * O segundo caso existe por causa de uma situação real: se o Slack falhar,
 * `postarNoCanalPacing_` cria um alerta DEPOIS da fila já estar escrita. Sem
 * isto, esse alerta sumiria, e a falha do canal de alerta ficaria sem registro
 * justamente na aba que serve para registrar alertas.
 */
function marcarEnviados_(ss, datas, enviados) {
  const aba = ss.getSheetByName(ING.ABA_ALERTAS);
  if (!aba) return;
  const ultima = aba.getLastRow();
  if (ultima < 2) return;

  const dia = Utilities.formatDate(datas.ontem, ingCfg_().FUSO, 'yyyy-MM-dd');
  const agora = Utilities.formatDate(new Date(), ingCfg_().FUSO, 'dd/MM/yyyy HH:mm');
  const dados = aba.getRange(2, 1, ultima - 1, ING.CAB_ALERTAS.length).getDisplayValues();

  const naFila = {};
  dados.forEach(function (l, i) {
    if (l[0] !== dia) return;
    naFila[l[8]] = true;
    if (ingNormalizar_(l[5]) !== 'nao') aba.getRange(i + 2, 7).setValue(agora);
  });

  (enviados || []).forEach(function (a) {
    if (naFila[a.chave]) return;
    aba.appendRow([dia, a.nivel, a.conta, a.titulo, a.detalhe, 'sim', agora,
                   a.persistencia || '', a.chave || '']);
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

// ---------------------------------------------------------------------
//  DETALHE DE CAMPANHA, TERMO E CRIATIVO
// ---------------------------------------------------------------------
/*
 * O total por conta diz que o ROAS caiu. Só o nível de campanha diz onde.
 *
 * No Meu Rodapé, em 17/09, a conta fechou ROAS 4,73 contra meta de 5,33. Sem a
 * campanha de marca, que gastou R$ 312 e devolveu R$ 53 mil, o ROAS real da
 * prospecção era 3,47. Nenhum relatório de total por conta mostraria isso.
 *
 * Quem puxa é o agente das 7:30, que já tem Pipeboard anexado. Ele grava
 * `detalhe_AAAA-MM-DD.json` na mesma pasta do pacing, e este arquivo lê e
 * escreve nas abas. Uma porta só para a plataforma: dois agentes puxando as
 * mesmas contas em horários diferentes acabam com dois números do mesmo dia e
 * ninguém sabendo qual vale.
 *
 * ROAS, CPA e CTR são calculados AQUI, não vêm no JSON. Métrica derivada
 * calculada em dois lugares diverge no dia em que alguém arredonda diferente.
 */

const DET = {
  PREFIXO: 'detalhe_',
  ABA_CAMPANHA: 'DETALHE CAMPANHA',
  ABA_TERMOS: 'DETALHE TERMOS',
  ABA_CRIATIVO: 'DETALHE CRIATIVO',
  ABA_ALTERACOES: 'DETALHE ALTERACOES',
  MAX_LINHAS: 50000,

  CAB_CAMPANHA: ['Dia', 'Cliente', 'Plataforma', 'Nível', 'Nome', 'Pai', 'Tipo', 'Status',
                 'Gasto', 'Impressões', 'Cliques', 'Conversões', 'Receita', 'ROAS', 'CPA', 'CTR',
                 'Coletado em', 'Fonte'],
  CAB_TERMOS: ['Dia', 'Cliente', 'Termo', 'Campanha', 'Gasto', 'Cliques', 'Conversões',
               'Receita', 'CPA', 'Coletado em', 'Fonte'],
  CAB_CRIATIVO: ['Dia', 'Cliente', 'Anúncio', 'Campanha', 'Gasto', 'Impressões', 'Cliques',
                 'Conversões', 'Receita', 'ROAS', 'Hook rate', 'Hold rate', 'Coletado em', 'Fonte'],
  CAB_ALTERACOES: ['Dia', 'Cliente', 'Plataforma', 'Entidade', 'Tipo', 'Campo', 'De', 'Para',
                   'Variação', 'Quem', 'Coletado em', 'Fonte']
};

/** Roda a ingestão do detalhe à mão. */
function importarDetalheAgora() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const res = importarDetalheDoDrive_(ss, ingDatas_(), []);
  const msg = res.ok
    ? 'Detalhe importado: ' + res.campanhas + ' campanhas, ' + res.termos + ' termos, ' +
      res.criativos + ' criativos, ' + res.alteracoes + ' alterações (' + res.arquivo + ')'
    : 'Nada importado: ' + res.motivo;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return res;
}

/**
 * Lê `detalhe_AAAA-MM-DD.json` e reescreve as três abas para o dia.
 *
 * Ausência do arquivo é ATENÇÃO, não CRÍTICO: sem detalhe o pacing continua
 * correto, só a análise das 9h fica mais rasa. Tratar como crítico faria o
 * time aprender a ignorar crítico.
 */
function importarDetalheDoDrive_(ss, datas, alertas) {
  const dia = Utilities.formatDate(datas.ontem, ingCfg_().FUSO, 'yyyy-MM-dd');
  const nome = DET.PREFIXO + dia + '.json';
  const res = { ok: false, arquivo: nome, campanhas: 0, termos: 0, criativos: 0, alteracoes: 0, motivo: '' };

  let arquivo;
  try {
    const it = DriveApp.getFolderById(ING.PASTA_ID).getFilesByName(nome);
    if (!it.hasNext()) {
      res.motivo = nome + ' não encontrado';
      if (alertas) alertas.push(ingAlerta_(ingNivel_().ATENCAO, 'GERAL', 'Detalhe de campanha não chegou',
        'O agente das 7:30 não deixou ' + nome + '. O pacing está correto, mas a análise do dia fica ' +
        'sem nível de campanha e não vai conseguir apontar onde o ROAS caiu.', 'detalhe_ausente'));
      return res;
    }
    arquivo = it.next();
  } catch (e) {
    res.motivo = 'pasta inacessível: ' + e.message;
    if (alertas) alertas.push(ingAlerta_(ingNivel_().ATENCAO, 'GERAL', 'Pasta de detalhe inacessível', res.motivo, 'detalhe_pasta'));
    return res;
  }

  let d;
  try {
    d = JSON.parse(arquivo.getBlob().getDataAsString('UTF-8'));
  } catch (e) {
    res.motivo = 'JSON inválido: ' + e.message;
    if (alertas) alertas.push(ingAlerta_(ingNivel_().ATENCAO, 'GERAL', 'Detalhe ilegível', res.motivo, 'detalhe_json'));
    return res;
  }
  if (d.data !== dia) {
    res.motivo = 'o arquivo diz ' + d.data + ' e o dia é ' + dia;
    if (alertas) alertas.push(ingAlerta_(ingNivel_().ATENCAO, 'GERAL', 'Detalhe com data errada',
      res.motivo + '. Nada gravado.', 'detalhe_data'));
    return res;
  }

  const linhasC = [], linhasT = [], linhasK = [], linhasA = [];
  const dias = {};   // os dias que este arquivo cobre, para substituir só eles
  const coletadoEm = datas.hoje;

  function diaDe(x) {
    const v = x.dia || x.data || dia;
    dias[v] = true;
    return new Date(v + 'T12:00:00Z');
  }

  Object.keys(d.contas || {}).forEach(function (cliente) {
    const c = d.contas[cliente] || {};

    (c.campanhas || []).forEach(function (x) {
      const g = Number(x.gasto) || 0, cv = Number(x.conversoes) || 0;
      const rv = Number(x.receita) || 0, im = Number(x.impressoes) || 0, cl = Number(x.cliques) || 0;
      linhasC.push([diaDe(x), cliente, x.plataforma || '', x.nivel || 'campanha', x.nome || '',
        x.pai || '', x.tipo || '', x.status || '', g, im, cl, cv, rv,
        g ? rv / g : '', cv ? g / cv : '', im ? cl / im : '', coletadoEm, x.fonte || 'Pipeboard']);
    });

    (c.termos || []).forEach(function (x) {
      const g = Number(x.gasto) || 0, cv = Number(x.conversoes) || 0;
      linhasT.push([diaDe(x), cliente, x.termo || '', x.campanha || '', g,
        Number(x.cliques) || 0, cv, Number(x.receita) || 0, cv ? g / cv : '', coletadoEm, x.fonte || 'Pipeboard']);
    });

    (c.alteracoes || []).forEach(function (x) {
      const de = x.de === undefined || x.de === null ? '' : x.de;
      const para = x.para === undefined || x.para === null ? '' : x.para;
      // Variação só quando os dois lados são número. "ENABLED para PAUSED" não
      // tem percentual, e forçar um faria aparecer -100% onde nada caiu.
      const nDe = Number(de), nPara = Number(para);
      const varia = (de !== '' && para !== '' && isFinite(nDe) && isFinite(nPara) && nDe !== 0)
        ? (nPara / nDe - 1) : '';
      linhasA.push([diaDe(x), cliente, x.plataforma || '', x.entidade || '', x.tipo || '',
        x.campo || '', de, para, varia, x.quem || '', coletadoEm, x.fonte || 'Pipeboard']);
    });

    (c.criativos || []).forEach(function (x) {
      const g = Number(x.gasto) || 0, rv = Number(x.receita) || 0;
      linhasK.push([diaDe(x), cliente, x.nome || '', x.campanha || '', g,
        Number(x.impressoes) || 0, Number(x.cliques) || 0, Number(x.conversoes) || 0, rv,
        g ? rv / g : '', x.hook === undefined ? '' : Number(x.hook),
        x.hold === undefined ? '' : Number(x.hold), coletadoEm, x.fonte || 'Pipeboard']);
    });
  });

  const diasCobertos = Object.keys(dias);

  gravarDetalhe_(ss, DET.ABA_CAMPANHA, DET.CAB_CAMPANHA, linhasC, diasCobertos);
  gravarDetalhe_(ss, DET.ABA_TERMOS, DET.CAB_TERMOS, linhasT, diasCobertos);
  gravarDetalhe_(ss, DET.ABA_CRIATIVO, DET.CAB_CRIATIVO, linhasK, diasCobertos);
  gravarDetalhe_(ss, DET.ABA_ALTERACOES, DET.CAB_ALTERACOES, linhasA, diasCobertos);

  res.campanhas = linhasC.length; res.termos = linhasT.length;
  res.criativos = linhasK.length; res.alteracoes = linhasA.length;
  res.ok = true;

  // Alteração é o elo entre o que o time fez e o que aconteceu depois. Semana
  // inteira sem nenhuma, numa carteira deste tamanho, quase sempre significa
  // coleta quebrada, não time parado.
  if (!linhasA.length && alertas) {
    alertas.push(ingAlerta_(ingNivel_().ATENCAO, 'GERAL', 'Nenhuma alteração coletada',
      'A janela de 7 dias não trouxe nenhuma mudança de verba, status ou segmentação em ' +
      'nenhuma conta. Sem isso a análise não consegue ligar ação a resultado. ' +
      'Verifique a coleta de change_event no Google e de account_activities no Meta.',
      'alteracoes_vazias'));
  }

  try { arquivo.setName(nome + ING.SUFIXO_PROCESSADO); } catch (e) {}
  Logger.log('Detalhe: %s campanhas, %s termos, %s criativos, %s alterações',
    res.campanhas, res.termos, res.criativos, res.alteracoes);
  return res;
}

/**
 * Cria a aba se não existir, substitui SÓ os dias que o arquivo cobre e apara o excesso.
 *
 * O histórico é o ativo aqui: a análise das 9h compara a semana com a anterior,
 * e sem dia guardado não existe comparação. Por isso a linha é DIÁRIA, nunca o
 * agregado da janela. Guardar agregado de 7 dias todo dia faria dias
 * consecutivos se sobreporem, e somar o histórico contaria o mesmo gasto sete
 * vezes.
 *
 * A substituição é por dia, não por aba: o arquivo traz a janela móvel, então
 * reescrever esses dias conserta lacuna e correção retroativa da plataforma
 * sem tocar em nada anterior. Conversão que a plataforma atribui dias depois
 * entra na próxima passada, que é o comportamento certo.
 */
function gravarDetalhe_(ss, nomeAba, cab, linhas, diasCobertos) {
  let aba = ss.getSheetByName(nomeAba);
  if (!aba) {
    aba = ss.insertSheet(nomeAba, ss.getNumSheets());
    aba.getRange(1, 1, 1, cab.length).setValues([cab])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3864');
    aba.setFrozenRows(1);
    aba.getRange('A:A').setNumberFormat('dd/mm/yyyy');
    aba.setColumnWidth(5, 300);
  }

  const alvos = {};
  (diasCobertos || []).forEach(function (x) {
    alvos[Utilities.formatDate(new Date(x + 'T12:00:00Z'), ingCfg_().FUSO, 'dd/MM/yyyy')] = true;
  });

  const ultima = aba.getLastRow();
  if (ultima > 1 && Object.keys(alvos).length) {
    const col = aba.getRange(2, 1, ultima - 1, 1).getDisplayValues();
    for (let i = col.length - 1; i >= 0; i--) {
      if (alvos[col[i][0]]) aba.deleteRow(i + 2);
    }
  }

  if (!linhas.length) return;
  aba.getRange(aba.getLastRow() + 1, 1, linhas.length, cab.length).setValues(linhas);

  const total = aba.getLastRow() - 1;
  if (total > DET.MAX_LINHAS) aba.deleteRows(2, total - DET.MAX_LINHAS);
}
