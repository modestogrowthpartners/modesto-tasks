/**
 * =====================================================================
 *  E-MAIL POR CONTA  |  conta.gs  ·  v3.4 (22/09/2026)
 *  Modesto Growth Partners
 * =====================================================================
 *
 *  Um e-mail por CLIENTE (Amakha, Meu Rodapé, Ruminar...), para o time inteiro
 *  de analistas (CONFIG.EMAILS_TIME). Para não cair uma rajada de 9 e-mails, o
 *  rodarAlertas das 8h só ENFILEIRA; um gatilho do próprio Apps Script manda um
 *  cliente por vez, a cada CONFIG.EMAIL_CONTA.INTERVALO_MIN minutos, críticos
 *  primeiro. Teste (testarEmailConta) vai só para CONFIG.EMAILS_TESTE.
 *
 *  v3.2 (21/09/2026): o e-mail só mostra o que a conta TEM. Conta sem Meta não
 *  ganha coluna nem card de Meta; conta por lead (sem receita) não ganha card
 *  de receita, ROAS, gráfico de receita nem coluna de ROAS; sem meta de CPA,
 *  sem card de CPA; seção sem dado (gráfico, tendência, campanha, tracking)
 *  some inteira, em vez de ficar um quadro "indisponível". Nada de "n/d" ou
 *  "sem meta cadastrada" ocupando lugar.
 *
 *  v3.3 (22/09/2026): "Boletim de ontem" antes dos gráficos (o que aconteceu
 *  no dia, em 3 a 6 frases com número), gráfico "Receita do mês" (acumulada x
 *  ideal da meta x projeção, o mesmo desenho do pacing) e Slack com o mesmo
 *  conteúdo do e-mail executivo: blocos curtos por conta + gráfico de pacing
 *  em imagem (enviarSlackVisual_, precisa de SLACK_BOT_TOKEN com files:write).
 *
 *  v3.4 (22/09/2026): o Slack vira o espelho do e-mail executivo: "N contas
 *  para olhar hoje", placar das contas citadas com status por plataforma, e
 *  uma seção por conta crítica com verba, alertas e o gráfico de pacing na
 *  própria mensagem (image block com slack_file). Sem crítico, placar da
 *  carteira. Sem files:write, sai sem gráfico e avisa na aba ALERTAS.
 *
 *  Layout: cabeçalho · cards (só os que existem) · Boletim de ontem · Ontem ·
 *  "No total, estou na meta?" · 3 faixas de ação · Pacing do mês · Receita do
 *  mês · Gasto por dia 14d · Mix + Receita vs meta · ROAS 7d + Funil · Por
 *  plataforma · Tendências · Por campanha · 5 elefantes na sala · rodapé.
 *
 *  Os gráficos são PNG gerados pelo serviço Charts do Apps Script e vão como
 *  imagem embutida (cid:).
 *
 *  Fontes (nada é recalculado aqui além de soma, divisão e média móvel):
 *   - aba da conta + PAINEL              -> cards, tabela por plataforma
 *   - SERIE DIARIA (tendencias.gs)       -> Ontem x 7d, pacing, gasto por dia, ROAS 7d, funil
 *   - tendencias_ (gerarTendencias_)     -> previsão, ritmo necessário, status previsto
 *   - DETALHE CAMPANHA / ALTERACOES      -> por campanha com veredito, elefantes
 *
 *  Depende de: Código.gs (CONFIG, MG, brl_, brlK_, pct_, esc_, pontoCor_, sev*_,
 *  statusVeiculo_, statusReceita_, rotuloStatusCurto_), tendencias.gs (lerSerie_,
 *  plataformaCanonica_, veredito_, resumoOntem_, fmtIso_), ingestao.gs (lerDetalhe7d_).
 */

const CONTA_MOEDA = { 'WONDR EXPERIENCE': '€', 'BARBIE': '€', 'ALLIANCE BR': '$', 'ALLIANCE LATAM': '$' };

// Cores das plataformas, iguais às do mockup
const COR_PLAT = { Google: '#B08A1E', Meta: '#2A6F9E', Pinterest: '#B0522E', TikTok: '#4A4A46' };
const COR_PLAT_CLARA = { Google: '#DDD1A6', Meta: '#A9C4D6', Pinterest: '#E0B5A8', TikTok: '#B9B7B2' };
function corPlat_(p) { return COR_PLAT[p] || '#777777'; }

/** Menu / editor: manda o e-mail de uma conta só para quem executa. */
function testarEmailConta(nomeConta) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const datas = calcularDatas_();
  const alertas = [];
  const painel = lerPainel_(ss, datas, alertas);
  const orcamentos = (function () { try { return lerOrcamentosExternos_(); } catch (e) { return {}; } })();
  painel.contas.forEach(c => analisarConta_(ss, c, datas, orcamentos, alertas));
  const alvo = String(nomeConta || 'MEU RODAPE');
  const c = painel.contas.filter(x => normalizar_(x.nome) === normalizar_(alvo))[0] || painel.contas.filter(x => (x.veiculos || []).length)[0];
  if (!c) throw new Error('Conta ' + alvo + ' não encontrada no PAINEL.');
  const det = lerDetalhe7d_(ss, datas, 7);
  const serie = lerSerie_(ss, datas);
  const m = montarHtmlConta_(ss, c, datas, lerTendenciasDoDrive_(datas), det, serie);
  const eu = CONFIG.EMAILS_TESTE.join(',');
  MailApp.sendEmail({ to: eu, subject: '[TESTE] [Pacing] ' + c.nome + ' · ' + datas.labelOntem, htmlBody: m.html, inlineImages: m.imagens, name: 'Controle de Pacing | Modesto Growth' });
  Logger.log('E-mail de teste da conta %s enviado para %s (%s KB de HTML, %s imagens).', c.nome, eu, Math.round(m.html.length / 1024), Object.keys(m.imagens).length);
  try { SpreadsheetApp.getUi().alert('E-mail de ' + c.nome + ' enviado para ' + eu); } catch (e) {}
}

// ---------------------------------------------------------------------
//  FILA COM CADÊNCIA
// ---------------------------------------------------------------------
const FILA_PROP = 'FILA_EMAIL_CONTA';

/**
 * Chamado pelo executar_ (Código.gs) no fim da rodada das 8h. Não manda nada:
 * grava a fila (críticos primeiro) e agenda o primeiro envio.
 */
function agendarFilaEmailsConta_(ss, painel, datas) {
  const peso = { crit: 0, aten: 1, ok: 2 };
  const contas = painel.contas.filter(c => (c.veiculos || []).length)
    .map(c => ({ nome: c.nome, sev: severidadeConta_(c) }))
    .sort((a, b) => (peso[a.sev] === undefined ? 9 : peso[a.sev]) - (peso[b.sev] === undefined ? 9 : peso[b.sev]))
    .map(x => x.nome);
  const fila = { dia: fmtIso_(datas.ontem), contas: contas, enviados: [], criadaEm: new Date().toISOString() };
  PropertiesService.getScriptProperties().setProperty(FILA_PROP, JSON.stringify(fila));
  limparGatilhosFila_();
  if (contas.length) agendarProximoDaFila_(CONFIG.EMAIL_CONTA.PRIMEIRO_APOS_MIN);
  Logger.log('Fila de e-mails por cliente: %s cliente(s), primeiro em %s min: %s', contas.length, CONFIG.EMAIL_CONTA.PRIMEIRO_APOS_MIN, contas.join(', '));
}

/**
 * Editor / menu: dispara HOJE os e-mails por cliente para o time inteiro, sem
 * repetir o rodarAlertas (sem e-mail da carteira, sem Slack, sem mexer no
 * histórico). Usa o que já está lançado na planilha e o tendencias_ de ontem
 * que está no Drive. O primeiro cliente sai em 1 minuto, os demais a cada
 * CONFIG.EMAIL_CONTA.INTERVALO_MIN. Para ver o andamento: verFilaEmailsConta.
 */
function enviarEmailsClientesAgora() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const datas = calcularDatas_();
  const alertas = [];
  const painel = lerPainel_(ss, datas, alertas);
  const orcamentos = (function () { try { return lerOrcamentosExternos_(); } catch (e) { return {}; } })();
  painel.contas.forEach(c => analisarConta_(ss, c, datas, orcamentos, alertas));
  const contas = painel.contas.filter(c => (c.veiculos || []).length).map(c => c.nome);
  if (!contas.length) throw new Error('Nenhuma conta com dado lançado no PAINEL.');
  agendarFilaEmailsConta_(ss, painel, datas);
  // o primeiro sai já, não daqui a PRIMEIRO_APOS_MIN
  limparGatilhosFila_();
  agendarProximoDaFila_(1);
  const msg = contas.length + ' e-mail(s) por cliente enfileirados para ' + CONFIG.EMAILS_TIME.join(', ') + '. Primeiro em 1 min, depois um a cada ' +
    CONFIG.EMAIL_CONTA.INTERVALO_MIN + ' min. Ordem: ' + JSON.parse(PropertiesService.getScriptProperties().getProperty(FILA_PROP)).contas.join(', ');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

function agendarProximoDaFila_(minutos) {
  ScriptApp.newTrigger('enviarProximoDaFila').timeBased().after(Math.max(1, minutos) * 60 * 1000).create();
}

/** Apaga os gatilhos one-shot da fila (os já disparados ficam órfãos no projeto). */
function limparGatilhosFila_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'enviarProximoDaFila').forEach(t => ScriptApp.deleteTrigger(t));
}

/** Gatilho: manda o próximo cliente da fila para o time e agenda o seguinte. */
function enviarProximoDaFila() {
  limparGatilhosFila_();
  const props = PropertiesService.getScriptProperties();
  const fila = JSON.parse(props.getProperty(FILA_PROP) || 'null');
  if (!fila || !fila.contas || !fila.contas.length) { Logger.log('Fila vazia.'); return; }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const datas = calcularDatas_();
  if (fila.dia !== fmtIso_(datas.ontem)) {
    Logger.log('Fila de %s descartada: o dia virou (%s).', fila.dia, fmtIso_(datas.ontem));
    props.deleteProperty(FILA_PROP);
    return;
  }
  const nome = fila.contas.shift();
  try {
    const alertas = [];
    const painel = lerPainel_(ss, datas, alertas);
    const orcamentos = (function () { try { return lerOrcamentosExternos_(); } catch (e) { return {}; } })();
    painel.contas.forEach(c => analisarConta_(ss, c, datas, orcamentos, alertas));
    const c = painel.contas.filter(x => x.nome === nome)[0];
    if (c && (c.veiculos || []).length) {
      const m = montarHtmlConta_(ss, c, datas, lerTendenciasDoDrive_(datas), lerDetalhe7d_(ss, datas, 7), lerSerie_(ss, datas));
      const sev = severidadeConta_(c);
      MailApp.sendEmail({
        to: CONFIG.EMAILS_TIME.join(','),
        subject: (sev === 'crit' ? '🔴 ' : sev === 'aten' ? '🟡 ' : '🟢 ') + '[Pacing] ' + c.nome + ' · ' + datas.labelOntem,
        htmlBody: m.html, inlineImages: m.imagens, name: 'Controle de Pacing | Modesto Growth'
      });
      fila.enviados.push(nome + ' ' + Utilities.formatDate(new Date(), CONFIG.FUSO, 'HH:mm'));
      Logger.log('E-mail do cliente %s enviado para o time (%s restantes).', nome, fila.contas.length);
    } else {
      Logger.log('Cliente %s não encontrado no PAINEL; pulado.', nome);
    }
  } catch (e) {
    Logger.log('E-mail do cliente %s falhou: %s', nome, e.message);
    fila.enviados.push(nome + ' FALHOU: ' + e.message);
  }
  props.setProperty(FILA_PROP, JSON.stringify(fila));
  if (fila.contas.length) agendarProximoDaFila_(CONFIG.EMAIL_CONTA.INTERVALO_MIN);
}

/** Menu / editor: mostra o estado da fila. */
function verFilaEmailsConta() {
  const fila = JSON.parse(PropertiesService.getScriptProperties().getProperty(FILA_PROP) || 'null');
  const pend = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'enviarProximoDaFila').length;
  const msg = !fila ? 'Sem fila gravada.' : 'Fila de ' + fila.dia + ': a enviar [' + fila.contas.join(', ') + '] · enviados [' + fila.enviados.join(', ') + '] · gatilhos pendentes: ' + pend;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/** Lê o tendencias_ de ontem que o rodarAlertas deixou no Drive (ou null). */
function lerTendenciasDoDrive_(datas) {
  try {
    const f = acharArquivoNaPasta_(TEND.PREFIXO_TENDENCIAS + fmtIso_(datas.ontem) + '.json');
    return f ? JSON.parse(f.getBlob().getDataAsString('UTF-8')) : null;
  } catch (e) { Logger.log('tendencias_ não lido: %s', e.message); return null; }
}

// ---------------------------------------------------------------------
//  E-MAIL EXECUTIVO DA CARTEIRA: "Contas para olhar hoje" (só críticos)
// ---------------------------------------------------------------------
/**
 * Substitui o resumo diário da carteira (CONFIG.EMAIL_CARTEIRA = 'executivo').
 * Só entra o que é CRÍTICO. Uma seção por conta citada: status por plataforma,
 * os alertas críticos e o gráfico de pacing do mês (mesmo g1 do e-mail por
 * cliente). Alertas críticos de sistema (coleta não chegou etc.) entram numa
 * seção "Sistema", sem gráfico. Chamado por enviar_ (Código.gs).
 * @return {{html: string, imagens: Object, contas: number}}
 */
