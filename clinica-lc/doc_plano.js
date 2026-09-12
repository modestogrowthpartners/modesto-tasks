const modesto = require("./brand/bytech_docx.js");
const U = require("./gerar_plano.js");
const { Document, Packer, Paragraph, TextRun, AlignmentType, Header } = require("docx");
const fs = require("fs");

const { BEGE, PRETO, DOURADO, CINZA_TEXTO, FONT_TITULO, FONT_CORPO } = modesto;
const { h2, h3, p, bullet, bulletKV, table, spacer, callout, pageBreak } = U;

const C = []; // children

/* ============ CAPA ============ */
C.push(new Paragraph({ spacing: { after: 900 }, children: [] }));
C.push(modesto.coverLogo(230));
C.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 100 },
  children: [new TextRun({ text: "PLANO TÉCNICO E DE INVESTIMENTO", font: FONT_CORPO, size: 17, bold: true, color: DOURADO, characterSpacing: 60 })],
}));
C.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 120 },
  children: [new TextRun({ text: "Clínica LC · Aplicativo do Paciente", font: FONT_TITULO, size: 52, bold: true, color: PRETO })],
}));
C.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 700 },
  children: [new TextRun({ text: "Arquitetura, banco de dados, cronograma de 12 semanas e custos reais", font: FONT_CORPO, size: 21, color: CINZA_TEXTO, italics: true })],
}));
C.push(U.table(
  ["Campo", "Conteúdo"],
  [
    ["Cliente", "Clínica LC · São José dos Pinhais / PR"],
    ["Origem", "Reunião de 11/09/2026 (20 min) · participantes: Financeiro Clínica LC, Vinicius Reis, Kevyn Machado"],
    ["Apresentação", "Terça-feira, 15/09/2026, 14h00"],
    ["Equipe prevista", "2 desenvolvedores assistidos por Claude Max"],
    ["Classificação", "USO INTERNO: contém margem, custo e estratégia de preço"],
  ],
  [26, 74]
));
C.push(pageBreak());

/* ============ 1. SUMÁRIO EXECUTIVO ============ */
C.push(modesto.eyebrow("Seção 1"));
C.push(modesto.sectionTitle("Sumário executivo"));
C.push(p("A Clínica LC quer um aplicativo que transforme o protocolo médico em rotina diária acompanhada. Hoje o médico prescreve por e-mail e agenda pelo Google Calendar, a comunicação acontece em grupos de WhatsApp e o agendamento depende de uma recepcionista que só atende em horário comercial, enquanto o paciente, majoritariamente mulher, 35+, alto poder aquisitivo e agenda cheia, responde fora desse horário."));
C.push(p("O aplicativo resolve três coisas ao mesmo tempo: tira o agendamento do gargalo humano, transforma o protocolo em checklist com lembrete, e dá à clínica um ativo de percepção de valor coerente com um serviço high ticket."));
C.push(spacer(60));
C.push(h3("Veredito sobre o prazo"));
C.push(callout("Dá para fazer em 3 meses, com uma ressalva",
  "12 semanas é suficiente para ter o código pronto e testado do MVP definido neste documento. O que não cabe em 12 semanas é o app JÁ PUBLICADO nas lojas: entre congelar o código e o app estar disponível para download existem de 1 a 3 semanas de abertura de contas, revisão da Apple e da Google, e prováveis rodadas de correção. O prazo honesto de ponta a ponta é 14 semanas. Comprometer-se com 'app na loja em 90 dias' é assumir um risco que não depende de nós."));
C.push(spacer(120));
C.push(p("Sobre a hipótese de 2 meses: não é viável sem cortar uma das três funcionalidades centrais. 8 semanas comportam protocolo diário + diário alimentar, OU protocolo diário + agendamento. Não os três com qualidade de produção.", { bold: true, color: PRETO }));
C.push(spacer(80));
C.push(h3("Os números em uma linha"));
C.push(U.table(
  ["Indicador", "Valor"],
  [
    ["Prazo de código pronto", "12 semanas"],
    ["Prazo até app publicado nas duas lojas", "14 semanas"],
    ["Custo de plataforma para a Bytech no build", "R$ 5.868 (3 meses)"],
    ["Custo que fica com a Clínica LC (contas de loja)", "R$ 694 no primeiro ano"],
    ["Custo mensal a partir do 4º mês", "R$ 703 (infraestrutura + 1 assinatura de IA)"],
    ["Esforço estimado", "≈ 600 horas (2 devs × 25 h/semana × 12 semanas)"],
    ["Faixa de honorário recomendada", "R$ 85.000 a R$ 98.000 (detalhe na seção 11)"],
  ],
  [58, 42]
));
C.push(spacer(140));
C.push(h3("As três coisas que precisam ser resolvidas antes de assinar"));
C.push(bulletKV("Qual é o sistema de agenda atual da clínica.", "É o único item de escopo que pode virar um buraco sem fundo. Se não houver API, ou o app assume a agenda (e a clínica muda o processo interno) ou haverá duas agendas para conciliar. Isso precisa ser respondido antes do preço fechar."));
C.push(bulletKV("Quantos pacientes ativos existem hoje.", "O ranking de adesão precisa de massa. Com menos de 40 pacientes ativos simultâneos, o ranking vira constrangimento em vez de engajamento e deve ser substituído por metas individuais."));
C.push(bulletKV("Em nome de quem ficam as contas Apple e Google.", "Recomendação: no CNPJ da Clínica LC. Além de ser o correto para um app médico, a conta de organização escapa da exigência do Google Play de 12 testadores por 14 dias corridos, que sozinha adiciona duas semanas ao cronograma."));
C.push(pageBreak());

