/**
 * =====================================================================
 *  CONTROLE DE PACING E METAS  |  ALERTAS DIÁRIOS (E-MAIL + SLACK)
 *  Modesto Growth Partners
 * =====================================================================
 *
 *  INSTALAÇÃO (uma vez)
 *  1. Abra a planilha de Controle de Pacing > Extensões > Apps Script.
 *     Apague o conteúdo de Código.gs e cole este arquivo inteiro.
 *  2. Engrenagem (Configurações do projeto) > Fuso horário: (GMT-03:00) São Paulo.
 *     Se preferir editar o appsscript.json, deixe:  "timeZone": "America/Sao_Paulo"
 *  3. Configurações do projeto > Propriedades do script > adicione:
 *        SLACK_WEBHOOK_URL   = URL do Incoming Webhook do canal #controle_pacing_diário
 *        SLACK_BOT_TOKEN     = (opcional) token xoxb-... para mandar DM ao Everton
 *        SLACK_EVERTON_ID    = (opcional) ID de usuário do Everton no Slack (formato U0XXXXXXX)
 *     Sem BOT_TOKEN o script manda tudo no canal e os críticos por e-mail ao Everton.
 *  4. No editor, selecione a função  instalarGatilho  e clique em Executar.
 *     Autorize as permissões pedidas. O gatilho roda todo dia entre 8h e 9h (Brasília).
 *  5. Para testar sem incomodar ninguém, rode  testarAlertas  (manda só para você, sem Slack).
 *
 *  A planilha externa de orçamento é lida a cada execução. Colunas aceitas (cabeçalho na linha 1):
 *     Cliente | Orçamento google ads | Orçamento meta ads | Orçamento pinterest ads (opcional)
 *     | Teto de gastos (opcional, contas por CPA) | Meta CPA (opcional) | Meta ROAS (opcional)
 *  O nome do cliente precisa ser igual ao nome da aba na planilha de pacing (acentos e maiúsculas
 *  são ignorados na comparação).
 */

// ---------------------------------------------------------------------
//  CONFIGURAÇÃO
// ---------------------------------------------------------------------
const CONFIG = {
  // Planilha externa "[Interno] Orçamento por cliente"
  PLANILHA_ORCAMENTO_ID: '1rHmIt2Nc_gIR3d96qf2ags3X-xI5YNZUfwPkMCPvyeA',
  ABA_ORCAMENTO: 'Página1',
  SINCRONIZAR_BUDGETS: true, // copia os budgets da planilha externa para B6/C6/D6 de cada aba de conta

  // Destinatários
  EMAILS_TIME: [
    'elias.braga@modestogrowth.com.br',
    'vinicius.reis@modestogrowth.com.br',
    'everton.medeiros@modestogrowth.com.br',
    'phellip.lira@modestogrowth.com.br'
  ],
  EMAIL_ESCALACAO: 'everton.medeiros@modestogrowth.com.br',
  NOME_ESCALACAO: 'Everton',

  // Estrutura da planilha de pacing
  ABA_PAINEL: 'PAINEL',
  ABA_LOG: 'LOG DE ALTERACOES',
  ABAS_IGNORAR: ['INSTRUCOES', 'PAINEL', 'LOG DE ALTERACOES'],

  // Limites (Índice de pacing = % budget consumido / % do mês decorrido)
  LIMITES: {
    VERDE_MIN: 0.95,
    VERDE_MAX: 1.05,
    AMARELO_MIN: 0.85,
    AMARELO_MAX: 1.15,
    CREDITO_MAX: 1.05,        // conta com crédito da agência: acima disso já é crítico
    TRAVA_97: 0.97,           // regra dos 97% do budget contratado
    MULT_GASTO_DIARIO: 2.0,   // gasto do dia acima de 2x o planejado dispara alerta
    CPA_TOLERANCIA: 1.15      // CPA realizado acima de 115% da meta é crítico
  },
  LOG_VARIACAO_PCT: 0.20,
  LOG_VARIACAO_RS: 1000,

  ASSUNTO_PREFIXO: '[Pacing]',
  FUSO: 'America/Sao_Paulo'
};

const NIVEL = { CRITICO: 'CRITICO', ATENCAO: 'ATENCAO', INFO: 'INFO' };

// ---------------------------------------------------------------------
//  PONTOS DE ENTRADA
// ---------------------------------------------------------------------

/** Cria o gatilho diário (8h-9h Brasília). Rode uma vez. */
function instalarGatilho() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'rodarAlertas')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('rodarAlertas')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone(CONFIG.FUSO)
    .create();
  Logger.log('Gatilho instalado: rodarAlertas todo dia entre 8h e 9h (%s).', CONFIG.FUSO);
}

/** Execução normal (gatilho ou menu). */
function rodarAlertas() {
  executar_({ teste: false });
}

/** Execução de teste: só e-mail para quem está rodando, sem Slack, sem gravar estado. */
function testarAlertas() {
  executar_({ teste: true });
}

