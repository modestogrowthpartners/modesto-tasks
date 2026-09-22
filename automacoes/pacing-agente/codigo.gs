/**
 * =====================================================================
 *  CONTROLE DE PACING E METAS  |  ALERTAS DIÁRIOS (E-MAIL + SLACK)
 *  Modesto Growth Partners
 * =====================================================================
 *
 *  v3.2 (22/09/2026): o Slack passa a sair pelo enviarSlackVisual_ (conta.gs):
 *  blocos curtos por conta e gráfico de pacing das contas críticas como imagem.
 *  Sem SLACK_BOT_TOKEN, cai sozinho no texto antigo pelo webhook.
 *
 *  v3.1 (21/09/2026)
 *
 *  HORÁRIOS (Brasília). A ordem importa: cada etapa depende da anterior.
 *   06:30  agente de coleta (tarefa agendada no Claude) sobe pacing_ e detalhe_ na pasta do Drive
 *   08:00  rodarAlertas (gatilho 7h45 a 8h15): lança o dia, alerta, gera tendencias_*.json,
 *          manda o e-mail da carteira e enfileira os e-mails por cliente
 *   08:10  em diante: um e-mail por cliente a cada 10 min, para o time inteiro (enviarProximoDaFila)
 *   09:05  agente de análise (tarefa agendada no Claude) lê tendencias_ e sobe relatorio_*.html
 *   09:45  enviarRelatorio30d (gatilho 9h30 a 10h00): manda o relatorio_ ao time
 *
 *  INSTALAÇÃO (uma vez)
 *  1. Planilha de Controle de Pacing > Extensões > Apps Script. Cinco arquivos no projeto,
 *     com estes nomes: Código.gs (este), ingestao.gs, tendencias.gs, conta.gs, migracao.gs.
 *     Apague qualquer arquivo antigo (ex.: "ingestao" duplicado, "pacing-ingestao").
 *  2. Configurações do projeto > Fuso horário: (GMT-03:00) São Paulo.
 *     E na PLANILHA: Arquivo > Configurações > Fuso horário: (GMT-03:00) São Paulo.
 *     São duas chaves diferentes; a da planilha estava vazia em 21/09 e derrubava formatDate.
 *  3. Propriedades do script:
 *        SLACK_WEBHOOK_URL   = Incoming Webhook do canal #controle_pacing_diário
 *        SLACK_BOT_TOKEN     = token xoxb-... (escopos chat:write e files:write; obrigatório para os gráficos no Slack)
 *        SLACK_EVERTON_ID    = (opcional) U0XXXXXXX
 *        SLACK_CANAL_ID      = (opcional) ID do canal; padrão C0BG2NK56UC
 *        SLACK_CANAL_TESTE   = (opcional) ID de um canal de teste, usado só por testarSlackVisual
 *  4. Rode  instalarGatilhos  (apaga TODOS os gatilhos do projeto e cria os dois certos).
 *  5. Rode  testarTudo  (manda um checklist por e-mail para quem executou, sem Slack,
 *     sem gravar célula). Tudo verde = pode deixar rodar amanhã.
 *  6. Rode  reconstruirSerieDoMesAtual  uma vez se a aba SERIE DIARIA estiver vazia.
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
    'phellip.lira@modestogrowth.com.br',
    'lucas.modesto@modestogrowth.com.br'
  ],
  EMAIL_ESCALACAO: 'everton.medeiros@modestogrowth.com.br',
  NOME_ESCALACAO: 'Everton',

  // Tudo que é TESTE (testarAlertas, testarTudo, testarEmailConta, testarRelatorio30d) vai só para cá.
  EMAILS_TESTE: ['elias.braga@modestogrowth.com.br', 'vinicius.reis@modestogrowth.com.br'],

  // Estrutura da planilha de pacing
  ABA_PAINEL: 'PAINEL',
  ABA_LOG: 'LOG DE ALTERACOES',
  ABA_HISTORICO: 'HISTORICO ALERTAS',   // criada automaticamente pelo script
  HISTORICO_MAX_LINHAS: 20000,          // acima disso apaga as execuções mais antigas
  ABAS_IGNORAR: ['INSTRUCOES', 'PAINEL', 'LOG DE ALTERACOES', 'HISTORICO ALERTAS', 'ALERTAS'],

  // Limites (Índice de pacing = % budget consumido / % do mês decorrido)
  LIMITES: {
    VERDE_MIN: 0.95,
    VERDE_MAX: 1.05,
    AMARELO_MIN: 0.85,
    AMARELO_MAX: 1.15,
    CREDITO_MAX: 1.05,        // conta com crédito da agência: acima disso já é crítico
    TRAVA_97: 0.97,           // regra dos 97% do budget contratado
    MULT_GASTO_DIARIO: 2.0,   // gasto do dia acima de 2x o planejado dispara alerta
    CPA_TOLERANCIA: 1.15,     // CPA realizado acima de 115% da meta é crítico
    // Pacing em correção: o índice do MÊS demora dias para voltar depois de um
    // ajuste. Se o gasto de ONTEM já está dentro desta tolerância do ritmo
    // necessário para fechar na verba, o alerta de pacing não dispara de novo:
    // vira INFO "em correção" e fica registrado no histórico.
    TOLERANCIA_CORRECAO: 0.15
  },
  LOG_VARIACAO_PCT: 0.20,
  LOG_VARIACAO_RS: 1000,

  ASSUNTO_PREFIXO: '[Pacing]',
  FUSO: 'America/Sao_Paulo',

  // Gatilhos do Apps Script (hora cheia + minuto; a janela real é ±15 min)
  HORARIOS: {
    ALERTAS:   { hora: 8, minuto: 0 },    // 7h45 a 8h15
    RELATORIO: { hora: 9, minuto: 45 }    // 9h30 a 10h00
  },

  // E-mail por cliente (conta.gs). Vai para o time inteiro (EMAILS_TIME), um
  // cliente por vez, em fila: o primeiro sai PRIMEIRO_APOS_MIN minutos depois
  // do e-mail da carteira e os demais a cada INTERVALO_MIN. Críticos primeiro.
  EMAIL_POR_CONTA: true,

  // E-mail da carteira das 8h (regra de 21/09/2026):
  //   'executivo'  só quando há crítico: "Contas para olhar hoje", com o gráfico de
  //                pacing de cada conta citada e nada além do crítico. Substitui
  //                também o e-mail de escalação separado.
  //   'completo'   resumo antigo com todas as contas, todo dia, mais escalação.
  //   'nunca'      nenhum e-mail da carteira; só os e-mails por cliente e o Slack.
  EMAIL_CARTEIRA: 'executivo',
  EMAIL_CONTA: { PRIMEIRO_APOS_MIN: 10, INTERVALO_MIN: 10 },

  // Dado inconsistente: investido do mês acima de N x budget é fórmula errada,
  // não gasto. Vira aviso e sai do pacing (caso MEU RODAPE / Pinterest em 09/2026).
  FATOR_INCONSISTENTE: 20
};

const NIVEL = { CRITICO: 'CRITICO', ATENCAO: 'ATENCAO', INFO: 'INFO' };

// ---------------------------------------------------------------------
//  PONTOS DE ENTRADA
// ---------------------------------------------------------------------

/**
 * Apaga TODOS os gatilhos do projeto e instala os dois certos:
 *   rodarAlertas        8h00 (janela 7h45 a 8h15)
 *   enviarRelatorio30d  9h45 (janela 9h30 a 10h00)
 *
 * Por que apagar tudo: o gatilho antigo era `atHour(8)` sem `nearMinute`, o que
 * o Apps Script interpreta como "qualquer minuto entre 8h e 9h". Ele vinha
 * disparando às 8h58 e 9h01, em cima do agente de análise das 9h, que então não
 * achava o tendencias_ do dia. Também some com gatilhos órfãos de funções que
 * não existem mais.
 */
function instalarGatilhos() {
  const antes = ScriptApp.getProjectTriggers();
  try { PropertiesService.getScriptProperties().deleteProperty('FILA_EMAIL_CONTA'); } catch (e) {}
  antes.forEach(t => {
    Logger.log('Removendo gatilho: %s (%s)', t.getHandlerFunction(), t.getUniqueId());
    ScriptApp.deleteTrigger(t);
  });
  const H = CONFIG.HORARIOS;
  ScriptApp.newTrigger('rodarAlertas').timeBased().everyDays(1)
    .atHour(H.ALERTAS.hora).nearMinute(H.ALERTAS.minuto).inTimezone(CONFIG.FUSO).create();
  ScriptApp.newTrigger('enviarRelatorio30d').timeBased().everyDays(1)
    .atHour(H.RELATORIO.hora).nearMinute(H.RELATORIO.minuto).inTimezone(CONFIG.FUSO).create();
  const msg = 'Gatilhos: ' + antes.length + ' removido(s), 2 instalados. rodarAlertas ~' +
    H.ALERTAS.hora + 'h' + pad2_(H.ALERTAS.minuto) + ' e enviarRelatorio30d ~' + H.RELATORIO.hora + 'h' + pad2_(H.RELATORIO.minuto) +
    ' (' + CONFIG.FUSO + ', janela de ±15 min).';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}