/* ============ 2. ESCOPO ============ */
C.push(modesto.eyebrow("Seção 2"));
C.push(modesto.sectionTitle("Escopo derivado da reunião"));
C.push(p("Tudo abaixo saiu literalmente do que foi dito na reunião de 11/09. A coluna de prioridade é nossa recomendação, não algo já acordado com o cliente."));
C.push(spacer(80));
C.push(h3("Bloco A · MVP, entra nas 12 semanas"));
C.push(U.table(
  ["Funcionalidade", "O que foi dito na reunião", "Complexidade"],
  [
    ["Cadastro e login do paciente", "Ficha com login, senha, dados pessoais, endereço e dados de saúde", "Baixa"],
    ["Protocolo diário com checklist", "Médico monta a programação; hoje vai por Gmail e Calendar e o paciente não consegue marcar o que cumpriu", "Média"],
    ["Lembretes por horário", "'8h toma café da manhã, 9h toma X ml de água'", "Média"],
    ["Diário alimentar", "Estilo FatSecret: anota o que comeu e vê no fim do dia se bateu a meta", "Média"],
    ["Plano alimentar do nutricionista", "O nutricionista faz a dieta e o paciente tem acesso a ela no app", "Baixa"],
    ["Registro de água e atividade", "Juntar num app só o que hoje são vários apps separados", "Baixa"],
    ["Agendamento pelo paciente", "Como check-in de academia, com antecedência mínima e prazo máximo de cancelamento", "Alta"],
    ["Gráfico de evolução", "'Como o paciente chegou e o que mudou no percurso dele aqui dentro'", "Média"],
    ["Notificações push motivacionais", "Substituem a automação de mensagem que nunca funcionou no CRM", "Média"],
    ["Ranking de adesão anônimo", "Inspirado no app de desafio em grupo citado; pacientes são competitivos", "Média"],
    ["Atalho para o WhatsApp da equipe", "Manter o grupo de WhatsApp, que a Carol faz questão de preservar", "Baixa"],
    ["Painel web da equipe", "Os 7 profissionais precisam prescrever protocolo, dieta e liberar resultados", "Alta"],
  ],
  [30, 52, 18]
));
C.push(spacer(140));
C.push(h3("Bloco B · Fase 2, depois do lançamento"));
C.push(bulletKV("Integração com o sistema de agenda atual da clínica.", "Depende de descobrir qual é o sistema e se ele expõe API. No MVP o app tem agenda própria."));
C.push(bulletKV("Histórico completo de exames com laudo.", "A própria cliente apontou que isso vive no prontuário e só o médico acessa. No MVP o app mostra um resumo de resultados que o profissional libera explicitamente, não é prontuário eletrônico."));
C.push(bulletKV("E-mails automáticos de ciclo de vida.", "Foi pedido ('quanto mais lembrarem da gente, melhor'), mas push resolve 80% do objetivo com custo e complexidade menores. Entra depois."));
C.push(bulletKV("WhatsApp Cloud API com disparo automático.", "No MVP o app abre a conversa por link. Automação real exige número verificado, templates aprovados e custo por conversa."));
C.push(bulletKV("Automação de Instagram Direct.", "Discutido na reunião e descartado pela própria cliente: o app é só para pacientes da Clínica LC."));
C.push(spacer(140));
C.push(h3("Bloco C · Fora de escopo, precisa estar escrito na proposta"));
C.push(bullet("Prontuário eletrônico, prescrição com assinatura digital e qualquer coisa que exija certificação SBIS/CFM."));
C.push(bullet("Telemedicina, videochamada ou consulta remota."));
C.push(bullet("Pagamento, cobrança ou emissão de nota dentro do app."));
C.push(bullet("Gestão de tráfego pago e CRM, ficou combinado indicar um parceiro."));
C.push(bullet("Reforma do site institucional (mencionado como possibilidade, não contratado)."));
C.push(pageBreak());