/** Menu na planilha. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Alertas de Pacing')
    .addItem('Rodar alertas agora', 'rodarAlertas')
    .addItem('Testar (só para mim, sem Slack)', 'testarAlertas')
    .addItem('Sincronizar budgets da planilha externa', 'sincronizarBudgets')
    .addToUi();
}

// ---------------------------------------------------------------------
//  FLUXO PRINCIPAL
// ---------------------------------------------------------------------
function executar_(opts) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const datas = calcularDatas_();
  const alertas = [];

  // 0. Ingestão da coleta do agente das 7:30 (arquivo ingestao.gs).
  //    Vem antes de tudo: analisar sem lançar o dia de ontem seria analisar
  //    dado velho e mandar alerta defasado como se fosse de hoje.
  //
  //    FORA do modo teste, de propósito. O menu promete "Testar (só para mim,
  //    sem Slack)", e quem clica não espera que a planilha seja escrita. Pior:
  //    a ingestão marca o JSON como processado, então um teste inocente faria
  //    a execução real das 8h não achar mais o arquivo e alertar que a coleta
  //    não chegou. Teste que consome o insumo da execução de verdade não é
  //    teste.
  if (!opts.teste) {
    importarPacingDoDrive_(ss, datas, alertas);
    SpreadsheetApp.flush();
  }

  // 1. Budgets externos + sincronização
  let orcamentos = {};
  try {
    orcamentos = lerOrcamentosExternos_();
    if (CONFIG.SINCRONIZAR_BUDGETS) {
      const res = aplicarBudgets_(ss, orcamentos);
      res.avisos.forEach(a => alertas.push(a));
    }
  } catch (e) {
    alertas.push(alerta_(NIVEL.ATENCAO, 'GERAL', 'Planilha de orçamento não lida',
      'Erro ao abrir a planilha externa de orçamento: ' + e.message + '. Os budgets usados foram os que já estavam nas abas.',
      'orc_erro'));
  }
  SpreadsheetApp.flush();

  // 2. PAINEL
  const painel = lerPainel_(ss, datas, alertas);

  // 3. Análise por conta
  painel.contas.forEach(c => analisarConta_(ss, c, datas, orcamentos, alertas));

  // 4. Log de alterações sem aprovação
  verificarLog_(ss, datas, alertas);

  // 5. Estado (novo x persistente) e envio
  const estado = opts.teste ? {} : carregarEstado_();
  marcarPersistencia_(alertas, estado, datas);
  if (!opts.teste) salvarEstado_(alertas, estado, datas);

  // 6. A aba ALERTAS é a FILA de envio, não o histórico do que já saiu.
  //    Escreve, lê de volta e manda o que a aba disser. Numa execução manual
  //    isso dá a chance de abrir a aba, marcar "não" na coluna Enviar de uma
  //    linha, e ela não chega no time.
  let paraEnviar = alertas;
  if (!opts.teste) {
    escreverAbaAlertas_(ss, alertas, datas);
    SpreadsheetApp.flush();
    paraEnviar = lerAbaAlertas_(ss, datas);
  }

  enviar_(paraEnviar, painel, datas, opts);

  // 7. Carimba o horário do envio. `paraEnviar` pode ter ganhado um alerta
  //    durante o próprio envio (falha de Slack), e ele entra na aba aqui.
  if (!opts.teste) marcarEnviados_(ss, datas, paraEnviar);
}

// ---------------------------------------------------------------------
//  DATAS
// ---------------------------------------------------------------------
function calcularDatas_() {
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 24 * 60 * 60 * 1000);
  const diaOntem = parseInt(Utilities.formatDate(ontem, CONFIG.FUSO, 'd'), 10);
  const mes = parseInt(Utilities.formatDate(ontem, CONFIG.FUSO, 'M'), 10);
  const ano = parseInt(Utilities.formatDate(ontem, CONFIG.FUSO, 'yyyy'), 10);
  const diasNoMes = new Date(ano, mes, 0).getDate();
  return {
    hoje: hoje,
    ontem: ontem,
    diaOntem: diaOntem,
    mes: mes,
    ano: ano,
    diasNoMes: diasNoMes,
    diasDecorridos: diaOntem,
    diasRestantes: diasNoMes - diaOntem,
    pctMes: diaOntem / diasNoMes,
    labelOntem: Utilities.formatDate(ontem, CONFIG.FUSO, 'dd/MM/yyyy'),
    labelHoje: Utilities.formatDate(hoje, CONFIG.FUSO, 'dd/MM/yyyy'),
    labelMes: Utilities.formatDate(ontem, CONFIG.FUSO, 'MM/yyyy')
  };
}

// ---------------------------------------------------------------------
//  ORÇAMENTO EXTERNO
// ---------------------------------------------------------------------
function lerOrcamentosExternos_() {
  const ext = SpreadsheetApp.openById(CONFIG.PLANILHA_ORCAMENTO_ID);
  const aba = ext.getSheetByName(CONFIG.ABA_ORCAMENTO) || ext.getSheets()[0];
  const dados = aba.getDataRange().getValues();
  if (dados.length < 2) return {};

  const cab = dados[0].map(h => normalizar_(h));
  const idx = {
    cliente: acharColuna_(cab, ['cliente']),
    google: acharColuna_(cab, ['google']),
    meta: acharColuna_(cab, ['meta ads', 'orcamento meta']),
    pinterest: acharColuna_(cab, ['pinterest']),
    teto: acharColuna_(cab, ['teto']),
    metaCpa: acharColuna_(cab, ['meta cpa', 'cpa']),
    metaRoas: acharColuna_(cab, ['meta roas', 'roas'])
  };
  const mapa = {};
  for (let i = 1; i < dados.length; i++) {
    const nome = String(dados[i][idx.cliente] || '').trim();
    if (!nome) continue;
    mapa[normalizar_(nome)] = {
      nome: nome,
      google: num_(idx.google >= 0 ? dados[i][idx.google] : null),
      meta: num_(idx.meta >= 0 ? dados[i][idx.meta] : null),
      pinterest: num_(idx.pinterest >= 0 ? dados[i][idx.pinterest] : null),
      teto: num_(idx.teto >= 0 ? dados[i][idx.teto] : null),
      metaCpa: num_(idx.metaCpa >= 0 ? dados[i][idx.metaCpa] : null),
      metaRoas: num_(idx.metaRoas >= 0 ? dados[i][idx.metaRoas] : null)
    };
  }
  return mapa;
}

/** Menu: sincroniza budgets e mostra o resultado. */
function sincronizarBudgets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const res = aplicarBudgets_(ss, lerOrcamentosExternos_());
  SpreadsheetApp.getUi().alert('Budgets sincronizados: ' + res.atualizados + ' célula(s) alterada(s).' +
    (res.avisos.length ? '\n\nAvisos:\n' + res.avisos.map(a => '- ' + a.titulo + ': ' + a.detalhe).join('\n') : ''));
}

/** Escreve budget da planilha externa em B6/C6/(D6) de cada aba de conta. Só altera se diferente. */
function aplicarBudgets_(ss, orcamentos) {
  const res = { atualizados: 0, avisos: [] };
  const abasConta = listarAbasConta_(ss);
  const usados = {};

  abasConta.forEach(aba => {
    const chave = normalizar_(aba.getName());
    const orc = orcamentos[chave];
    if (!orc) return;
    usados[chave] = true;

    const veiculos = lerVeiculos_(aba); // [{nome, col}]
    veiculos.forEach(v => {
      let valor = null;
      const n = normalizar_(v.nome);
      if (n.indexOf('google') >= 0) valor = orc.google;
      else if (n.indexOf('meta') >= 0) valor = orc.meta;
      else if (n.indexOf('pinterest') >= 0) valor = orc.pinterest;
      if (valor === null) return;
      const cel = aba.getRange(6, v.col);
      const atual = num_(cel.getValue());
      if (atual !== valor) {
        cel.setValue(valor);
        res.atualizados++;
      }
    });

    // Meta de ROAS e CPA (linhas 25 e 23), se vierem da planilha externa
    if (orc.metaRoas !== null && orc.metaRoas > 0) {
      veiculos.forEach(v => {
        const cel = aba.getRange(25, v.col);
        if (num_(cel.getValue()) !== orc.metaRoas) { cel.setValue(orc.metaRoas); res.atualizados++; }
      });
    }
    if (orc.metaCpa !== null && orc.metaCpa > 0) {
      veiculos.forEach(v => {
        const cel = aba.getRange(23, v.col);
        if (num_(cel.getValue()) !== orc.metaCpa) { cel.setValue(orc.metaCpa); res.atualizados++; }
      });
    }
  });

  Object.keys(orcamentos).forEach(k => {
    if (!usados[k]) {
      res.avisos.push(alerta_(NIVEL.INFO, 'GERAL', 'Cliente sem aba correspondente',
        'O cliente "' + orcamentos[k].nome + '" está na planilha de orçamento, mas não existe aba com esse nome na planilha de pacing.',
        'orc_sem_aba_' + k));
    }
  });
  return res;
}

