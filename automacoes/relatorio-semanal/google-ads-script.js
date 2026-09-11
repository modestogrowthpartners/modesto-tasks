/**
 * RELATÓRIO SEMANAL — PARTE 1 DE 2: Google Ads
 *
 * Onde roda: Google Ads Scripts, dentro de uma conta MCC.
 *   Ferramentas > Scripts em massa (Bulk actions > Scripts).
 *
 * Por que aqui e não no Apps Script: rodando dentro do Google Ads não existe
 * developer token, OAuth client nem refresh token para gerenciar. O script já
 * tem acesso às contas do MCC.
 *
 * IMPORTANTE — são dois MCCs independentes. Rode este mesmo script nos dois,
 * cada um com sua lista de contas em CONTAS:
 *   - Modesto Growth Partners (4871560986): Amakha, Alliance/LATAM, Meu Rodapé, D&G
 *   - Wondr Experience MCC (5492481349): Wondr, Barbie
 * Cada execução grava seu próprio arquivo no Drive (veja ARQUIVO_SAIDA).
 *
 * Agende para SEXTA, 15:30. A parte 2 (apps-script.gs) roda às 16:00 e lê o
 * que este aqui deixou no Drive.
 */

// ————————————————————————————————————————————————————————————
// CONFIGURAÇÃO
// ————————————————————————————————————————————————————————————

/** Contas deste MCC. Rótulo é o nome do cliente como sai no post. */
var CONTAS = [
  // --- Modesto Growth Partners (4871560986) ---
  { id: '4074568221', rotulo: 'Amakha',      moeda: 'BRL', fuso: 'America/Sao_Paulo' },
  { id: '5026131996', rotulo: 'Alliance',    moeda: 'USD', fuso: 'America/Chicago' },
  { id: '3084869797', rotulo: 'Meu Rodapé',  moeda: 'BRL', fuso: 'America/Sao_Paulo' },
  { id: '8056022205', rotulo: 'Meu Rodapé',  moeda: 'BRL', fuso: 'America/Los_Angeles' },
  { id: '6813205150', rotulo: 'D&G',         moeda: 'BRL', fuso: 'America/Sao_Paulo' },

  // --- Wondr Experience MCC (5492481349) — use esta lista na outra execução ---
  // { id: '4154437131', rotulo: 'Wondr',  moeda: 'EUR', fuso: 'Europe/Amsterdam' },
  // { id: '3805729384', rotulo: 'Barbie', moeda: 'EUR', fuso: 'Europe/Amsterdam' },
];

/** Nome do arquivo no Drive. Troque na execução do outro MCC. */
var ARQUIVO_SAIDA = 'relatorio-semanal-google-mgp.json';
// var ARQUIVO_SAIDA = 'relatorio-semanal-google-wondr.json';

/** Tipos que contam como otimização. Criativo entra separado, agregado.
 *
 *  Não existe CAMPAIGN_BIDDING_STRATEGY neste enum: a consulta inteira volta
 *  BAD_ENUM_CONSTANT, e nenhuma conta é coletada. Mudança de estratégia de
 *  lance já chega como CAMPAIGN, com targetRoas, targetSpend ou
 *  targetImpressionShare dentro de changed_fields. */
var TIPOS_MATERIAIS = [
  'CAMPAIGN', 'CAMPAIGN_BUDGET', 'AD_GROUP',
  'CAMPAIGN_CRITERION', 'AD_GROUP_CRITERION'
];
var TIPOS_CRIATIVO = ['AD', 'AD_GROUP_AD', 'ASSET'];

// ————————————————————————————————————————————————————————————

function main() {
  var janela = janelaDaSemana();
  Logger.log('Janela (Brasília): ' + janela.inicioBR + ' até ' + janela.fimBR);

  var saida = {
    gerado_em: new Date().toISOString(),
    janela_brasilia: { inicio: janela.inicioBR, fim: janela.fimBR },
    contas: []
  };

  for (var i = 0; i < CONTAS.length; i++) {
    var conta = CONTAS[i];
    try {
      saida.contas.push(coletarConta(conta, janela));
    } catch (e) {
      // Falha de uma conta não pode derrubar o relatório inteiro. Ela vira
      // uma linha de erro no post, que é diferente de "não teve mexida".
      Logger.log('ERRO em ' + conta.rotulo + ' (' + conta.id + '): ' + e);
      saida.contas.push({
        conta_id: conta.id, rotulo: conta.rotulo, moeda: conta.moeda,
        erro: String(e), eventos: [], criativos: 0
      });
    }
  }

  gravarNoDrive(ARQUIVO_SAIDA, JSON.stringify(saida, null, 2));
  Logger.log('Gravado em ' + ARQUIVO_SAIDA);
}

/**
 * Segunda 00:00 até sexta 16:00, horário de Brasília.
 * Roda na sexta, então "esta semana" é a segunda que já passou.
 */
