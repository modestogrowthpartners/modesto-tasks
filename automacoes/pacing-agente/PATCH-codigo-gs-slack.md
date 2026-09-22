# Patch no Código.gs (Alerta de pacing.gs) para o Slack visual · 22/09/2026

Em `enviar_`, no bloco `// ---- Slack`, trocar a linha

    postarNoCanalPacing_(blocosCanal, alertas);

por

    if (typeof enviarSlackVisual_ === 'function') enviarSlackVisual_(SpreadsheetApp.getActiveSpreadsheet(), crit, aten, painel, datas, urlPlanilha, alertas);
    else postarNoCanalPacing_(blocosCanal, alertas);

O resto do bloco (DM ao Everton) fica igual. Sem SLACK_BOT_TOKEN, enviarSlackVisual_
cai sozinho no texto antigo pelo webhook.

Propriedades do script:
  SLACK_BOT_TOKEN     obrigatório para os gráficos (escopos chat:write e files:write; bot no canal)
  SLACK_CANAL_ID      opcional, padrão C0BG2NK56UC (#controle_pacing_diário)
  SLACK_CANAL_TESTE   ID de um canal de teste, usado só por testarSlackVisual