function montarHtmlExecutivo_(ss, crit, painel, datas, url) {
  const M = MG, W = 820;
  const fonte = "font-family:Inter,'Helvetica Neue',Arial,sans-serif;";
  const serif = "font-family:'Playfair Display',Georgia,'Times New Roman',serif;";
  const serie = (typeof lerSerie_ === 'function') ? lerSerie_(ss, datas) : {};
  const dot = (sevx, size) => '<span style="color:' + pontoCor_(sevx) + ';font-size:' + (size || 11) + 'px;line-height:1">&#9679;</span>';
  const chip = (txt, sevx) => { const bg = sevx === 'crit' ? '#F0D0CD' : sevx === 'aten' ? '#F3E4BC' : sevx === 'ok' ? '#D6E9DB' : '#EBE7DE';
    return '<span style="display:inline-block;padding:2px 8px;border-radius:9px;background:' + bg + ';color:' + pontoCor_(sevx) + ';font-size:10px;font-weight:bold;margin-right:4px">' + txt + '</span>'; };

  // Agrupa críticos por conta, na ordem do PAINEL; o que não é conta vira "Sistema".
  const porConta = {}; const sistema = [];
  const nomes = painel.contas.map(c => c.nome);
  crit.forEach(a => { if (nomes.indexOf(a.conta) >= 0) (porConta[a.conta] = porConta[a.conta] || []).push(a); else sistema.push(a); });
  const contasCit = painel.contas.filter(c => porConta[c.nome]);
  const imagens = {};

  let h = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Contas para olhar hoje</title></head><body style="margin:0;background:' + M.bege + '">' +
    '<div style="background:' + M.bege + ';padding:24px 0;' + fonte + 'color:' + M.preto + '"><table width="' + W + '" align="center" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff">';
  h += '<tr><td style="background:' + M.preto + ';padding:20px 28px 16px 28px;border-bottom:3px solid ' + M.dourado + '">' +
    '<div style="font-size:10px;letter-spacing:2px;color:' + M.dourado + ';text-transform:uppercase">Modesto Growth Partners · Controle de mídia</div>' +
    '<div style="' + serif + 'font-size:26px;color:#fff;margin-top:4px">' + contasCit.length + ' conta' + (contasCit.length === 1 ? '' : 's') + ' para olhar hoje</div>' +
    '<div style="font-size:11px;color:#BDB9B0;margin-top:4px">Dados de ' + datas.labelOntem + ' · dia ' + datas.diasDecorridos + ' de ' + datas.diasNoMes + ' (' + Math.round(datas.pctMes * 100) + '% do mês) · ' +
    crit.length + ' crítico(s) · só o que precisa de ação hoje; o resto está no e-mail de cada cliente · <a href="' + url + '" style="color:' + M.dourado + ';text-decoration:none">abrir planilha ↗</a></div></td></tr>';

  // Placar: uma linha por conta citada, para bater o olho
  h += '<tr><td style="padding:12px 28px 4px 28px;border-bottom:1px solid ' + M.linha + '">';
  contasCit.forEach(c => {
    const vs = (c.veiculos || []).filter(v => !v.inconsistente);
    h += '<div style="font-size:12px;padding:4px 0">' + dot('crit', 12) + ' <b>' + esc_(c.nome) + '</b>' + (c.responsavel ? ' <span style="color:' + M.cinza + '">· ' + esc_(c.responsavel) + '</span>' : '') +
      ' <span style="color:' + M.cinza + '">· ' + porConta[c.nome].length + ' crítico(s)</span> &nbsp;' +
      vs.map(v => { const p = plataformaCanonica_(v.nome); const sv = v.budget ? sevInvest_(v.status) : 'na';
        return chip(esc_(p) + ' ' + (v.budget ? rotuloStatusCurto_(v.status).split(' (')[0] : 'sem verba'), sv); }).join('') + '</div>';
  });
  if (sistema.length) h += '<div style="font-size:12px;padding:4px 0">' + dot('crit', 12) + ' <b>Sistema</b> <span style="color:' + M.cinza + '">· ' + sistema.length + ' crítico(s)</span></div>';
  h += '</td></tr>';

  // Uma seção por conta: alertas críticos + gráfico de pacing
  contasCit.forEach((c, i) => {
    const vs = (c.veiculos || []).filter(v => !v.inconsistente);
    const moeda = CONTA_MOEDA[c.nome] || 'R$';
    const fmtKint = v => { v = Number(v) || 0; return Math.abs(v) >= 1000 ? moeda + ' ' + Math.round(v / 1000) + 'k' : brl_(v).replace('R$', moeda); };
    const soma = k => vs.reduce((a, v) => a + (Number(v[k]) || 0), 0);
    const budget = soma('budget'), investido = soma('investido');
    h += '<tr><td style="padding:16px 28px 4px 28px;border-top:2px solid ' + M.dourado + '"><div style="' + serif + 'font-size:20px">' + esc_(c.nome) + '</div>' +
      '<div style="font-size:11px;color:' + M.cinza + ';margin-top:2px">' + (budget ? fmtKint(investido) + ' de ' + fmtKint(budget) + ' (' + Math.round(investido / budget * 100) + '% da verba com ' + Math.round(datas.pctMes * 100) + '% do mês)' : fmtKint(investido) + ' investidos · sem verba fixa') +
      (c.credito ? ' · <span style="color:' + M.dourado + ';letter-spacing:1px">CRÉDITO DA AGÊNCIA</span>' : '') + '</div></td></tr>';
    h += '<tr><td style="padding:4px 28px 6px 28px">';
    porConta[c.nome].forEach(a => {
      const plat = a.titulo.indexOf(' / ') >= 0 ? a.titulo.split(' / ').pop() : '';
      const tit = a.titulo.split(':')[0].replace(/ \[.*\]/, '');
      h += '<div style="padding:7px 0;border-bottom:1px solid ' + M.linha + ';font-size:12px">' + dot('crit') + ' <b>' + esc_(tit) + '</b>' + (plat ? ' <span style="color:' + corPlat_(plataformaCanonica_(plat)) + ';font-size:10px">· ' + esc_(plat) + '</span>' : '') +
        (a.persistencia && a.persistencia !== 'NOVO' ? ' <span style="font-size:10px;color:' + M.neutro + '">(' + esc_(a.persistencia) + ')</span>' : '') +
        '<div style="color:' + M.cinza + ';margin-top:2px">' + esc_(a.detalhe) + '</div></div>';
    });
    h += '</td></tr>';
    try {
      const g = graficosConta_(c, datas, serie[c.nome] || {}, vs, {}, moeda, { budget: budget, investido: investido, projConta: soma('proj'), metaRoas: 0 }, ['g1']);
      if (g.g1) { const cid = 'ex' + i; imagens[cid] = g.g1.setName(cid + '.png');
        h += '<tr><td style="padding:0 28px 12px 28px"><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:' + M.dourado + ';font-weight:bold;margin-bottom:4px">Pacing do mês <span style="color:' + M.neutro + ';font-weight:normal;letter-spacing:0;text-transform:none">· acumulado x ideal x projeção</span></div>' +
          '<img src="cid:' + cid + '" width="764" style="display:block;width:764px;max-width:100%;height:auto;border:0" alt=""></td></tr>'; }
    } catch (e) { Logger.log('Gráfico executivo de %s: %s', c.nome, e.message); }
  });

  if (sistema.length) {
    h += '<tr><td style="padding:16px 28px 10px 28px;border-top:2px solid ' + M.dourado + '"><div style="' + serif + 'font-size:20px">Sistema</div>';
    sistema.forEach(a => { h += '<div style="padding:7px 0;border-bottom:1px solid ' + M.linha + ';font-size:12px">' + dot('crit') + ' <b>' + esc_(a.titulo) + '</b><div style="color:' + M.cinza + ';margin-top:2px">' + esc_(a.detalhe) + '</div></div>'; });
    h += '</td></tr>';
  }

  h += '<tr><td style="padding:10px 28px 16px 28px;font-size:9px;color:' + M.neutro + ';border-top:1px solid ' + M.linha + ';line-height:1.6">Só alertas críticos. Atenção e informativos ficam na aba ALERTAS e no e-mail de cada cliente, que sai em seguida, um a cada ' +
    (CONFIG.EMAIL_CONTA ? CONFIG.EMAIL_CONTA.INTERVALO_MIN : 10) + ' min. Gráfico gerado pelo Apps Script a partir da SERIE DIARIA.</td></tr>';
  h += '</table></div></body></html>';
  return { html: h, imagens: imagens, contas: contasCit.length + (sistema.length ? 1 : 0) };
}

/** Editor: manda o e-mail executivo de hoje para EMAILS_TESTE, mesmo sem crítico (usa os críticos que houver). */
function testarEmailExecutivo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const datas = calcularDatas_();
  const alertas = [];
  const painel = lerPainel_(ss, datas, alertas);
  const orcamentos = (function () { try { return lerOrcamentosExternos_(); } catch (e) { return {}; } })();
  painel.contas.forEach(c => analisarConta_(ss, c, datas, orcamentos, alertas));
  const crit = alertas.filter(a => a.nivel === NIVEL.CRITICO);
  const ex = montarHtmlExecutivo_(ss, crit, painel, datas, ss.getUrl());
  const eu = CONFIG.EMAILS_TESTE.join(',');
  MailApp.sendEmail({ to: eu, subject: '[TESTE] 🔴 [Pacing] ' + datas.labelOntem + ' | ' + ex.contas + ' conta(s) para olhar hoje', htmlBody: ex.html, inlineImages: ex.imagens, name: 'Controle de Pacing | Modesto Growth' });
  Logger.log('E-mail executivo de teste enviado para %s (%s críticos, %s contas, %s gráficos).', eu, crit.length, ex.contas, Object.keys(ex.imagens).length);
  try { SpreadsheetApp.getUi().alert('E-mail executivo enviado para ' + eu + ' (' + crit.length + ' crítico(s))'); } catch (e) {}
}

function severidadeConta_(c) {
  let s = 'ok';
  (c.veiculos || []).forEach(v => {
    if (v.inconsistente) return;
    const a = sevInvest_(v.status), b = sevReceita_(v.statusReceita);
    if (a === 'crit' || b === 'crit') s = 'crit';
    else if ((a === 'aten' || b === 'aten') && s !== 'crit') s = 'aten';
  });
  return s;
}

