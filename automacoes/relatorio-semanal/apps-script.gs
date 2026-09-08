/**
 * RELATÓRIO SEMANAL — PARTE 2 DE 2: Meta, MGP Tasks, montagem e post no Slack
 *
 * Onde roda: Google Apps Script (script.google.com), projeto standalone.
 * Agende `main` para SEXTA, 16:00 (Acionadores > Adicionar acionador >
 * Baseado no tempo > Semanal > Sexta > 16h). Confira o fuso do projeto em
 * Configurações do projeto: precisa ser America/Sao_Paulo.
 *
 * A parte 1 (google-ads-script.js) roda às 15:30 dentro do Google Ads e deixa
 * os dados do Google em arquivos no Drive. Este script lê aqueles arquivos,
 * junta com Meta e MGP Tasks, monta o post e publica.
 *
 * ANTES DE RODAR, cadastre os segredos em
 * Configurações do projeto > Propriedades do script:
 *
 *   META_TOKEN     token de System User do Business Manager, com ads_read.
 *                  Use System User (não expira) em vez de token de usuário.
 *   SUPABASE_URL   https://eeqaabwsheaiwyhujcqj.supabase.co
 *   SUPABASE_KEY   service_role key do projeto Supabase
 *   SLACK_TOKEN    bot token (xoxb-...) com chat:write, e o bot no canal
 *
 * Nada de segredo no código: este repositório é público.
 */

// ————————————————————————————————————————————————————————————
// CONFIGURAÇÃO
// ————————————————————————————————————————————————————————————

var CANAL_SLACK = 'C0C0H9AGT8U';           // #resumo_otmizações_e_tarefas
var API_META = 'v24.0';

/** Arquivos deixados pela parte 1. Um por MCC. */
var ARQUIVOS_GOOGLE = [
  'relatorio-semanal-google-mgp.json',
  'relatorio-semanal-google-wondr.json'
];

/** A ordem daqui é a ordem do post. Não reordene sem combinar com o time. */
var CLIENTES = [
  {
    rotulo: 'Wondr',
    meta: [
      { id: 'act_2084569325186193', nome: 'WONDR EXPERIENCE', moeda: 'EUR' },
      { id: 'act_331761388917652',  nome: 'PINK BEACH',       moeda: 'EUR' }
    ],
    tasksCliente: 'Wondr/Barbie/PB',
    tasksInclui: ['wondr', 'pink beach'],   // separa Wondr de Barbie pelo título
    semTikTok: true
  },
  {
    rotulo: 'Barbie',
    meta: [{ id: 'act_1450012306123467', nome: 'Barbie Experience', moeda: 'EUR' }],
    tasksCliente: 'Wondr/Barbie/PB',
    tasksInclui: ['barbie'],
    semTikTok: true
  },
  {
    rotulo: 'Amakha',
    meta: [{ id: 'act_541549713104937', nome: 'Amakha Paris #1', moeda: 'BRL' }],
    tasksCliente: 'Amakha Paris',
    semTikTok: true
  },
  {
    rotulo: 'Alliance',
    meta: [{ id: 'act_313434459904767', nome: 'LATAM', moeda: 'USD' }],
    tasksCliente: 'Alliance Laundry'
  },
  {
    rotulo: 'Meu Rodapé',
    meta: [{ id: 'act_2964386040481714', nome: 'Meu Rodapé V2', moeda: 'BRL' }],
    tasksCliente: 'Meu Rodapé'
  },
  { rotulo: 'D&G',    meta: [], tasksCliente: 'Dolce & Gabbana' },
  { rotulo: 'Dabela', meta: [], tasksCliente: 'Dabela',
    nota: 'Sem conta de mídia conectada' },
  {
    rotulo: 'Ruminar',
    meta: [
      { id: 'act_367338121425127',  nome: 'Ruminar - Lead Ad',  moeda: 'BRL' },
      { id: 'act_1649947782846182', nome: 'Ruminar - Whatsapp', moeda: 'BRL' }
    ],
    tasksCliente: 'Ruminar'
  },
  { rotulo: 'Botoclinic', meta: [], tasksCliente: null,
    nota: 'Sem conta de mídia conectada e sem cadastro no MGP Tasks' }
];

