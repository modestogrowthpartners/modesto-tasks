/**
 * PACING DIÁRIO — PARTE 1 DE 2: gasto do Google Ads
 *
 * Onde roda: Google Ads Scripts, dentro de uma conta MCC.
 *   Ferramentas > Ações em massa > Scripts.
 *
 * Agende para TODOS OS DIAS, 07:00. A parte 2 (pacing-diario.gs) roda às
 * 07:30, lê o que este deixou no Drive, junta com o Meta e publica.
 *
 * São dois MCCs independentes. Rode este mesmo script nos dois, cada um com
 * sua lista em CONTAS e seu próprio ARQUIVO_SAIDA:
 *   - Modesto Growth Partners (4871560986): Amakha, Alliance, Meu Rodapé, D&G
 *   - Wondr Experience MCC (5492481349): Wondr, Barbie
 *
 * Coleta o gasto de cada dia do mês corrente, por conta. Um dia só é
 * confiável depois de fechado, e quem decide isso é a parte 2.
 */

var CONTAS = [
  // --- Modesto Growth Partners ---
  { id: '4074568221', rotulo: 'Amakha',     fuso: 'America/Sao_Paulo' },
  { id: '5026131996', rotulo: 'Alliance',   fuso: 'America/Chicago' },
  { id: '3084869797', rotulo: 'Meu Rodapé', fuso: 'America/Sao_Paulo' },
  { id: '6813205150', rotulo: 'D&G',        fuso: 'America/Sao_Paulo' },

  // --- Wondr Experience MCC: use esta lista na outra execução ---
  // { id: '4154437131', rotulo: 'Wondr',  fuso: 'Europe/Amsterdam' },
  // { id: '3805729384', rotulo: 'Barbie', fuso: 'Europe/Amsterdam' },
];

var ARQUIVO_SAIDA = 'pacing-google-mgp.json';
// var ARQUIVO_SAIDA = 'pacing-google-wondr.json';

function main() {
  var hoje = new Date();
  var fuso = AdsApp.currentAccount().getTimeZone();
  var ano = Number(Utilities.formatDate(hoje, fuso, 'yyyy'));
  var mes = Number(Utilities.formatDate(hoje, fuso, 'MM'));
  var primeiro = ano + '-' + dois(mes) + '-01';
  var ultimo = ano + '-' + dois(mes) + '-' + dois(diasNoMes(ano, mes));

  var saida = {
    gerado_em: new Date().toISOString(),
    mes: ano + '-' + dois(mes),
    dias_no_mes: diasNoMes(ano, mes),
    contas: []
  };

  for (var i = 0; i < CONTAS.length; i++) {
    var conta = CONTAS[i];
    try {
      saida.contas.push(coletar(conta, primeiro, ultimo));
    } catch (e) {
      // Uma conta que falha não pode derrubar as outras: ela vira uma linha
      // de erro, que a parte 2 mostra no lugar de fingir que o gasto foi zero.
      Logger.log('ERRO em ' + conta.rotulo + ': ' + e);
      saida.contas.push({ conta_id: conta.id, rotulo: conta.rotulo,
                          erro: String(e), dias: {} });
    }
  }

  gravar(ARQUIVO_SAIDA, JSON.stringify(saida, null, 2));
  Logger.log('Gravado em ' + ARQUIVO_SAIDA + ' · ' + saida.contas.length + ' conta(s).');
}

function coletar(conta, de, ate) {
  var alvo = AdsManagerApp.accounts().withIds([conta.id]).get();
  if (!alvo.hasNext()) throw new Error('conta não encontrada neste MCC');
  AdsManagerApp.select(alvo.next());

  // FROM customer traz o total da conta por dia, sem precisar somar campanha
  // a campanha (e sem perder o que foi gasto em campanha já removida).
  var q = "SELECT segments.date, metrics.cost_micros FROM customer " +
          "WHERE segments.date BETWEEN '" + de + "' AND '" + ate + "'";

  var dias = {};
  var it = AdsApp.search(q);
  while (it.hasNext()) {
    var r = it.next();
    dias[r.segments.date] = Number(r.metrics.costMicros) / 1e6;
  }

  return {
    conta_id: conta.id,
    rotulo: conta.rotulo,
    moeda: AdsApp.currentAccount().getCurrencyCode(),
    fuso: conta.fuso,
    dias: dias
  };
}

function diasNoMes(ano, mes) { return new Date(ano, mes, 0).getDate() }
function dois(n) { return (n < 10 ? '0' : '') + n }

function gravar(nome, conteudo) {
  var f = DriveApp.getFilesByName(nome);
  if (f.hasNext()) f.next().setContent(conteudo);
  else DriveApp.createFile(nome, conteudo, MimeType.PLAIN_TEXT);
}