// ---------------------------------------------------------------------
//  LEITURA DO PAINEL
// ---------------------------------------------------------------------
function lerPainel_(ss, datas, alertas) {
  const aba = ss.getSheetByName(CONFIG.ABA_PAINEL);
  if (!aba) throw new Error('Aba PAINEL não encontrada.');
  const dados = aba.getDataRange().getValues();

  // Localiza a linha de cabeçalho (coluna A = "Cliente")
  let linhaCab = -1;
  for (let i = 0; i < dados.length; i++) {
    if (normalizar_(dados[i][0]) === 'cliente') { linhaCab = i; break; }
  }
  if (linhaCab < 0) throw new Error('Cabeçalho "Cliente" não encontrado no PAINEL.');

  const contas = [];
  for (let i = linhaCab + 1; i < dados.length; i++) {
    const r = dados[i];
    const nome = String(r[0] || '').trim();
    if (!nome) continue;
    if (normalizar_(nome).indexOf('total') === 0) break;
    contas.push({
      nome: nome,
      veiculosTxt: String(r[1] || ''),
      tipoVerba: String(r[2] || ''),
      responsavel: String(r[3] || ''),
      budget: num_(r[4]) || 0,
      investido: num_(r[5]) || 0,
      indicePainel: num_(r[7]),
      statusPacingPainel: String(r[11] || ''),
      metaReceita: num_(r[12]) || 0,
      receita: num_(r[13]) || 0,
      pctMeta: num_(r[14]),
      projReceita: num_(r[15]) || 0,
      gapReceita: num_(r[16]) || 0,
      roas: num_(r[17]) || 0,
      cpa: num_(r[18]) || 0,
      statusNegocio: String(r[19] || ''),
      credito: normalizar_(r[2]).indexOf('credito') >= 0,
      porCpa: normalizar_(r[2]).indexOf('cpa') >= 0
    });
  }

  // Sanidade: dias decorridos do PAINEL x calendário real
  const diasPainel = num_(aba.getRange('B6').getValue());
  const diasMesPainel = num_(aba.getRange('B5').getValue());
  if (diasPainel !== null && diasPainel !== datas.diasDecorridos) {
    alertas.push(alerta_(NIVEL.ATENCAO, 'PAINEL', 'Dias decorridos divergem do calendário',
      'PAINEL!B6 mostra ' + diasPainel + ', mas o dia anterior fechado é ' + datas.diaOntem + '/' + datas.mes +
      '. Todos os índices da planilha dependem dessa célula. Os alertas abaixo usam o calendário real (' +
      datas.diasDecorridos + ' de ' + datas.diasNoMes + ' dias).',
      'painel_dias'));
  }
  if (diasMesPainel !== null && diasMesPainel !== datas.diasNoMes) {
    alertas.push(alerta_(NIVEL.ATENCAO, 'PAINEL', 'Dias no mês divergem do calendário',
      'PAINEL!B5 mostra ' + diasMesPainel + ' e o mês ' + datas.labelMes + ' tem ' + datas.diasNoMes + ' dias.',
      'painel_diasmes'));
  }
  return { contas: contas };
}