// ---------------------------------------------------------------------
//  HTML: só o que a conta tem
// ---------------------------------------------------------------------
/** @return {{html: string, imagens: Object}} */
function montarHtmlConta_(ss, c, datas, tendencias, det, serie) {
  const M = MG, W = 820;
  const moeda = CONTA_MOEDA[c.nome] || 'R$';
  const fmtK = v => brlK_(v).replace('R$', moeda);
  const fmt = v => brl_(v).replace('R$', moeda);
  const fmtKint = v => { v = Number(v) || 0; return Math.abs(v) >= 1000 ? moeda + ' ' + Math.round(v / 1000) + 'k' : fmt(v); };
  const fonte = "font-family:Inter,'Helvetica Neue',Arial,sans-serif;";
  const serif = "font-family:'Playfair Display',Georgia,'Times New Roman',serif;";
  const vs = (c.veiculos || []).filter(v => !v.inconsistente);
  const inconsistentes = (c.veiculos || []).filter(v => v.inconsistente);
  const tc = tendencias && tendencias.contas && tendencias.contas[c.nome];
  const plat = {}; if (tc) Object.keys(tc.plataformas || {}).forEach(p => plat[p] = tc.plataformas[p]);
  const sev = severidadeConta_(c);
  const rotSev = sev === 'crit' ? 'AÇÃO HOJE' : sev === 'aten' ? 'ATENÇÃO' : 'NO RITMO';
  const serieConta = serie[c.nome] || {};

  const soma = k => vs.reduce((a, v) => a + (Number(v[k]) || 0), 0);
  const budget = soma('budget'), investido = soma('investido');
  const metaReceita = soma('metaReceita'), receita = soma('receita'), projReceita = soma('projReceita');
  const roasConta = investido ? receita / investido : 0;
  const metaRoas = vs.map(v => v.metaRoas).filter(x => x > 0)[0] || 0;
  const metaCpa = vs.map(v => v.metaCpa).filter(x => x > 0)[0] || 0;
  const cpaConta = c.cpa || 0;
  const stInv = budget ? statusVeiculo_((investido / budget) / datas.pctMes, c.credito) : 'SEM VERBA';
  const stRec = statusReceita_(receita, metaReceita, datas.pctMes);

  // O que a conta TEM. Tudo abaixo só entra no e-mail se a flag for verdadeira.
  const temReceita = receita > 0 || metaReceita > 0;      // conta por lead não tem
  const temMetaReceita = metaReceita > 0;
  const temRoas = temReceita && investido > 0;
  const temCpa = cpaConta > 0 || metaCpa > 0;
  const temVerba = budget > 0;

  // Projeção da conta: soma da média 7d das plataformas (tendências) ou ritmo médio do mês
  let media7 = 0, temMedia7 = false;
  vs.forEach(v => { const t = plat[plataformaCanonica_(v.nome)]; if (t && t.media_7d) { media7 += t.media_7d; temMedia7 = true; } });
  const projConta = temMedia7 ? investido + media7 * datas.diasRestantes : soma('proj');

  // Gráficos
  const graf = graficosConta_(c, datas, serieConta, vs, plat, moeda, { budget: budget, investido: investido, projConta: projConta, metaRoas: metaRoas, metaReceita: metaReceita, receita: receita, projReceita: projReceita });
  if (!temReceita) { delete graf.g4; delete graf.g5; delete graf.g7; }   // sem receita, sem gráfico de receita nem de ROAS

  // ---- helpers de HTML
  const sec = (t, sub, extra) => '<tr><td style="padding:10px 28px 2px 28px;' + (extra || 'border-top:1px solid ' + M.linha) + '"><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:' + M.dourado + ';font-weight:bold">' + t +
    (sub ? ' <span style="color:' + M.neutro + ';font-weight:normal;letter-spacing:0;text-transform:none">· ' + sub + '</span>' : '') + '</div></td></tr>';
  const dot = (sevx, size) => '<span style="color:' + pontoCor_(sevx) + ';font-size:' + (size || 11) + 'px;line-height:1">&#9679;</span>';
  const chip = (txt, sevx) => { const bg = sevx === 'crit' ? '#F0D0CD' : sevx === 'aten' ? '#F3E4BC' : sevx === 'ok' ? '#D6E9DB' : '#EBE7DE';
    return '<span style="display:inline-block;padding:2px 8px;border-radius:9px;background:' + bg + ';color:' + pontoCor_(sevx) + ';font-size:10px;font-weight:bold">' + txt + '</span>'; };
  const sq = (p, s) => '<span style="display:inline-block;width:' + (s || 9) + 'px;height:' + (s || 9) + 'px;background:' + corPlat_(p) + ';margin-right:6px"></span>';
  const th = (t, al) => '<th style="text-align:' + (al || 'right') + ';font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:' + M.cinza + ';padding:6px 5px;border-bottom:2px solid ' + M.preto + '">' + t + '</th>';
  const td = (t, al, extra) => '<td' + (al === 'right' ? ' align="right"' : '') + ' style="padding:7px 5px;border-bottom:1px solid ' + M.linha + ';' + (extra || '') + '">' + t + '</td>';
  const img = (cid, w) => '<img src="cid:' + cid + '" width="' + w + '" style="display:block;width:' + w + 'px;max-width:100%;height:auto;border:0" alt="">';
  const bloco = (titulo, sub) => '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:' + M.dourado + ';font-weight:bold">' + titulo +
    (sub ? ' <span style="color:' + M.neutro + ';font-weight:normal;letter-spacing:0;text-transform:none">· ' + sub + '</span>' : '') + '</div>';

  let h = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc_(c.nome) + ' · pacing</title></head><body style="margin:0;background:' + M.bege + '">' +
    '<div style="background:' + M.bege + ';padding:24px 0;' + fonte + 'color:' + M.preto + '"><table width="' + W + '" align="center" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff">';

  // Cabeçalho
  h += '<tr><td style="background:' + M.preto + ';padding:20px 28px 16px 28px;border-bottom:3px solid ' + M.dourado + '"><table width="100%" cellpadding="0" cellspacing="0"><tr><td>' +
    '<div style="font-size:10px;letter-spacing:2px;color:' + M.dourado + ';text-transform:uppercase">Modesto Growth Partners · Controle de mídia</div>' +
    '<div style="' + serif + 'font-size:26px;color:#fff;margin-top:4px">' + esc_(c.nome) + '</div>' +
    '<div style="font-size:11px;color:#BDB9B0;margin-top:4px">Dados de ' + datas.labelOntem + ' · dia ' + datas.diasDecorridos + ' de ' + datas.diasNoMes + ' (' + Math.round(datas.pctMes * 100) + '% do mês)' +
    (c.responsavel ? ' · ' + esc_(c.responsavel) : '') + (c.credito ? ' · <span style="color:' + M.dourado + ';letter-spacing:1px">CRÉDITO DA AGÊNCIA</span>' : '') +
    ' · ' + vs.map(v => esc_(plataformaCanonica_(v.nome))).join(' + ') + '</div></td>' +
    '<td align="right" valign="top"><span style="display:inline-block;padding:6px 12px;border:1px solid ' + pontoCor_(sev) + ';color:' + pontoCor_(sev) + ';font-size:11px;letter-spacing:1px">&#9679; ' + rotSev + '</span></td></tr></table></td></tr>';

  // Cards: só os que a conta tem. Largura dividida entre os que existem.
  const cards = [];
  cards.push({ titulo: 'Investimento', sev: temVerba ? sevInvest_(stInv) : 'na', valor: fmtKint(investido),
    sub: temVerba ? 'de ' + fmtKint(budget) + ' · ' + Math.round(investido / budget * 100) + '% usado · fecha ' + fmtKint(projConta) : 'sem verba fixa · fecha ' + fmtKint(projConta) });
  if (temReceita) cards.push({ titulo: 'Receita', sev: sevReceita_(stRec), valor: fmtKint(receita),
    sub: temMetaReceita ? 'de ' + fmtKint(metaReceita) + ' · ' + Math.round(receita / metaReceita * 100) + '% da meta' : '' });
  if (temRoas) cards.push({ titulo: 'ROAS', sev: metaRoas ? (roasConta >= metaRoas ? 'ok' : roasConta >= metaRoas * 0.85 ? 'aten' : 'crit') : 'na', valor: roasConta.toFixed(2),
    sub: metaRoas ? 'meta ' + metaRoas.toFixed(2) : '' });
  if (temCpa) cards.push({ titulo: c.porCpa || !temReceita ? 'CPL' : 'CPA', sev: metaCpa && cpaConta ? sevCpa_({ metaCpa: metaCpa, cpa: cpaConta }) : 'na',
    valor: cpaConta ? moeda + ' ' + Math.round(cpaConta) : fmt(metaCpa), sub: metaCpa ? (cpaConta ? 'meta ' + fmt(metaCpa) : 'meta; sem realizado ainda') : '' });
  const wCard = Math.floor(100 / cards.length) + '%';
  h += '<tr><td style="padding:0;border-bottom:1px solid ' + M.linha + '"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    cards.map((k, i) => '<td width="' + wCard + '" valign="top" style="padding:14px 14px;' + (i === cards.length - 1 ? '' : 'border-right:1px solid ' + M.linha) + '">' +
      '<div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:' + M.cinza + '">' + k.titulo + '</div>' +
      '<div style="font-size:22px;font-weight:bold;color:' + M.preto + ';margin-top:3px">' + dot(k.sev, 12) + ' ' + k.valor + '</div>' +
      (k.sub ? '<div style="font-size:10px;color:' + M.neutro + ';margin-top:2px">' + k.sub + '</div>' : '') + '</td>').join('') +
    '</tr></table></td></tr>';

  // Boletim de ontem: o que aconteceu, em frases com número, antes de qualquer gráfico
  const ont = resumoOntem_(serieConta, datas);
  const faixasPre = faixasAcao_(c, vs, inconsistentes, plat, datas, fmtK);
  const listaPre = (det && det.campanhas && det.campanhas[c.nome]) || [];
  const totalPre = listaPre.reduce((a, x) => a + x.gasto, 0);
  const metasPre = {}; vs.forEach(v => { metasPre[plataformaCanonica_(v.nome)] = { roas: v.metaRoas || 0, cpa: v.metaCpa || 0 }; });
  const comVerPre = listaPre.map(x => { const mm = metasPre[x.plataforma] || { roas: 0, cpa: 0 }; const vd = veredito_(x, mm, totalPre, !!c.porCpa);
    return Object.assign({}, x, { veredito: vd.veredito, motivo: vd.motivo, marca: vd.marca, share: totalPre ? x.gasto / totalPre : 0, meta_roas: mm.roas || null, meta_cpa: mm.cpa || null }); });
  const elefPre = elefantes_(c, vs, inconsistentes, plat, comVerPre, (det && det.alteracoes && det.alteracoes[c.nome]) || [], datas, moeda, fmtKint);
  const boletim = boletimOntem_(c, vs, plat, ont, datas, moeda, fmtKint, { temReceita: temReceita, temVerba: temVerba, budget: budget, investido: investido, projConta: projConta, stInv: stInv, elef: elefPre, faixas: faixasPre });
  if (boletim.length) {
    h += '<tr><td style="padding:12px 28px 10px 28px;border-bottom:1px solid ' + M.linha + '">' +
      '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:' + M.dourado + ';font-weight:bold;margin-bottom:6px">Boletim de ontem <span style="color:' + M.neutro + ';font-weight:normal;letter-spacing:0;text-transform:none">· ' + datas.labelOntem + ' em ' + boletim.length + ' pontos</span></div>' +
      boletim.map(b => '<div style="font-size:13px;line-height:1.5;padding:3px 0">' + dot(b.sev, 11) + ' ' + b.txt + '</div>').join('') + '</td></tr>';
  }

  const tiles = [];
  tiles.push({ rot: temReceita ? 'Vendas' : 'Conversões', val: Math.round(ont.ontem.conversoes), varv: ont.variacao.conversoes });
  if (temReceita) tiles.push({ rot: 'Receita', val: fmtKint(ont.ontem.receita), varv: ont.variacao.receita });
  tiles.push({ rot: 'Gasto', val: fmtKint(ont.ontem.gasto), varv: ont.variacao.gasto });
  const wTile = Math.floor(100 / tiles.length) + '%';
  h += '<tr><td style="padding:0;background:' + M.bege + ';border-bottom:1px solid ' + M.linha + '"><table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="padding:8px 28px 0 28px;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:' + M.dourado + ';font-weight:bold" colspan="' + tiles.length + '">Ontem · ' + datas.labelOntem + '</td></tr><tr>' +
    tiles.map((t, i) => {
      const cor = t.varv === null ? M.neutro : (t.varv >= 0 ? M.verde : M.vermelho);
      const seta = t.varv === null ? (ont.dias_base ? '' : 'sem base de 7 dias') : '<span style="color:' + cor + ';font-weight:bold">' + (t.varv >= 0 ? '&#9650; ' : '&#9660; ') + Math.abs(Math.round(t.varv * 100)) + '%</span> <span style="color:' + M.neutro + '">vs média 7d</span>';
      return '<td width="' + wTile + '" style="padding:10px 14px;' + (i === tiles.length - 1 ? '' : 'border-right:1px solid ' + M.linha) + '"><div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:' + M.cinza + '">' + t.rot + '</div>' +
        '<div style="font-size:16px;font-weight:bold;margin-top:2px">' + t.val + '</div>' + (seta ? '<div style="font-size:10px;margin-top:1px">' + seta + '</div>' : '') + '</td>';
    }).join('') + '</tr></table></td></tr>';

  // No total, estou na meta? Só as caixas que fazem sentido para a conta.
  const caixas = [];
  const sI = temVerba ? sevInvest_(stInv) : 'na', sR = sevReceita_(stRec);
  if (temVerba) caixas.push({ rot: 'Investimento', sev: sI, txt: (sI === 'ok' ? 'NO RITMO' : sI === 'aten' ? 'ATENÇÃO' : 'FORA DO PACING') + ' · ' + Math.round(investido / budget * 100) + '% da verba com ' + Math.round(datas.pctMes * 100) + '% do mês' });
  if (temMetaReceita) caixas.push({ rot: 'Receita', sev: sR, txt: (sR === 'ok' ? 'NA META' : sR === 'aten' ? 'ATENÇÃO' : 'ABAIXO DA META') + ' · ' + Math.round(receita / metaReceita * 100) + '% da meta com ' + Math.round(datas.pctMes * 100) + '% do mês' });
  if (caixas.length) {
    h += '<tr><td style="padding:10px 28px 0 28px"><div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:' + M.dourado + ';font-weight:bold;margin-bottom:6px">No total, estou na meta?</div><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
      caixas.map((k, i) => { const bg = k.sev === 'crit' ? '#F0D0CD' : k.sev === 'aten' ? '#F3E4BC' : k.sev === 'ok' ? '#D6E9DB' : '#EBE7DE';
        return (i ? '<td width="6"></td>' : '') + '<td style="padding:10px 14px;text-align:center;background:' + bg + '"><span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:' + M.cinza + '">' + k.rot + '</span>' +
          '<div style="font-size:14px;font-weight:bold;color:' + pontoCor_(k.sev) + ';margin-top:2px">' + dot(k.sev, 12) + ' ' + k.txt + '</div></td>'; }).join('') +
      '</tr></table></td></tr>';
  }

  // 3 faixas de ação (as três mais graves)
  const faixas = faixasAcao_(c, vs, inconsistentes, plat, datas, fmtK);
  if (faixas.length) {
    h += '<tr><td style="padding:12px 23px 4px 23px"><table width="100%" cellpadding="0" cellspacing="0"><tr>';
    faixas.slice(0, 3).forEach(f => {
      const bg = f.sev === 'crit' ? '#F0D0CD' : f.sev === 'aten' ? '#F3E4BC' : f.sev === 'ok' ? '#D6E9DB' : '#EBE7DE';
      h += '<td width="33%" valign="top" style="padding:0 5px"><div style="border-left:3px solid ' + pontoCor_(f.sev) + ';background:' + bg + ';padding:8px 10px"><div style="font-size:12px;font-weight:bold;color:' + pontoCor_(f.sev) + '">' + f.titulo + '</div><div style="font-size:11px"><b>' + f.quem + '</b> · ' + f.sub + '</div></div></td>';
    });
    h += '</tr></table></td></tr>';
  }

  // Gráfico 1: pacing do mês (só se existir)
  if (graf.g1) h += sec('Pacing do mês', 'acumulado x ideal x projeção', '') + '<tr><td style="padding:0 28px 6px 28px">' + img('g1', 764) + '</td></tr>';
  // Gráfico 7: receita do mês (acumulada x ideal da meta x projeção), só com receita
  if (graf.g7 && temReceita) h += sec('Receita do mês', temMetaReceita ? 'acumulada x ideal da meta x projeção' : 'acumulada x projeção (sem meta cadastrada)') + '<tr><td style="padding:0 28px 6px 28px">' + img('g7', 764) + '</td></tr>';
  // Gráfico 2: gasto por dia
  if (graf.g2) h += sec('Gasto por dia', 'últimos 14 dias por plataforma' + (temVerba ? ' · planejado/dia ' + fmtKint(budget / datas.diasNoMes) : '')) + '<tr><td style="padding:0 28px 6px 28px">' + img('g2', 764) + '</td></tr>';

  // Gráficos 3 e 4: mix (só com 2+ plataformas) e receita vs meta (só com meta de receita)
  const mostraMix = !!graf.g3 && vs.length > 1;
  const mostraRec = !!graf.g4 && temMetaReceita;
  if (mostraMix || mostraRec) {
    let legMix = '';
    vs.forEach(v => { const p = plataformaCanonica_(v.nome);
      legMix += '<div style="font-size:11px;margin:3px 0">' + sq(p) + '<b>' + esc_(p) + '</b> <span style="color:' + M.cinza + '">' + (investido ? Math.round(v.investido / investido * 100) : 0) + '% do gasto</span>' +
        (temVerba ? ' <span style="color:' + M.neutro + '">· ' + Math.round((v.budget || 0) / budget * 100) + '% da verba</span>' : '') + '</div>'; });
    const colMix = mostraMix ? '<td width="' + (mostraRec ? '46%' : '100%') + '" valign="top">' + bloco('Mix de investimento', 'gasto do mês por plataforma') +
      '<table cellpadding="0" cellspacing="0"><tr><td>' + img('g3', 190) + '</td><td valign="middle" style="padding-left:6px">' + legMix + '</td></tr></table></td>' : '';
    const colRec = mostraRec ? '<td width="' + (mostraMix ? '54%' : '100%') + '" valign="top" style="' + (mostraMix ? 'padding-left:14px' : '') + '">' + bloco('Receita vs meta', 'cinza escuro = onde deveria estar hoje') + img('g4', 380) + '</td>' : '';
    h += '<tr><td style="padding:10px 28px 6px 28px;border-top:1px solid ' + M.linha + '"><table width="100%" cellpadding="0" cellspacing="0"><tr>' + colMix + colRec + '</tr></table></td></tr>';
  }

  // Gráficos 5 e 6: ROAS 7d (só com receita) e funil (só com impressões e cliques)
  const mostraRoas = !!graf.g5 && temReceita;
  const mostraFunil = !!graf.g6;
  if (mostraRoas || mostraFunil) {
    const colRoas = mostraRoas ? '<td width="' + (mostraFunil ? '50%' : '100%') + '" valign="top">' + bloco('ROAS', 'média móvel 7 dias') + img('g5', 370) + '</td>' : '';
    const colFunil = mostraFunil ? '<td width="' + (mostraRoas ? '50%' : '100%') + '" valign="top" style="' + (mostraRoas ? 'padding-left:14px' : '') + '">' + bloco('Eficiência do funil', 'mês até ontem') + img('g6', 370) + '</td>' : '';
    h += '<tr><td style="padding:10px 28px 12px 28px;border-top:1px solid ' + M.linha + '"><table width="100%" cellpadding="0" cellspacing="0"><tr>' + colRoas + colFunil + '</tr></table></td></tr>';
  }

  // Por plataforma: colunas de receita e ROAS só se a conta tiver receita; verba só se tiver verba
  h += sec('Por plataforma') + '<tr><td style="padding:0 28px 10px 28px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px"><tr>' +
    th('Plataforma', 'left') + th('Gasto') + (temVerba ? th('Verba') + th('% usado') : '') + th('Fecha em') + (temReceita ? th('Receita') + th('ROAS') : '') + (temCpa ? th(c.porCpa || !temReceita ? 'CPL' : 'CPA') : '') + th('Previsão', 'left') + '</tr>';
  vs.forEach(v => {
    const p = plataformaCanonica_(v.nome), t = plat[p];
    const sv = v.budget ? sevInvest_(v.status) : 'na';
    const projV = (t && t.projecao_tendencia) ? t.projecao_tendencia : v.proj;
    let prev;
    if (v.gastoOntem === 0 && v.budget > 0) prev = chip('GASTO ZERO ONTEM', 'crit');
    else if (v.emCorrecao) prev = chip('EM CORREÇÃO · AJUSTE APLICADO ONTEM', 'aten');
    else if (t && t.status_previsto && t.status_previsto !== 'fecha no ritmo') prev = chip(esc_(t.status_previsto.toUpperCase()), /crédito|por cima|por baixo/.test(t.status_previsto) ? 'crit' : 'aten');
    else if (v.budget > 0 && sv !== 'ok') prev = chip(projV >= v.budget ? 'FECHA ' + Math.round((projV / v.budget - 1) * 100) + '% ACIMA' : 'FECHA ' + Math.round((1 - projV / v.budget) * 100) + '% ABAIXO', sv);
    else if (v.budget > 0) prev = '<span style="color:' + M.verde + ';font-size:11px">&#10003; no ritmo</span>';
    else prev = '<span style="color:' + M.neutro + ';font-size:11px">sem verba fixa</span>';
    h += '<tr>' + td(sq(p) + '<b>' + esc_(p) + '</b>') + td(dot(sv) + ' <b>' + fmtKint(v.investido) + '</b>', 'right') +
      (temVerba ? td(v.budget ? fmtKint(v.budget) : '', 'right', 'color:' + M.neutro) + td(v.budget ? Math.round(v.investido / v.budget * 100) + '%' : '', 'right') : '') +
      td('<b style="color:' + (sv === 'ok' || sv === 'na' ? M.preto : pontoCor_(sv)) + '">' + fmtKint(projV) + '</b>', 'right') +
      (temReceita ? td(v.receita ? fmtKint(v.receita) : '', 'right') + td(v.roas ? v.roas.toFixed(2) : '', 'right') : '') +
      (temCpa ? td(v.cpa ? moeda + ' ' + Math.round(v.cpa) : '', 'right') : '') +
      td(prev) + '</tr>';
  });
  inconsistentes.forEach(v => {
    const p = plataformaCanonica_(v.nome);
    const vazias = 2 + (temVerba ? 2 : 0) + (temReceita ? 2 : 0) + (temCpa ? 1 : 0);
    h += '<tr>' + td(sq(p) + '<b>' + esc_(p) + '</b>') + '<td colspan="' + (vazias - 1) + '" style="padding:7px 5px;border-bottom:1px solid ' + M.linha + '"></td>' + td(chip('CONFERIR FÓRMULA (LINHA 7)', 'na')) + '</tr>';
  });
  h += '</table></td></tr>';

  // Tendências: só se houver plataforma com série. Sem série, a seção não existe.
  const plataformasT = Object.keys(plat).filter(p => plat[p] && plat[p].dias_com_dado && plat[p].suficiente);
  if (plataformasT.length) {
    h += sec('Tendências', 'últimos 7 dias x 7 anteriores · previsão pela curva de 14 dias · qualidade 7d x 30d');
    h += '<tr><td style="padding:0 28px 8px 28px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px"><tr>' +
      th('Plataforma', 'left') + th('Média 7d') + th('7d anteriores') + th('Variação') + th('Tendência', 'left') + (temVerba ? th('Previsão de fechamento', 'left') : '') + th('Qualidade 7d x 30d', 'left') + '</tr>';
    plataformasT.forEach(p => {
      const t = plat[p];
      const varp = t.variacao_semana_pct;
      const corVar = varp === null || varp === undefined ? M.neutro : Math.abs(varp) < 0.05 ? M.preto : (varp > 0 ? M.amarelo : M.vermelho);
      const forte = (Math.abs(t.inclinacao_pct_dia || 0) >= 0.03) || (Math.abs(varp || 0) >= 0.20);
      const tend = t.tendencia ? (t.tendencia === 'alta' ? '&#9650; alta' : t.tendencia === 'baixa' ? '&#9660; baixa' : '&#8594; estável') + (forte ? ' <b>forte</b>' : '') : '';
      const prevSev = !t.status_previsto ? 'na' : t.status_previsto === 'fecha no ritmo' ? 'ok' : /crédito|por cima|por baixo/.test(t.status_previsto) ? 'crit' : 'aten';
      const prevTxt = t.status_previsto ? esc_(t.status_previsto) + (t.dias_ate_estourar_budget ? ' em ' + t.dias_ate_estourar_budget + ' dia(s)' : '') + (t.projecao_tendencia ? ' · ' + fmtKint(t.projecao_tendencia) : '') : '';
      const q7 = t.qualidade_7d || {}, q30 = t.qualidade_30d || {};
      const qual = [];
      if (temReceita && q7.roas && q30.roas) qual.push('ROAS ' + q7.roas.toFixed(2) + ' x ' + q30.roas.toFixed(2) + (q7.roas < q30.roas * 0.85 ? ' <span style="color:' + M.vermelho + '">caindo</span>' : ''));
      if (q7.cpa && q30.cpa) qual.push((temReceita ? 'CPA ' : 'CPL ') + fmtKint(q7.cpa) + ' x ' + fmtKint(q30.cpa) + (q7.cpa > q30.cpa * 1.15 ? ' <span style="color:' + M.vermelho + '">subindo</span>' : ''));
      if (q7.ctr && q30.ctr) qual.push('CTR ' + (q7.ctr * 100).toFixed(2) + '% x ' + (q30.ctr * 100).toFixed(2) + '%' + (q7.ctr < q30.ctr * 0.85 ? ' <span style="color:' + M.amarelo + '">criativo cansando</span>' : ''));
      h += '<tr>' + td(sq(p) + '<b>' + esc_(p) + '</b>') + td(t.media_7d ? fmtKint(t.media_7d) + '/dia' : '', 'right') + td(t.media_7d_anterior ? fmtKint(t.media_7d_anterior) + '/dia' : '', 'right') +
        td(varp === null || varp === undefined ? '' : '<b style="color:' + corVar + '">' + (varp >= 0 ? '+' : '') + Math.round(varp * 100) + '%</b>', 'right') + td(tend) +
        (temVerba ? td('<span style="color:' + pontoCor_(prevSev) + ';font-size:11px;font-weight:bold">' + prevTxt + '</span>') : '') + td(qual.join('<br>'), 'left', 'white-space:normal;font-size:11px') + '</tr>';
      (t.anomalias || []).slice(-2).forEach(an => {
        h += '<tr><td colspan="7" style="padding:2px 5px 6px 24px;border-bottom:1px solid ' + M.linha + ';font-size:10px;color:' + M.neutro + '">' + (an.tipo === 'pico' ? 'pico' : 'queda') + ' isolado em ' + an.data.substring(8, 10) + '/' + an.data.substring(5, 7) + ': ' + fmtKint(an.investido) + ' contra média de ' + fmtKint(an.media_7d) + ' (não é tendência)</td></tr>';
      });
    });
    h += '</table></td></tr>';
  }

  // Por campanha (DETALHE, 7 dias): só se houver campanha
  const lista = (det && det.campanhas && det.campanhas[c.nome]) || [];
  const totalC = lista.reduce((a, x) => a + x.gasto, 0);
  const metas = {}; vs.forEach(v => { metas[plataformaCanonica_(v.nome)] = { roas: v.metaRoas || 0, cpa: v.metaCpa || 0 }; });
  const comVer = lista.map(x => { const mm = metas[x.plataforma] || { roas: 0, cpa: 0 }; const vd = veredito_(x, mm, totalC, !!c.porCpa);
    return Object.assign({}, x, { veredito: vd.veredito, motivo: vd.motivo, marca: vd.marca, share: totalC ? x.gasto / totalC : 0, meta_roas: mm.roas || null, meta_cpa: mm.cpa || null }); });
  if (lista.length) {
    const kpiRot = c.porCpa || !temReceita ? 'CPL' : 'ROAS';
    h += sec('Por campanha', 'top 8 por gasto nos últimos 7 dias · veredito só para campanha com ' + TEND.MIN_DIAS_VEREDITO + '+ dias no ar');
    const corV = { ESCALAR: 'ok', MANTER: 'ok', OBSERVAR: 'na', REDUZIR: 'crit', CONFERIR: 'crit' };
    h += '<tr><td style="padding:0 28px 8px 28px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px"><tr>' +
      th('Campanha', 'left') + th('Gasto 7d') + th('% conta') + th(kpiRot) + th('Dias ativa') + th('Veredito', 'left') + '</tr>';
    comVer.slice(0, 8).forEach(x => {
      const kpi = kpiRot === 'CPL' ? (x.cpa === null ? '' : moeda + ' ' + Math.round(x.cpa)) : (x.roas === null ? '' : x.roas.toFixed(1));
      const kpiSev = x.veredito === 'REDUZIR' ? 'crit' : x.veredito === 'CONFERIR' ? 'aten' : x.veredito === 'OBSERVAR' ? 'aten' : 'ok';
      const dias = x.dias_ativa === null ? '' : (x.dias_ativa < TEND.MIN_DIAS_VEREDITO ? '<span style="color:' + M.amarelo + '">' + x.dias_ativa + ' (aprendizado)</span>' : String(x.dias_ativa));
      const tk = x.tendencia_kpi === 'piorando' ? ' <span style="color:' + M.vermelho + ';font-size:10px">&#9660; 3d</span>' : x.tendencia_kpi === 'melhorando' ? ' <span style="color:' + M.verde + ';font-size:10px">&#9650; 3d</span>' : '';
      h += '<tr><td style="padding:6px 5px;border-bottom:1px solid ' + M.linha + '">' + sq(x.plataforma, 8) + esc_(nomeCurto_(x.nome)) + '</td>' +
        '<td align="right" style="padding:6px 5px;border-bottom:1px solid ' + M.linha + '"><b>' + fmtKint(x.gasto) + '</b></td>' +
        '<td align="right" style="padding:6px 5px;border-bottom:1px solid ' + M.linha + ';color:' + M.cinza + '">' + Math.round(x.share * 100) + '%</td>' +
        '<td align="right" style="padding:6px 5px;border-bottom:1px solid ' + M.linha + '">' + (kpi ? dot(kpiSev) + ' ' + kpi + tk : '') + '</td>' +
        '<td align="right" style="padding:6px 5px;border-bottom:1px solid ' + M.linha + ';color:' + M.cinza + '">' + dias + '</td>' +
        '<td style="padding:6px 5px;border-bottom:1px solid ' + M.linha + '">' + chip(x.veredito, corV[x.veredito] || 'na') + '</td></tr>';
    });
    h += '</table></td></tr>';
  }

  // 5 elefantes na sala
  const elef = elefantes_(c, vs, inconsistentes, plat, comVer, (det && det.alteracoes && det.alteracoes[c.nome]) || [], datas, moeda, fmtKint);
  h += '<tr><td style="padding:12px 28px 2px 28px;border-top:2px solid ' + M.dourado + '"><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:' + M.dourado + ';font-weight:bold">' + (elef.length ? elef.length : 'Nenhum') + ' elefante' + (elef.length === 1 ? '' : 's') + ' na sala <span style="color:' + M.neutro + ';font-weight:normal;letter-spacing:0;text-transform:none">· To Do de hoje · só o que está no seu controle em plataforma · ordem de impacto</span></div></td></tr>';
  if (elef.length) {
    h += '<tr><td style="padding:0 28px 8px 28px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">';
    elef.forEach((e, i) => {
      h += '<tr><td width="34" valign="top" style="padding:9px 0;border-bottom:1px solid ' + M.linha + '"><div style="width:26px;height:26px;border-radius:13px;background:' + M.preto + ';color:' + M.dourado + ';font-weight:bold;font-size:13px;text-align:center;line-height:26px">' + (i + 1) + '</div></td>' +
        '<td valign="top" style="padding:9px 8px;border-bottom:1px solid ' + M.linha + '"><div style="font-size:13px;font-weight:bold">' + e.titulo + (e.plat ? ' <span style="font-weight:normal;font-size:10px;color:' + corPlat_(e.plat) + '">· ' + esc_(e.plat) + '</span>' : '') + '</div>' +
        '<div style="font-size:11px;color:' + M.cinza + ';margin-top:1px">' + e.sub + '</div><div style="font-size:12px;margin-top:3px"><span style="color:' + pontoCor_(e.sev) + ';font-weight:bold">&#8594;</span> ' + e.acao + '</div></td></tr>';
    });
    h += '</table></td></tr>';
  } else {
    h += '<tr><td style="padding:4px 28px 8px 28px;font-size:12px;color:' + M.cinza + '">Nada fora do lugar no que está no seu controle em plataforma. Segue o plano.</td></tr>';
  }
  h += '<tr><td style="padding:4px 28px 6px 28px;font-size:10px;color:' + M.neutro + '">Fora da lista de propósito: site, checkout, preço e estoque. Campanha com menos de ' + TEND.MIN_DIAS_VEREDITO + ' dias no ar não recebe veredito nem pedido de desligar.</td></tr>';

  // Rodapé
  h += '<tr><td style="padding:10px 28px 16px 28px;font-size:9px;color:' + M.neutro + ';border-top:1px solid ' + M.linha + ';line-height:1.6">' + dot('ok', 9) + ' na meta &nbsp; ' + dot('aten', 9) + ' até 15% fora &nbsp; ' + dot('crit', 9) +
    ' acima de 15% (crédito da agência: acima de 5% de sobregasto). Projeção = ritmo médio dos últimos 7 dias' + (temMedia7 ? '' : ' (hoje: ritmo médio do mês, sem tendência disponível)') +
    '. Veredito por campanha = regra fixa sobre ' + (temReceita ? 'ROAS' : 'CPL') + ' de 7 dias contra a meta da plataforma. Gráficos gerados pelo Apps Script a partir da SERIE DIARIA e das abas DETALHE.</td></tr>';
  h += '</table></div></body></html>';

  const imagens = {};
  ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'].forEach(k => { if (graf[k]) imagens[k] = graf[k]; });
  if (!temReceita) delete imagens.g7;
  if (!mostraMix) delete imagens.g3;
  if (!mostraRec) delete imagens.g4;
  if (!mostraRoas) delete imagens.g5;
  if (!mostraFunil) delete imagens.g6;
  return { html: h, imagens: imagens };
}