/** Categorias do activity log que são otimização de verdade. */
var CATEGORIAS_META = ['BUDGET', 'STATUS', 'TARGETING'];

var SIMBOLO = { BRL: 'R$', USD: 'US$', EUR: '€' };

// ————————————————————————————————————————————————————————————

function main() {
  var janela = janelaDaSemana();
  var google = lerGoogleDoDrive();
  var post = montarPost(janela, google);

  if (post.length > 4000) {
    Logger.log('AVISO: post com ' + post.length + ' caracteres, perto do teto do Slack.');
  }
  postarNoSlack(post);
  Logger.log('Publicado. ' + post.length + ' caracteres.');
}

/** Use para conferir o texto sem publicar. */
function previa() {
  Logger.log(montarPost(janelaDaSemana(), lerGoogleDoDrive()));
}

// ————————————————————————————————————————————————————————————
// JANELA
// ————————————————————————————————————————————————————————————

function janelaDaSemana() {
  var agora = new Date();
  var recuo = (agora.getDay() + 6) % 7;

  var segunda = new Date(agora.getTime());
  segunda.setDate(segunda.getDate() - recuo);
  segunda.setHours(0, 0, 0, 0);

  var sexta = new Date(segunda.getTime());
  sexta.setDate(sexta.getDate() + 4);
  sexta.setHours(16, 0, 0, 0);

  return {
    inicio: segunda,
    fim: sexta,
    // Unix timestamp resolve o fuso de vez: não depende de como cada API
    // interpreta uma string de data.
    inicioUnix: Math.floor(segunda.getTime() / 1000),
    fimUnix: Math.floor(sexta.getTime() / 1000),
    inicioISO: segunda.toISOString(),
    rotulo: dm(segunda) + ' a ' + dm(sexta)
  };
}

function dm(d) {
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM');
}

// ————————————————————————————————————————————————————————————
// GOOGLE ADS (lido do Drive)
// ————————————————————————————————————————————————————————————

function lerGoogleDoDrive() {
  var porCliente = {};

  ARQUIVOS_GOOGLE.forEach(function (nome) {
    var arquivos = DriveApp.getFilesByName(nome);
    if (!arquivos.hasNext()) {
      Logger.log('AVISO: ' + nome + ' não encontrado no Drive.');
      return;
    }
    var dados = JSON.parse(arquivos.next().getBlob().getDataAsString());
    (dados.contas || []).forEach(function (c) {
      if (!porCliente[c.rotulo]) porCliente[c.rotulo] = [];
      porCliente[c.rotulo].push(c);
    });
  });

  return porCliente;
}

function linhasGoogle(contas) {
  if (!contas || !contas.length) return [];
  var linhas = [];

  contas.forEach(function (conta) {
    if (conta.erro) {
      linhas.push('• Google (' + conta.conta_id + '): falha na coleta — ' + conta.erro);
      return;
    }

    var orcamentos = conta.eventos.filter(function (e) { return e.orcamento; });
    var troas      = conta.eventos.filter(function (e) { return e.troas; });
    var ativadas   = conta.eventos.filter(function (e) {
      return e.status && e.status.para === 'ENABLED' && e.tipo === 'CAMPAIGN';
    });
    var pausadas   = conta.eventos.filter(function (e) {
      return e.status && e.status.para === 'PAUSED' && e.tipo === 'CAMPAIGN';
    });
    var criadas    = conta.eventos.filter(function (e) {
      return e.operacao === 'CREATE' && e.tipo === 'CAMPAIGN';
    });

    if (orcamentos.length) {
      var de = soma(orcamentos, 'de'), para = soma(orcamentos, 'para');
      var txt = '• Google: ' + orcamentos.length + ' ' +
        (orcamentos.length === 1 ? 'orçamento ajustado' : 'orçamentos ajustados');
      if (de > 0 && para > 0) {
        txt += ', de ' + dinheiro(de, conta.moeda) + ' para ' +
               dinheiro(para, conta.moeda) + '/dia no total (' + variacao(de, para) + ')';
      }
      linhas.push(txt + ' — ' + quem(orcamentos));
    }

    if (troas.length) {
      linhas.push('• Google: tROAS ajustado em ' + troas.length +
        (troas.length === 1 ? ' campanha' : ' campanhas') +
        ' (' + amostraTroas(troas) + ') — ' + quem(troas));
    }

    if (criadas.length) {
      linhas.push('• Google: ' + criadas.length +
        (criadas.length === 1 ? ' campanha criada' : ' campanhas criadas') +
        ' — ' + nomes(criadas) + ' — ' + quem(criadas));
    }

    if (ativadas.length || pausadas.length) {
      var partes = [];
      if (ativadas.length) partes.push(ativadas.length + ' ativada(s): ' + nomes(ativadas));
      if (pausadas.length) partes.push(pausadas.length + ' pausada(s): ' + nomes(pausadas));
      linhas.push('• Google: ' + partes.join(' · ') + ' — ' +
                  quem(ativadas.concat(pausadas)));
    }

    if (conta.criativos > 0) {
      linhas.push('• Google: ' + conta.criativos +
        ' alterações de criativo e assets — ' + Object.keys(conta.criativos_por_pessoa).join(', '));
    }
  });

  return linhas;
}

