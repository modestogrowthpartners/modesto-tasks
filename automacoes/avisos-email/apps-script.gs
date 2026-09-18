/**
 * MGP · avisos por e-mail
 * ---------------------------------------------------------------------
 * Lê a fila `email_fila` do Supabase e envia cada linha pelo Gmail da
 * conta que rodar o script. Pode ficar no mesmo projeto do relatório
 * semanal: usa as mesmas propriedades.
 *
 * Propriedades do script (Configurações do projeto → Propriedades):
 *   SUPABASE_URL   https://eeqaabwsheaiwyhujcqj.supabase.co
 *   SUPABASE_KEY   service_role key do projeto Supabase
 *
 * A fila não tem policy nenhuma: só a chave de serviço enxerga. É por
 * isso que ela mora aqui, numa propriedade do script, e nunca no HTML.
 *
 * Rode instalarAcionadorDeAvisos() uma vez: cria o acionador de 5 em 5
 * minutos. Cota do Gmail no Workspace: por volta de 1.500 e-mails/dia;
 * confirme na sua conta antes de contar com esse número.
 */

function enviarAvisos() {
  var props = PropertiesService.getScriptProperties();
  var base  = props.getProperty('SUPABASE_URL');
  var chave = props.getProperty('SUPABASE_KEY');
  if (!base || !chave) throw new Error('Defina SUPABASE_URL e SUPABASE_KEY nas propriedades do script.');

  var cab = { apikey: chave, Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' };
  var url = base + '/rest/v1/email_fila?enviado_em=is.null&tentativas=lt.5&order=criado_em.asc&limit=40';
  var resp = UrlFetchApp.fetch(url, { headers: cab, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Fila: HTTP ' + resp.getResponseCode() + ' ' + resp.getContentText().slice(0, 200));
  var fila = JSON.parse(resp.getContentText());
  if (!fila.length) { Logger.log('Nada na fila.'); return; }

  var enviados = 0, expirados = 0;
  var limite = Date.now() - 6 * 60 * 60 * 1000;   /* 6 horas */
  fila.forEach(function (item) {
    var patch;
    /* Aviso velho não é aviso: se ficou mais de 6 horas na fila (o script
       estava parado, ou acabou de ser instalado com backlog), marca como
       expirado em vez de despejar uma enxurrada atrasada. */
    if (new Date(item.criado_em).getTime() < limite) {
      patch = { enviado_em: new Date().toISOString(), erro: 'expirou na fila (mais de 6 h sem envio)' };
      expirados++;
      UrlFetchApp.fetch(base + '/rest/v1/email_fila?id=eq.' + item.id, {
        method: 'patch', headers: cab, payload: JSON.stringify(patch), muteHttpExceptions: true
      });
      return;
    }
    try {
      MailApp.sendEmail({
        to: item.para,
        subject: item.assunto,
        body: item.corpo,
        name: 'Plataforma MGP'
      });
      patch = { enviado_em: new Date().toISOString(), erro: null };
      enviados++;
    } catch (e) {
      patch = { tentativas: (item.tentativas || 0) + 1, erro: String(e && e.message || e).slice(0, 500) };
    }
    UrlFetchApp.fetch(base + '/rest/v1/email_fila?id=eq.' + item.id, {
      method: 'patch', headers: cab, payload: JSON.stringify(patch), muteHttpExceptions: true
    });
  });
  Logger.log('Enviados: ' + enviados + ' de ' + fila.length + (expirados ? ' · expirados: ' + expirados : '') + '.');
}

function instalarAcionadorDeAvisos() {
  removerAcionadoresDeAvisos();
  ScriptApp.newTrigger('enviarAvisos').timeBased().everyMinutes(5).create();
  Logger.log('Acionador criado: enviarAvisos() a cada 5 minutos.');
}

function removerAcionadoresDeAvisos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarAvisos') ScriptApp.deleteTrigger(t);
  });
}