/* ============ 3. ARQUITETURA ============ */
C.push(modesto.eyebrow("Seção 3"));
C.push(modesto.sectionTitle("Arquitetura"));
C.push(p("A escolha central é otimizar para uma equipe de duas pessoas. Toda decisão abaixo troca flexibilidade por velocidade, porque com 600 horas de orçamento não existe margem para manter infraestrutura própria."));
C.push(spacer(80));
C.push(h3("Stack"));
C.push(U.table(
  ["Camada", "Escolha", "Por quê"],
  [
    ["App iOS e Android", "React Native + Expo (TypeScript)", "Uma base de código para as duas lojas. O protótipo já está em React, então o design system é reaproveitado quase direto."],
    ["Build e publicação", "EAS Build / Submit / Update", "Compila o binário iOS na nuvem, sem precisar de Mac. EAS Update permite corrigir bug de JS sem passar por revisão de loja."],
    ["Banco de dados", "PostgreSQL gerenciado (Supabase), região São Paulo", "Relacional, que é o que este domínio pede. Dado de saúde permanece em território nacional, argumento comercial e de LGPD."],
    ["Autenticação", "Supabase Auth (e-mail e senha + magic link)", "Integra nativamente com as políticas de acesso do banco."],
    ["Autorização", "Row Level Security no Postgres", "A regra 'paciente só vê o próprio dado' vive no banco, não no app. Um bug no aplicativo não vaza dado de outro paciente."],
    ["Arquivos (exames, fotos)", "Supabase Storage com URL assinada e expiração", "Arquivo de saúde nunca fica em URL pública."],
    ["Lógica de servidor", "Edge Functions + cron agendado no banco", "Cálculo de adesão, disparo de lembrete e fechamento de ranking."],
    ["Notificações push", "Expo Push sobre APNs e FCM", "Sem custo por mensagem."],
    ["Painel da equipe", "Next.js publicado na Vercel", "Web, não app. Os 7 profissionais trabalham no computador da clínica."],
    ["E-mail transacional", "Provedor com cota gratuita inicial", "Confirmação de agendamento e recuperação de senha."],
    ["Erros e monitoramento", "Sentry (plano gratuito)", "Descobrir a falha antes do paciente reclamar no grupo de WhatsApp."],
    ["Versionamento e CI", "GitHub privado + GitHub Actions", "Lint, typecheck e teste a cada PR. Obrigatório com dois devs em paralelo."],
  ],
  [22, 30, 48]
));
C.push(spacer(140));
C.push(h3("Fluxo em uma frase"));
C.push(p("O app (React Native) e o painel (Next.js) falam com o mesmo Postgres via API gerada automaticamente; quem decide o que cada usuário enxerga é a política de RLS dentro do banco; tarefas agendadas rodam de madrugada para calcular adesão e de hora em hora para disparar os lembretes do protocolo."));
C.push(spacer(100));
C.push(callout("Decisão que vale registrar",
  "Não vamos escrever um backend próprio. Um servidor Node dedicado somaria de 3 a 4 semanas de trabalho ao cronograma e uma conta de infraestrutura permanente, para entregar exatamente o mesmo resultado funcional. Se o projeto crescer a ponto de precisar, o Postgres continua sendo o mesmo e a migração é incremental."));
C.push(pageBreak());

/* ============ 4. MODELO DE DADOS ============ */
C.push(modesto.eyebrow("Seção 4"));
C.push(modesto.sectionTitle("Modelo de dados"));
C.push(p("Vinte e duas tabelas cobrem todo o MVP. O agrupamento abaixo é também a ordem em que elas serão construídas."));
C.push(spacer(80));
C.push(h3("Identidade e acesso"));
C.push(U.table(
  ["Tabela", "Função"],
  [
    ["profiles", "Toda pessoa com login. Guarda papel: paciente, profissional ou administrador."],
    ["patients", "Ficha do paciente: nascimento, endereço, WhatsApp, data de entrada, status do protocolo."],
    ["professionals", "Os 7 profissionais: especialidade, conselho, agenda padrão."],
    ["care_team", "Vínculo paciente ↔ profissional. É esta tabela que autoriza um profissional a ver um paciente."],
    ["consents", "Registro de consentimento LGPD: versão do termo, data, IP. Imutável."],
  ], [24, 76]
));
C.push(spacer(120));
C.push(h3("Protocolo e rotina"));
C.push(U.table(
  ["Tabela", "Função"],
  [
    ["protocols", "O protocolo contratado: início, fim previsto, fase atual, profissional responsável."],
    ["protocol_items", "Cada item prescrito: descrição, horário-alvo, dias da semana, se exige confirmação."],
    ["protocol_checkins", "Cada marcação feita pelo paciente. Uma linha por item por dia."],
    ["water_log", "Registro de hidratação, com meta diária individual."],
    ["activity_log", "Atividade física registrada: tipo, duração, percepção de esforço."],
  ], [24, 76]
));
C.push(spacer(120));
C.push(h3("Nutrição"));
C.push(U.table(
  ["Tabela", "Função"],
  [
    ["diet_plans", "O plano montado pelo nutricionista, com versão e data de vigência."],
    ["diet_plan_meals", "Refeições previstas no plano: horário, descrição, alvo calórico."],
    ["food_log_entries", "O que o paciente de fato comeu: texto, foto opcional, estimativa de calorias."],
  ], [24, 76]
));
C.push(spacer(120));
C.push(h3("Evolução e exames"));
C.push(U.table(
  ["Tabela", "Função"],
  [
    ["measurements", "Peso, circunferências, bioimpedância e scanner corporal. Uma linha por medição por data."],
    ["exams", "Exame realizado: tipo, data, profissional que liberou."],
    ["exam_results", "Resultado em formato de par chave-valor, para conseguir montar gráfico."],
    ["exam_files", "Arquivo anexo, sempre por URL assinada e com expiração."],
  ], [24, 76]
));
C.push(spacer(120));
C.push(h3("Agenda"));
C.push(U.table(
  ["Tabela", "Função"],
  [
    ["availability_rules", "Janela padrão de atendimento de cada profissional."],
    ["availability_exceptions", "Férias, feriado e bloqueio pontual."],
    ["appointments", "A consulta: profissional, paciente, início, fim, status, canal de origem."],
    ["booking_policies", "Antecedência mínima para marcar e prazo limite para cancelar sem custo. Parametrizável pela clínica."],
  ], [24, 76]
));
C.push(spacer(120));
C.push(h3("Engajamento e governança"));
C.push(U.table(
  ["Tabela", "Função"],
  [
    ["devices", "Token de push por aparelho, para o paciente que usa celular e tablet."],
    ["notifications", "Fila e histórico de notificação enviada, com status de entrega."],
    ["adherence_daily", "Percentual de adesão consolidado por paciente por dia. Alimenta gráfico e ranking sem varrer as tabelas brutas."],
    ["audit_log", "Quem acessou qual dado de saúde e quando. Somente inserção, sem update nem delete."],
  ], [24, 76]
));
C.push(spacer(140));
C.push(callout("Duas decisões de modelagem que evitam retrabalho",
  "Primeira: adesão é calculada uma vez por dia e gravada em adherence_daily, em vez de ser recalculada a cada abertura de tela. Sem isso, a tela de evolução fica lenta já no terceiro mês de uso. Segunda: exam_results guarda resultado em pares chave-valor e não como PDF anexado, porque foi pedido gráfico de 'como o paciente chegou e como ele está', e não se faz gráfico a partir de PDF."));