function soma(eventos, campo) {
  return eventos.reduce(function (acc, e) { return acc + (e.orcamento[campo] || 0); }, 0);
}

function amostraTroas(eventos) {
  return eventos.slice(0, 3).map(function (e) {
    return curto(e.campanha) + ' ' + e.troas.de + '→' + e.troas.para;
  }).join('; ');
}

function nomes(eventos) {
  var vistos = [];
  eventos.forEach(function (e) {
    var n = curto(e.campanha);
    if (n && vistos.indexOf(n) === -1) vistos.push(n);
  });
  return vistos.slice(0, 4).join(', ') + (vistos.length > 4 ? ' e outras' : '');
}

function curto(nome) {
  if (!nome) return '';
  return nome.length > 42 ? nome.substring(0, 40) + '…' : nome;
}

function quem(eventos) {
  var pessoas = [];
  eventos.forEach(function (e) {
    if (e.quem && pessoas.indexOf(e.quem) === -1) pessoas.push(e.quem);
  });
  return pessoas.join(' e ');
}

// ————————————————————————————————————————————————————————————
// META ADS
// ————————————————————————————————————————————————————————————

function linhasMeta(contas, janela) {
  if (!contas || !contas.length) return [];
  var linhas = [];

  contas.forEach(function (conta) {
    var eventos;
    try {
      eventos = buscarAtividadesMeta(conta.id, janela);
    } catch (e) {
      linhas.push('• Meta (' + conta.nome + '): falha na coleta — ' + e);
      return;
    }

    var orcamentos = eventos.filter(function (ev) {
      return ev.event_type === 'update_ad_set_budget' ||
             ev.event_type === 'update_campaign_budget';
    });
    var status = eventos.filter(function (ev) {
      return ev.event_type.indexOf('run_status') !== -1;
    });
    var criadas = eventos.filter(function (ev) {
      return ev.event_type === 'create_campaign_group' ||
             ev.event_type === 'create_ad_set';
    });
    var alvo = eventos.filter(function (ev) {
      return ev.event_type === 'update_ad_set_target_spec';
    });

    if (orcamentos.length) {
      var pares = orcamentos.map(valoresDoOrcamento).filter(function (p) { return p; });
      var de = pares.reduce(function (a, p) { return a + p.de; }, 0);
      var para = pares.reduce(function (a, p) { return a + p.para; }, 0);
      var txt = '• Meta: ' + orcamentos.length + ' ajustes de orçamento';
      if (de > 0 && para > 0) {
        txt += ', de ' + dinheiro(de, conta.moeda) + ' para ' +
               dinheiro(para, conta.moeda) + '/dia somados (' + variacao(de, para) + ')';
      }
      linhas.push(txt + ' — ' + quemMeta(orcamentos));
    }

    if (criadas.length) {
      linhas.push('• Meta: ' + criadas.length + ' campanhas e conjuntos criados — ' +
                  nomesMeta(criadas) + ' — ' + quemMeta(criadas));
    }
    if (status.length) {
      linhas.push('• Meta: ' + status.length +
                  ' mudanças de status em campanhas, conjuntos e anúncios — ' +
                  quemMeta(status));
    }
    if (alvo.length) {
      linhas.push('• Meta: segmentação alterada em ' + alvo.length +
                  ' conjuntos — ' + nomesMeta(alvo) + ' — ' + quemMeta(alvo));
    }
  });

  return linhas;
}