/**
 * Boletim de ontem: 3 a 6 frases, cada uma com o número que a sustenta.
 * Tudo vem do que já foi calculado (SERIE DIARIA, PAINEL, tendências,
 * elefantes). Não inventa causa: onde não há dado, a frase não entra.
 */
function boletimOntem_(c, vs, plat, ont, datas, moeda, fmtKint, x) {
  const out = [];
  const pctTxt = v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
  const porPlat = vs.filter(v => v.gastoOntem !== null && v.gastoOntem !== undefined).map(v => plataformaCanonica_(v.nome) + ' ' + fmtKint(v.gastoOntem));
  // 1. gasto de ontem x média 7d
  if (ont.ontem.gasto > 0) {
    const varG = ont.variacao.gasto;
    out.push({ sev: varG === null ? 'na' : Math.abs(varG) <= 0.15 ? 'ok' : 'aten',
      txt: 'Gastou <b>' + fmtKint(ont.ontem.gasto) + '</b> ontem' + (porPlat.length > 1 ? ' (' + porPlat.join(', ') + ')' : '') +
        (varG === null ? (ont.dias_base ? '' : ', sem base de 7 dias para comparar') : ', <b>' + pctTxt(varG) + '</b> contra a média dos 7 dias anteriores (' + fmtKint(ont.media_7d.gasto) + '/dia)') + '.' });
  } else {
    const parados = vs.filter(v => v.gastoOntem === 0 && v.budget > 0).map(v => plataformaCanonica_(v.nome));
    if (parados.length) out.push({ sev: 'crit', txt: '<b>Gasto zero</b> ontem em ' + parados.join(' e ') + ' com verba ativa. Primeira coisa a conferir hoje.' });
  }
  // 2. resultado de ontem
  if (x.temReceita) {
    if (ont.ontem.receita > 0 || ont.ontem.conversoes > 0) {
      const roasDia = ont.ontem.gasto ? ont.ontem.receita / ont.ontem.gasto : null;
      const varR = ont.variacao.receita;
      out.push({ sev: varR === null ? 'na' : varR >= -0.15 ? 'ok' : 'aten',
        txt: '<b>' + Math.round(ont.ontem.conversoes) + ' vendas</b> e <b>' + fmtKint(ont.ontem.receita) + '</b> de receita' + (roasDia ? ' (ROAS do dia ' + roasDia.toFixed(2) + ')' : '') +
          (varR === null ? '' : ', receita ' + pctTxt(varR) + ' e vendas ' + pctTxt(ont.variacao.conversoes || 0) + ' contra a média 7d') + '.' });
    }
  } else if (ont.ontem.conversoes > 0) {
    const cpl = ont.ontem.gasto / ont.ontem.conversoes;
    const varC = ont.variacao.conversoes;
    out.push({ sev: varC === null ? 'na' : varC >= -0.15 ? 'ok' : 'aten',
      txt: '<b>' + Math.round(ont.ontem.conversoes) + ' conversões</b> a ' + moeda + ' ' + Math.round(cpl) + ' cada' + (varC === null ? '' : ', ' + pctTxt(varC) + ' contra a média 7d') + '.' });
  } else if (ont.ontem.gasto > 0) {
    out.push({ sev: 'crit', txt: 'Gasto sem nenhuma conversão registrada ontem. Conferir tracking antes de mexer em campanha.' });
  }
  // 3. pacing do mês
  if (x.temVerba) {
    const idx = (x.investido / x.budget) / datas.pctMes;
    const sv = sevInvest_(x.stInv);
    const fora = vs.filter(v => v.budget > 0 && sevInvest_(v.status) !== 'ok' && !v.emCorrecao);
    const corr = vs.filter(v => v.emCorrecao);
    let t = 'No mês: <b>' + Math.round(x.investido / x.budget * 100) + '% da verba</b> com ' + Math.round(datas.pctMes * 100) + '% do mês (índice ' + idx.toFixed(2) + '), fecha em ' + fmtKint(x.projConta) + ' de ' + fmtKint(x.budget) + '.';
    if (fora.length) t += ' Fora do ritmo: ' + fora.map(v => plataformaCanonica_(v.nome) + ' (' + (v.ajuste >= 0 ? 'acelerar ' : 'frear ') + fmtKint(Math.abs(v.ajuste)) + '/dia)').join(', ') + '.';
    if (corr.length) t += ' ' + corr.map(v => plataformaCanonica_(v.nome)).join(' e ') + ' já em correção desde ontem.';
    out.push({ sev: sv, txt: t });
  }
  // 4. previsão pela curva (tendências)
  const prev = Object.keys(plat).filter(p => plat[p] && plat[p].suficiente && plat[p].status_previsto && plat[p].status_previsto !== 'fecha no ritmo' && plat[p].status_atual === 'NO RITMO');
  if (prev.length) out.push({ sev: 'aten', txt: 'Pela curva dos últimos 14 dias, ' + prev.map(p => p + ' <b>' + esc_(plat[p].status_previsto) + '</b>' + (plat[p].dias_ate_estourar_budget ? ' em ' + plat[p].dias_ate_estourar_budget + ' dia(s)' : '')).join('; ') + ', mesmo estando no ritmo hoje.' });
  // 5. ação do dia (primeiro elefante)
  if (x.elef && x.elef.length) out.push({ sev: x.elef[0].sev, txt: 'Ação do dia: ' + x.elef[0].titulo + '. ' + x.elef[0].acao + '.' });
  return out.slice(0, 6);
}