C.push(pageBreak());

/* ============ 5. SEGURANÇA E LGPD ============ */
C.push(modesto.eyebrow("Seção 5"));
C.push(modesto.sectionTitle("Segurança e LGPD"));
C.push(p("Este é o ponto em que um app de clínica difere de qualquer outro app. Dado de saúde é dado pessoal sensível pela LGPD (Art. 5º, II), e tratá-lo mal tem consequência regulatória, não só reputacional."));
C.push(spacer(80));
C.push(h3("Papéis"));
C.push(bulletKV("Clínica LC é a controladora.", "Ela decide a finalidade do tratamento e precisa nomear um encarregado (DPO), ainda que seja alguém da própria equipe."));
C.push(bulletKV("A Bytech é a operadora.", "Trata dado em nome da clínica. Isso exige um contrato de operador anexo ao contrato principal, não é opcional e protege os dois lados."));
C.push(spacer(120));
C.push(h3("Base legal"));
C.push(p("Para o dado clínico, a base é a tutela da saúde em procedimento realizado por profissionais de saúde (Art. 11, II, 'f'), que dispensa consentimento. Para tudo que não é assistencial (ranking, notificação motivacional, e-mail) a base é consentimento específico e destacado, que o paciente pode revogar sem perder acesso ao app."));
C.push(spacer(80));
C.push(callout("Atenção ao ranking",
  "Ranking de adesão ao tratamento entre pacientes é, na prática, divulgação de informação de saúde para terceiros. Só é defensável com três travas simultâneas: participação por opt-in explícito, exibição sempre anônima para os demais, e possibilidade de sair a qualquer momento. O protótipo já foi construído assim e isso precisa continuar até a versão final."));
C.push(spacer(140));
C.push(h3("Controles técnicos"));
C.push(bullet("RLS ativo em todas as tabelas, sem exceção, com teste automatizado que tenta ler dado de outro paciente e falha o build se conseguir."));
C.push(bullet("Criptografia em trânsito (TLS) e em repouso, padrão da plataforma."));
C.push(bullet("Arquivo de exame só por URL assinada com expiração curta. Nunca bucket público."));
C.push(bullet("audit_log imutável registrando cada acesso a dado de saúde por profissional."));
C.push(bullet("Exclusão de conta dentro do app, exigência formal da Apple (Guideline 5.1.1) e direito do titular pela LGPD."));
C.push(bullet("Exportação dos próprios dados em formato legível, pelo mesmo motivo."));
C.push(bullet("Política de retenção definida por escrito: quanto tempo o dado fica após o fim do protocolo."));
C.push(bullet("Dados hospedados em região brasileira."));
C.push(spacer(120));
C.push(callout("Fronteira que não deve ser cruzada",
  "O app mostra resumo de resultado que o profissional liberou explicitamente. Ele não é prontuário eletrônico e não substitui o sistema da clínica. No momento em que virar repositório oficial de prontuário, entra em terreno de certificação SBIS/CFM, que multiplica prazo e custo. A própria cliente já sinalizou essa fronteira na reunião, e ela precisa estar escrita no contrato."));
C.push(spacer(120));
C.push(p("Recomendação: a redação final da política de privacidade e do termo de consentimento deve passar por um advogado com prática em saúde. O custo disso não está previsto neste documento e deve ficar com a clínica.", { italics: true }));
C.push(pageBreak());