function janelaDaSemana() {
  var agoraBR = new Date(Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy/MM/dd HH:mm:ss"));
  var diaDaSemana = agoraBR.getDay();          // 0 domingo … 5 sexta
  var recuo = (diaDaSemana + 6) % 7;           // dias desde a segunda

  var segunda = new Date(agoraBR.getTime());
  segunda.setDate(segunda.getDate() - recuo);
  segunda.setHours(0, 0, 0, 0);

  var sexta = new Date(segunda.getTime());
  sexta.setDate(sexta.getDate() + 4);
  sexta.setHours(16, 0, 0, 0);

  return {
    inicioMs: segunda.getTime(),
    fimMs: sexta.getTime(),
    inicioBR: fmt(segunda),
    fimBR: fmt(sexta)
  };
}

function fmt(d) {
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss');
}

/**
 * change_date_time vem no fuso DA CONTA, não em Brasília. Sem esta conversão,
 * uma conta em Amsterdam perde cinco horas de trabalho da sexta, e perde calado.
 */
function janelaNoFusoDaConta(janela, fuso) {
  return {
    inicio: Utilities.formatDate(new Date(janela.inicioMs), fuso, 'yyyy-MM-dd HH:mm:ss'),
    fim:    Utilities.formatDate(new Date(janela.fimMs),    fuso, 'yyyy-MM-dd HH:mm:ss')
  };
}

function coletarConta(conta, janela) {
  var alvo = AdsManagerApp.accounts().withIds([conta.id]).get();
  if (!alvo.hasNext()) throw new Error('conta não encontrada neste MCC');
  AdsManagerApp.select(alvo.next());

  var j = janelaNoFusoDaConta(janela, conta.fuso);

  var eventos = buscarEventos(
    j, TIPOS_MATERIAIS,
    'change_event.change_date_time, change_event.change_resource_type, ' +
    'change_event.resource_change_operation, change_event.changed_fields, ' +
    'change_event.old_resource, change_event.new_resource, ' +
    'change_event.user_email, campaign.name',
    200
  );

  // Criativo só entra como contagem. Uma troca de anúncio gera dezenas de
  // eventos e afogaria o resto do post.
  var criativos = buscarEventos(
    j, TIPOS_CRIATIVO,
    'change_event.change_date_time, change_event.user_email', 200
  );

  return {
    conta_id: conta.id,
    rotulo: conta.rotulo,
    moeda: conta.moeda,
    fuso: conta.fuso,
    janela_local: j,
    eventos: eventos.map(function (r) { return normalizar(r, conta.moeda); }),
    criativos: criativos.length,
    criativos_por_pessoa: contarPorPessoa(criativos)
  };
}

function buscarEventos(j, tipos, campos, limite) {
  var query =
    'SELECT ' + campos + ' FROM change_event ' +
    "WHERE change_event.change_date_time >= '" + j.inicio + "' " +
    "AND change_event.change_date_time <= '" + j.fim + "' " +
    'AND change_event.change_resource_type IN (' + aspas(tipos) + ') ' +
    'ORDER BY change_event.change_date_time DESC ' +
    'LIMIT ' + limite;   // change_event exige LIMIT e teto de 10 mil

  var linhas = [];
  var it = AdsApp.search(query);
  while (it.hasNext()) linhas.push(it.next());
  return linhas;
}

function aspas(arr) {
  return arr.map(function (t) { return "'" + t + "'"; }).join(',');
}

/** Achata o evento e já resolve orçamento, tROAS e status em algo legível. */
function normalizar(row, moeda) {
  var ev = row.changeEvent || {};
  var velho = ev.oldResource || {};
  var novo = ev.newResource || {};

  var out = {
    quando: ev.changeDateTime,
    tipo: ev.changeResourceType,
    operacao: ev.resourceChangeOperation,
    campos: ev.changedFields,
    quem: pessoa(ev.userEmail),
    campanha: row.campaign ? row.campaign.name : null
  };

  // Orçamento: micros para unidade da moeda.
  var vb = caminho(velho, 'campaignBudget.amountMicros');
  var nb = caminho(novo, 'campaignBudget.amountMicros');
  if (vb || nb) {
    out.orcamento = {
      de: vb ? Number(vb) / 1e6 : null,
      para: nb ? Number(nb) / 1e6 : null,
      moeda: moeda
    };
  }

  // tROAS aparece em dois lugares conforme a estratégia da campanha.
  var vr = caminho(velho, 'campaign.targetRoas.targetRoas') ||
           caminho(velho, 'campaign.maximizeConversionValue.targetRoas');
  var nr = caminho(novo, 'campaign.targetRoas.targetRoas') ||
           caminho(novo, 'campaign.maximizeConversionValue.targetRoas');
  if (vr || nr) out.troas = { de: vr || null, para: nr || null };

  var vs = caminho(velho, 'campaign.status') || caminho(velho, 'adGroup.status');
  var ns = caminho(novo, 'campaign.status') || caminho(novo, 'adGroup.status');
  if (vs || ns) out.status = { de: vs || null, para: ns || null };

  return out;
}

function caminho(obj, cam) {
  var partes = cam.split('.');
  var atual = obj;
  for (var i = 0; i < partes.length; i++) {
    if (atual === null || atual === undefined) return null;
    atual = atual[partes[i]];
  }
  return (atual === undefined) ? null : atual;
}

function contarPorPessoa(linhas) {
  var mapa = {};
  for (var i = 0; i < linhas.length; i++) {
    var quem = pessoa(linhas[i].changeEvent.userEmail);
    mapa[quem] = (mapa[quem] || 0) + 1;
  }
  return mapa;
}

/** everton.medeiros@modestogrowth.com.br vira Everton. */
function pessoa(email) {
  if (!email) return 'automático';
  var nome = String(email).split('@')[0].split('.')[0];
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function gravarNoDrive(nome, conteudo) {
  var existentes = DriveApp.getFilesByName(nome);
  if (existentes.hasNext()) {
    existentes.next().setContent(conteudo);
  } else {
    DriveApp.createFile(nome, conteudo, MimeType.PLAIN_TEXT);
  }
}