// ---------------------------------------------------------------------
//  ANÁLISE POR CONTA
// ---------------------------------------------------------------------
function analisarConta_(ss, c, datas, orcamentos, alertas) {
  const L = CONFIG.LIMITES;
  const aba = ss.getSheetByName(c.nome);
  if (!aba) {
    alertas.push(alerta_(NIVEL.ATENCAO, c.nome, 'Aba da conta não encontrada',
      'O PAINEL lista "' + c.nome + '" mas não existe aba com esse nome. Verifique o nome da aba.', 'sem_aba_' + c.nome));
    return;
  }
  const orc = orcamentos[normalizar_(c.nome)] || null;
  const veiculos = lerVeiculos_(aba);
  const tag = c.credito ? ' [CRÉDITO DA AGÊNCIA]' : '';

  // ---------- Dados por veículo ----------
  const col36 = aba.getRange(36, 1, 1, aba.getLastColumn()).getValues()[0];
  const colsPlanejado = [], colsRealizado = [];
  col36.forEach((h, i) => {
    const n = normalizar_(h);
    if (n === 'inv. planejado' || n === 'inv planejado') colsPlanejado.push(i + 1);
    if (n === 'inv. realizado' || n === 'inv realizado') colsRealizado.push(i + 1);
  });
  const linhaOntem = 36 + datas.diaOntem;
  const diaNaLinha = num_(aba.getRange(linhaOntem, 1).getValue());

  const recomendacoes = aba.getRange(31, 1, 6, 6).getValues(); // A31:F36

  // O e-mail mostra uma linha por veículo, então o detalhe precisa sobreviver
  // a esta função em vez de virar só alerta.
  c.veiculos = [];

  veiculos.forEach((v, k) => {
    const budget = num_(aba.getRange(6, v.col).getValue()) || 0;
    const investido = num_(aba.getRange(7, v.col).getValue()) || 0;
    const metaCpa = num_(aba.getRange(23, v.col).getValue()) || 0;
    const cpa = num_(aba.getRange(24, v.col).getValue()) || 0;
    const metaRoas = num_(aba.getRange(25, v.col).getValue()) || 0;
    const roas = num_(aba.getRange(26, v.col).getValue()) || 0;
    const rotulo = c.nome + ' / ' + v.nome;
    const chaveBase = c.nome + '|' + v.nome;

    c.veiculos.push({
      nome: v.nome,
      budget: budget,
      investido: investido,
      metaReceita: num_(aba.getRange(18, v.col).getValue()) || 0,
      receita: num_(aba.getRange(19, v.col).getValue()) || 0,
      metaCpa: metaCpa, cpa: cpa, metaRoas: metaRoas, roas: roas,
      idx: budget > 0 ? (investido / budget) / datas.pctMes : null,
      proj: budget > 0 ? investido / datas.diasDecorridos * datas.diasNoMes : null,
      ritmo: (budget > 0 && datas.diasRestantes > 0) ? (budget - investido) / datas.diasRestantes : null
    });

    // Pacing por veículo
    if (budget > 0) {
      const idx = (investido / budget) / datas.pctMes;
      const proj = investido / datas.diasDecorridos * datas.diasNoMes;
      const desvio = proj - budget;
      const ritmo = datas.diasRestantes > 0 ? (budget - investido) / datas.diasRestantes : 0;
      const det = 'Índice ' + idx.toFixed(2) + ' | consumido ' + pct_(investido / budget) + ' vs ' + pct_(datas.pctMes) +
        ' do mês | investido ' + brl_(investido) + ' de ' + brl_(budget) + ' | projeção ' + brl_(proj) +
        ' (' + (desvio >= 0 ? '+' : '') + brl_(desvio) + ') | ritmo necessário ' + brl_(ritmo) + '/dia';

      if (idx < L.AMARELO_MIN || idx > L.AMARELO_MAX) {
        alertas.push(alerta_(NIVEL.CRITICO, c.nome, 'FORA DE PACING' + tag + ': ' + rotulo, det, chaveBase + '|pacing'));
      } else if (c.credito && idx > L.CREDITO_MAX) {
        alertas.push(alerta_(NIVEL.CRITICO, c.nome, 'ACIMA DO RITMO EM CONTA DE CRÉDITO: ' + rotulo,
          det + '. Estouro projetado de ' + brl_(desvio) + ' é prejuízo da Modesto.', chaveBase + '|pacing'));
      } else if (idx < L.VERDE_MIN || idx > L.VERDE_MAX) {
        alertas.push(alerta_(NIVEL.ATENCAO, c.nome, 'Atenção no pacing' + tag + ': ' + rotulo, det, chaveBase + '|pacing'));
      }

      if (c.credito && investido / budget >= L.TRAVA_97 && datas.diasRestantes > 0) {
        alertas.push(alerta_(NIVEL.CRITICO, c.nome, 'REGRA DOS 97% ATINGIDA: ' + rotulo,
          'Consumido ' + pct_(investido / budget) + ' do budget com ' + datas.diasRestantes +
          ' dia(s) restantes. Confirme a trava de gastos na plataforma agora.', chaveBase + '|97'));
      }

      // Anomalia do dia anterior
      if (colsRealizado[k] && diaNaLinha === datas.diaOntem) {
        const real = aba.getRange(linhaOntem, colsRealizado[k]).getValue();
        const plan = colsPlanejado[k] ? num_(aba.getRange(linhaOntem, colsPlanejado[k]).getValue()) : null;
        if (real === '' || real === null) {
          alertas.push(alerta_(NIVEL.CRITICO, c.nome, 'DADO NÃO LANÇADO: ' + rotulo,
            'Investimento realizado de ' + datas.labelOntem + ' está vazio. O índice de pacing desta conta está subestimado até o lançamento.',
            chaveBase + '|semdado'));
        } else {
          const realN = num_(real) || 0;
          if (realN === 0) {
            alertas.push(alerta_(NIVEL.CRITICO, c.nome, 'GASTO ZERO: ' + rotulo,
              'Investimento realizado em ' + datas.labelOntem + ' foi R$ 0,00 com budget ativo. Verifique campanha pausada, cartão recusado ou limite atingido.',
              chaveBase + '|zero'));
          } else if (plan && plan > 0 && realN > plan * L.MULT_GASTO_DIARIO) {
            alertas.push(alerta_(c.credito ? NIVEL.CRITICO : NIVEL.ATENCAO, c.nome, 'Gasto diário acima de 2x o planejado: ' + rotulo,
              'Realizado ' + brl_(realN) + ' em ' + datas.labelOntem + ' vs planejado ' + brl_(plan) + ' (' + (realN / plan).toFixed(1) + 'x). Armadilha do orçamento diário.',
              chaveBase + '|2x'));
          }
        }
      }
    }

    // ROAS por veículo
    if (metaRoas > 0 && investido > 0 && roas < metaRoas) {
      alertas.push(alerta_(NIVEL.ATENCAO, c.nome, 'ROAS abaixo da meta: ' + rotulo,
        'ROAS ' + roas.toFixed(2) + ' vs meta ' + metaRoas.toFixed(2) + ' (' + (roas - metaRoas).toFixed(2) + ').', chaveBase + '|roas'));
    }

    // CPA por veículo (contas por CPA ou qualquer conta com meta de CPA preenchida)
    if (metaCpa > 0 && cpa > 0) {
      if (cpa > metaCpa * L.CPA_TOLERANCIA) {
        alertas.push(alerta_(NIVEL.CRITICO, c.nome, 'CPA ESTOURADO: ' + rotulo,
          'CPA ' + brl_(cpa) + ' vs meta ' + brl_(metaCpa) + ' (' + pct_(cpa / metaCpa - 1) + ' acima).', chaveBase + '|cpa'));
      } else if (cpa > metaCpa) {
        alertas.push(alerta_(NIVEL.ATENCAO, c.nome, 'CPA acima da meta: ' + rotulo,
          'CPA ' + brl_(cpa) + ' vs meta ' + brl_(metaCpa) + ' (' + pct_(cpa / metaCpa - 1) + ' acima).', chaveBase + '|cpa'));
      }
    }

    // Recomendação de realocação (F31/F32)
    for (let r = 0; r < recomendacoes.length; r++) {
      if (normalizar_(recomendacoes[r][0]) === normalizar_(v.nome)) {
        const rec = String(recomendacoes[r][5] || '');
        const recN = normalizar_(rec);
        if (recN.indexOf('reduzir') === 0 || recN.indexOf('receber') === 0) {
          alertas.push(alerta_(NIVEL.INFO, c.nome, 'Realocação: ' + rotulo, rec, chaveBase + '|realoc'));
        }
        break;
      }
    }
  });

  // ---------- Conta consolidada ----------
  if (c.budget > 0) {
    const idx = (c.investido / c.budget) / datas.pctMes;
    if (c.indicePainel !== null && c.indicePainel > 0 && Math.abs(c.indicePainel - idx) > 0.02) {
      alertas.push(alerta_(NIVEL.INFO, c.nome, 'Índice do PAINEL diverge do calculado',
        'PAINEL mostra ' + c.indicePainel.toFixed(2) + ' e o cálculo pelo calendário dá ' + idx.toFixed(2) + '. Provável causa: PAINEL!B5/B6.',
        c.nome + '|idxdiv'));
    }
  } else if (!c.porCpa) {
    alertas.push(alerta_(NIVEL.ATENCAO, c.nome, 'Budget do mês não preenchido',
      'Sem budget não há índice de pacing. Preencha na planilha de orçamento por cliente.', c.nome + '|sembudget'));
  }

  // Contas por CPA: teto de gastos
  if (c.porCpa) {
    const teto = orc && orc.teto ? orc.teto : 0;
    if (teto > 0) {
      const idxTeto = (c.investido / teto) / datas.pctMes;
      const proj = c.investido / datas.diasDecorridos * datas.diasNoMes;
      if (c.investido / teto >= L.TRAVA_97 && datas.diasRestantes > 0) {
        alertas.push(alerta_(NIVEL.CRITICO, c.nome, 'TETO DE GASTOS ATINGIDO (97%)' + tag,
          'Investido ' + brl_(c.investido) + ' de teto ' + brl_(teto) + ' com ' + datas.diasRestantes + ' dia(s) restantes.', c.nome + '|teto97'));
      } else if (idxTeto > 1.0) {
        alertas.push(alerta_(NIVEL.CRITICO, c.nome, 'RITMO ACIMA DO TETO DE GASTOS' + tag,
          'Projeção de fechamento ' + brl_(proj) + ' vs teto ' + brl_(teto) + ' (' + (idxTeto).toFixed(2) + 'x o ritmo).', c.nome + '|tetoritmo'));
      }
    } else {
      alertas.push(alerta_(NIVEL.ATENCAO, c.nome, 'Conta por CPA sem teto de gastos',
        'Sem "Teto de gastos" na planilha de orçamento não é possível alertar estouro. Limite na plataforma é obrigatório para esta conta.',
        c.nome + '|semteto'));
    }
  }

  // Negócio (meta de receita)
  if (c.metaReceita > 0) {
    const sn = normalizar_(c.statusNegocio);
    if (sn.indexOf('abaixo') >= 0) {
      alertas.push(alerta_(NIVEL.ATENCAO, c.nome, 'Receita abaixo da meta',
        pct_(c.pctMeta || 0) + ' da meta com ' + pct_(datas.pctMes) + ' do mês | receita ' + brl_(c.receita) + ' de ' + brl_(c.metaReceita) +
        ' | projeção ' + brl_(c.projReceita) + ' | gap ' + brl_(c.gapReceita) + ' | ROAS ' + c.roas.toFixed(2), c.nome + '|negocio'));
    }
  } else if (c.receita > 0) {
    alertas.push(alerta_(NIVEL.INFO, c.nome, 'Meta de ROAS/receita não preenchida',
      'A conta gera receita mas a meta de ROAS está em 0, então a recomendação de realocação sai como "preencher meta". Preencha na planilha de orçamento.',
      c.nome + '|semmeta'));
  }
}