/* ============ 6. PUBLICAÇÃO NAS LOJAS ============ */
C.push(modesto.eyebrow("Seção 6"));
C.push(modesto.sectionTitle("Publicação nas lojas"));
C.push(p("Esta é a parte do cronograma que não depende de quanto código escrevemos. É onde projetos bem executados atrasam."));
C.push(spacer(80));
C.push(h3("Apple App Store"));
C.push(U.table(
  ["Item", "Situação"],
  [
    ["Custo", "US$ 99 por ano, renovação anual"],
    ["Tipo de conta", "Organização, no CNPJ da Clínica LC"],
    ["Pré-requisito", "Número D-U-N-S da clínica. Gratuito, mas a emissão leva de dias a algumas semanas"],
    ["Prazo de revisão", "Normalmente 24 a 48 horas por submissão"],
    ["Risco específico", "App de saúde com login obrigatório recebe revisão mais rígida. Exige conta de demonstração funcional, política de privacidade publicada e ficha de privacidade preenchida com precisão"],
    ["Exigência formal", "Exclusão de conta dentro do app (Guideline 5.1.1)"],
  ], [24, 76]
));
C.push(spacer(140));
C.push(h3("Google Play"));
C.push(U.table(
  ["Item", "Situação"],
  [
    ["Custo", "US$ 25, pagamento único, sem renovação"],
    ["Tipo de conta", "Organização, no CNPJ da Clínica LC"],
    ["Pré-requisito", "Verificação de identidade e autenticação em duas etapas"],
    ["Prazo de revisão", "De alguns dias até duas semanas na primeira submissão"],
    ["Armadilha de cronograma", "Conta PESSOAL criada após novembro de 2023 exige teste fechado com 12 testadores por 14 dias corridos antes de liberar produção. Conta de organização não passa por essa regra"],
    ["Exigência formal", "Seção de Segurança de Dados declarando coleta de dado de saúde"],
  ], [24, 76]
));
C.push(spacer(140));
C.push(callout("Ação de semana zero",
  "Abrir as duas contas e solicitar o D-U-N-S no primeiro dia útil após a assinatura, antes de escrever a primeira linha de código. É a tarefa de menor esforço e maior risco de cronograma do projeto inteiro, e depende da clínica, não de nós."));
C.push(pageBreak());

/* ============ 7. CRONOGRAMA ============ */
C.push(modesto.eyebrow("Seção 7"));
C.push(modesto.sectionTitle("Cronograma de 12 semanas"));
C.push(p("Duas trilhas paralelas. Dev A cuida do cliente (app e painel), Dev B cuida do servidor (banco, regras, funções). O contrato entre as duas trilhas (tipos TypeScript e schema do banco) é fechado na semana 1 e vira a única fonte de verdade."));
C.push(spacer(80));
C.push(U.table(
  ["Semana", "Dev A · Cliente", "Dev B · Servidor", "Entrega verificável"],
  [
    ["0", "Nome do app e identidade visual", "Contas Apple e Google, D-U-N-S", "Contas abertas e escopo assinado"],
    ["1–2", "Design system, navegação, login e cadastro", "Schema inicial, RLS, Auth, ambientes", "App instalável no celular com login real"],
    ["3–4", "Tela Início, checklist, água, sequência", "Motor de protocolo e de adesão, painel v0", "Médico prescreve e paciente marca"],
    ["5–6", "Diário alimentar e plano do nutricionista", "Plano alimentar, upload de foto, metas", "Paciente registra o dia e vê a aderência"],
    ["7–8", "Telas de agenda, agendar e cancelar", "Disponibilidade, regras, conflito, aviso", "BETA FECHADO com a equipe da clínica"],
    ["9", "Gráficos de peso, medidas e linha do tempo", "Medições, liberação de exame, auditoria", "Evolução funcionando com dado real"],
    ["10", "Ranking, conquistas, tela de notificações", "Push, agendador de lembrete, e-mail, WhatsApp", "Lembrete chegando no horário certo"],
    ["11", "Painel completo dos 7 profissionais", "LGPD, exclusão de conta, teste de RLS, carga", "Equipe opera sem a nossa ajuda"],
    ["12", "Assets de loja, onboarding, treinamento", "Build de produção, submissão", "Submetido nas duas lojas"],
    ["13–14", "Correção de apontamento das lojas", "Correção de apontamento das lojas", "APP PUBLICADO"],
  ],
  [10, 28, 28, 34]
));
C.push(spacer(140));
C.push(h3("Marcos de pagamento sugeridos"));
C.push(bulletKV("30% na assinatura.", "Cobre o custo de plataforma dos três meses e o risco inicial."));
C.push(bulletKV("30% na semana 8, na entrega do beta fechado.", "É o momento em que a clínica toca o app funcionando pela primeira vez. Amarrar pagamento a esse marco protege as duas partes."));
C.push(bulletKV("40% na publicação nas lojas.", "Não em 'código pronto', e sim em app disponível para download."));
C.push(spacer(120));
C.push(callout("O que derruba este cronograma",
  "Em ordem de probabilidade: atraso na emissão do D-U-N-S; a clínica não fechar a identidade visual e o nome até a semana 2; descobrir na semana 7 que a integração com a agenda atual era obrigatória; e pedidos de escopo novo durante o build. Os quatro se neutralizam com escopo assinado e uma reunião quinzenal de acompanhamento de 30 minutos."));
C.push(pageBreak());