// ---------------------------------------------------------------------
//  SLACK VISUAL (v3.4): espelho do e-mail executivo "Contas para olhar hoje"
//  Mesma estrutura do montarHtmlExecutivo_: cabeçalho, placar das contas
//  citadas com status por plataforma, e uma seção por conta crítica com
//  verba, alertas críticos e o gráfico de pacing do mês (g1) na própria
//  mensagem (image block com slack_file). Sem crítico: placar da carteira.
//  Precisa de SLACK_BOT_TOKEN (chat:write + files:write) e do bot no canal.
//  Sem files:write, sai o texto sem gráfico e o motivo vai para o log e para
//  a aba ALERTAS. Sem token, cai no texto antigo pelo webhook.
// ---------------------------------------------------------------------
const SLACK_CANAL_PADRAO = 'C0BG2NK56UC';   // #controle_pacing_diário

function enviarSlackVisual_(ss, crit, aten, painel, datas, url, alertas) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('SLACK_BOT_TOKEN');
  const canal = props.getProperty('SLACK_CANAL_ID') || SLACK_CANAL_PADRAO;
  if (!token) {
    if (typeof postarNoCanalPacing_ === 'function') postarNoCanalPacing_(montarTextoSlack_(crit, aten, [], datas, url), alertas);
    return;
  }
  const serie = (typeof lerSerie_ === 'function') ? lerSerie_(ss, datas) : {};
  const m = montarBlocosSlack_(crit, aten, painel, datas, url, serie);

  // 1) sobe os gráficos (sem canal: o arquivo só é compartilhado quando a mensagem sai)
  const ids = {};
  let erroUpload = '';
  Object.keys(m.imagens).forEach(k => {
    try { ids[k] = slackUploadPng_(token, null, m.imagens[k], k + '.png', ''); }
    catch (e) { erroUpload = e.message; Logger.log('Slack upload %s: %s', k, e.message); }
  });

  // 2) posta a mensagem com as imagens embutidas; se o Slack recusar os image blocks,
  //    posta só o texto e manda cada gráfico como arquivo logo abaixo
  let blocks = m.blocks.map(b => (b.type === 'image' && ids[b.slack_key]) ? { type: 'image', slack_file: { id: ids[b.slack_key] }, alt_text: b.alt_text, title: b.title } : b)
    .filter(b => b.type !== 'image' || b.slack_file);
  if (erroUpload) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Gráficos não enviados: ' + erroUpload + ' (confira o escopo files:write do bot).' }] });
  try {
    slackPostBlocks_(token, canal, m.texto, blocks);
  } catch (e) {
    Logger.log('Slack blocks com imagem falhou (%s); tentando sem imagem.', e.message);
    try {
      slackPostBlocks_(token, canal, m.texto, m.blocks.filter(b => b.type !== 'image'));
      Object.keys(m.imagens).forEach(k => { try { slackUploadPng_(token, canal, m.imagens[k], k + '.png', m.legendas[k] || k); } catch (e2) { Logger.log('Slack gráfico %s: %s', k, e2.message); } });
    } catch (e2) {
      if (alertas) alertas.push(alerta_(NIVEL.ATENCAO, 'GERAL', 'Slack não postado', 'chat.postMessage falhou: ' + e2.message, 'slack_erro'));
      if (typeof postarNoCanalPacing_ === 'function') postarNoCanalPacing_(montarTextoSlack_(crit, aten, [], datas, url), alertas);
      return;
    }
  }
  if (erroUpload && alertas) alertas.push(alerta_(NIVEL.ATENCAO, 'GERAL', 'Slack sem gráficos', 'Upload falhou: ' + erroUpload + '. Confira o escopo files:write do bot.', 'slack_upload'));
}