// ---------------------------------------------------------------------
//  LOG DE ALTERAÇÕES
// ---------------------------------------------------------------------
function verificarLog_(ss, datas, alertas) {
  const aba = ss.getSheetByName(CONFIG.ABA_LOG);
  if (!aba) return;
  const dados = aba.getDataRange().getValues();
  for (let i = 4; i < dados.length; i++) { // linha 5 em diante
    const r = dados[i];
    const data = r[0];
    if (!(data instanceof Date)) continue;
    if (data.getMonth() + 1 !== datas.mes || data.getFullYear() !== datas.ano) continue;
    const ant = num_(r[5]) || 0, novo = num_(r[6]) || 0;
    const varPct = ant > 0 ? Math.abs(novo / ant - 1) : 1;
    const varRs = Math.abs(novo - ant);
    const aprovador = String(r[10] || '').trim();
    if ((varPct > CONFIG.LOG_VARIACAO_PCT || varRs > CONFIG.LOG_VARIACAO_RS) && !aprovador) {
      alertas.push(alerta_(NIVEL.ATENCAO, String(r[2] || 'LOG'), 'Alteração de orçamento sem aprovador',
        Utilities.formatDate(data, CONFIG.FUSO, 'dd/MM') + ' ' + (r[3] || '') + ' ' + (r[4] || '') + ': ' + brl_(ant) + ' > ' + brl_(novo) +
        ' (' + pct_(varPct) + '). Acima de 20% ou R$ 1.000 exige segunda pessoa aprovando. Quem alterou: ' + (r[9] || 'não informado') + '.',
        'log_' + (i + 1)));
    }
  }
}

// ---------------------------------------------------------------------
//  ESTADO (novo x persistente)
// ---------------------------------------------------------------------
function carregarEstado_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('ESTADO_ALERTAS') || '{}'); }
  catch (e) { return {}; }
}
function salvarEstado_(alertas, estado, datas) {
  const novo = {};
  alertas.forEach(a => { novo[a.chave] = estado[a.chave] || datas.labelHoje; });
  PropertiesService.getScriptProperties().setProperty('ESTADO_ALERTAS', JSON.stringify(novo));
}
function marcarPersistencia_(alertas, estado, datas) {
  alertas.forEach(a => {
    const primeira = estado[a.chave];
    if (!primeira) { a.persistencia = 'NOVO'; return; }
    const p = primeira.split('/');
    const d0 = new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
    const dias = Math.round((datas.hoje - d0) / 86400000);
    a.persistencia = dias <= 0 ? 'NOVO' : 'persiste há ' + dias + ' dia(s)';
  });
}