/* ============ 8. OPERAÇÃO COM 2 CLAUDE MAX ============ */
C.push(modesto.eyebrow("Seção 8"));
C.push(modesto.sectionTitle("Como operar com duas contas Claude Max"));
C.push(p("Duas pessoas com assistente de IA não equivalem a quatro desenvolvedores. Equivalem a duas pessoas que escrevem código muito mais rápido e revisam muito mais devagar. Toda a organização abaixo existe para proteger a etapa de revisão, que é onde o gargalo de verdade se instala."));
C.push(spacer(80));
C.push(h3("Regras de trabalho"));
C.push(bulletKV("Trilhas separadas por pasta.", "Dev A não edita arquivo de servidor e Dev B não edita tela. Quando precisa, abre PR. Sem essa regra, duas sessões de IA se sobrescrevem em silêncio."));
C.push(bulletKV("CLAUDE.md no repositório desde o primeiro commit.", "Padrão de nomenclatura, estrutura de pastas, como escrever migração, política de RLS e o que nunca fazer. É o que mantém os dois assistentes gerando código parecido."));
C.push(bulletKV("O contrato de tipos vem antes da implementação.", "Schema do banco e tipos TypeScript fechados na semana 1, num pacote compartilhado. Sem isso as duas trilhas divergem por volta da semana 4."));
C.push(bulletKV("PR pequeno, revisão cruzada obrigatória.", "Ninguém aprova o próprio PR. Código gerado por IA falha em padrões específicos: tratamento de erro, caso de borda e, principalmente, política de acesso."));
C.push(bulletKV("CI travando o merge.", "Lint, typecheck, teste e verificação de RLS. Se o teste que tenta ler dado de outro paciente passar, o build quebra."));
C.push(spacer(120));
C.push(h3("Qual plano assinar"));
C.push(U.table(
  ["Configuração", "Custo mensal", "Avaliação"],
  [
    ["2 × Max 5x", "US$ 200 · R$ 1.120", "CONFIGURAÇÃO ADOTADA. É o orçamento deste plano"],
    ["1 × Max 20x + 1 × Max 5x", "US$ 300 · R$ 1.680", "Rota de escape. Subir só a conta de quem faz migração, RLS e refatoração pesada"],
    ["2 × Max 20x", "US$ 400 · R$ 2.240", "Só se o cronograma apertar de verdade"],
  ], [34, 24, 42]
));
C.push(spacer(120));
C.push(p("O plano trabalha com duas contas Max 5x. O ponto de atenção é conhecido: o teto de uso do 5x costuma ser atingido em sessões longas de refatoração de backend, normalmente nas semanas 3 e 7, quando o schema muda. Se isso acontecer, subir UMA das contas para 20x custa R$ 560 a mais por mês e resolve, sem mexer no cronograma.", { italics: true }));
C.push(spacer(100));
C.push(p("Regra prática: se qualquer um dos dois perder mais de meio dia de trabalho por limite de uso, sobe a conta no mês seguinte. Meio dia parado custa mais que os R$ 560.", { italics: true }));
C.push(pageBreak());

/* ============ 9. CUSTOS ============ */
C.push(modesto.eyebrow("Seção 9"));
C.push(modesto.sectionTitle("Custos"));
C.push(p("Todos os valores em dólar foram convertidos a R$ 5,60. A cotação à vista em 12/09/2026 era de aproximadamente R$ 5,17; a diferença cobre o spread do cartão internacional e o IOF. Preços de plataforma consultados em setembro de 2026 e sujeitos a reajuste dos fornecedores."));
C.push(spacer(100));
C.push(h3("A · Setup, pagamento único, fica com a Clínica LC"));
C.push(U.table(
  ["Item", "Valor em USD", "Valor em BRL", "Recorrência"],
  [
    ["Google Play Console", "US$ 25", "R$ 140", "Único, sem renovação"],
    ["Apple Developer Program", "US$ 99", "R$ 554", "Anual"],
    ["Número D-U-N-S", "—", "R$ 0", "Único"],
    ["Total", "US$ 124", "R$ 694", "Primeiro ano"],
  ], [40, 20, 20, 20], { numeric: false }
));
C.push(spacer(140));
C.push(h3("B · Build, 3 meses, custo da Bytech"));
C.push(U.table(
  ["Item", "Mês 1", "Mês 2", "Mês 3", "Total"],
  [
    ["Claude Max (2 × 5x)", "R$ 1.120", "R$ 1.120", "R$ 1.120", "R$ 3.360"],
    ["Banco de dados gerenciado", "R$ 0", "R$ 140", "R$ 140", "R$ 280"],
    ["Serviço de build iOS e Android", "R$ 0", "R$ 1.114", "R$ 1.114", "R$ 2.228"],
    ["Repositório e CI", "R$ 0", "R$ 0", "R$ 0", "R$ 0"],
    ["Monitoramento de erro", "R$ 0", "R$ 0", "R$ 0", "R$ 0"],
    ["Total", "R$ 1.120", "R$ 2.374", "R$ 2.374", "R$ 5.868"],
  ], [32, 17, 17, 17, 17], { numeric: true }
));
C.push(spacer(100));
C.push(p("No mês 1 o banco e o serviço de build rodam em plano gratuito, que é suficiente enquanto não há build de produção nem dado real. A partir do mês 2 os dois sobem de plano.", { italics: true }));
C.push(spacer(140));
C.push(h3("C · Operação, mensal, a partir do 4º mês"));
C.push(p("A partir daqui não existe mais custo de build. O que sobra é a conta de manter o app no ar mais uma assinatura de IA para a sustentação.", { italics: true }));
C.push(U.table(
  ["Item", "Mensal em BRL", "Observação"],
  [
    ["Claude Max 5x, 1 conta", "R$ 560", "Sustentação exige menos que o build. A segunda conta pode ser cancelada ou rebaixada no fim do 3º mês"],
    ["Banco de dados gerenciado", "R$ 140", "Cobre com folga a base inicial. O item que cresce primeiro é armazenamento de exame"],
    ["Domínio", "R$ 3", "Rateio anual"],
    ["Serviço de build", "R$ 0", "Plano gratuito basta fora de mês de release. Em mês de release grande, US$ 199 pontual"],
    ["Notificações push", "R$ 0", "Sem custo por mensagem"],
    ["E-mail transacional", "R$ 0", "Dentro da cota gratuita no volume inicial"],
    ["Monitoramento de erro", "R$ 0", "Plano gratuito"],
    ["Total", "R$ 703", "Custo mensal recorrente da Bytech"],
  ], [30, 16, 54]
));
C.push(spacer(100));
C.push(p("A renovação anual da conta Apple, de R$ 554, não entra aqui porque fica com a Clínica LC, conforme a seção A. Manter as duas assinaturas de IA na sustentação em vez de uma leva este total de R$ 703 para R$ 1.263 por mês.", { italics: true }));
C.push(spacer(140));
C.push(h3("D · Custo total do primeiro ano para a Bytech"));
C.push(U.table(
  ["Item", "Valor"],
  [
    ["Domínio, pago no início", "R$ 40"],
    ["Build, 3 meses (seção B)", "R$ 5.868"],
    ["Operação, 9 meses × R$ 703 (seção C)", "R$ 6.327"],
    ["Total", "R$ 12.235"],
  ], [62, 38]
));
C.push(spacer(140));
C.push(callout("O que ainda não está precificado",
  "Advogado para política de privacidade e termo de consentimento; design de identidade visual, caso a clínica não tenha manual de marca aplicável; e eventual integração com o sistema de agenda atual, que só pode ser orçada depois de saber qual é o sistema. Esses três itens devem aparecer na proposta como exceções explícitas, nunca como omissão."));