/**
 * Blocos do Slack no mesmo desenho do e-mail executivo.
 * @return {{texto: string, blocks: Array, imagens: Object, legendas: Object}}
 *   blocks traz image blocks provisórios {type:'image', slack_key, alt_text, title}
 *   que enviarSlackVisual_ troca pelo id do arquivo depois do upload.
 */
function montarBlocosSlack_(crit, aten, painel, datas, url, serie) {
  serie = serie || {};
  const bola = sev => sev === 'ok' ? ':large_green_circle:' : sev === 'aten' ? ':large_yellow_circle:' : sev === 'crit' ? ':red_circle:' : ':white_circle:';
  const sec = txt => ({ type: 'section', text: { type: 'mrkdwn', text: txt } });
  const ctx = txt => ({ type: 'context', elements: [{ type: 'mrkdwn', text: txt }] });
  const div = () => ({ type: 'divider' });
  const pctMes = Math.round(datas.pctMes * 100);

  // Agrupa críticos por conta, na ordem do PAINEL; o que não é conta vira "Sistema".
  const porConta = {}; const sistema = [];
  const nomes = painel.contas.map(c => c.nome);
  crit.forEach(a => { if (nomes.indexOf(a.conta) >= 0) (porConta[a.conta] = porConta[a.conta] || []).push(a); else sistema.push(a); });
  const contasCit = painel.contas.filter(c => porConta[c.nome]);

  const chips = c => (c.veiculos || []).filter(v => !v.inconsistente).map(v => {
    const p = plataformaCanonica_(v.nome); const sv = v.budget ? sevInvest_(v.status) : 'na';
    return bola(sv) + ' ' + p + ' ' + (v.budget ? rotuloStatusCurto_(v.status).split(' (')[0] : 'sem verba');
  }).join('   ');

  const blocks = [], imagens = {}, legendas = {};
  const nCont = contasCit.length + (sistema.length ? 1 : 0);
  blocks.push({ type: 'header', text: { type: 'plain_text', text: nCont ? nCont + ' conta' + (nCont === 1 ? '' : 's') + ' para olhar hoje' : 'Nenhuma conta para olhar hoje' } });
  blocks.push(ctx('Dados de ' + datas.labelOntem + ' · dia ' + datas.diasDecorridos + ' de ' + datas.diasNoMes + ' (' + pctMes + '% do mês) · ' +
    crit.length + ' crítico(s) · ' + aten.length + ' atenção · só o que precisa de ação hoje; o resto está no e-mail de cada cliente · <' + url + '|abrir planilha>'));
  blocks.push(div());

  // Placar: contas citadas (sem crítico, a carteira inteira, para não sair vazio)
  const placar = (contasCit.length ? contasCit : painel.contas.filter(c => (c.veiculos || []).length)).map(c =>
    bola(contasCit.length ? 'crit' : severidadeConta_(c)) + ' *' + c.nome + '*' + (c.responsavel ? ' · ' + c.responsavel : '') +
    (porConta[c.nome] ? ' · ' + porConta[c.nome].length + ' crítico(s)' : '') + '\n        ' + chips(c));
  if (sistema.length) placar.push(bola('crit') + ' *Sistema* · ' + sistema.length + ' crítico(s)');
  for (let i = 0; i < placar.length; i += 6) blocks.push(sec(placar.slice(i, i + 6).join('\n')));

  // Uma seção por conta citada: verba, alertas críticos, gráfico de pacing (até 8 contas)
  contasCit.slice(0, 8).forEach((c, i) => {
    const vs = (c.veiculos || []).filter(v => !v.inconsistente);
    const moeda = CONTA_MOEDA[c.nome] || 'R$';
    const fmtKint = v => { v = Number(v) || 0; return Math.abs(v) >= 1000 ? moeda + ' ' + Math.round(v / 1000) + 'k' : brl_(v).replace('R$', moeda); };
    const soma = k => vs.reduce((a, v) => a + (Number(v[k]) || 0), 0);
    const budget = soma('budget'), investido = soma('investido');
    blocks.push(div());
    blocks.push(sec('*' + c.nome + '*\n' + (budget ? fmtKint(investido) + ' de ' + fmtKint(budget) + ' (' + Math.round(investido / budget * 100) + '% da verba com ' + pctMes + '% do mês)' : fmtKint(investido) + ' investidos · sem verba fixa') +
      (c.credito ? ' · CRÉDITO DA AGÊNCIA' : '')));
    const itens = porConta[c.nome].map(a => {
      const plat = a.titulo.indexOf(' / ') >= 0 ? a.titulo.split(' / ').pop() : '';
      const tit = a.titulo.split(':')[0].replace(/ \[.*\]/, '');
      return ':red_circle: *' + tit + '*' + (plat ? ' · ' + plat : '') + (a.persistencia && a.persistencia !== 'NOVO' ? ' _(' + a.persistencia + ')_' : '') + '\n        ' + String(a.detalhe).substring(0, 400);
    });
    for (let j = 0; j < itens.length; j += 4) blocks.push(sec(itens.slice(j, j + 4).join('\n')));
    try {
      const g = graficosConta_(c, datas, serie[c.nome] || {}, vs, {}, moeda, { budget: budget, investido: investido, projConta: soma('proj'), metaRoas: 0 }, ['g1']);
      if (g.g1) {
        const k = 'pacing-' + (i + 1) + '-' + c.nome.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + fmtIso_(datas.ontem);
        imagens[k] = g.g1;
        legendas[k] = c.nome + ' · pacing do mês · acumulado x ideal x projeção';
        blocks.push({ type: 'image', slack_key: k, alt_text: legendas[k], title: { type: 'plain_text', text: 'Pacing do mês · acumulado x ideal x projeção' } });
      }
    } catch (e) { Logger.log('Gráfico Slack de %s: %s', c.nome, e.message); }
  });
  if (contasCit.length > 8) blocks.push(ctx('+ ' + (contasCit.length - 8) + ' conta(s) com crítico na aba ALERTAS'));

  if (sistema.length) {
    blocks.push(div());
    blocks.push(sec('*Sistema*\n' + sistema.slice(0, 6).map(a => ':red_circle: *' + a.titulo + '*\n        ' + String(a.detalhe).substring(0, 300)).join('\n')));
  }
  blocks.push(ctx('Só alertas críticos. Atenção e informativos ficam na aba ALERTAS e no e-mail de cada cliente, que sai em seguida.'));

  const texto = nCont ? nCont + ' conta(s) para olhar hoje · pacing ' + datas.labelOntem + ' · ' + crit.length + ' crítico(s)' : 'Pacing ' + datas.labelOntem + ': nenhuma conta para olhar hoje';
  return { texto: texto, blocks: blocks, imagens: imagens, legendas: legendas };
}

function slackPostBlocks_(token, canal, texto, blocks) {
  const r = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post', contentType: 'application/json; charset=utf-8', headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ channel: canal, text: texto, blocks: blocks, unfurl_links: false }), muteHttpExceptions: true
  });
  const body = JSON.parse(r.getContentText());
  if (!body.ok) throw new Error('chat.postMessage: ' + body.error);
  return body.ts;
}

/**
 * Sobe um PNG (files.getUploadURLExternal + files.completeUploadExternal). Exige files:write.
 * Com canal, publica no canal com o comentário; sem canal, só sobe e devolve o id
 * para usar num image block (slack_file). @return {string} id do arquivo
 */
function slackUploadPng_(token, canal, blob, nome, comentario) {
  const bytes = blob.getBytes();
  const r1 = UrlFetchApp.fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'post', headers: { Authorization: 'Bearer ' + token }, payload: { filename: nome, length: String(bytes.length) }, muteHttpExceptions: true
  });
  const b1 = JSON.parse(r1.getContentText());
  if (!b1.ok) throw new Error('getUploadURLExternal: ' + b1.error);
  const r2 = UrlFetchApp.fetch(b1.upload_url, { method: 'post', contentType: 'image/png', payload: bytes, muteHttpExceptions: true });
  if (r2.getResponseCode() >= 300) throw new Error('upload ' + r2.getResponseCode());
  const corpo = { files: [{ id: b1.file_id, title: nome }] };
  if (canal) { corpo.channel_id = canal; corpo.initial_comment = comentario || ''; }
  const r3 = UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'post', contentType: 'application/json; charset=utf-8', headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(corpo), muteHttpExceptions: true
  });
  const b3 = JSON.parse(r3.getContentText());
  if (!b3.ok) throw new Error('completeUploadExternal: ' + b3.error);
  return b1.file_id;
}

/**
 * Editor: manda o Slack visual de hoje para o canal em SLACK_CANAL_TESTE
 * (propriedade do script). Sem essa propriedade, não manda nada e avisa:
 * o canal de produção não é lugar de teste.
 */
function testarSlackVisual() {
  const props = PropertiesService.getScriptProperties();
  const canalTeste = props.getProperty('SLACK_CANAL_TESTE');
  if (!canalTeste) { Logger.log('Defina a propriedade SLACK_CANAL_TESTE (ID de um canal de teste, ex.: C0XXXXXXX) antes de testar.'); return; }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const datas = calcularDatas_();
  const alertas = [];
  const painel = lerPainel_(ss, datas, alertas);
  const orcamentos = (function () { try { return lerOrcamentosExternos_(); } catch (e) { return {}; } })();
  painel.contas.forEach(c => analisarConta_(ss, c, datas, orcamentos, alertas));
  const crit = alertas.filter(a => a.nivel === NIVEL.CRITICO), aten = alertas.filter(a => a.nivel === NIVEL.ATENCAO);
  const original = props.getProperty('SLACK_CANAL_ID');
  props.setProperty('SLACK_CANAL_ID', canalTeste);
  try { enviarSlackVisual_(ss, crit, aten, painel, datas, ss.getUrl(), alertas); }
  finally { if (original) props.setProperty('SLACK_CANAL_ID', original); else props.deleteProperty('SLACK_CANAL_ID'); }
  const extras = alertas.filter(a => a.chave === 'slack_erro' || a.chave === 'slack_upload');
  Logger.log('Slack visual de teste enviado para ' + canalTeste + ' (' + crit.length + ' críticos, ' + aten.length + ' atenção).' + (extras.length ? '\nPROBLEMA: ' + extras.map(a => a.titulo + ': ' + a.detalhe).join('\n') : ''));
}

function nomeCurto_(n) { n = String(n || ''); return n.length > 44 ? n.substring(0, 43) + '…' : n; }

// ---------------------------------------------------------------------
//  FAIXAS DE AÇÃO (3 no topo) E ELEFANTES (até 5)
// ---------------------------------------------------------------------
function faixasAcao_(c, vs, inconsistentes, plat, datas, fmtK) {
  const out = [];
  const peso = { crit: 0, aten: 1, ok: 2, na: 3 };
  vs.forEach(v => {
    const p = plataformaCanonica_(v.nome), t = plat[p];
    if (v.gastoOntem === 0 && v.budget > 0) out.push({ sev: 'crit', titulo: 'conferir campanha · ' + fmtK(v.budget - v.investido) + ' parados', quem: p, sub: 'gasto zero ontem com verba ativa' });
    if (v.emCorrecao) {
      out.push({ sev: 'ok', titulo: 'manter o ritmo de ' + fmtK(v.ritmoNec) + '/dia', quem: p, sub: 'ajuste aplicado: ontem ' + fmtK(v.gastoOntem) + ' · índice do mês ainda ' + v.idx.toFixed(2) + 'x' });
    } else if (v.budget > 0 && sevInvest_(v.status) !== 'ok') {
      out.push({ sev: sevInvest_(v.status), titulo: (v.ajuste >= 0 ? 'acelerar ' : 'frear ') + fmtK(Math.abs(v.ajuste)) + '/dia', quem: p,
        sub: 'fecha ' + Math.round(Math.abs(v.proj / v.budget - 1) * 100) + '% ' + (v.desvio >= 0 ? 'acima' : 'abaixo') + ' da verba' });
    } else if (t && t.status_previsto && t.status_previsto !== 'fecha no ritmo' && t.status_atual === 'NO RITMO') {
      out.push({ sev: 'aten', titulo: 'olhar a curva · ' + esc_(t.status_previsto), quem: p, sub: 'pelos últimos 14 dias' + (t.dias_ate_estourar_budget ? ' · em ' + t.dias_ate_estourar_budget + ' dia(s)' : '') });
    }
    if (v.metaRoas > 0 && v.investido > 0 && v.roas < v.metaRoas) {
      out.push({ sev: v.roas >= v.metaRoas * 0.85 ? 'aten' : 'crit', titulo: 'revisar campanhas abaixo de ROAS ' + v.metaRoas.toFixed(2), quem: 'ROAS ' + p, sub: v.roas.toFixed(2) + ' vs meta ' + v.metaRoas.toFixed(2) });
    }
    if (v.metaCpa > 0 && v.cpa > v.metaCpa) out.push({ sev: sevCpa_(v), titulo: 'revisar conjuntos com CPA acima de ' + fmtK(v.metaCpa), quem: 'CPA ' + p, sub: fmtK(v.cpa) + ' vs meta ' + fmtK(v.metaCpa) });
  });
  inconsistentes.forEach(v => out.push({ sev: 'na', titulo: 'conferir fórmula da linha 7', quem: plataformaCanonica_(v.nome), sub: 'investido do mês incompatível com a verba' }));
  return out.sort((a, b) => peso[a.sev] - peso[b.sev]);
}