function buscarAtividadesMeta(contaId, janela) {
  var token = segredo('META_TOKEN');
  var tudo = [];

  // Uma categoria por chamada. Sem category a resposta vem afogada em evento
  // automático e URL de CDN, e fica grande demais para ser útil.
  CATEGORIAS_META.forEach(function (categoria) {
    var url = 'https://graph.facebook.com/' + API_META + '/' + contaId + '/activities' +
      '?fields=event_time,event_type,actor_name,object_name,extra_data' +
      '&category=' + categoria +
      '&since=' + janela.inicioUnix +
      '&until=' + janela.fimUnix +
      '&limit=25&access_token=' + encodeURIComponent(token);

    var pagina = 0;
    while (url && pagina < 6) {
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var corpo = JSON.parse(resp.getContentText());

      if (corpo.error) {
        // Códigos 1 e 2 são instabilidade conhecida do endpoint em janelas
        // largas. Uma tentativa a mais resolve na maioria das vezes.
        if (corpo.error.code === 1 || corpo.error.code === 2) {
          Utilities.sleep(2000);
          resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
          corpo = JSON.parse(resp.getContentText());
          if (corpo.error) throw new Error(corpo.error.message);
        } else {
          throw new Error(corpo.error.message);
        }
      }

      (corpo.data || []).forEach(function (ev) {
        // "Meta" como ator é evento automático da plataforma, não otimização.
        if (ev.actor_name !== 'Meta') tudo.push(ev);
      });

      url = (corpo.paging && corpo.paging.next) ? corpo.paging.next : null;
      pagina++;
    }
  });

  return tudo;
}

/** extra_data traz valor em unidade MENOR da moeda: 2760 é R$ 27,60. */
function valoresDoOrcamento(ev) {
  try {
    var d = JSON.parse(ev.extra_data || '{}');
    var de = d.old_value && d.old_value.old_value;
    var para = d.new_value && d.new_value.new_value;
    if (!de && !para) return null;
    return { de: Number(de || 0) / 100, para: Number(para || 0) / 100 };
  } catch (e) {
    return null;
  }
}

function quemMeta(eventos) {
  var pessoas = [];
  eventos.forEach(function (ev) {
    var primeiro = String(ev.actor_name || '').split(' ')[0];
    if (primeiro && pessoas.indexOf(primeiro) === -1) pessoas.push(primeiro);
  });
  return pessoas.join(' e ');
}

function nomesMeta(eventos) {
  var vistos = [];
  eventos.forEach(function (ev) {
    var n = curto(ev.object_name);
    if (n && vistos.indexOf(n) === -1) vistos.push(n);
  });
  return vistos.slice(0, 3).join(', ') + (vistos.length > 3 ? ' e outros' : '');
}

// ————————————————————————————————————————————————————————————
// MGP TASKS (Supabase)
// ————————————————————————————————————————————————————————————