C.push(pageBreak());

/* ============ 10. RISCOS ============ */
C.push(modesto.eyebrow("Seção 10"));
C.push(modesto.sectionTitle("Riscos"));
C.push(U.table(
  ["Risco", "Impacto", "Como neutralizar"],
  [
    ["Sistema de agenda atual exigir integração", "Alto. Pode somar 3 a 5 semanas", "Descobrir qual é o sistema ANTES de fechar preço. Deixar a integração fora do MVP por escrito"],
    ["D-U-N-S e contas de loja atrasarem", "Alto. Trava a publicação, não o código", "Tarefa de semana zero, sob responsabilidade formal da clínica"],
    ["Rejeição na revisão da App Store", "Médio. 1 a 2 semanas por rodada", "Conta de demonstração pronta, política publicada e ficha de privacidade precisa desde a primeira submissão"],
    ["Escopo crescer durante o build", "Alto. É o que mais mata projeto de 3 meses", "Escopo assinado com os três blocos da seção 2. Pedido novo vira aditivo, nunca cortesia"],
    ["Base de pacientes pequena demais para o ranking", "Médio. Funcionalidade nasce morta", "Perguntar o número de pacientes ativos. Abaixo de 40, trocar ranking por meta individual"],
    ["Equipe da clínica não adotar o painel", "Alto. Sem prescrição no painel, o app fica vazio", "Treinamento na semana 12 e um profissional definido como ponto focal desde a semana 1"],
    ["Paciente abandonar depois de duas semanas", "Alto para a percepção de valor", "Push com conteúdo do próprio protocolo, não genérico. Medir retenção de 30 dias desde o primeiro dia"],
    ["Indisponibilidade das duas trilhas em paralelo", "Médio", "Contrato de tipos na semana 1 e CI travando merge"],
  ], [30, 22, 48]
));
C.push(spacer(160));
C.push(callout("O risco comercial que não é técnico",
  "Na reunião a cliente disse que somos os primeiros com quem ela conversa. Isso significa que provavelmente haverá outras cotações e que nós estamos ancorando o preço do mercado para ela. Ancorar baixo demais entrega o benchmark para o concorrente e ainda destrói a nossa margem. Ancorar com a lógica de custo aberta, como está na seção 11, sustenta o número mesmo diante de uma proposta mais barata."));
C.push(pageBreak());