/** Compatibilidade com o nome antigo. */
function instalarGatilho() { return instalarGatilhos(); }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Lista os gatilhos do projeto (para conferência). */
function listarGatilhos() {
  const ts = ScriptApp.getProjectTriggers();
  const linhas = ts.map(t => t.getHandlerFunction() + ' · ' + t.getEventType() + ' · id ' + t.getUniqueId());
  Logger.log(linhas.join('\n') || 'nenhum gatilho');
  return linhas;
}

/** Execução normal (gatilho ou menu). */
function rodarAlertas() {
  executar_({ teste: false });
}

/** Execução de teste: só e-mail para quem está rodando, sem Slack, sem gravar estado. */
function testarAlertas() {
  executar_({ teste: true });
}

/**
 * Menu na planilha. Único onOpen do projeto: o Apps Script só executa um, e se
 * dois arquivos declararem onOpen o último carregado vence em silêncio e o
 * outro menu some. Por isso o menu de "sincronizar formulas.gs" é montado aqui.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Alertas de Pacing')
    .addItem('Rodar alertas agora', 'rodarAlertas')
    .addItem('Testar (só para mim, sem Slack)', 'testarAlertas')
    .addItem('Sincronizar budgets da planilha externa', 'sincronizarBudgets')
    .addSeparator()
    .addItem('Importar coleta do Drive agora (pacing)', 'importarPacingAgora')
    .addItem('Importar detalhe do Drive agora', 'importarDetalheAgora')
    .addSeparator()
    .addItem('Instalar gatilhos (limpa os antigos)', 'instalarGatilhos')
    .addItem('Testar tudo (checklist por e-mail)', 'testarTudo')
    .addItem('Testar e-mail de um cliente (MEU RODAPE)', 'testarEmailConta')
    .addItem('Testar e-mail executivo (contas para olhar hoje)', 'testarEmailExecutivo')
    .addItem('Testar Slack visual (canal de teste)', 'testarSlackVisual')
    .addItem('Enviar e-mails por cliente AGORA (time inteiro)', 'enviarEmailsClientesAgora')
    .addItem('Fila de e-mails por cliente: ver estado', 'verFilaEmailsConta')
    .addSeparator()
    .addItem('Migração: verificar estrutura da planilha', 'verificarEstruturaManual')
    .addToUi();

  // Menu do sincronizar formulas.gs, só se o arquivo estiver no projeto.
  if (typeof simularSincronizacao === 'function') {
    ui.createMenu('Sincronizar fórmulas')
      .addItem('1. Simular (só gera relatório)', 'simularSincronizacao')
      .addItem('2. Aplicar sincronização', 'aplicarSincronizacao')
      .addToUi();
  }
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
    // 0b. Detalhe (campanha, ad set, termo, criativo, alteração). Vem antes da
    //     análise porque o e-mail por conta e o tendencias_ leem as abas DETALHE.
    if (typeof importarDetalheDoDrive_ === 'function') {
      try { importarDetalheDoDrive_(ss, datas, alertas); }
      catch (e) { alertas.push(alerta_(NIVEL.ATENCAO, 'GERAL', 'Detalhe não importado', e.message, 'detalhe_erro')); }
      SpreadsheetApp.flush();
    }
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

  // 3b. Tendências de 30 dias (tendencias.gs): aba TENDENCIAS + JSON no Drive
  //     para o agente de análise das 9h05. Fora do teste, porque grava arquivo.
  let tendencias = null;
  if (!opts.teste && typeof gerarTendencias_ === 'function') {
    tendencias = gerarTendencias_(ss, painel, datas, alertas);
  }

  // 4. Log de alterações sem aprovação
  verificarLog_(ss, datas, alertas);

  // 5. Estado (novo x persistente x resolvido) e envio.
  //    Alerta que estava aberto ontem e não disparou hoje vira uma linha
  //    RESOLVIDO no HISTORICO ALERTAS (não vai por e-mail): fica registrado
  //    que o alerta existiu e quando parou.
  const estado = opts.teste ? {} : carregarEstado_();
  marcarPersistencia_(alertas, estado, datas);
  const resolvidos = opts.teste ? [] : listarResolvidos_(alertas, estado, datas);
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

  // 8. Histórico acumulado (aba HISTORICO ALERTAS). Diferente da fila ALERTAS,
  //    aqui nada é apagado entre execuções: uma linha por alerta, por rodada.
  registrarHistorico_(ss, paraEnviar.concat(resolvidos), painel, datas, opts);

  // 9. E-mails por cliente (conta.gs): entram numa fila e saem espaçados, um
  //    por vez, para não cair uma rajada de 9 e-mails na caixa do time.
  if (!opts.teste && CONFIG.EMAIL_POR_CONTA && typeof agendarFilaEmailsConta_ === 'function') {
    try { agendarFilaEmailsConta_(ss, painel, datas); }
    catch (e) { Logger.log('Fila de e-mails por cliente falhou: %s', e.message); }
  }
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
    labelOntemAnterior: Utilities.formatDate(new Date(ontem.getTime() - 24 * 60 * 60 * 1000), CONFIG.FUSO, 'dd/MM/yyyy'),
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
  c.veiculos = [];
  c.gastoOntem = 0;

  veiculos.forEach((v, k) => {
    const budget = num_(aba.getRange(6, v.col).getValue()) || 0;
    const investido = num_(aba.getRange(7, v.col).getValue()) || 0;
    const metaCpa = num_(aba.getRange(23, v.col).getValue()) || 0;
    const cpa = num_(aba.getRange(24, v.col).getValue()) || 0;
    const metaRoas = num_(aba.getRange(25, v.col).getValue()) || 0;
    const roas = num_(aba.getRange(26, v.col).getValue()) || 0;
    const metaReceita = num_(aba.getRange(18, v.col).getValue()) || 0;
    const receita = num_(aba.getRange(19, v.col).getValue()) || 0;
    let recomendacao = '';
    for (let r = 0; r < recomendacoes.length; r++) {
      if (normalizar_(recomendacoes[r][0]) === normalizar_(v.nome)) { recomendacao = String(recomendacoes[r][5] || ''); break; }
    }
    const rotulo = c.nome + ' / ' + v.nome;
    const chaveBase = c.nome + '|' + v.nome;

    // Dado do dia anterior (lido sempre, com ou sem budget)
    let real = null, plan = null, temLinha = false;
    if (colsRealizado[k] && diaNaLinha === datas.diaOntem) {
      temLinha = true;
      const rv = aba.getRange(linhaOntem, colsRealizado[k]).getValue();
      real = (rv === '' || rv === null) ? null : (num_(rv) || 0);
      plan = colsPlanejado[k] ? num_(aba.getRange(linhaOntem, colsPlanejado[k]).getValue()) : null;
    }
    if (real !== null) c.gastoOntem += real;

    // Métricas de ritmo
    const ritmoIdeal = budget > 0 ? budget / datas.diasNoMes : 0;
    const ritmoAtual = investido / datas.diasDecorridos;
    const proj = ritmoAtual * datas.diasNoMes;
    const idx = budget > 0 ? (investido / budget) / datas.pctMes : null;
    const desvio = budget > 0 ? proj - budget : 0;
    const ritmoNec = budget > 0 && datas.diasRestantes > 0 ? (budget - investido) / datas.diasRestantes : 0;
    const ajuste = budget > 0 ? ritmoNec - ritmoAtual : 0;
    let status = idx === null ? (investido > 0 ? 'SEM VERBA' : 'INATIVO') : statusVeiculo_(idx, c.credito);
    if (investido === 0 && budget === 0) return; // veículo não usado nesta conta

    // Ajuste já aplicado? O índice do mês ainda está fora, mas o gasto de ontem
    // já bate com o ritmo necessário para fechar na verba (±TOLERANCIA_CORRECAO).
    // Ex.: dia 17 gastou 1.500, ritmo necessário 1.000, dia 18 gastou 1.000:
    // no dia 19 o pacing não dispara de novo; entra como "em correção".
    let emCorrecao = false;
    if (budget > 0 && idx !== null && (idx < L.VERDE_MIN || idx > L.VERDE_MAX) && real !== null && real > 0 && ritmoNec > 0) {
      const tol = L.TOLERANCIA_CORRECAO;
      if (idx > L.VERDE_MAX && real <= ritmoNec * (1 + tol)) emCorrecao = true;
      if (idx < L.VERDE_MIN && real >= ritmoNec * (1 - tol)) emCorrecao = true;
    }
    if (emCorrecao) status = 'EM CORREÇÃO';

    // Dado inconsistente: investido do mês maior que N x budget não é gasto, é
    // fórmula apontando para a célula errada. Entra no painel como aviso e sai
    // de todos os alertas de pacing, para não gerar 3 críticos falsos por dia.
    const inconsistente = budget > 0 && investido > budget * CONFIG.FATOR_INCONSISTENTE;
    if (inconsistente) {
      status = 'DADO INCONSISTENTE';
      alertas.push(alerta_(NIVEL.ATENCAO, c.nome, 'Dado inconsistente: ' + rotulo,
        'Investido do mês ' + brl_(investido) + ' com budget ' + brl_(budget) + ' (' + Math.round(investido / budget) +
        'x). É fórmula apontando para célula errada na linha 7 da aba ' + c.nome + ', coluna ' + v.nome +
        '. Veículo retirado do pacing até correção.', chaveBase + '|inconsistente'));
    }

    c.veiculos.push({
      nome: v.nome, budget: budget, investido: investido, gastoOntem: real, planOntem: plan,
      saldo: budget - investido, pctUsado: budget > 0 ? investido / budget : null,
      ritmoIdeal: ritmoIdeal, ritmoAtual: ritmoAtual, ritmoNec: ritmoNec, proj: proj, desvio: desvio,
      idx: idx, ajuste: ajuste, status: status, inconsistente: inconsistente, emCorrecao: emCorrecao, roas: roas, metaRoas: metaRoas, cpa: cpa, metaCpa: metaCpa,
      metaReceita: metaReceita, receita: receita, projReceita: receita / datas.diasDecorridos * datas.diasNoMes,
      statusReceita: statusReceita_(receita, metaReceita, datas.pctMes), recomendacao: recomendacao
    });

    if (inconsistente) return;

    // Pacing por veículo
    if (budget > 0) {
      const det = 'Gastou ' + brl_(investido) + ' de ' + brl_(budget) + ' (' + pct_(investido / budget) + ') com ' + pct_(datas.pctMes) + ' do mês. Nesse ritmo fecha em ' + brl_(proj) +
        ' (' + (desvio >= 0 ? '+' : '-') + brl_(Math.abs(desvio)) + '). ' + (ajuste >= 0 ? 'Acelerar +' : 'Frear -') + brl_(Math.abs(ajuste)) + '/dia.';

      if (emCorrecao) {
        alertas.push(alerta_(NIVEL.INFO, c.nome, 'Pacing em correção: ' + rotulo,
          'Índice do mês ' + idx.toFixed(2) + 'x, mas ontem gastou ' + brl_(real) + ' contra ritmo necessário de ' + brl_(ritmoNec) +
          '/dia: ajuste aplicado. Mantendo esse ritmo fecha em ' + brl_(investido + real * datas.diasRestantes) + ' de ' + brl_(budget) + '.', chaveBase + '|pacing_correcao'));
      } else if (idx < L.AMARELO_MIN || idx > L.AMARELO_MAX) {
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
      if (temLinha) {
        if (real === null) {
          alertas.push(alerta_(NIVEL.CRITICO, c.nome, 'DADO NÃO LANÇADO: ' + rotulo,
            'Investimento realizado de ' + datas.labelOntem + ' está vazio. O índice desta conta fica subestimado até o lançamento.',
            chaveBase + '|semdado'));
        } else if (real === 0) {
          alertas.push(alerta_(NIVEL.CRITICO, c.nome, 'GASTO ZERO: ' + rotulo,
            'R$ 0,00 em ' + datas.labelOntem + ' com budget ativo. Verifique campanha pausada, cartão recusado ou limite atingido.',
            chaveBase + '|zero'));
        } else if (plan && plan > 0 && real > plan * L.MULT_GASTO_DIARIO) {
          alertas.push(alerta_(c.credito ? NIVEL.CRITICO : NIVEL.ATENCAO, c.nome, 'Gasto diário acima de 2x o planejado: ' + rotulo,
            'Realizado ' + brl_(real) + ' vs planejado ' + brl_(plan) + ' (' + (real / plan).toFixed(1) + 'x). Armadilha do orçamento diário.',
            chaveBase + '|2x'));
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
//  HISTÓRICO DE ALERTAS (aba criada pelo script)
// ---------------------------------------------------------------------
const HIST_CABECALHO = [
  'Execução', 'Data dos dados', 'Modo', 'Nível', 'Conta', 'Alerta', 'Detalhe',
  'Persistência', 'Índice carteira', 'Total críticos', 'Total atenção', 'Total info', 'Chave'
];

function obterAbaHistorico_(ss) {
  let aba = ss.getSheetByName(CONFIG.ABA_HISTORICO);
  if (aba) return aba;
  aba = ss.insertSheet(CONFIG.ABA_HISTORICO, ss.getNumSheets());
  aba.getRange(1, 1, 1, HIST_CABECALHO.length).setValues([HIST_CABECALHO])
    .setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
  aba.setFrozenRows(1);
  aba.setColumnWidths(1, 2, 130);
  aba.setColumnWidth(6, 320);
  aba.setColumnWidth(7, 520);
  aba.getRange('A:A').setNumberFormat('dd/mm/yyyy hh:mm');
  aba.getRange('B:B').setNumberFormat('dd/mm/yyyy');

  // Semáforo por nível (coluna D)
  const regras = [
    ['CRITICO', '#f4c7c3'], ['ATENCAO', '#fce8b2'], ['INFO', '#d4e6f7'], ['OK', '#d9ead3'], ['RESOLVIDO', '#d9ead3']
  ].map(p => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(p[0]).setBackground(p[1]).setRanges([aba.getRange('D2:D')]).build());
  aba.setConditionalFormatRules(regras);
  return aba;
}

function registrarHistorico_(ss, alertas, painel, datas, opts) {
  const aba = obterAbaHistorico_(ss);
  const modo = opts.teste ? 'TESTE' : 'PRODUÇÃO';
  const crit = alertas.filter(a => a.nivel === NIVEL.CRITICO).length;
  const aten = alertas.filter(a => a.nivel === NIVEL.ATENCAO).length;
  const info = alertas.filter(a => a.nivel === NIVEL.INFO).length;

  // Índice da carteira inteira (soma dos budgets x soma dos investidos)
  let budgetTotal = 0, investidoTotal = 0;
  painel.contas.forEach(c => { if (c.budget > 0) { budgetTotal += c.budget; investidoTotal += c.investido; } });
  const idxCarteira = budgetTotal > 0 ? Number(((investidoTotal / budgetTotal) / datas.pctMes).toFixed(3)) : '';

  const ordem = { CRITICO: 0, ATENCAO: 1, INFO: 2, RESOLVIDO: 3 };
  const ordenados = alertas.slice().sort((a, b) => ((ordem[a.nivel] || 9) - (ordem[b.nivel] || 9)) || String(a.conta).localeCompare(String(b.conta)));

  const linhas = ordenados.map(a => [
    datas.hoje, datas.ontem, modo, a.nivel, a.conta, a.titulo, a.detalhe, a.persistencia || '',
    idxCarteira, crit, aten, info, a.chave || ''
  ]);
  if (!linhas.length) {
    linhas.push([datas.hoje, datas.ontem, modo, 'OK', 'CARTEIRA', 'Nenhum alerta',
      'Carteira no ritmo. Nenhum ajuste necessário.', '', idxCarteira, 0, 0, 0, 'ok']);
  }

  const inicio = aba.getLastRow() + 1;
  aba.getRange(inicio, 1, linhas.length, HIST_CABECALHO.length).setValues(linhas);

  // Limpeza: mantém a aba dentro do limite
  const total = aba.getLastRow() - 1;
  if (total > CONFIG.HISTORICO_MAX_LINHAS) {
    aba.deleteRows(2, total - CONFIG.HISTORICO_MAX_LINHAS);
  }
}

// ---------------------------------------------------------------------
//  ESTADO (novo x persistente)
// ---------------------------------------------------------------------
function carregarEstado_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('ESTADO_ALERTAS') || '{}'); }
  catch (e) { return {}; }
}
// Estado: { chave: { desde: 'dd/MM/yyyy', conta, titulo } }. Versões antigas
// guardavam só a data como string; as duas formas são aceitas.
function estadoDesde_(v) { return v && typeof v === 'object' ? v.desde : v; }
function salvarEstado_(alertas, estado, datas) {
  const novo = {};
  alertas.forEach(a => { novo[a.chave] = { desde: estadoDesde_(estado[a.chave]) || datas.labelHoje, conta: a.conta, titulo: a.titulo }; });
  PropertiesService.getScriptProperties().setProperty('ESTADO_ALERTAS', JSON.stringify(novo));
}
function marcarPersistencia_(alertas, estado, datas) {
  alertas.forEach(a => {
    const primeira = estadoDesde_(estado[a.chave]);
    if (!primeira) { a.persistencia = 'NOVO'; return; }
    const p = primeira.split('/');
    const d0 = new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
    const dias = Math.round((datas.hoje - d0) / 86400000);
    a.persistencia = dias <= 0 ? 'NOVO' : 'persiste há ' + dias + ' dia(s)';
  });
}
/** Alertas abertos ontem que não dispararam hoje. Vão só para o histórico. */
function listarResolvidos_(alertas, estado, datas) {
  const hoje = {}; alertas.forEach(a => { hoje[a.chave] = true; });
  return Object.keys(estado).filter(k => !hoje[k] && k !== 'sem_alerta').map(k => {
    const e = estado[k]; const desde = estadoDesde_(e) || '';
    const conta = (e && e.conta) || String(k).split('|')[0];
    const titulo = (e && e.titulo) || k;
    return { nivel: 'RESOLVIDO', conta: conta, titulo: 'Resolvido: ' + titulo, chave: k, persistencia: desde ? 'aberto desde ' + desde : '',
      detalhe: 'Disparou pela última vez em ' + datas.labelOntemAnterior + ' e não disparou hoje (' + datas.labelHoje + ').' };
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

  // ---- E-mail da carteira (time inteiro). Modo em CONFIG.EMAIL_CARTEIRA:
  //   'executivo'  só "Contas para olhar hoje": críticos, com o gráfico de pacing
  //                de cada conta citada. Sem crítico, não sai e-mail nenhum aqui;
  //                o dia a dia vai nos e-mails por cliente (conta.gs).
  //   'completo'   o resumo antigo, todas as contas, todo dia.
  //   'nunca'      nenhum e-mail da carteira; só os e-mails por cliente e o Slack.
  const destinatarios = opts.teste ? CONFIG.EMAILS_TESTE.join(',') : CONFIG.EMAILS_TIME.join(',');
  const modo = CONFIG.EMAIL_CARTEIRA || 'executivo';
  if (modo === 'completo') {
    MailApp.sendEmail({
      to: destinatarios,
      subject: (opts.teste ? '[TESTE] ' : '') + (crit.length ? '🔴 ' : aten.length ? '🟡 ' : '🟢 ') + assuntoBase,
      htmlBody: montarHtml_(crit, aten, info, painel, datas, urlPlanilha),
      name: 'Controle de Pacing | Modesto Growth'
    });
  } else if (modo === 'executivo' && crit.length && typeof montarHtmlExecutivo_ === 'function') {
    const ex = montarHtmlExecutivo_(SpreadsheetApp.getActiveSpreadsheet(), crit, painel, datas, urlPlanilha);
    MailApp.sendEmail({
      to: destinatarios,
      subject: (opts.teste ? '[TESTE] ' : '') + '🔴 ' + CONFIG.ASSUNTO_PREFIXO + ' ' + datas.labelOntem + ' | ' + ex.contas + ' conta(s) para olhar hoje',
      htmlBody: ex.html, inlineImages: ex.imagens,
      name: 'Controle de Pacing | Modesto Growth'
    });
  }

  // ---- E-mail só de críticos para o Everton (só no modo completo; no executivo
  //      ele já recebe o "Contas para olhar hoje" com o time)
  if (modo === 'completo' && crit.length && !opts.teste) {
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

  // v3.2 (22/09/2026): Slack visual (conta.gs): blocos curtos por conta e o
  // gráfico de pacing das contas críticas como imagem. Sem bot token, o próprio
  // enviarSlackVisual_ cai no texto antigo pelo webhook (postarNoCanalPacing_).
  // Falha vira alerta em vez de linha no Logger. Canal de alerta que falha
  // calado é o próprio problema que o canal existia para evitar.
  if (typeof enviarSlackVisual_ === 'function') {
    enviarSlackVisual_(SpreadsheetApp.getActiveSpreadsheet(), crit, aten, painel, datas, urlPlanilha, alertas);
  } else {
    postarNoCanalPacing_(blocosCanal, alertas);
  }
  if (token && evertonId && crit.length) {
    const dm = montarTextoSlack_(crit, [], [], datas, urlPlanilha, true);
    try { dm.forEach(txt => postSlackApi_(token, evertonId, txt)); }
    catch (e) { Logger.log('DM ao Everton falhou: %s', e.message); }
  }
}

function postSlack_(webhook, payload) {
  const r = UrlFetchApp.fetch(webhook, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (r.getResponseCode() >= 300) throw new Error('Slack webhook ' + r.getResponseCode() + ': ' + r.getContentText());
}
function postSlackApi_(token, channel, text) {
  const r = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post', contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ channel: channel, text: text }), muteHttpExceptions: true
  });
  const body = r.getContentText();
  if (body.indexOf('"ok":true') < 0) throw new Error('Slack API: ' + body);
}

// ---------------------------------------------------------------------
//  FORMATAÇÃO DAS MENSAGENS (layout de painel)
// ---------------------------------------------------------------------
const UI = {
  escuro: '#2d3748', escuroTxt: '#ffffff',
  cabecalhoLinha: '#1f2937',
  entrada: '#fff2cc', formula: '#e8eefc', neutro: '#ffffff',
  google: '#e53e3e', meta: '#1877f2', pinterest: '#e60023', outro: '#4a5568',
  verde: '#2f855a', vermelho: '#c53030', amarelo: '#b7791f', azul: '#2b6cb0', cinza: '#718096',
  borda: '#cbd5e0'
};

function corPlataforma_(nome) {
  const n = normalizar_(nome);
  if (n.indexOf('google') >= 0) return UI.google;
  if (n.indexOf('meta') >= 0) return UI.meta;
  if (n.indexOf('pinterest') >= 0) return UI.pinterest;
  return UI.outro;
}
function statusVeiculo_(idx, credito) {
  const L = CONFIG.LIMITES;
  if (idx < L.AMARELO_MIN) return 'SUBGASTO CRÍTICO';  // 'EM CORREÇÃO' é atribuído em analisarConta_
  if (idx > L.AMARELO_MAX) return 'SOBREGASTO CRÍTICO';
  if (credito && idx > L.CREDITO_MAX) return 'SOBREGASTO CRÍTICO';
  if (idx < L.VERDE_MIN) return 'SUBGASTO';
  if (idx > L.VERDE_MAX) return 'SOBREGASTO';
  return 'NO RITMO';
}
function rotuloStatus_(st) {
  return ({ 'NO RITMO': 'NO RITMO', 'SUBGASTO': 'GASTANDO POUCO', 'SOBREGASTO': 'GASTANDO MUITO',
    'SUBGASTO CRÍTICO': 'MUITO ABAIXO', 'SOBREGASTO CRÍTICO': 'MUITO ACIMA', 'EM CORREÇÃO': 'EM CORREÇÃO' })[st] || st;
}
function statusReceita_(receita, meta, pctMes) {
  if (!meta) return 'SEM META';
  const r = (receita / meta) / pctMes;
  if (r < CONFIG.LIMITES.AMARELO_MIN) return 'ABAIXO DA META';
  if (r < CONFIG.LIMITES.VERDE_MIN) return 'ATENÇÃO';
  return 'NA META';
}
function emojiStatus_(st) {
  if (st === 'NO RITMO' || st === 'NA META') return '🟢';
  if (st === 'ATENÇÃO') return '🟡';
  if (st === 'ABAIXO DA META') return '🔴';
  if (st === 'SUBGASTO' || st === 'SOBREGASTO' || st === 'EM CORREÇÃO') return '🟡';
  if (st.indexOf('CRÍTICO') >= 0) return '🔴';
  return '⚪';
}
function corStatus_(st) {
  if (st === 'NO RITMO' || st === 'NA META') return UI.verde;
  if (st === 'ATENÇÃO') return UI.amarelo;
  if (st === 'ABAIXO DA META') return UI.vermelho;
  if (st === 'SUBGASTO' || st === 'SOBREGASTO' || st === 'EM CORREÇÃO') return UI.amarelo;
  if (st.indexOf('CRÍTICO') >= 0) return UI.vermelho;
  return UI.cinza;
}
function sinal_(v) { return (v > 0 ? '+ ' : v < 0 ? '- ' : '') + brl_(Math.abs(v)); }
function corSinal_(v) { return v < 0 ? UI.vermelho : v > 0 ? UI.verde : '#111'; }

// ---- blocos HTML reutilizáveis
function hBanda_(titulo, largura) {
  return '<table width="' + largura + '" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:14px"><tr>' +
    '<td style="background:' + UI.escuro + ';color:' + UI.escuroTxt + ';font-weight:bold;font-size:13px;text-align:center;padding:8px;letter-spacing:.3px">' +
    titulo + '</td></tr></table>';
}
function hTabelaInicio_(largura, colunas) {
  let s = '<table width="' + largura + '" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;border:1px solid ' + UI.borda + '"><tr>';
  colunas.forEach(c => {
    s += '<th style="background:' + UI.cabecalhoLinha + ';color:#fff;padding:8px 6px;border:1px solid #111;font-size:12px;text-align:' + (c.al || 'center') + '">' + c.t + '</th>';
  });
  return s + '</tr>';
}
function hCel_(txt, opts) {
  opts = opts || {};
  return '<td style="padding:7px 6px;border:1px solid ' + UI.borda + ';text-align:' + (opts.al || 'right') + ';background:' + (opts.bg || UI.neutro) +
    ';color:' + (opts.cor || '#111') + ';font-weight:' + (opts.negrito ? 'bold' : 'normal') + ';white-space:nowrap">' + txt + '</td>';
}
function hRotuloPlataforma_(nome, cor) {
  return hCel_(esc_(nome), { al: 'left', bg: cor, cor: '#fff', negrito: true });
}

// Cores da Modesto Growth Partners
const MG = { bege: '#F0EDE6', preto: '#1A1A18', dourado: '#C9A227', cinza: '#4A4A46', linha: '#E2DDD3', branco: '#FFFFFF',
  verde: '#2E7D4F', amarelo: '#C48A00', vermelho: '#B3261E', neutro: '#9A978F' };

function pontoCor_(sev) { return sev === 'ok' ? MG.verde : sev === 'aten' ? MG.amarelo : sev === 'crit' ? MG.vermelho : MG.neutro; }
function sevInvest_(st) { return st === 'NO RITMO' ? 'ok' : (st === 'SUBGASTO' || st === 'SOBREGASTO' || st === 'EM CORREÇÃO') ? 'aten' : st.indexOf('CRÍTICO') >= 0 ? 'crit' : 'na'; }
function rotuloStatusCurto_(st) {
  return ({ 'NO RITMO': 'no ritmo', 'SUBGASTO': 'gastando pouco', 'SOBREGASTO': 'gastando muito', 'SUBGASTO CRÍTICO': 'muito abaixo',
    'SOBREGASTO CRÍTICO': 'muito acima', 'EM CORREÇÃO': 'em correção (ajuste aplicado ontem)', 'DADO INCONSISTENTE': 'conferir fórmula', 'SEM VERBA': 'sem verba', 'INATIVO': 'inativo' })[st] || st;
}
function sevReceita_(st) { return st === 'NA META' ? 'ok' : st === 'ATENÇÃO' ? 'aten' : st === 'ABAIXO DA META' ? 'crit' : 'na'; }
function sevRoas_(v) { if (!v.metaRoas || !v.investido) return 'na'; return v.roas >= v.metaRoas ? 'ok' : v.roas >= v.metaRoas * 0.85 ? 'aten' : 'crit'; }
function sevCpa_(v) { if (!v.metaCpa || !v.cpa) return 'na'; return v.cpa <= v.metaCpa ? 'ok' : v.cpa <= v.metaCpa * CONFIG.LIMITES.CPA_TOLERANCIA ? 'aten' : 'crit'; }
function brlK_(v) { v = Number(v) || 0; if (Math.abs(v) >= 1000) return 'R$ ' + (v / 1000).toFixed(1).replace('.', ',') + 'k'; return brl_(v); }

function montarHtml_(crit, aten, info, painel, datas, url, soCriticos) {
  const W = 820;
  const fonte = "font-family:Inter,'Helvetica Neue',Arial,sans-serif;";
  const serif = "font-family:'Playfair Display',Georgia,'Times New Roman',serif;";
  let h = '<div style="background:' + MG.bege + ';padding:28px 0;' + fonte + 'color:' + MG.preto + '">' +
    '<table width="' + W + '" align="center" cellpadding="0" cellspacing="0" style="border-collapse:collapse">';

  // ---- Cabeçalho
  h += '<tr><td style="background:' + MG.preto + ';padding:26px 30px;border-bottom:3px solid ' + MG.dourado + '">' +
    '<div style="font-size:11px;letter-spacing:2px;color:' + MG.dourado + ';text-transform:uppercase">Modesto Growth Partners · Controle de mídia</div>' +
    '<div style="' + serif + 'font-size:26px;color:#fff;margin-top:6px">' + (soCriticos ? 'Escalação · ' + CONFIG.NOME_ESCALACAO : 'Alerta de pacing') + '</div>' +
    '<div style="font-size:12px;color:#BDB9B0;margin-top:6px">Dados fechados de ' + datas.labelOntem + ' · dia ' + datas.diasDecorridos + ' de ' + datas.diasNoMes +
    ' (' + pct_(datas.pctMes) + ' do mês) · <a href="' + url + '" style="color:' + MG.dourado + ';text-decoration:none">abrir planilha ↗</a></div></td></tr>';

  // ---- Placar em uma linha
  const veics = [];
  painel.contas.forEach(c => (c.veiculos || []).forEach(v => veics.push(v)));
  const cnt = (sev) => veics.filter(v => sevInvest_(v.status) === sev).length;
  h += '<tr><td style="background:#fff;padding:14px 30px;border-bottom:1px solid ' + MG.linha + ';font-size:13px">' +
    '<span style="color:' + MG.verde + ';font-weight:bold">● ' + cnt('ok') + '</span> no ritmo &nbsp;&nbsp;&nbsp;' +
    '<span style="color:' + MG.amarelo + ';font-weight:bold">● ' + cnt('aten') + '</span> com ajuste &nbsp;&nbsp;&nbsp;' +
    '<span style="color:' + MG.vermelho + ';font-weight:bold">● ' + cnt('crit') + '</span> fora do pacing &nbsp;&nbsp;&nbsp;' +
    '<span style="color:' + MG.neutro + '">' + crit.length + ' crítico(s) · ' + aten.length + ' atenção</span></td></tr>';

  // ---- Ação hoje (críticos operacionais; os de pacing já aparecem na tabela)
  const acao = crit.filter(a => soCriticos || !/\|pacing$/.test(a.chave));
  if (acao.length) {
    h += '<tr><td style="background:#fff;padding:18px 30px 6px 30px">' + titulo_('Ação hoje') + '</td></tr>';
    acao.forEach(a => {
      h += '<tr><td style="background:#fff;padding:6px 30px;border-bottom:1px solid ' + MG.linha + ';font-size:13px">' +
        '<span style="color:' + MG.vermelho + '">●</span> <b>' + esc_(a.conta) + (a.titulo.indexOf(' / ') >= 0 ? ' · ' + esc_(a.titulo.split(' / ').pop()) : '') + '</b> ' +
        '<span style="color:' + MG.cinza + '">' + esc_(a.titulo.split(':')[0].replace(/ \[.*\]/, '').toLowerCase()) + '. ' + esc_(a.detalhe) + '</span>' +
        (a.persistencia !== 'NOVO' ? ' <span style="font-size:11px;color:' + MG.neutro + '">(' + a.persistencia + ')</span>' : '') + '</td></tr>';
    });
    h += '<tr><td style="background:#fff;padding:6px"></td></tr>';
  }

  // ---- Tabela executiva
  const faltantes = [];
  h += '<tr><td style="background:#fff;padding:18px 30px 6px 30px">' + titulo_('Contas') + '</td></tr>';
  h += '<tr><td style="background:#fff;padding:0 30px 20px 30px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">';
  const th = (t, al) => '<th style="text-align:' + (al || 'right') + ';font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:' + MG.cinza + ';padding:8px 6px;border-bottom:2px solid ' + MG.preto + '">' + t + '</th>';
  h += '<tr>' + th('Conta', 'left') + th('Plataforma', 'left') + th('Investimento') + th('Receita') + th('ROAS') + th('CPA') + '</tr>';

  const cel = (sev, valor, desc) => {
    if (sev === 'na') return '<td style="text-align:right;padding:10px 6px;border-bottom:1px solid ' + MG.linha + ';color:' + MG.neutro + '">n/d</td>';
    const cor = pontoCor_(sev);
    return '<td style="text-align:right;padding:10px 6px;border-bottom:1px solid ' + MG.linha + ';white-space:nowrap">' +
      '<span style="color:' + cor + ';font-size:15px">●</span> <b style="color:' + (sev === 'crit' ? cor : MG.preto) + '">' + valor + '</b>' +
      (sev === 'crit' && desc ? '<br><span style="font-size:11px;color:' + cor + '">' + desc + '</span>' : '') + '</td>';
  };

  painel.contas.forEach(c => {
    const vs = c.veiculos || [];
    vs.forEach((v, i) => {
      const rot = c.nome + ' · ' + v.nome;
      // Investimento
      const sI = v.inconsistente ? 'na' : (v.budget ? sevInvest_(v.status) : 'na');
      if (v.inconsistente) faltantes.push({ rot: rot, o: 'investido incompatível com o budget (conferir fórmula da linha 7)' });
      if (!v.budget && !c.porCpa) faltantes.push({ rot: rot, o: 'verba do mês' });
      if (v.gastoOntem === null) faltantes.push({ rot: rot, o: 'gasto de ' + datas.labelOntem });
      const dI = v.emCorrecao ? 'em correção: ontem ' + brlK_(v.gastoOntem) + ' contra ritmo necessário ' + brlK_(v.ritmoNec) + '/dia'
        : v.budget ? (v.desvio >= 0 ? 'fecha em ' + brlK_(v.proj) + ' (+' + brlK_(v.desvio) + ') · frear ' + brlK_(Math.abs(v.ajuste)) + '/dia'
        : 'fecha em ' + brlK_(v.proj) + ' (' + brlK_(v.desvio) + ') · acelerar ' + brlK_(Math.abs(v.ajuste)) + '/dia') : '';
      // Receita
      const sR = sevReceita_(v.statusReceita);
      if (sR === 'na') faltantes.push({ rot: rot, o: v.receita ? 'meta de receita' : 'receita' });
      const dR = 'fecha em ' + brlK_(v.projReceita) + ' · gap ' + brlK_(v.projReceita - v.metaReceita);
      // ROAS
      const sRo = sevRoas_(v);
      if (sRo === 'na') faltantes.push({ rot: rot, o: v.roas ? 'meta de ROAS' : 'ROAS' });
      // CPA
      const sC = sevCpa_(v);
      if (sC === 'na') faltantes.push({ rot: rot, o: v.cpa ? 'meta de CPA' : 'CPA' });

      h += '<tr>' +
        '<td style="padding:10px 6px;border-bottom:1px solid ' + MG.linha + ';white-space:nowrap">' + (i === 0 ? '<b>' + esc_(c.nome) + '</b>' + (c.credito ? '<br><span style="font-size:10px;color:' + MG.dourado + ';letter-spacing:1px">CRÉDITO AGÊNCIA</span>' : '') : '') + '</td>' +
        '<td style="padding:10px 6px;border-bottom:1px solid ' + MG.linha + ';color:' + MG.cinza + '">' + esc_(v.nome) + '</td>' +
        cel(sI, brl_(v.investido) + '<span style="font-weight:normal;color:' + MG.neutro + '"> / ' + brlK_(v.budget) + '</span>', dI) +
        cel(sR, brl_(v.receita) + '<span style="font-weight:normal;color:' + MG.neutro + '"> / ' + brlK_(v.metaReceita) + '</span>', dR) +
        cel(sRo, v.roas.toFixed(2) + '<span style="font-weight:normal;color:' + MG.neutro + '"> / ' + v.metaRoas.toFixed(1) + '</span>', 'meta ' + v.metaRoas.toFixed(2)) +
        cel(sC, brl_(v.cpa) + '<span style="font-weight:normal;color:' + MG.neutro + '"> / ' + brlK_(v.metaCpa) + '</span>', 'meta ' + brl_(v.metaCpa)) +
        '</tr>';
    });
    if (!vs.length) faltantes.push({ rot: c.nome, o: 'nenhum dado lançado' });
  });
  h += '</table></td></tr>';

  // ---- Gráficos: investimento e receita vs meta
  if (!soCriticos) {
    let g = '';
    painel.contas.forEach(c => {
      const vs = (c.veiculos || []).filter(v => v.budget > 0 || v.metaReceita > 0);
      if (!vs.length) return;
      g += '<tr><td colspan="3" style="padding:12px 0 2px 0;font-size:12px;font-weight:bold;color:' + MG.preto + ';border-bottom:1px solid ' + MG.linha + '">' + esc_(c.nome) +
        (c.credito ? ' <span style="font-size:10px;color:' + MG.dourado + ';letter-spacing:1px;font-weight:normal">CRÉDITO AGÊNCIA</span>' : '') + '</td></tr>';
      vs.forEach(v => {
        if (v.budget > 0) g += linhaBarra_(esc_(v.nome) + ' · investimento', v.investido, v.budget, v.proj, datas.pctMes, pontoCor_(sevInvest_(v.status)), 'moeda');
        if (v.metaReceita > 0) g += linhaBarra_(esc_(v.nome) + ' · receita', v.receita, v.metaReceita, v.projReceita, datas.pctMes, pontoCor_(sevReceita_(v.statusReceita)), 'moeda');
      });
    });
    if (g) {
      h += '<tr><td style="background:#fff;padding:18px 30px 6px 30px;border-top:1px solid ' + MG.linha + '">' + titulo_('Onde está, onde deveria estar e onde vai fechar') + '</td></tr>';
      h += '<tr><td style="background:#fff;padding:0 30px 4px 30px;font-size:11px;color:' + MG.neutro + '">' +
        '<span style="display:inline-block;width:14px;height:9px;background:' + MG.preto + ';vertical-align:middle"></span> gasto/receita até ontem &nbsp;&nbsp;' +
        '<span style="display:inline-block;width:14px;height:9px;background:#DDDAD3;vertical-align:middle"></span> projeção de fechamento &nbsp;&nbsp;' +
        '<span style="display:inline-block;width:2px;height:12px;background:' + MG.preto + ';vertical-align:middle"></span> onde deveria estar hoje (' + pct_(datas.pctMes) + ' do mês)</td></tr>';
      h += '<tr><td style="background:#fff;padding:0 30px 20px 30px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' + g + '</table></td></tr>';
    }
  }

  // ---- Dados faltantes
  if (faltantes.length && !soCriticos) {
    const porConta = {};
    faltantes.forEach(f => { (porConta[f.rot] = porConta[f.rot] || []).push(f.o); });
    h += '<tr><td style="background:' + MG.bege + ';padding:16px 30px 6px 30px">' + titulo_('Dados faltantes') + '</td></tr>';
    h += '<tr><td style="background:' + MG.bege + ';padding:0 30px 20px 30px;font-size:12px;color:' + MG.cinza + '">';
    Object.keys(porConta).forEach(rot => {
      h += '<div style="padding:4px 0;border-bottom:1px solid ' + MG.linha + '"><b style="color:' + MG.preto + '">' + esc_(rot) + '</b> &nbsp;' + porConta[rot].join(' · ') + '</div>';
    });
    h += '</td></tr>';
  }

  h += '<tr><td style="background:#fff;padding:14px 30px;font-size:10px;color:' + MG.neutro + ';border-top:1px solid ' + MG.linha + '">' +
    '<span style="color:' + MG.verde + '">●</span> dentro da meta &nbsp; <span style="color:' + MG.amarelo + '">●</span> até 15% fora &nbsp; <span style="color:' + MG.vermelho + '">●</span> acima de 15% fora &nbsp; n/d = sem meta ou sem dado. ' +
    'Investimento e receita comparados com o % do mês já decorrido. Contas de crédito da agência ficam vermelhas com 5% de sobregasto.</td></tr>';
  h += '</table></div>';
  return h;
}

// ---- Barra de progresso em HTML puro (funciona em Gmail/Outlook, sem script)
//  valor = realizado, meta = verba ou meta, proj = projeção de fechamento,
//  marca = fração do mês decorrido (onde deveria estar hoje), cor = cor do status.
function barra_(valor, meta, proj, marca, cor) {
  const claro = { '#2E7D4F': '#BFDCC9', '#C48A00': '#F1DCA6', '#B3261E': '#EBC2BF', '#9A978F': '#DDDAD3' }[cor] || '#DDDAD3';
  const a = Math.max(0, Math.min(valor / meta, 1));
  const b = Math.max(a, Math.min(proj / meta, 1));
  const m = Math.max(0, Math.min(marca, 1));
  const pontos = [0, a, b, m, 1].sort((x, y) => x - y);
  let h = '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed"><tr>';
  for (let i = 1; i < pontos.length; i++) {
    const ini = pontos[i - 1], fim = pontos[i];
    if (Math.abs(ini - m) < 1e-9 && i > 0 && m > 0 && m < 1) {
      h += '<td width="2" style="width:2px;height:14px;background:' + MG.preto + ';padding:0;font-size:1px;line-height:1px">&nbsp;</td>';
    }
    const w = Math.round((fim - ini) * 1000) / 10;
    if (w <= 0) continue;
    const bg = fim <= a + 1e-9 ? cor : fim <= b + 1e-9 ? claro : '#EBE7DE';
    h += '<td width="' + w + '%" style="width:' + w + '%;height:14px;background:' + bg + ';padding:0;font-size:1px;line-height:1px">&nbsp;</td>';
  }
  h += '</tr></table>';
  return h;
}
function linhaBarra_(rotulo, valor, meta, proj, marca, cor, unidade) {
  const fmt = unidade === 'moeda' ? brlK_ : (x => Number(x).toFixed(2));
  const excede = proj > meta * 1.001 ? ' <span style="color:' + cor + ';font-weight:bold">+' + pct_(proj / meta - 1) + '</span>' : '';
  return '<tr>' +
    '<td style="padding:7px 6px 7px 0;font-size:12px;color:' + MG.cinza + ';white-space:nowrap;width:150px">' + rotulo + '</td>' +
    '<td style="padding:7px 10px 7px 0">' + barra_(valor, meta, proj, marca, cor) + '</td>' +
    '<td style="padding:7px 0;font-size:12px;white-space:nowrap;text-align:right;width:230px">' +
    '<b style="color:' + (cor === MG.vermelho ? MG.vermelho : MG.preto) + '">' + fmt(valor) + '</b>' +
    '<span style="color:' + MG.neutro + '"> de ' + fmt(meta) + ' · fecha em </span>' + fmt(proj) + excede + '</td>' +
    '</tr>';
}

function titulo_(t) {
  return '<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:' + MG.dourado + ';font-weight:bold">' + t + '</div>';
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

function pad_(s, n) { s = String(s); return s.length >= n ? s.substring(0, n - 1) + ' ' : s + ' '.repeat(n - s.length); }
function brlCurto_(v) { return brl_(v).replace('R$ ', '').replace(',00', ''); }
function mesExtenso_(m) { return ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'][m - 1]; }

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
    if (s.getName().indexOf('_old_') === 0) return false;   // sobras de migração (migracao.gs)
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
  return String(s === null || s === undefined ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
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
// ---------------------------------------------------------------------
//  TESTE DE PONTA A PONTA
// ---------------------------------------------------------------------
/**
 * Confere a cadeia inteira sem gravar célula, sem renomear arquivo e sem Slack,
 * e manda um checklist por e-mail para quem executou. Rode pelo editor ou pelo
 * menu. Cada item sai como OK, ATENÇÃO ou FALHA com a explicação ao lado.
 *
 * O que confere:
 *   1. Arquivos do projeto (Código.gs, ingestao.gs, tendencias.gs, conta.gs)
 *   2. Gatilhos instalados e horários
 *   3. Pasta do Drive acessível e arquivos de ontem (pacing_, detalhe_, tendencias_, relatorio_)
 *   4. Arquivos de TESTE do coletor (teste_pacing_ e teste_detalhe_), se existirem: parse e contagem
 *   5. Planilha externa de orçamento
 *   6. PAINEL e abas de conta (nome, budget, dado de ontem, dado inconsistente)
 *   7. SERIE DIARIA (dias com dado nos últimos 30) e DETALHE CAMPANHA (linhas nos últimos 7)
 *   8. Propriedades do Slack
 *   9. Monta o e-mail da carteira (modo teste) e o e-mail de uma conta, e anexa os dois
 */
function testarTudo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const datas = calcularDatas_();
  const fuso = CONFIG.FUSO;
  const ontem = Utilities.formatDate(datas.ontem, fuso, 'yyyy-MM-dd');
  const itens = [];
  const add = (nivel, titulo, detalhe) => { itens.push({ nivel, titulo, detalhe }); Logger.log('[%s] %s: %s', nivel, titulo, detalhe); };

  // 1. Arquivos do projeto
  try {
    const inst = conferirInstalacao();
    add(inst.ok ? 'OK' : 'FALHA', 'Arquivos do projeto', inst.msg);
  } catch (e) { add('FALHA', 'Arquivos do projeto', e.message); }

  // 2. Gatilhos
  try {
    const ts = ScriptApp.getProjectTriggers();
    const fns = ts.map(t => t.getHandlerFunction());
    const temA = fns.indexOf('rodarAlertas') >= 0, temR = fns.indexOf('enviarRelatorio30d') >= 0;
    const extras = fns.filter(f => f !== 'rodarAlertas' && f !== 'enviarRelatorio30d' && f !== 'enviarProximoDaFila');
    add(temA && temR && !extras.length ? 'OK' : 'FALHA', 'Gatilhos',
      ts.length + ' gatilho(s): ' + (fns.join(', ') || 'nenhum') + (extras.length ? '. Sobrando: ' + extras.join(', ') : '') +
      (!temA || !temR ? '. Rode instalarGatilhos.' : '. Horários: alertas ~' + CONFIG.HORARIOS.ALERTAS.hora + 'h' + pad2_(CONFIG.HORARIOS.ALERTAS.minuto) +
        ', relatório ~' + CONFIG.HORARIOS.RELATORIO.hora + 'h' + pad2_(CONFIG.HORARIOS.RELATORIO.minuto) + '.'));
  } catch (e) { add('FALHA', 'Gatilhos', e.message); }

  // 3. Pasta e arquivos de ontem
  let pasta = null;
  try {
    pasta = DriveApp.getFolderById(ING.PASTA_ID);
    const nomes = [];
    const it = pasta.getFiles();
    while (it.hasNext()) { const f = it.next(); nomes.push(f.getName()); }
    const tem = n => nomes.indexOf(n) >= 0;
    const st = (base) => tem(base + '.processado') ? 'processado' : tem(base) ? 'na pasta, ainda não lido' : 'AUSENTE';
    const pac = st('pacing_' + ontem + '.json'), det = st('detalhe_' + ontem + '.json');
    const ten = tem('tendencias_' + ontem + '.json') ? 'ok' : 'AUSENTE';
    const rel = tem('relatorio_' + ontem + '.html') ? 'ok' : 'AUSENTE';
    add(pac === 'AUSENTE' ? 'FALHA' : 'OK', 'Coleta de ontem (pacing_' + ontem + ')', pac);
    add(det === 'AUSENTE' ? 'ATENÇÃO' : 'OK', 'Detalhe de ontem (detalhe_' + ontem + ')',
      det + (det === 'AUSENTE' ? '. O coletor precisa entregar este arquivo; sem ele não há e-mail por campanha.' : ''));
    add(ten === 'AUSENTE' ? 'ATENÇÃO' : 'OK', 'Tendências de ontem', ten + (ten === 'AUSENTE' ? ' (gerado pelo rodarAlertas das 8h)' : ''));
    add(rel === 'AUSENTE' ? 'ATENÇÃO' : 'OK', 'Relatório do agente de análise', rel + (rel === 'AUSENTE' ? ' (gerado pelo agente das 9h05)' : ''));
    const soltos = nomes.filter(n => /^pacing_\d{4}-\d{2}-\d{2}\.json$/.test(n) && n !== 'pacing_' + ontem + '.json');
    if (soltos.length) add('ATENÇÃO', 'Coletas de outros dias na pasta', soltos.join(', ') + '. Apague; backfill está desligado.');
    else add('OK', 'Pasta limpa', 'nenhum pacing_ de outro dia sem processar');
  } catch (e) { add('FALHA', 'Pasta do Drive', e.message); }

  // 4. Arquivos de TESTE do coletor (prefixo teste_), sem gravar nada
  if (pasta) {
    try {
      const rp = importarPacingDoDrive_(ss, datas, [], { prefixo: ING.PREFIXO_TESTE, somenteLer: true, naoRenomear: true });
      add(rp.ok ? 'OK' : 'ATENÇÃO', 'teste_pacing_' + ontem + '.json',
        rp.ok ? rp.contas + ' conta(s) reconhecida(s): ' + (rp.contasLidas || []).join(', ') : rp.motivo + ' (dispare o coletor em modo TESTE para gerar)');
      const rd = importarDetalheDoDrive_(ss, datas, [], { prefixo: ING.PREFIXO_TESTE, somenteLer: true, naoRenomear: true });
      add(rd.ok ? (rd.campanhas && rd.alteracoes ? 'OK' : 'ATENÇÃO') : 'ATENÇÃO', 'teste_detalhe_' + ontem + '.json',
        rd.ok ? rd.campanhas + ' linhas de campanha, ' + rd.termos + ' termos, ' + rd.criativos + ' criativos, ' + rd.alteracoes +
          ' alterações, dias ' + rd.dias.join(', ') + ', contas ' + rd.contas.join(', ') : rd.motivo);
    } catch (e) { add('FALHA', 'Leitura dos arquivos de teste', e.message); }
  }

  // 5. Orçamento externo
  let orcamentos = {};
  try {
    orcamentos = lerOrcamentosExternos_();
    add(Object.keys(orcamentos).length ? 'OK' : 'FALHA', 'Planilha de orçamento', Object.keys(orcamentos).length + ' cliente(s) lidos');
  } catch (e) { add('FALHA', 'Planilha de orçamento', e.message); }

  // 6. PAINEL e contas
  let painel = null;
  const alertas = [];
  try {
    painel = lerPainel_(ss, datas, alertas);
    painel.contas.forEach(c => analisarConta_(ss, c, datas, orcamentos, alertas));
    painel.contas.forEach(c => {
      const vs = c.veiculos || [];
      const probl = [];
      vs.forEach(v => {
        if (v.inconsistente) probl.push(v.nome + ': investido incompatível com o budget (fórmula da linha 7)');
        else if (v.budget > 0 && v.gastoOntem === null) probl.push(v.nome + ': sem gasto lançado ontem');
      });
      add(probl.length ? 'ATENÇÃO' : 'OK', 'Conta ' + c.nome + ' (' + (c.responsavel || 'sem responsável') + ')',
        probl.length ? probl.join(' · ') : vs.length + ' veículo(s), dado de ontem lançado');
    });
  } catch (e) { add('FALHA', 'PAINEL', e.message); }

  // 7. Série diária e detalhe
  try {
    const serie = lerSerie_(ss, datas);
    let contas = 0, diasMax = 0;
    Object.keys(serie).forEach(c => Object.keys(serie[c]).forEach(p => { contas++; diasMax = Math.max(diasMax, serie[c][p].length); }));
    add(diasMax >= TEND.MIN_DIAS_PARA_TENDENCIA ? 'OK' : 'ATENÇÃO', 'SERIE DIARIA', contas + ' conta/plataforma com dado, até ' + diasMax + ' dia(s) nos últimos 30' +
      (diasMax < TEND.MIN_DIAS_PARA_TENDENCIA ? '. Rode reconstruirSerieDoMesAtual.' : ''));
    const det = lerDetalhe7d_(ss, datas, 7);
    const nC = Object.keys(det.campanhas).reduce((a, c) => a + det.campanhas[c].length, 0);
    const nA = Object.keys(det.alteracoes).reduce((a, c) => a + det.alteracoes[c].length, 0);
    add(nC ? 'OK' : 'ATENÇÃO', 'DETALHE CAMPANHA (7 dias)', nC + ' campanha(s) em ' + Object.keys(det.campanhas).length + ' conta(s); ' + nA + ' alteração(ões)' +
      (nC ? '' : '. Vazio até o primeiro detalhe_ ser ingerido.'));
  } catch (e) { add('FALHA', 'SERIE DIARIA / DETALHE', e.message); }

  // 8. Slack
  const props = PropertiesService.getScriptProperties();
  const wh = props.getProperty('SLACK_WEBHOOK_URL'), tk = props.getProperty('SLACK_BOT_TOKEN');
  add(wh || tk ? 'OK' : 'ATENÇÃO', 'Slack', (wh ? 'webhook configurado' : 'sem webhook') + ', ' + (tk ? 'bot token configurado (gráficos no canal)' : 'sem bot token (Slack sai só em texto)') +
    (!wh && !tk ? '. Sem os dois o canal fica mudo e vira alerta.' : ''));

  // 9. E-mails de exemplo
  const eu = CONFIG.EMAILS_TESTE.join(',');
  const anexos = [];
  try {
    if (painel) {
      const crit = alertas.filter(a => a.nivel === NIVEL.CRITICO), aten = alertas.filter(a => a.nivel === NIVEL.ATENCAO), info = alertas.filter(a => a.nivel === NIVEL.INFO);
      anexos.push(Utilities.newBlob(montarHtml_(crit, aten, info, painel, datas, ss.getUrl()), 'text/html', 'exemplo_email_carteira.html'));
      if (typeof montarHtmlConta_ === 'function') {
        const c = painel.contas.filter(x => (x.veiculos || []).length)[0];
        if (c) {
          const m = montarHtmlConta_(ss, c, datas, null, lerDetalhe7d_(ss, datas, 7), lerSerie_(ss, datas));
          anexos.push(Utilities.newBlob(m.html, 'text/html', 'exemplo_email_' + c.nome.replace(/\W+/g, '_') + '.html'));
          Object.keys(m.imagens).forEach(k => anexos.push(m.imagens[k]));
        }
      }
      add('OK', 'E-mails de exemplo', anexos.length + ' HTML anexado(s) a este checklist');
    }
  } catch (e) { add('FALHA', 'E-mails de exemplo', e.message); }

  // Checklist
  const cor = { OK: '#2E7D4F', 'ATENÇÃO': '#C48A00', FALHA: '#B3261E' };
  const nF = itens.filter(i => i.nivel === 'FALHA').length, nA = itens.filter(i => i.nivel === 'ATENÇÃO').length;
  let html = '<div style="font-family:Inter,Arial,sans-serif;color:#1A1A18;background:#F0EDE6;padding:20px"><table width="760" align="center" cellpadding="0" cellspacing="0" style="background:#fff;border-collapse:collapse">' +
    '<tr><td style="background:#1A1A18;color:#fff;padding:18px 24px;border-bottom:3px solid #C9A227"><div style="font-size:11px;letter-spacing:2px;color:#C9A227">MODESTO GROWTH PARTNERS · CONTROLE DE MÍDIA</div>' +
    '<div style="font-size:22px;margin-top:4px">Teste de ponta a ponta</div><div style="font-size:12px;color:#BDB9B0;margin-top:4px">Executado em ' +
    Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm') + ' · dados de ' + datas.labelOntem + ' · ' + nF + ' falha(s), ' + nA + ' atenção</div></td></tr>';
  itens.forEach(i => {
    html += '<tr><td style="padding:10px 24px;border-bottom:1px solid #E2DDD3;font-size:13px"><span style="display:inline-block;min-width:74px;font-weight:bold;color:' + cor[i.nivel] + '">' +
      i.nivel + '</span> <b>' + esc_(i.titulo) + '</b><div style="color:#4A4A46;margin-top:2px;font-size:12px">' + esc_(i.detalhe) + '</div></td></tr>';
  });
  html += '<tr><td style="padding:14px 24px;font-size:11px;color:#9A978F">Nada foi gravado na planilha, nenhum arquivo foi renomeado e o Slack não foi acionado. ' +
    'Para validar a gravação de verdade, use o menu Importar coleta / Importar detalhe com o arquivo do dia.</td></tr></table></div>';
  MailApp.sendEmail({ to: eu, subject: (nF ? '🔴 ' : nA ? '🟡 ' : '🟢 ') + '[TESTE] [Pacing] Teste de ponta a ponta · ' + datas.labelOntem, htmlBody: html,
    attachments: anexos, name: 'Controle de Pacing | Modesto Growth' });
  const resumo = 'Checklist enviado para ' + eu + ': ' + nF + ' falha(s), ' + nA + ' atenção, ' + (itens.length - nF - nA) + ' ok.';
  Logger.log(resumo);
  try { SpreadsheetApp.getUi().alert(resumo); } catch (e) {}
  return itens;
}