/**
 * Até 5 itens, ordem de impacto. Regras fixas sobre veredito, plataforma e
 * alterações. Cada item traz o número que o justifica e uma ação concreta.
 */
function elefantes_(c, vs, inconsistentes, plat, camps, alts, datas, moeda, fmtKint) {
  const out = [];
  const pct = x => Math.round(x * 100) + '%';
  const altDe = (x) => alts.filter(a => a.entidade && x.nome && (a.entidade === x.nome || x.nome.indexOf(a.entidade) >= 0 || a.entidade.indexOf(x.nome) >= 0) && /budget|orcamento|amount/i.test(a.campo || ''))[0];

  // 1. plataforma parada
  vs.forEach(v => { if (v.gastoOntem === 0 && v.budget > 0) { const p = plataformaCanonica_(v.nome);
    out.push({ peso: 0, sev: 'crit', plat: p, titulo: esc_(p) + ' sem gasto ontem com ' + fmtKint(v.budget - v.investido) + ' de verba restante', sub: 'gasto zero em ' + datas.labelOntem + ' · ' + fmtKint(v.investido) + ' gastos de ' + fmtKint(v.budget), acao: 'Conferir status das campanhas e do meio de pagamento; se voltar, diário de ' + fmtKint((v.budget - v.investido) / Math.max(1, datas.diasRestantes)) }); } });

  // 2. REDUZIR ou DESATIVAR, por share. Desativar só quando: campanha com idade
  //    mínima, KPI muito abaixo da meta (ROAS < 60% da meta ou CPA > 160% da meta)
  //    e existe na MESMA conta uma campanha Y comprovadamente melhor (7 dias,
  //    idade mínima, share relevante) para receber a verba. Senão, reduzir.
  const kpiDe = x => c.porCpa ? (x.cpa === null ? 'sem conversão' : 'CPA ' + moeda + ' ' + Math.round(x.cpa)) : (x.roas === null ? 'sem receita' : 'ROAS ' + x.roas.toFixed(1));
  const melhores = camps.filter(y => y.veredito !== 'OBSERVAR' && y.veredito !== 'CONFERIR' && !y.marca && y.share >= 0.05 && (c.porCpa ? y.cpa !== null : y.roas !== null))
    .sort((a, b) => c.porCpa ? a.cpa - b.cpa : b.roas - a.roas);
  camps.filter(x => x.veredito === 'REDUZIR').sort((a, b) => b.share - a.share).forEach(x => {
    const a = altDe(x);
    const y = melhores.filter(m => m.nome !== x.nome && m.plataforma === x.plataforma)[0] || melhores.filter(m => m.nome !== x.nome)[0];
    const meta = c.porCpa ? x.meta_cpa : x.meta_roas;
    const muitoRuim = c.porCpa ? (x.cpa !== null && meta && x.cpa > meta * 1.6) : (x.roas !== null && meta && x.roas < meta * 0.6);
    const yMelhor = y && (c.porCpa ? y.cpa <= x.cpa / 1.5 : y.roas >= (x.roas || 0) * 1.5);
    const piorando = x.tendencia_kpi === 'piorando';
    const porque = y ? (c.porCpa ? 'CPA ' + moeda + ' ' + Math.round(y.cpa) : 'ROAS ' + y.roas.toFixed(1)) + ' em 7 dias, ' + (y.dias_ativa || 'n/d') + ' dias no ar' +
      (y.uso_orcamento_diario !== null && y.uso_orcamento_diario >= 0.9 ? ', gastando ' + pct(y.uso_orcamento_diario) + ' do diário (tem demanda represada)' : '') : '';
    const sub = 'meta ' + (c.porCpa ? moeda + ' ' + Math.round(meta || 0) : (meta || 0).toFixed(2)) + ' · ' + (x.dias_ativa || 'n/d') + ' dias no ar · ' + fmtKint(x.gasto) + ' em 7 dias (' + fmtKint(x.gasto_medio_dia) + '/dia)' +
      (piorando ? ' · piorando nos últimos 3 dias (' + kpiDe({ cpa: x.cpa_3d, roas: x.roas_3d }) + ')' : '') +
      (a ? ' · verba ' + (a.de !== '' ? a.de + ' → ' : '') + a.para + ' em ' + a.dia.substring(8, 10) + '/' + a.dia.substring(5, 7) + ' não devolveu resultado' : '');
    if (muitoRuim && yMelhor) {
      out.push({ peso: 0.5 - x.share, sev: 'crit', plat: x.plataforma,
        titulo: esc_(nomeCurto_(x.nome)) + ' está com orçamento a mais para o que entrega: ' + kpiDe(x) + ' com ' + pct(x.share) + ' da verba', sub: sub,
        acao: 'Desativar e realocar os ' + fmtKint(x.gasto_medio_dia) + '/dia para ' + esc_(nomeCurto_(y.nome)) + ', que funciona melhor: ' + porque });
    } else {
      out.push({ peso: 1 - x.share, sev: 'crit', plat: x.plataforma,
        titulo: esc_(nomeCurto_(x.nome)) + ' queima ' + pct(x.share) + ' da verba com ' + kpiDe(x), sub: sub,
        acao: 'Reduzir 30% do orçamento' + (x.orcamento_diario ? ' (' + fmtKint(x.orcamento_diario) + ' → ' + fmtKint(x.orcamento_diario * 0.7) + '/dia)' : '') +
          (y ? ' e mover para ' + esc_(nomeCurto_(y.nome)) + ' (' + porque + ')' : '') + '; reavaliar em 3 dias' });
    }
  });

  // 3. CONFERIR (gasto sem conversão)
  camps.filter(x => x.veredito === 'CONFERIR').sort((a, b) => b.share - a.share).forEach(x => {
    out.push({ peso: 2 - x.share, sev: 'crit', plat: x.plataforma, titulo: esc_(nomeCurto_(x.nome)) + ' gastou ' + fmtKint(x.gasto) + ' em 7 dias sem conversão',
      sub: pct(x.share) + ' do gasto da conta · ' + (x.cliques || 0) + ' cliques · ' + (x.dias_ativa || 'n/d') + ' dias ativa', acao: 'Conferir se o evento de conversão está chegando desta campanha; se o tracking está certo, pausar' });
  });

  // 4. ESCALAR travada no diário
  camps.filter(x => x.veredito === 'ESCALAR').forEach(x => {
    const travada = x.uso_orcamento_diario !== null && x.uso_orcamento_diario >= 0.9;
    const t = plat[x.plataforma];
    const abaixo = t && t.ritmo_necessario_dia && t.media_7d && t.ritmo_necessario_dia > t.media_7d;
    if (!travada && !abaixo) return;
    const od = x.orcamento_diario;
    if (x.tendencia_kpi === 'piorando') return; // não escalar o que está piorando nos últimos 3 dias
    out.push({ peso: 3 - x.share, sev: 'ok', plat: x.plataforma, titulo: esc_(nomeCurto_(x.nome)) + ' tem espaço para escalar' + (travada ? ' e está travada no diário' : ''),
      sub: (c.porCpa ? 'CPA ' + moeda + ' ' + Math.round(x.cpa) : 'ROAS ' + x.roas.toFixed(1)) + (x.cpa ? ' · CPA ' + moeda + ' ' + Math.round(x.cpa) : '') + (travada ? ' · gastando ' + pct(x.uso_orcamento_diario) + ' do diário' : ' · plataforma abaixo do ritmo'),
      acao: od ? 'Subir diário em 20% (' + fmtKint(od) + ' → ' + fmtKint(od * 1.2) + ') e reavaliar em 3 dias' : 'Subir o orçamento em 20% e reavaliar em 3 dias' });
  });

  // 5. frequência
  camps.forEach(x => {
    if (x.plataforma !== 'Meta' || x.frequencia === null) return;
    const rmkt = /rmkt|remarketing|retarget/i.test(x.nome || '');
    if (!rmkt && x.frequencia >= 4) out.push({ peso: 4, sev: 'aten', plat: 'Meta', titulo: esc_(nomeCurto_(x.nome)) + ' com frequência ' + x.frequencia.toFixed(1) + ' em 7 dias', sub: 'prospecção · ' + (x.roas !== null ? 'ROAS ' + x.roas.toFixed(1) : 'sem receita') + ' · CTR ' + (x.ctr !== null ? (x.ctr * 100).toFixed(2) + '%' : 'n/d'), acao: 'Trocar os criativos mais servidos e reduzir 30% até a frequência voltar abaixo de 3' });
    if (rmkt && x.frequencia >= 8) out.push({ peso: 4.5, sev: 'aten', plat: 'Meta', titulo: esc_(nomeCurto_(x.nome)) + ' com frequência ' + x.frequencia.toFixed(1) + ' em 7 dias', sub: 'remarketing · ' + (x.roas !== null ? 'ROAS ' + x.roas.toFixed(1) : 'sem receita'), acao: 'Cap de frequência em 4 e excluir compradores dos últimos 14 dias' });
  });

  // 6. plataforma com ROAS/CPA abaixo da meta sem campanha culpada identificada
  vs.forEach(v => {
    const p = plataformaCanonica_(v.nome);
    if (v.metaRoas > 0 && v.investido > 0 && v.roas < v.metaRoas * 0.85 && !out.some(e => e.plat === p && e.sev === 'crit')) {
      out.push({ peso: 5, sev: 'aten', plat: p, titulo: 'ROAS ' + p + ' ' + v.roas.toFixed(2) + ' contra meta ' + v.metaRoas.toFixed(2) + ' no mês', sub: 'receita ' + fmtKint(v.receita) + ' com ' + fmtKint(v.investido) + ' de gasto · causa não identificada nas campanhas', acao: 'Abrir por conjunto e criativo; sem detalhe abaixo de campanha hoje' });
    }
  });

  // 7. pacing da plataforma fora
  vs.forEach(v => {
    const p = plataformaCanonica_(v.nome);
    if (v.budget > 0 && sevInvest_(v.status) === 'crit' && v.gastoOntem !== 0 && !out.some(e => e.plat === p && /verba|pacing/.test(e.titulo))) {
      out.push({ peso: 6, sev: 'crit', plat: p, titulo: p + ' fecha ' + pct(Math.abs(v.proj / v.budget - 1)) + ' ' + (v.desvio >= 0 ? 'acima' : 'abaixo') + ' da verba', sub: fmtKint(v.investido) + ' de ' + fmtKint(v.budget) + ' com ' + Math.round(datas.pctMes * 100) + '% do mês', acao: (v.ajuste >= 0 ? 'Acelerar ' : 'Frear ') + fmtKint(Math.abs(v.ajuste)) + '/dia' + (c.credito && v.desvio > 0 ? '; estouro é prejuízo da Modesto' : '') });
    }
  });

  inconsistentes.forEach(v => out.push({ peso: 9, sev: 'na', plat: plataformaCanonica_(v.nome), titulo: 'Número da planilha incompatível com a verba', sub: 'investido do mês ' + fmtKint(v.investido) + ' com verba ' + fmtKint(v.budget), acao: 'Corrigir a fórmula da linha 7 na aba ' + esc_(c.nome) }));

  return out.sort((a, b) => a.peso - b.peso).slice(0, 5);
}