/* ============ 11. PRECIFICAÇÃO ============ */
C.push(modesto.eyebrow("Seção 11 · Uso interno"));
C.push(modesto.sectionTitle("Recomendação de honorário"));
C.push(p("Esta seção não vai para o cliente. A proposta apresentada em 15/09 traz apenas os custos de plataforma, com o campo de honorário em aberto."));
C.push(spacer(80));
C.push(h3("Base de cálculo"));
C.push(U.table(
  ["Variável", "Valor", "Origem"],
  [
    ["Duração", "12 semanas", "Cronograma da seção 7"],
    ["Pessoas", "2", "Definido pelo sócio"],
    ["Dedicação realista", "25 h por semana por pessoa", "Premissa de dedicação parcial. Ajustar se for integral"],
    ["Esforço total", "600 horas", "12 × 2 × 25"],
    ["Custo direto de plataforma", "R$ 5.868", "Seção 9B"],
  ], [30, 22, 48]
));
C.push(spacer(140));
C.push(h3("Três faixas"));
C.push(U.table(
  ["Faixa", "Valor", "Hora bruta", "Quando usar"],
  [
    ["Piso", "R$ 58.000", "R$ 97", "Só se o objetivo for o case de portfólio a qualquer custo. Abaixo disso o projeto dá prejuízo com qualquer imprevisto"],
    ["Recomendada", "R$ 89.000", "R$ 148", "Coerente com o esforço, com o porte do cliente e com uma dupla sênior. É onde ancorar"],
    ["Teto defensável", "R$ 120.000", "R$ 200", "Sustentável se a clínica exigir integração com a agenda atual dentro do escopo, ou prazo menor que 12 semanas"],
  ], [16, 16, 14, 54]
));
C.push(spacer(140));
C.push(h3("O que sobra na faixa recomendada"));
C.push(U.table(
  ["Linha", "Valor"],
  [
    ["Honorário", "R$ 89.000"],
    ["(–) Custo de plataforma no build", "R$ 5.868"],
    ["Margem bruta do projeto", "R$ 83.132"],
    ["Por pessoa, em 3 meses", "R$ 41.566"],
    ["Por pessoa, por mês (antes de imposto)", "R$ 13.855"],
  ], [62, 38]
));
C.push(spacer(100));
C.push(p("Considerando Simples Nacional na faixa inicial, o líquido por pessoa fica na casa de R$ 12.300 a R$ 13.000 por mês para 25 horas semanais. É um patamar justo para o perfil de trabalho, sem ser agressivo.", { italics: true }));
C.push(spacer(140));
C.push(h3("A parte mais importante: a sustentação"));
C.push(p("O contrato de projeto é receita que acontece uma vez. O contrato de sustentação é o que faz este cliente valer a pena no horizonte de dois anos."));
C.push(U.table(
  ["Linha", "Valor"],
  [
    ["Mensalidade sugerida", "R$ 2.900 por mês"],
    ["Custo de infraestrutura e IA (seção 9C)", "R$ 703 por mês"],
    ["Margem mensal", "R$ 2.197"],
    ["Margem em 12 meses", "R$ 26.364"],
  ], [62, 38]
));
C.push(spacer(100));
C.push(p("A mensalidade cobre: hospedagem e banco, monitoramento, correção de defeito, atualização obrigatória de SDK das lojas (que acontece todo ano e não é negociável), suporte à equipe da clínica e uma evolução pequena por mês. Contrato mínimo de 12 meses, reajuste anual por índice. Deixar claro que sem sustentação o app para de funcionar em algum momento, não por má-fé, mas porque Apple e Google forçam atualização de SDK periodicamente.", { italics: true }));
C.push(spacer(140));
C.push(h3("Como apresentar em 15/09"));
C.push(bulletKV("Não abrir com o número.", "Abrir com o protótipo navegável. A cliente precisa tocar no app antes de ouvir o valor."));
C.push(bulletKV("Mostrar o custo de plataforma primeiro.", "R$ 694 uma vez para ela, R$ 5.868 que a Bytech gasta nos três meses de construção e R$ 703 por mês depois que o app entra no ar. Isso estabelece que somos transparentes e faz o honorário parecer o que de fato é: trabalho, não intermediação."));
C.push(bulletKV("Apresentar projeto e sustentação juntos.", "R$ 89.000 mais R$ 2.900 por mês. Separar os dois gera a conversa de 'depois a gente vê a manutenção', que nunca acontece."));
C.push(bulletKV("Oferecer a fase de discovery como porta de entrada.", "Se houver hesitação, propor 2 semanas de escopo fechado, arquitetura e design por R$ 12.000, abatidos do total se o projeto seguir. Reduz o risco percebido e filtra cliente que não vai fechar."));
C.push(bulletKV("Não dar desconto na primeira reunião.", "Se pedirem, tirar escopo em vez de baixar preço. Ranking e painel avançado são os candidatos naturais."));
C.push(spacer(160));
C.push(callout("Ponto a decidir antes de terça",
  "Quem fica dono do código e em nome de quem ficam as contas das lojas. Recomendação: as contas ficam no CNPJ da clínica, porque é o correto para um app médico, e o código permanece da Bytech, com licença de uso perpétua e irrevogável para a Clínica LC enquanto o contrato de sustentação estiver ativo. Se a clínica exigir a cessão total do código, isso é outro produto e o preço sobe para a faixa de teto."));

/* ============ MONTAGEM ============ */
const doc = new Document({
  background: { color: BEGE },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } },
    headers: { default: new Header({ children: [modesto.watermarkParagraph()] }) },
    footers: { default: modesto.footerWithLogo() },
    children: C,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("/home/user/modesto-tasks/clinica-lc/Clinica-LC-Plano-Tecnico-e-Custos.docx", buf);
  console.log("DOCX gerado:", buf.length, "bytes");
});