// ---------------------------------------------------------------------
//  ENVIO
// ---------------------------------------------------------------------
function enviar_(alertas, painel, datas, opts) {
  const crit = alertas.filter(a => a.nivel === NIVEL.CRITICO);
  const aten = alertas.filter(a => a.nivel === NIVEL.ATENCAO);
  const info = alertas.filter(a => a.nivel === NIVEL.INFO);
  const resumo = crit.length + ' crítico(s), ' + aten.length + ' atenção, ' + info.length + ' info';
  const assuntoBase = CONFIG.ASSUNTO_PREFIXO + ' ' + datas.labelOntem + ' | ' + resumo;
  const urlPlanilha = SpreadsheetApp.getActiveSpreadsheet().getUrl();

  // ---- E-mail resumo diário (time inteiro)
  const html = montarHtml_(crit, aten, info, painel, datas, urlPlanilha);
  const destinatarios = opts.teste ? Session.getEffectiveUser().getEmail() : CONFIG.EMAILS_TIME.join(',');
  MailApp.sendEmail({
    to: destinatarios,
    subject: (opts.teste ? '[TESTE] ' : '') + (crit.length ? '🔴 ' : aten.length ? '🟡 ' : '🟢 ') + assuntoBase,
    htmlBody: html,
    name: 'Controle de Pacing | Modesto Growth'
  });

  // ---- E-mail só de críticos para o Everton
  if (crit.length && !opts.teste) {
    MailApp.sendEmail({
      to: CONFIG.EMAIL_ESCALACAO,
      subject: '🔴 ESCALAÇÃO ' + CONFIG.ASSUNTO_PREFIXO + ' ' + datas.labelOntem + ' | ' + crit.length + ' crítico(s) para ação hoje',
      htmlBody: montarHtml_(crit, [], [], painel, datas, urlPlanilha, true),
      name: 'Controle de Pacing | Modesto Growth'
    });
  }

  // ---- Slack
  if (opts.teste) { Logger.log('TESTE: Slack não enviado.\n' + montarTextoSlack_(crit, aten, info, datas, urlPlanilha).join('\n')); return; }
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('SLACK_BOT_TOKEN');
  const evertonId = props.getProperty('SLACK_EVERTON_ID');
  const blocosCanal = montarTextoSlack_(crit, aten, info, datas, urlPlanilha);

  // Webhook, com reserva no bot token, e falha vira alerta em vez de linha no
  // Logger. Canal de alerta que falha calado é o próprio problema que o canal
  // existia para evitar. Ver postarNoCanalPacing_ em ingestao.gs.
  postarNoCanalPacing_(blocosCanal, alertas);
  if (token && evertonId && crit.length) {
    const dm = montarTextoSlack_(crit, [], [], datas, urlPlanilha, true);
    dm.forEach(txt => postSlackApi_(token, evertonId, txt));
  }
}

function postSlack_(webhook, payload) {
  const r = UrlFetchApp.fetch(webhook, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (r.getResponseCode() >= 300) Logger.log('Slack webhook erro %s: %s', r.getResponseCode(), r.getContentText());
}
function postSlackApi_(token, channel, text) {
  const r = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post', contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ channel: channel, text: text }), muteHttpExceptions: true
  });
  const body = r.getContentText();
  if (body.indexOf('"ok":true') < 0) Logger.log('Slack API erro: %s', body);
}

// ---------------------------------------------------------------------
//  FORMATAÇÃO DAS MENSAGENS
// ---------------------------------------------------------------------
/**
 * E-mail no padrão visual da Modesto: fundo bege, cabeçalho preto com filete
 * dourado, uma linha por veículo.
 *
 * O número sozinho não decide nada. Cada célula mostra realizado sobre meta e
 * a bolinha diz se está dentro, perto ou fora, para o leitor conseguir varrer
 * a tabela sem fazer conta de cabeça.
 */