function buscarTarefas(janela) {
  var url = segredo('SUPABASE_URL') + '/rest/v1/tasks' +
    '?select=title,status,created_at,completed_at,clients(nome)' +
    '&archived=eq.false' +
    '&or=(created_at.gte.' + janela.inicioISO + ',completed_at.gte.' + janela.inicioISO + ')' +
    '&limit=400';

  // Nunca filtre por updated_at: uma alteração em massa em 08/09/2026 tocou
  // 425 das 443 linhas, o que apaga a diferença entre mexido e não mexido.

  var resp = UrlFetchApp.fetch(url, {
    headers: {
      apikey: segredo('SUPABASE_KEY'),
      Authorization: 'Bearer ' + segredo('SUPABASE_KEY')
    },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error('Supabase ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }
  return JSON.parse(resp.getContentText());
}

function linhasTarefas(cliente, tarefas, janela) {
  if (!cliente.tasksCliente) return ['• sem cadastro no MGP Tasks'];

  var fim = janela.fim.toISOString();
  var minhas = tarefas.filter(function (t) {
    var nome = t.clients && t.clients.nome;
    if (nome !== cliente.tasksCliente) return false;
    // Wondr e Barbie dividem o mesmo cliente no banco; o título desempata.
    if (cliente.tasksInclui) {
      var titulo = String(t.title || '').toLowerCase();
      return cliente.tasksInclui.some(function (p) { return titulo.indexOf(p) !== -1; });
    }
    return true;
  });

  if (!minhas.length) return ['• —'];

  var feitas = minhas.filter(function (t) {
    return t.completed_at && t.completed_at >= janela.inicioISO && t.completed_at <= fim;
  });
  var abertas = minhas.filter(function (t) { return feitas.indexOf(t) === -1; });

  var linhas = [];
  if (feitas.length) {
    linhas.push('• Feito: ' + feitas.slice(0, 6).map(function (t) { return t.title; }).join(' · ') +
      (feitas.length > 6 ? ' e mais ' + (feitas.length - 6) : ''));
  }
  if (abertas.length) {
    linhas.push('• Aberto: ' + abertas.slice(0, 5).map(function (t) {
      return t.title + ' (' + t.status + ')';
    }).join(' · ') + (abertas.length > 5 ? ' e mais ' + (abertas.length - 5) : ''));
  }
  return { linhas: linhas, feitas: feitas.length, abertas: abertas.length };
}

// ————————————————————————————————————————————————————————————
// MONTAGEM
// ————————————————————————————————————————————————————————————

function montarPost(janela, google) {
  var tarefas;
  var erroTarefas = null;
  try {
    tarefas = buscarTarefas(janela);
  } catch (e) {
    tarefas = [];
    erroTarefas = String(e);
  }

  var p = ['*RESUMO DA SEMANA — ' + janela.rotulo + '*', '', '*BLOCO 1 — Otimizações da semana*', ''];

  CLIENTES.forEach(function (cliente) {
    p.push('*' + cliente.rotulo + ':*');
    var linhas = linhasGoogle(google[cliente.rotulo]).concat(linhasMeta(cliente.meta, janela));
    if (!linhas.length) linhas = [cliente.nota ? '• ' + cliente.nota : '• —'];
    linhas.forEach(function (l) { p.push(l); });
    p.push('');
  });

  p.push('*BLOCO 2 — Tarefas da semana*', '');

  if (erroTarefas) {
    p.push('_Falha ao ler o MGP Tasks: ' + erroTarefas + '_', '');
  } else {
    CLIENTES.forEach(function (cliente) {
      var r = linhasTarefas(cliente, tarefas, janela);
      if (Array.isArray(r)) {
        p.push('*' + cliente.rotulo + ':*');
        r.forEach(function (l) { p.push(l); });
      } else {
        p.push('*' + cliente.rotulo + ':* ' + r.feitas + ' concluídas, ' + r.abertas + ' abertas');
        r.linhas.forEach(function (l) { p.push(l); });
      }
      p.push('');
    });
  }

  p.push('_Fontes: Google Ads change history, Meta Ads activity log e MGP Tasks. ' +
         'TikTok não expõe histórico de alterações via API._');

  return p.join('\n');
}

// ————————————————————————————————————————————————————————————
// SAÍDA E UTILIDADES
// ————————————————————————————————————————————————————————————

function postarNoSlack(texto) {
  var resp = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + segredo('SLACK_TOKEN') },
    payload: JSON.stringify({ channel: CANAL_SLACK, text: texto, unfurl_links: false }),
    muteHttpExceptions: true
  });

  var corpo = JSON.parse(resp.getContentText());
  if (!corpo.ok) throw new Error('Slack recusou: ' + corpo.error);
}

function dinheiro(valor, moeda) {
  var s = SIMBOLO[moeda] || moeda;
  return s + ' ' + Utilities.formatString('%.2f', valor).replace('.', ',');
}

function variacao(de, para) {
  var pct = ((para - de) / de) * 100;
  return (pct >= 0 ? '+' : '') + Utilities.formatString('%.0f', pct) + '%';
}

function segredo(chave) {
  var v = PropertiesService.getScriptProperties().getProperty(chave);
  if (!v) throw new Error('Falta a propriedade de script ' + chave);
  return v;
}