// ---------------------------------------------------------------------
//  GRÁFICOS (serviço Charts do Apps Script -> PNG embutido)
// ---------------------------------------------------------------------
function graficosConta_(c, datas, serieConta, vs, plat, moeda, tot, apenas) {
  const out = {};
  const quer = k => !apenas || apenas.indexOf(k) >= 0;   // apenas: ['g1'] gera só o pacing (e-mail executivo)
  const plats = Object.keys(serieConta).filter(p => (serieConta[p] || []).length);
  if (!plats.length || typeof Charts === 'undefined') return out;
  const fuso = CONFIG.FUSO;
  const cores = plats.map(corPlat_);
  const base = { backgroundColor: '#FFFFFF', chartArea: { left: 56, top: 18, width: '84%', height: '68%' }, fontName: 'Arial', fontSize: 12,
    titleTextStyle: { fontSize: 12 }, vAxis: { format: 'short', gridlines: { color: '#E2DDD3' }, textStyle: { color: '#4A4A46' }, baselineColor: '#E2DDD3' },
    hAxis: { textStyle: { color: '#4A4A46' }, gridlines: { color: 'transparent' } } };
  const pontosDoMes = [];   // {dia(número), porPlat:{p:inv}}
  const mesRef = datas.mes, anoRef = datas.ano;
  const idx = {};
  plats.forEach(p => serieConta[p].forEach(pt => {
    if (pt.data.getMonth() + 1 !== mesRef || pt.data.getFullYear() !== anoRef) return;
    const d = pt.data.getDate();
    const r = idx[d] = idx[d] || { dia: d, porPlat: {}, planejado: 0 };
    r.porPlat[p] = (r.porPlat[p] || 0) + (pt.investido || 0);
    r.planejado += pt.planejado || 0;
  }));
  Object.keys(idx).map(Number).sort((a, b) => a - b).forEach(d => pontosDoMes.push(idx[d]));

  try {
    // g1: pacing do mês (acumulado x ideal x projeção x verba)
    if (quer('g1') && tot.budget > 0 && pontosDoMes.length) {
      const dt = Charts.newDataTable().addColumn(Charts.ColumnType.NUMBER, 'dia do mês').addColumn(Charts.ColumnType.NUMBER, 'realizado')
        .addColumn(Charts.ColumnType.NUMBER, 'ideal').addColumn(Charts.ColumnType.NUMBER, 'projeção (ritmo 7d)').addColumn(Charts.ColumnType.NUMBER, 'verba');
      let acum = 0; const acumPorDia = {};
      pontosDoMes.forEach(r => { acum += Object.keys(r.porPlat).reduce((a, p) => a + r.porPlat[p], 0); acumPorDia[r.dia] = acum; });
      const ritmo7 = (tot.projConta - tot.investido) / Math.max(1, datas.diasRestantes);
      let ultimo = tot.investido;
      for (let d = 1; d <= datas.diasNoMes; d++) {
        const real = d <= datas.diaOntem ? (acumPorDia[d] !== undefined ? acumPorDia[d] : null) : null;
        if (real !== null) ultimo = real;
        const proj = d >= datas.diaOntem ? (d === datas.diaOntem ? ultimo : ultimo + ritmo7 * (d - datas.diaOntem)) : null;
        dt.addRow([d, real, tot.budget / datas.diasNoMes * d, proj, tot.budget]);
      }
      out.g1 = Charts.newLineChart().setDataTable(dt.build()).setDimensions(764, 300)
        .setOption('colors', ['#1A1A18', '#9A978F', '#C9A227', '#B3261E'])
        .setOption('series', { 0: { lineWidth: 3 }, 1: { lineWidth: 2, lineDashStyle: [6, 4] }, 2: { lineWidth: 2, lineDashStyle: [2, 3] }, 3: { lineWidth: 1 } })
        .setOption('legend', { position: 'bottom', textStyle: { color: '#4A4A46' } }).setOption('hAxis', Object.assign({ title: 'dia do mês', ticks: [1, 5, 10, 15, 20, 25, datas.diasNoMes] }, base.hAxis))
        .setOption('vAxis', base.vAxis).setOption('backgroundColor', base.backgroundColor).setOption('chartArea', base.chartArea).setOption('interpolateNulls', false).build().getBlob().setName('g1.png');
    }

    // g7: receita do mês (acumulada x ideal da meta x projeção x meta), mesmo desenho do pacing
    if (quer('g7') && pontosDoMes.length) {
      const recPorDia = {};
      plats.forEach(p => serieConta[p].forEach(pt => {
        if (pt.data.getMonth() + 1 !== mesRef || pt.data.getFullYear() !== anoRef) return;
        const d = pt.data.getDate(); recPorDia[d] = (recPorDia[d] || 0) + (pt.receita || 0);
      }));
      const dias = Object.keys(recPorDia).map(Number);
      if (dias.length && Object.keys(recPorDia).some(d => recPorDia[d] > 0)) {
        const meta = tot.metaReceita || 0;
        const dt = Charts.newDataTable().addColumn(Charts.ColumnType.NUMBER, 'dia do mês').addColumn(Charts.ColumnType.NUMBER, 'receita acumulada');
        if (meta) dt.addColumn(Charts.ColumnType.NUMBER, 'ideal da meta');
        dt.addColumn(Charts.ColumnType.NUMBER, 'projeção (ritmo 7d)');
        if (meta) dt.addColumn(Charts.ColumnType.NUMBER, 'meta do mês');
        let acum = 0; const acumPorDia = {};
        for (let d = 1; d <= datas.diaOntem; d++) { if (recPorDia[d] !== undefined) { acum += recPorDia[d]; acumPorDia[d] = acum; } }
        let rec7 = 0, n7 = 0;
        for (let d = Math.max(1, datas.diaOntem - 6); d <= datas.diaOntem; d++) { if (recPorDia[d] !== undefined) { rec7 += recPorDia[d]; n7++; } }
        const ritmo7 = n7 ? rec7 / n7 : 0;
        let ultimo = acum;
        for (let d = 1; d <= datas.diasNoMes; d++) {
          const real = d <= datas.diaOntem ? (acumPorDia[d] !== undefined ? acumPorDia[d] : null) : null;
          if (real !== null) ultimo = real;
          const proj = d >= datas.diaOntem ? (d === datas.diaOntem ? ultimo : ultimo + ritmo7 * (d - datas.diaOntem)) : null;
          const row = [d, real]; if (meta) row.push(meta / datas.diasNoMes * d); row.push(proj); if (meta) row.push(meta);
          dt.addRow(row);
        }
        const cores7 = meta ? ['#2E7D4F', '#9A978F', '#C9A227', '#B3261E'] : ['#2E7D4F', '#C9A227'];
        const series7 = meta ? { 0: { lineWidth: 3 }, 1: { lineWidth: 2, lineDashStyle: [6, 4] }, 2: { lineWidth: 2, lineDashStyle: [2, 3] }, 3: { lineWidth: 1 } } : { 0: { lineWidth: 3 }, 1: { lineWidth: 2, lineDashStyle: [2, 3] } };
        out.g7 = Charts.newLineChart().setDataTable(dt.build()).setDimensions(764, 300)
          .setOption('colors', cores7).setOption('series', series7)
          .setOption('legend', { position: 'bottom', textStyle: { color: '#4A4A46' } }).setOption('hAxis', Object.assign({ title: 'dia do mês', ticks: [1, 5, 10, 15, 20, 25, datas.diasNoMes] }, base.hAxis))
          .setOption('vAxis', base.vAxis).setOption('backgroundColor', base.backgroundColor).setOption('chartArea', base.chartArea).setOption('interpolateNulls', false).build().getBlob().setName('g7.png');
      }
    }

    // g2: gasto por dia, últimos 14 dias, colunas empilhadas por plataforma + planejado/dia
    if (quer('g2')) {
      const dt = Charts.newDataTable().addColumn(Charts.ColumnType.STRING, 'dia');
      plats.forEach(p => dt.addColumn(Charts.ColumnType.NUMBER, p));
      let algum = false;
      for (let k = 13; k >= 0; k--) {
        const d = new Date(datas.ontem.getTime() - k * 86400000);
        const iso = fmtIso_(d);
        const row = [Utilities.formatDate(d, fuso, 'dd')];
        plats.forEach(p => { const pt = serieConta[p].filter(x => fmtIso_(x.data) === iso)[0]; const v = pt && pt.investido ? pt.investido : 0; if (v) algum = true; row.push(v); });
        dt.addRow(row);
      }
      if (algum) {
        out.g2 = Charts.newColumnChart().setDataTable(dt.build()).setDimensions(764, 300).setStacked()
          .setOption('colors', cores)
          .setOption('legend', { position: 'top', textStyle: { color: '#4A4A46' } }).setOption('hAxis', Object.assign({ title: 'dia' }, base.hAxis)).setOption('vAxis', base.vAxis)
          .setOption('backgroundColor', base.backgroundColor).setOption('chartArea', base.chartArea).setOption('bar', { groupWidth: '70%' }).build().getBlob().setName('g2.png');
      }
    }

    // g3: mix de investimento (donut do gasto do mês)
    if (quer('g3') && tot.investido > 0) {
      const dt = Charts.newDataTable().addColumn(Charts.ColumnType.STRING, 'plataforma').addColumn(Charts.ColumnType.NUMBER, 'gasto');
      const corMix = [];
      vs.forEach(v => { if (v.investido > 0) { const p = plataformaCanonica_(v.nome); dt.addRow([p, v.investido]); corMix.push(corPlat_(p)); } });
      out.g3 = Charts.newPieChart().setDataTable(dt.build()).setDimensions(190, 190)
        .setOption('colors', corMix).setOption('pieHole', 0.55).setOption('legend', 'none').setOption('pieSliceText', 'none')
        .setOption('backgroundColor', '#FFFFFF').setOption('chartArea', { left: 6, top: 6, width: '90%', height: '90%' }).setOption('pieSliceBorderColor', '#FFFFFF').build().getBlob().setName('g3.png');
    }

    // g4: receita vs meta por plataforma (barras empilhadas: realizado, até onde deveria estar, restante)
    if (quer('g4')) {
      const comMeta = vs.filter(v => v.metaReceita > 0);
      if (comMeta.length) {
        const dt = Charts.newDataTable().addColumn(Charts.ColumnType.STRING, 'plataforma').addColumn(Charts.ColumnType.NUMBER, 'receita')
          .addColumn(Charts.ColumnType.NUMBER, 'deveria estar hoje').addColumn(Charts.ColumnType.NUMBER, 'restante da meta');
        comMeta.forEach(v => { const dev = v.metaReceita * datas.pctMes; const gap = Math.max(0, dev - v.receita); dt.addRow([plataformaCanonica_(v.nome) + ' (' + Math.round(v.receita / v.metaReceita * 100) + '%)', v.receita, gap, Math.max(0, v.metaReceita - v.receita - gap)]); });
        out.g4 = Charts.newBarChart().setDataTable(dt.build()).setDimensions(380, 60 + 70 * comMeta.length).setStacked()
          .setOption('colors', ['#B3261E', '#9A978F', '#EBE7DE']).setOption('legend', { position: 'bottom', textStyle: { color: '#4A4A46', fontSize: 10 } })
          .setOption('hAxis', Object.assign({ format: 'short' }, base.hAxis, { gridlines: { color: '#E2DDD3' } })).setOption('vAxis', { textStyle: { color: '#1A1A18', fontSize: 12 } })
          .setOption('backgroundColor', '#FFFFFF').setOption('chartArea', { left: 110, top: 10, width: '68%', height: '65%' }).setOption('bar', { groupWidth: '60%' }).build().getBlob().setName('g4.png');
      }
    }

    // g5: ROAS média móvel 7 dias, últimos 30 dias, por plataforma + meta
    if (quer('g5')) {
      const comRec = plats.filter(p => serieConta[p].some(pt => pt.receita));
      if (comRec.length) {
        const dt = Charts.newDataTable().addColumn(Charts.ColumnType.NUMBER, 'dia');
        comRec.forEach(p => dt.addColumn(Charts.ColumnType.NUMBER, p));
        if (tot.metaRoas) dt.addColumn(Charts.ColumnType.NUMBER, 'meta ' + tot.metaRoas.toFixed(2));
        const N = 30; let algum = false;
        for (let i = 0; i < N; i++) {
          const fim = new Date(datas.ontem.getTime() - (N - 1 - i) * 86400000);
          const row = [i + 1];
          comRec.forEach(p => {
            let inv = 0, rec = 0;
            serieConta[p].forEach(pt => { const dd = Math.round((fim - pt.data) / 86400000); if (dd >= 0 && dd < 7) { inv += pt.investido || 0; rec += pt.receita || 0; } });
            const r = inv ? rec / inv : null; if (r !== null) algum = true; row.push(r);
          });
          if (tot.metaRoas) row.push(tot.metaRoas);
          dt.addRow(row);
        }
        if (algum) {
          const series = {}; comRec.forEach((p, i) => series[i] = { lineWidth: 3 }); if (tot.metaRoas) series[comRec.length] = { lineWidth: 1, lineDashStyle: [4, 4] };
          out.g5 = Charts.newLineChart().setDataTable(dt.build()).setDimensions(370, 240)
            .setOption('colors', comRec.map(corPlat_).concat(tot.metaRoas ? ['#B3261E'] : [])).setOption('series', series)
            .setOption('legend', { position: 'bottom', textStyle: { color: '#4A4A46', fontSize: 10 } }).setOption('hAxis', Object.assign({ title: 'últimos 30 dias', ticks: [1, 10, 20, 30] }, base.hAxis))
            .setOption('vAxis', { gridlines: { color: '#E2DDD3' }, textStyle: { color: '#4A4A46' }, format: '#.0' }).setOption('backgroundColor', '#FFFFFF')
            .setOption('chartArea', { left: 40, top: 12, width: '84%', height: '62%' }).setOption('interpolateNulls', true).build().getBlob().setName('g5.png');
        }
      }
    }

    // g6: eficiência do funil (CTR e taxa de conversão, mês até ontem, por plataforma)
    if (quer('g6')) {
      const dt = Charts.newDataTable().addColumn(Charts.ColumnType.STRING, 'métrica');
      const rows = { 'CTR': [], 'Taxa de conversão': [] }; let algum = false;
      plats.forEach(p => {
        dt.addColumn(Charts.ColumnType.NUMBER, p);
        let imp = 0, cli = 0, conv = 0;
        serieConta[p].forEach(pt => { if (pt.data.getMonth() + 1 === mesRef && pt.data.getFullYear() === anoRef) { imp += pt.impressoes || 0; cli += pt.cliques || 0; conv += pt.conversoes || 0; } });
        const ctr = imp ? cli / imp : null, tx = cli ? conv / cli : null; if (ctr !== null || tx !== null) algum = true;
        rows['CTR'].push(ctr); rows['Taxa de conversão'].push(tx);
      });
      if (algum) {
        dt.addRow(['CTR'].concat(rows['CTR'])); dt.addRow(['Taxa de conversão'].concat(rows['Taxa de conversão']));
        out.g6 = Charts.newColumnChart().setDataTable(dt.build()).setDimensions(370, 240)
          .setOption('colors', cores).setOption('legend', { position: 'top', textStyle: { color: '#4A4A46', fontSize: 10 } })
          .setOption('vAxis', { format: '#.#%', gridlines: { color: '#E2DDD3' }, textStyle: { color: '#4A4A46' }, minValue: 0 }).setOption('hAxis', { textStyle: { color: '#1A1A18' } })
          .setOption('backgroundColor', '#FFFFFF').setOption('chartArea', { left: 48, top: 30, width: '84%', height: '58%' }).setOption('bar', { groupWidth: '65%' }).build().getBlob().setName('g6.png');
      }
    }
  } catch (e) {
    Logger.log('Gráficos da conta %s: %s', c.nome, e.message);
  }
  return out;
}