function montarHtml_(crit, aten, info, painel, datas, url, soCriticos) {
  const C = {
    verde: '#2E7D4F', amarelo: '#C48A00', vermelho: '#B3261E', ouro: '#C9A227',
    preto: '#1A1A18', texto: '#4A4A46', fraco: '#9A978F', bege: '#F0EDE6',
    linha: '#E2DDD3', sub: '#BDB9B0'
  };
  const L = CONFIG.LIMITES;

  function curto(v) {
    v = Number(v) || 0;
    if (Math.abs(v) >= 1000) return 'R$ ' + (v / 1000).toFixed(1).replace('.', ',') + 'k';
    return brl_(v);
  }
  function corIndice(idx, credito) {
    if (idx === null) return null;
    if (idx < L.AMARELO_MIN || idx > L.AMARELO_MAX) return C.vermelho;
    if (credito && idx > L.CREDITO_MAX) return C.vermelho;
    if (idx < L.VERDE_MIN || idx > L.VERDE_MAX) return C.amarelo;
    return C.verde;
  }
  // Maior é melhor em receita e ROAS; em CPA é o contrário.
  function corMeta(real, meta, maiorMelhor) {
    if (!meta) return null;
    const r = maiorMelhor ? real / meta : meta / real;
    if (!isFinite(r) || r <= 0) return C.vermelho;
    if (r >= 0.95) return C.verde;
    if (r >= 0.85) return C.amarelo;
    return C.vermelho;
  }
  function vazio() {
    return '<td style="text-align:right;padding:10px 6px;border-bottom:1px solid ' + C.linha +
           ';color:' + C.fraco + '">&mdash;</td>';
  }
  function celula(cor, valor, meta, nota) {
    let h = '<td style="text-align:right;padding:10px 6px;border-bottom:1px solid ' + C.linha + ';white-space:nowrap">';
    if (cor) h += '<span style="color:' + cor + ';font-size:15px">&#9679;</span> ';
    h += '<b style="color:' + (cor === C.vermelho ? C.vermelho : C.preto) + '">' + valor;
    if (meta) h += '<span style="font-weight:normal;color:' + C.fraco + '"> / ' + meta + '</span>';
    h += '</b>';
    if (nota) h += '<br><span style="font-size:11px;color:' + (cor || C.fraco) + '">' + nota + '</span>';
    return h + '</td>';
  }
  function secao(titulo, fundo) {
    return '<tr><td style="background:' + (fundo || '#fff') + ';padding:18px 30px 6px 30px">' +
      '<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:' + C.ouro +
      ';font-weight:bold">' + titulo + '</div></td></tr>';
  }

  // ---- contagem por veículo, que é a unidade que o time trata
  let noRitmo = 0, comAjuste = 0, foraDoPacing = 0;
  painel.contas.forEach(function (c) {
    (c.veiculos || []).forEach(function (v) {
      const cor = corIndice(v.idx, c.credito);
      if (cor === C.verde) noRitmo++;
      else if (cor === C.amarelo) comAjuste++;
      else if (cor === C.vermelho) foraDoPacing++;
    });
  });

  let h = '<div style="background:' + C.bege + ';padding:28px 0;font-family:Inter,\'Helvetica Neue\',Arial,sans-serif;color:' + C.preto + '">';
  h += '<table width="820" align="center" cellpadding="0" cellspacing="0" style="border-collapse:collapse">';

  // ---- cabeçalho
  h += '<tr><td style="background:' + C.preto + ';padding:26px 30px;border-bottom:3px solid ' + C.ouro + '">';
  h += '<div style="font-size:11px;letter-spacing:2px;color:' + C.ouro + ';text-transform:uppercase">Modesto Growth Partners &middot; Controle de mídia</div>';
  h += '<div style="font-family:\'Playfair Display\',Georgia,\'Times New Roman\',serif;font-size:26px;color:#fff;margin-top:6px">' +
       (soCriticos ? 'Escalação para ' + esc_(CONFIG.NOME_ESCALACAO) : 'Alerta de pacing') + '</div>';
  h += '<div style="font-size:12px;color:' + C.sub + ';margin-top:6px">Dados fechados de ' + datas.labelOntem +
       ' &middot; dia ' + datas.diasDecorridos + ' de ' + datas.diasNoMes + ' (' + pct_(datas.pctMes) + ' do mês) &middot; ' +
       '<a href="' + url + '" style="color:' + C.ouro + ';text-decoration:none">abrir planilha &#8599;</a></div>';
  h += '</td></tr>';

  // ---- resumo
  h += '<tr><td style="background:#fff;padding:14px 30px;border-bottom:1px solid ' + C.linha + ';font-size:13px">';
  h += '<span style="color:' + C.verde + ';font-weight:bold">&#9679; ' + noRitmo + '</span> no ritmo &nbsp;&nbsp;&nbsp;';
  h += '<span style="color:' + C.amarelo + ';font-weight:bold">&#9679; ' + comAjuste + '</span> com ajuste &nbsp;&nbsp;&nbsp;';
  h += '<span style="color:' + C.vermelho + ';font-weight:bold">&#9679; ' + foraDoPacing + '</span> fora do pacing &nbsp;&nbsp;&nbsp;';
  h += '<span style="color:' + C.fraco + '">' + crit.length + ' crítico(s) &middot; ' + aten.length + ' atenção</span>';
  h += '</td></tr>';

  // ---- ação hoje
  const acoes = soCriticos ? crit : crit.concat(aten);
  h += secao('Ação hoje');
  if (!acoes.length) {
    h += '<tr><td style="background:#fff;padding:6px 30px;border-bottom:1px solid ' + C.linha + ';font-size:13px;color:' + C.texto + '">Carteira no ritmo. Nenhum ajuste necessário hoje.</td></tr>';
  }
  acoes.forEach(function (a) {
    const cor = a.nivel === NIVEL.CRITICO ? C.vermelho : C.amarelo;
    const partes = String(a.titulo).split(': ');
    const alvo = partes.length > 1 ? partes.slice(1).join(': ') : a.conta;
    const desc = partes[0];
    h += '<tr><td style="background:#fff;padding:6px 30px;border-bottom:1px solid ' + C.linha + ';font-size:13px">';
    h += '<span style="color:' + cor + '">&#9679;</span> <b>' + esc_(alvo.replace(' / ', ' · ')) + '</b> ';
    h += '<span style="color:' + C.texto + '">' + esc_(desc.toLowerCase()) + '. ' + esc_(a.detalhe) + '</span>';
    if (a.persistencia && a.persistencia !== 'NOVO') {
      h += ' <span style="font-size:11px;color:' + C.fraco + '">(' + esc_(a.persistencia) + ')</span>';
    }
    h += '</td></tr>';
  });

  if (soCriticos) {
    h += '<tr><td style="background:#fff;padding:14px 30px;font-size:10px;color:' + C.fraco + ';border-top:1px solid ' + C.linha + '">Escalação automática. O resumo completo da carteira foi enviado ao time.</td></tr>';
    return h + '</table></div>';
  }

  // ---- tabela de contas
  h += secao('Contas');
  h += '<tr><td style="background:#fff;padding:0 30px 20px 30px">';
  h += '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px"><tr>';
  ['Conta', 'Plataforma', 'Investimento', 'Receita', 'ROAS', 'CPA'].forEach(function (t, i) {
    h += '<th style="text-align:' + (i < 2 ? 'left' : 'right') + ';font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:' +
         C.texto + ';padding:8px 6px;border-bottom:2px solid ' + C.preto + '">' + t + '</th>';
  });
  h += '</tr>';

  const faltando = [];
  painel.contas.forEach(function (c) {
    const veics = c.veiculos || [];
    if (!veics.length) return;
    veics.forEach(function (v, i) {
      const rot = c.nome + ' &middot; ' + esc_(v.nome);
      const gaps = [];
      h += '<tr><td style="padding:10px 6px;border-bottom:1px solid ' + C.linha + ';white-space:nowrap">';
      if (i === 0) {
        h += '<b>' + esc_(c.nome) + '</b>';
        if (c.credito) h += '<br><span style="font-size:10px;color:' + C.ouro + ';letter-spacing:1px">CRÉDITO AGÊNCIA</span>';
      }
      h += '</td><td style="padding:10px 6px;border-bottom:1px solid ' + C.linha + ';color:' + C.texto + '">' + esc_(v.nome) + '</td>';

      // investimento
      if (v.budget > 0) {
        const cor = corIndice(v.idx, c.credito);
        let nota = '';
        if (cor !== C.verde && v.proj !== null) {
          const desvio = v.proj - v.budget;
          nota = 'fecha em ' + curto(v.proj) + ' (' + (desvio >= 0 ? '+' : '') + curto(desvio) + ')';
          if (v.ritmo !== null) nota += ' · ' + (desvio >= 0 ? 'frear ' : 'acelerar ') + brl_(v.ritmo) + '/dia';
        }
        h += celula(cor, brl_(v.investido), curto(v.budget), nota);
      } else { h += vazio(); gaps.push('budget'); }

      // receita
      if (v.metaReceita > 0) {
        const cor = corMeta(v.receita / Math.max(datas.pctMes, 0.0001), v.metaReceita, true);
        const projR = datas.diasDecorridos ? v.receita / datas.diasDecorridos * datas.diasNoMes : 0;
        const gap = projR - v.metaReceita;
        const nota = cor === C.vermelho ? 'fecha em ' + curto(projR) + ' · gap ' + curto(gap) : '';
        h += celula(cor, brl_(v.receita), curto(v.metaReceita), nota);
      } else { h += vazio(); gaps.push('meta de receita'); }

      // roas
      if (v.metaRoas > 0 && v.roas > 0) {
        const cor = corMeta(v.roas, v.metaRoas, true);
        h += celula(cor, v.roas.toFixed(2), v.metaRoas.toFixed(1), cor === C.vermelho ? 'meta ' + v.metaRoas.toFixed(2) : '');
      } else { h += vazio(); gaps.push(v.metaRoas > 0 ? 'ROAS' : 'meta de ROAS'); }

      // cpa
      if (v.metaCpa > 0 && v.cpa > 0) {
        const cor = corMeta(v.cpa, v.metaCpa, false);
        h += celula(cor, brl_(v.cpa), brl_(v.metaCpa), cor === C.vermelho ? 'meta ' + brl_(v.metaCpa) : '');
      } else { h += vazio(); gaps.push(v.metaCpa > 0 ? 'CPA' : 'meta de CPA'); }

      h += '</tr>';
      if (gaps.length) faltando.push({ rotulo: rot, campos: gaps });
    });
  });
  h += '</table></td></tr>';

  // ---- dados faltantes
  if (faltando.length) {
    h += secao('Dados faltantes', C.bege);
    h += '<tr><td style="background:' + C.bege + ';padding:0 30px 20px 30px;font-size:12px;color:' + C.texto + '">';
    faltando.forEach(function (f) {
      h += '<div style="padding:4px 0;border-bottom:1px solid ' + C.linha + '"><b style="color:' + C.preto + '">' +
           f.rotulo + '</b> &nbsp;' + f.campos.join(' · ') + '</div>';
    });
    h += '</td></tr>';
  }

  // ---- legenda
  h += '<tr><td style="background:#fff;padding:14px 30px;font-size:10px;color:' + C.fraco + ';border-top:1px solid ' + C.linha + '">';
  h += '<span style="color:' + C.verde + '">&#9679;</span> dentro da meta &nbsp; ';
  h += '<span style="color:' + C.amarelo + '">&#9679;</span> até 15% fora &nbsp; ';
  h += '<span style="color:' + C.vermelho + '">&#9679;</span> acima de 15% fora &nbsp; &mdash; sem meta ou sem dado. ';
  h += 'Investimento e receita comparados com o % do mês já decorrido. Contas de crédito da agência ficam vermelhas com 5% de sobregasto.';
  h += '</td></tr>';

  return h + '</table></div>';
}

function montarTextoSlack_(crit, aten, info, datas, url, dm) {
  const partes = [];
  let cab = (dm ? '*Escalação de pacing para ' + CONFIG.NOME_ESCALACAO + '*' : '*Controle de Pacing | resumo diário*') +
    ' · dados de ' + datas.labelOntem + ' (dia ' + datas.diasDecorridos + '/' + datas.diasNoMes + ', ' + pct_(datas.pctMes) + ' do mês) · <' + url + '|planilha>\n' +
    ':red_circle: ' + crit.length + ' crítico(s)  :large_yellow_circle: ' + aten.length + ' atenção  :information_source: ' + info.length + ' info';
  partes.push(cab);

  const sec = (titulo, lista) => {
    if (!lista.length) return;
    let txt = '*' + titulo + '*\n';
    const porConta = agrupar_(lista);
    Object.keys(porConta).forEach(conta => {
      txt += '\n*' + conta + '*\n';
      porConta[conta].forEach(a => { txt += '• *' + a.titulo + '* _(' + a.persistencia + ')_\n   ' + a.detalhe + '\n'; });
    });
    // quebra em pedaços de até ~2800 caracteres
    while (txt.length > 2800) {
      let corte = txt.lastIndexOf('\n', 2800);
      if (corte < 500) corte = 2800;
      partes.push(txt.substring(0, corte));
      txt = txt.substring(corte);
    }
    partes.push(txt);
  };
  sec(':red_circle: CRÍTICO - ação hoje', crit);
  sec(':large_yellow_circle: ATENÇÃO - ajustar no mesmo dia', aten);
  sec(':information_source: Realocação e higiene', info);
  if (!crit.length && !aten.length) partes.push(':large_green_circle: Carteira no ritmo. Nenhum ajuste necessário hoje.');
  return partes;
}

// ---------------------------------------------------------------------
//  UTILITÁRIOS
// ---------------------------------------------------------------------
function alerta_(nivel, conta, titulo, detalhe, chave) {
  return { nivel: nivel, conta: conta, titulo: titulo, detalhe: detalhe, chave: chave, persistencia: 'NOVO' };
}
function agrupar_(lista) {
  const m = {};
  lista.forEach(a => { (m[a.conta] = m[a.conta] || []).push(a); });
  return m;
}
function classificar_(idx, credito) {
  const L = CONFIG.LIMITES;
  if (idx < L.AMARELO_MIN || idx > L.AMARELO_MAX) return 'FORA DE PACING';
  if (credito && idx > L.CREDITO_MAX) return 'FORA DE PACING';
  if (idx < L.VERDE_MIN || idx > L.VERDE_MAX) return 'ATENCAO';
  return 'OK';
}
function listarAbasConta_(ss) {
  const ignorar = CONFIG.ABAS_IGNORAR.map(normalizar_);
  return ss.getSheets().filter(s => {
    if (ignorar.indexOf(normalizar_(s.getName())) >= 0) return false;
    // aba de conta tem "Budget do mês" em A6
    return normalizar_(s.getRange('A6').getValue()).indexOf('budget') >= 0;
  });
}
/** Lê os veículos da linha 5 (B5 até a coluna anterior a "TOTAL"). */
function lerVeiculos_(aba) {
  const linha = aba.getRange(5, 2, 1, 8).getValues()[0];
  const out = [];
  for (let i = 0; i < linha.length; i++) {
    const n = String(linha[i] || '').trim();
    if (!n) continue;
    if (normalizar_(n) === 'total') break;
    out.push({ nome: n, col: i + 2 });
  }
  return out;
}
function acharColuna_(cab, termos) {
  for (let t = 0; t < termos.length; t++) {
    for (let i = 0; i < cab.length; i++) if (cab[i].indexOf(normalizar_(termos[t])) >= 0) return i;
  }
  return -1;
}
function normalizar_(s) {
  return String(s === null || s === undefined ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = String(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function brl_(v) {
  v = Number(v) || 0;
  const neg = v < 0; v = Math.abs(v);
  const s = v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + 'R$ ' + s;
}
function pct_(v) { return (Number(v) * 100).toFixed(1).replace('.', ',') + '%'; }
function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
