/* MGP NPS: Pré-Discovery, Client Discovery e Revisão de Parceria.
   Jornada inteira, nos dois lados: a equipe envia, o cliente responde, a
   equipe lê o painel. O dublê persiste `mgp_pesquisas` no localStorage, então
   o que o cliente responde na fase 2 é o que a equipe lê na fase 3. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import http from 'http';
const SP = process.env.SP || new URL('.', import.meta.url).pathname;
const stub = fs.readFileSync(SP + '/stub.js', 'utf8');
const ARQ = process.argv[2] || new URL('../index.html', import.meta.url).pathname;
const html = fs.readFileSync(ARQ);
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); s.end(html) });
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const BASE = 'http://127.0.0.1:' + srv.address().port + '/';

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({viewport:{width:1280,height:900}});
const erros = [];
const res = [];
const ok = (n,c,d='') => res.push({t:n, r:c?'PASSOU':'FALHOU', d:String(d).slice(0,200)});

const page = await ctx.newPage();
page.on('pageerror', e=>erros.push('PAGEERROR: '+e.message));
page.on('console', m=>{ if(m.type()==='error') erros.push('CONSOLE: '+m.text()) });
await page.route('**/*', async r=>{
  const u = r.request().url();
  if(u.includes('supabase-js')) return r.fulfill({contentType:'application/javascript', body:stub});
  if(u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200, contentType:'text/plain', body:''});
});

async function entrar(como){
  await page.goto(BASE, {waitUntil:'domcontentloaded'});
  await page.evaluate(c=>{
    if(c === 'cliente') localStorage.setItem('__COMO','cliente');
    else localStorage.removeItem('__COMO');
  }, como);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(3200);
  await page.evaluate(()=>{ document.querySelectorAll('button').forEach(b=>{
    const t=b.textContent.trim(); if(t==='Pular'||t==='✕') b.click() }) });
  await page.waitForTimeout(700);
}

/* =====================================================================
   FASE 1 — a equipe
   ===================================================================== */
await page.goto(BASE, {waitUntil:'domcontentloaded'});
await page.evaluate(()=>{ localStorage.clear() });
await entrar('admin');

const naNav = await page.evaluate(()=>{
  const n = NAV.find(x=>x.v==='nps');
  return {existe:!!n, label:n&&n.label, admin:n&&!!n.admin,
          noMenu: mgNavItens().some(x=>x.v==='nps'),
          naVitrine: mgAtalhos().some(a=>a.v==='nps')};
});
ok('1  a aba MGP NPS entra no menu e na vitrine do Início',
   naNav.existe && naNav.label==='MGP NPS' && naNav.admin && naNav.noMenu && naNav.naVitrine,
   JSON.stringify(naNav));

await page.evaluate(()=>showView('nps'));
await page.waitForTimeout(600);
const abriu = await page.evaluate(()=>({view:VIEW, naTela:!!document.querySelector('#v-nps.on'),
  titulo:(document.querySelector('#v-nps h1')||{}).textContent}));
ok('2  a aba abre e se identifica', abriu.view==='nps' && abriu.naTela && abriu.titulo==='MGP NPS',
   JSON.stringify(abriu));

const geral = await page.evaluate(()=>({
  cartoes:[...document.querySelectorAll('#v-nps .mgn-n span:first-child')].map(e=>e.textContent),
  empresas: document.querySelectorAll('#v-nps .mgn-tab tbody tr').length,
  semRevisao: (document.querySelector('#v-nps .mgn-farol')||{}).textContent,
}));
ok('3  visão geral da carteira, sem inventar número',
   geral.cartoes.join('|')==='NPS da carteira|MGPI médio|Em recuperação|Empresas'
   && geral.empresas===1 && geral.semRevisao==='sem revisão', JSON.stringify(geral));

/* envia os três questionários para a Cliente Um */
await page.evaluate(()=>mgNpsCliente('c-1'));
await page.waitForTimeout(400);
await page.evaluate(async ()=>{
  await mgNpsEnviarPesquisa('pre_discovery');
  await mgNpsEnviarPesquisa('client_discovery');
});
await page.waitForTimeout(500);
const enviados = await page.evaluate(()=>__FIX.mgp_pesquisas.map(p=>({t:p.tipo,s:p.status,r:p.rodada})));
ok('4  a equipe envia Pré-Discovery e Client Discovery',
   enviados.length===2 && enviados.every(p=>p.s==='enviado' && p.r===1)
   && enviados[0].t==='pre_discovery' && enviados[1].t==='client_discovery',
   JSON.stringify(enviados));

/* =====================================================================
   FASE 2 — o cliente responde, no formulário estilo Google Forms
   ===================================================================== */
await entrar('cliente');

const bloco = await page.evaluate(()=>({
  titulos:[...document.querySelectorAll('#v-portal .mgp-bloco h2')].map(h=>h.textContent.trim()),
  itens: document.querySelectorAll('#v-portal .mgp-bloco .mgp-doc').length,
}));
ok('5  o cliente vê as pesquisas logo abaixo do cabeçalho',
   bloco.titulos[0]==='Pesquisas' && bloco.titulos.includes('Demandas em aberto'),
   JSON.stringify(bloco.titulos));

/* abre o Pré-Discovery: cabeçalho com faixa, um cartão por pergunta,
   asterisco no obrigatório, Enviar já na primeira (e única) página */
const abriuForm = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='pre_discovery');
  mgNpsResponder(p.id);
  const pe = document.querySelector('#v-portal .gf-pe');
  return {titulo:(document.querySelector('#v-portal .gf-cabeca h1')||{}).textContent,
          aviso:(document.querySelector('#v-portal .gf-cabeca .obrig')||{}).textContent,
          cartoes: document.querySelectorAll('#v-portal .gf-q').length,
          asteriscos: document.querySelectorAll('#v-portal .gf-q .ast').length,
          botoes:[...pe.querySelectorAll('button')].map(b=>b.textContent.trim()),
          pagina:(pe.querySelector('.gf-prog span')||{}).textContent};
});
ok('6  o Pré-Discovery abre como um Forms: cabeçalho, cartões, asterisco e Enviar no pé',
   abriuForm.titulo==='Pré-Discovery' && /Indica uma pergunta obrigat/.test(abriuForm.aviso)
   && abriuForm.cartoes===13 && abriuForm.asteriscos===12
   && abriuForm.botoes.includes('Enviar') && !abriuForm.botoes.includes('Próxima')
   && abriuForm.pagina==='Página 1 de 1', JSON.stringify(abriuForm));

/* tenta enviar pela metade: o cartão em branco é marcado e nada é gravado */
const barrou = await page.evaluate(async ()=>{
  mgNpsSet('pd_dor', 'CAC subindo e margem caindo no retargeting');
  await mgNpsEnviarResposta();
  await new Promise(r=>setTimeout(r,80));
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='pre_discovery');
  const erros = [...document.querySelectorAll('#v-portal .gf-q.erro')];
  return {status:p.status, marcados:erros.length,
          primeiro: erros[0] ? erros[0].id : '',
          msg:(document.querySelector('#v-portal .gf-q.erro .msg-erro')||{}).textContent,
          dorLimpa: !document.getElementById('gfq-pd_dor').classList.contains('erro')};
});
ok('7  enviar com pergunta obrigatória em branco marca o cartão e não grava',
   barrou.status==='enviado' && barrou.marcados===11 && barrou.primeiro==='gfq-pd_objetivo'
   && /Esta é uma pergunta obrigatória/.test(barrou.msg) && barrou.dorLimpa, JSON.stringify(barrou));

/* preenche o resto e envia */
await page.evaluate(async ()=>{
  mgNpsEspelho('pre_discovery').abas[0].perguntas.forEach(q=>{
    if(q.id==='pd_dor') return;
    mgNpsSet(q.id, q.id==='pd_objetivo' ? 'Dobrar a receita nova em 12 meses' : 'resposta de teste');
  });
  await mgNpsEnviarResposta();
});
await page.waitForTimeout(500);
const pdSalvo = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='pre_discovery');
  return {status:p.status, dor:p.respostas.pd_dor, temData:!!p.respondido_em};
});
ok('7b responder tudo grava e fecha a pesquisa',
   pdSalvo.status==='respondido' && pdSalvo.temData
   && pdSalvo.dor==='CAC subindo e margem caindo no retargeting', JSON.stringify(pdSalvo));

/* o Client Discovery abre na seção 1 com o que ele já contou, e só anda com Próxima */
const recap = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='client_discovery');
  mgNpsResponder(p.id);
  return {secao:(document.querySelector('#v-portal .gf-sec .faixa')||{}).textContent,
          titulo:(document.querySelector('#v-portal .gf-sec h2')||{}).textContent,
          itens:[...document.querySelectorAll('#v-portal .mgn-recap .it b')].map(b=>b.textContent),
          texto:(document.querySelector('#v-portal .mgn-recap .it span')||{}).textContent,
          botoes:[...document.querySelectorAll('#v-portal .gf-pe button')].map(b=>b.textContent.trim())};
});
ok('8  o Client Discovery abre na seção "O que você já nos contou" com as respostas do Pré-Discovery',
   /Seção 1 de 9/.test(recap.secao) && /O que você já nos contou/.test(recap.titulo)
   && recap.itens.includes('Principal dor') && recap.texto==='Dobrar a receita nova em 12 meses'
   && recap.botoes.join('|')==='Próxima', JSON.stringify(recap).slice(0,240));

/* Próxima com a seção em branco não avança; preenchida, avança */
const anda = await page.evaluate(async ()=>{
  mgNpsProxima();                     /* recap: nada obrigatório, vai para Negócio */
  const s2 = (document.querySelector('#v-portal .gf-sec .faixa')||{}).textContent;
  mgNpsProxima();                     /* Negócio em branco: fica */
  const ficou = (document.querySelector('#v-portal .gf-sec .faixa')||{}).textContent;
  const marcados = document.querySelectorAll('#v-portal .gf-q.erro').length;
  mgNpsEspelho('client_discovery').abas[1].perguntas.forEach(q=>mgNpsSet(q.id,'x'));
  mgNpsProxima();
  const s3 = (document.querySelector('#v-portal .gf-sec .faixa')||{}).textContent;
  return {s2, ficou, marcados, s3, voltar:[...document.querySelectorAll('#v-portal .gf-pe button')].map(b=>b.textContent.trim())};
});
ok('8b Próxima só avança com a seção completa, e marca o que falta',
   /Seção 2 de 9/.test(anda.s2) && anda.ficou===anda.s2 && anda.marcados===4
   && /Seção 3 de 9/.test(anda.s3) && anda.voltar.join('|')==='Voltar|Próxima', JSON.stringify(anda));

/* preenche o resto e envia pela última seção */
await page.evaluate(async ()=>{
  const spec = mgNpsEspelho('client_discovery');
  spec.abas.forEach(a=>(a.perguntas||[]).forEach(q=>{
    if(q.tipo==='pessoas'){ mgNpsPessoaNova(); mgNpsPessoa(0,'nome','Ana'); return }
    const v = q.id==='cd_economics' ? 'ROAS piso 3,5 e CAC máximo de R$ 180'
            : q.id==='cd_restricoes' ? 'Estoque limitado na linha premium'
            : q.id==='cd_postura' ? 'Provocativa' : 'x';
    mgNpsSet(q.id, v);
  }));
  for(let i=0;i<10;i++) mgNpsProxima();
  await mgNpsEnviarResposta();
});
await page.waitForTimeout(500);
const cdSalvo = await page.evaluate(()=>(__FIX.mgp_pesquisas.find(x=>x.tipo==='client_discovery')||{}).status);
ok('8c o Client Discovery inteiro é enviado pela última seção', cdSalvo==='respondido', cdSalvo);

/* =====================================================================
   FASE 3 — a equipe manda a revisão de 60 dias
   ===================================================================== */
await entrar('admin');
await page.evaluate(()=>showView('nps'));
await page.waitForTimeout(400);
await page.evaluate(async ()=>{ mgNpsCliente('c-1'); await mgNpsEnviarPesquisa('mgpr') });
await page.waitForTimeout(500);

const cont = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='mgpr');
  const i = __FIX.mgp_pesquisas_interno.find(x=>x.pesquisa_id===p.id);
  return {itens:((i&&i.dados.continuidade)||[]).map(c=>({i:c.item, ini:c.inicio, r:c.responsavel})),
          proxima:p.proxima_em, comDiscovery:p.com_discovery, internoNaLinha:'interno' in p};
});
ok('9  a revisão nasce com a continuidade na tabela interna, e nada interno na linha do cliente',
   cont.itens.length===5
   && cont.itens[0].ini==='CAC subindo e margem caindo no retargeting'
   && cont.itens[2].ini==='ROAS piso 3,5 e CAC máximo de R$ 180'
   && cont.itens[0].r==='Customer Success' && !!cont.proxima
   && cont.comDiscovery===true && !cont.internoNaLinha, JSON.stringify(cont).slice(0,260));

/* =====================================================================
   FASE 4 — o cliente responde a revisão: nota, depois motivo calibrado
   ===================================================================== */
await entrar('cliente');
const motivo = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='mgpr');
  mgNpsResponder(p.id);
  const escondido = !document.getElementById('gfq-confianca_motivo');
  mgNpsSet('confianca_recomendacoes',9);
  const soUmaNota = !document.getElementById('gfq-confianca_motivo');
  mgNpsSet('confianca_seguranca',9);
  const alta = [...document.querySelectorAll('#gfq-confianca_motivo .gf-opc button span')].map(b=>b.textContent);
  document.querySelector('#gfq-confianca_motivo .gf-opc button').click();
  const r1 = __COPIA = null;
  const escolhido = (document.querySelector('#gfq-confianca_motivo .gf-opc button.on span')||{}).textContent;
  /* cai para a faixa baixa: a lista muda e a escolha anterior some */
  mgNpsSet('confianca_seguranca',3);
  const baixa = [...document.querySelectorAll('#gfq-confianca_motivo .gf-opc button span')].map(b=>b.textContent);
  const limpou = !document.querySelector('#gfq-confianca_motivo .gf-opc button.on');
  mgNpsSet('confianca_seguranca',9);
  return {escondido, soUmaNota, alta, escolhido, baixa, limpou,
          secoes:(document.querySelector('#v-portal .gf-prog span')||{}).textContent};
});
ok('9b o motivo só aparece depois das notas, muda com a faixa e some se a faixa muda',
   motivo.escondido && motivo.soUmaNota && motivo.alta.length===5 && motivo.baixa.length===5
   && motivo.alta[1]==='Sinto que o time pensa no nosso negócio como se fosse deles.'
   && motivo.baixa[0]==='Sinto que as recomendações não vêm acompanhadas de dados ou explicação suficiente.'
   && motivo.escolhido===motivo.alta[0] && motivo.limpou && motivo.secoes==='Página 1 de 7',
   JSON.stringify(motivo).slice(0,300));

/* responde tudo pelo fluxo real: nota, motivo (primeira opção da faixa), Próxima */
await page.evaluate(async ()=>{
  const clicaMotivo = id => document.querySelector('#gfq-' + id + ' .gf-opc button').click();
  /* Confiança avg(9,9)=9 · Valor 9 · Execução avg(6,7,6,5)=6 · Impacto 9 ·
     Futuro 8  ->  MGPI (9+9+6+9+8)/5 = 8,2 */
  clicaMotivo('confianca_motivo'); mgNpsProxima();
  mgNpsSet('valor_entende',9); mgNpsSet('valor_percepcao','Parceiro estratégico'); clicaMotivo('valor_motivo'); mgNpsProxima();
  mgNpsSet('exec_comunicacao',6); mgNpsSet('exec_organizacao',7);
  mgNpsSet('exec_prazos',6);      mgNpsSet('exec_proatividade',5); clicaMotivo('exec_motivo'); mgNpsProxima();
  mgNpsSet('impacto_evolucao',9); clicaMotivo('impacto_motivo'); mgNpsProxima();
  mgNpsSet('futuro_potencial',8); clicaMotivo('futuro_motivo');
  mgNpsMulti('temas','IA'); mgNpsMulti('temas','Growth'); mgNpsProxima();
  mgNpsSet('continuidade_endereca','Parcialmente'); mgNpsProxima();
  mgNpsSet('nps_nota',9);
  window.__antesDoEnvio = (document.querySelector('#v-portal .gf-prog span')||{}).textContent;
  await mgNpsEnviarResposta();   /* falta o motivo do NPS: fica e marca */
  await new Promise(r=>setTimeout(r,80));
  window.__barrado = {marcado: !!document.querySelector('#gfq-nps_motivo.erro'),
                      status: __FIX.mgp_pesquisas.find(x=>x.tipo==='mgpr').status};
  clicaMotivo('nps_motivo');
  await mgNpsEnviarResposta();
});
await page.waitForTimeout(600);
const enviou = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='mgpr');
  return {antes:window.__antesDoEnvio, barrado:window.__barrado, status:p.status,
          motivoExec:p.respostas.exec_motivo, codExec:p.respostas.exec_motivo_cod,
          motivoNps:p.respostas.nps_motivo, percepcao:p.respostas.valor_percepcao};
});
ok('9c a última seção só envia com o motivo do NPS; grava texto e código do motivo',
   enviou.antes==='Página 7 de 7' && enviou.barrado.marcado && enviou.barrado.status==='enviado'
   && enviou.status==='respondido'
   && enviou.motivoExec==='Tivemos atrasos que impactaram o cronograma.' && enviou.codExec==='execucao:baixa:1'
   && enviou.motivoNps==='Já recomendei a Modesto para outras empresas do meu círculo.'
   && enviou.percepcao==='Parceiro estratégico', JSON.stringify(enviou).slice(0,300));

const snap = await page.evaluate(()=>({
  titulos:[...document.querySelectorAll('#v-portal .mgn-snap .it h3')].map(h=>h.textContent),
  corpo:(document.querySelector('#v-portal .mgn-snap')||{}).textContent||'',
}));
ok('10 o cliente recebe o retorno na hora, no formato da aba 02: um bloco por pilar, temas, recomendação, compromisso e próxima revisão',
   snap.titulos.join('|')==='Confiança|Valor estratégico|Excelência na execução|Impacto nos resultados|Futuro da parceria|'
     +'Temas que você destacou para gerar mais valor|Sobre sua recomendação|Nosso compromisso|Próxima revisão',
   JSON.stringify(snap.titulos));

ok('11 o retorno não mostra nota, MGPI, classificação nem farol',
   !/8,2|8\.2|MGPI|Silver|Gold|Platinum|Bronze|Recovery|Farol|Próximo passo/i.test(snap.corpo),
   snap.corpo.slice(0,160));

ok('12 cada bloco ecoa a frase escolhida e responde com o texto da faixa',
   /Tivemos atrasos que impactaram o cronograma\./.test(snap.corpo)
   && /Esse feedback vai direto para o time responsável/.test(snap.corpo)
   && /Sinto que o time pensa no nosso negócio como se fosse deles|As decisões costumam ser bem embasadas/.test(snap.corpo)
   && /Ficamos felizes em ler isso/.test(snap.corpo)
   && /IA · Growth/.test(snap.corpo)
   && /Muito obrigado! Ficamos muito felizes/.test(snap.corpo)
   && /Próxima revisão prevista/.test(snap.corpo), snap.corpo.slice(0,220));

/* =====================================================================
   FASE 5 — o painel interno da equipe
   ===================================================================== */
await entrar('admin');
await page.evaluate(()=>showView('nps'));
await page.waitForTimeout(400);
await page.evaluate(()=>mgNpsCliente('c-1'));
await page.waitForTimeout(400);

const painel = await page.evaluate(()=>{
  const car = [...document.querySelectorAll('#v-nps .mgn-n')].map(n=>({
    rot:n.querySelector('span').textContent, v:n.querySelector('b').textContent}));
  return {
    car,
    pilares:[...document.querySelectorAll('#v-nps .mgn-pilar')].map(p=>
      p.querySelector('.rot').textContent + '=' + p.querySelector('.v').textContent),
    alertas:[...document.querySelectorAll('#v-nps .mgn-alerta')].map(a=>a.textContent.slice(0,40)),
  };
});
ok('13 o painel calcula o MGPI da planilha',
   (painel.car[0]||{}).rot==='MGPI' && (painel.car[0]||{}).v==='8,20', JSON.stringify(painel.car));
ok('14 farol, nota e classificação aparecem como a planilha manda',
   (painel.car[1]||{}).v==='Verde' && (painel.car[2]||{}).v==='9', JSON.stringify(painel.car.slice(1,3)));
ok('15 cada pilar aparece com a média das perguntas dele',
   painel.pilares.join('|')==='Confiança=9,0|Valor estratégico=9,0|Excelência na execução=6,0|'
     +'Impacto nos resultados=9,0|Futuro da parceria=8,0', JSON.stringify(painel.pilares));
ok('16 o alerta sai só no pilar abaixo de 8',
   painel.alertas.filter(a=>a.startsWith('⚠️')).length===1
   && painel.alertas.some(a=>/⚠️ Excelência/.test(a)), JSON.stringify(painel.alertas));

/* ---- 17. CAP pré-carregado, sem SLA (NPS 9, MGPI 8,2) ---- */
const cap = await page.evaluate(async ()=>{
  const sec = document.querySelector('#v-nps .mgn-cap');
  const linhas = [...(sec ? sec.querySelectorAll('tbody tr') : [])];
  const semSla = ![...document.querySelectorAll('#v-nps .mgn-bloco h2')].some(h=>/SLA de contato/.test(h.textContent));
  const antes = __FIX.tasks.length;
  await mgNpsCapDemanda(0);
  await new Promise(r=>setTimeout(r,200));
  const nova = __FIX.tasks[__FIX.tasks.length-1];
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='mgpr');
  const i = __FIX.mgp_pesquisas_interno.find(x=>x.pesquisa_id===p.id);
  return {linhas:linhas.length, pilar:linhas[0] ? linhas[0].querySelector('b').textContent : '',
          acao:linhas[0] ? linhas[0].querySelector('.cap-acao').value : '', semSla,
          criou: __FIX.tasks.length===antes+1, titulo:nova.title, clienteInterno: nova.client_id==null,
          guardou: !!(i && i.dados.cap && i.dados.cap[0].task_id)};
});
ok('17 o CAP nasce só com o pilar abaixo de 8, com a ação da planilha, e vira demanda fora do portal do cliente',
   cap.linhas===1 && cap.pilar==='Excelência na execução'
   && /Revisar SLAs internos de comunicação e prazos/.test(cap.acao) && cap.semSla
   && cap.criou && cap.titulo==='CAP · Cliente Um · Excelência na execução' && cap.clienteInterno && cap.guardou,
   JSON.stringify(cap));

/* ---- as respostas do cliente: lista no painel, relatório ao clique ---- */
const resp = await page.evaluate(()=>{
  const sec = document.getElementById('mgn-respostas');
  return {
    existe: !!sec,
    linhas: [...(sec ? sec.querySelectorAll('tbody tr') : [])].map(tr=>tr.querySelector('b').textContent.trim()),
    botoes: [...(sec ? sec.querySelectorAll('button') : [])].map(b=>b.textContent.trim()),
    cruas: /Quanto você confia nas recomendações/.test(sec ? sec.textContent : ''),
    semLeitura: /sem leitura ainda/.test(sec ? sec.textContent : ''),
  };
});
ok('18 o painel lista as respostas em uma linha por pesquisa, sem despejar as respostas cruas',
   resp.existe && resp.linhas.length === 3 && /Revisão de Parceria/.test(resp.linhas[0])
   && resp.botoes.every(b=>b==='abrir relatório') && !resp.cruas && resp.semLeitura, JSON.stringify(resp));

const rel = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='mgpr');
  mgNpsRelatorio(p.id);
  const r = document.getElementById('mgn-relatorio');
  const t = r ? r.textContent : '';
  return {
    existe: !!r,
    titulo: (r.querySelector('.rel-tit h1')||{}).textContent,
    donuts: r.querySelectorAll('.rel-donut').length,
    mgpiNoDonut: (r.querySelector('.rel-donut text')||{}).textContent,
    radar: !!r.querySelector('.rel-radar'),
    barras: r.querySelectorAll('.rel-barra').length,
    citas: r.querySelectorAll('.rel-cita').length,
    motivoExec: /Tivemos atrasos que impactaram o cronograma/.test(t),
    palavras: /As decisões costumam ser bem embasadas e isso me dá segurança/.test(t),
    temaIA: /IA/.test(t),
    semLeitura: /Ainda sem leitura/.test(t),
    botoes: [...r.querySelectorAll('.rel-acoes button')].map(b=>b.textContent.trim()),
    painelSumiu: !document.querySelector('#v-nps .mgn-cap'),
  };
});
ok('19 o relatório abre no lugar do painel: MGPI, radar, uma barra por pergunta, a frase de cada pilar',
   rel.existe && /Revisão de Parceria/.test(rel.titulo) && rel.donuts===2 && rel.mgpiNoDonut==='8,20'
   && rel.radar && rel.barras===10 && rel.citas===6 && rel.motivoExec && rel.palavras && rel.temaIA
   && rel.semLeitura && rel.botoes.join('|')==='Salvar em PDF|Gerar leitura da Modesto' && rel.painelSumiu,
   JSON.stringify(rel));

/* a leitura da Modesto: vai para a função, volta, fica guardada na tabela interna */
const lei = await page.evaluate(async ()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='mgpr');
  await mgNpsGerarLeitura(p.id);
  await new Promise(r=>setTimeout(r,200));
  const r = document.getElementById('mgn-relatorio');
  const i = __FIX.mgp_pesquisas_interno.find(x=>x.pesquisa_id===p.id);
  const enviado = window.__LEITURA_ULTIMO || {};
  return {tipo: enviado.tipo, dossieTemNumeros: /MGPI 8,20/.test(enviado.dossie||''),
          dossieTemRespostas: /Tivemos atrasos que impactaram o cronograma/.test(enviado.dossie||''),
          dossieTemDiscovery: /CAC subindo e margem caindo no retargeting/.test(enviado.dossie||''),
          titulos: [...r.querySelectorAll('.rel-texto h4')].map(h=>h.textContent),
          itens: r.querySelectorAll('.rel-texto li').length,
          guardou: !!(i && i.dados.leitura && /O cliente confia no time/.test(i.dados.leitura.texto)),
          botao: (r.querySelector('.rel-acoes .btn-p')||{}).textContent};
});
ok('19b a leitura da Modesto é gerada a partir do dossiê completo e fica guardada só na tabela interna',
   lei.tipo==='mgpr' && lei.dossieTemNumeros && lei.dossieTemRespostas && lei.dossieTemDiscovery
   && lei.titulos.length===6 && lei.titulos[0]==='Em três linhas' && lei.itens===8 && lei.guardou
   && /Gerar leitura de novo/.test(lei.botao), JSON.stringify(lei));

const trocou = await page.evaluate(()=>{
  mgNpsFecharRelatorio();
  const voltou = !!document.querySelector('#v-nps .mgn-cap') && !document.getElementById('mgn-relatorio');
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='pre_discovery');
  mgNpsRelatorio(p.id);
  const r = document.getElementById('mgn-relatorio');
  return {voltou, titulo:(r.querySelector('.rel-tit h1')||{}).textContent, texto:r.textContent,
          semGrafico: !r.querySelector('.rel-radar'), perguntas: r.querySelectorAll('.rel-secoes .rel-q').length};
});
ok('20 voltar devolve o painel, e o relatório do Pré-Discovery é pergunta e resposta, sem gráfico',
   trocou.voltou && /Pré-Discovery/.test(trocou.titulo)
   && /CAC subindo e margem caindo no retargeting/.test(trocou.texto) && trocou.semGrafico && trocou.perguntas===12,
   JSON.stringify({voltou:trocou.voltou, titulo:trocou.titulo, perguntas:trocou.perguntas}));
const com = await page.evaluate(async ()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='pre_discovery');
  const r = document.getElementById('mgn-relatorio');
  const bloco = r.querySelector('.rel-comercial');
  const titulo = (r.querySelector('.rel-leitura h2')||{}).textContent;
  const botaoAlto = [...bloco.querySelectorAll('.mgn-multi button')].find(b=>/Alto/.test(b.textContent));
  botaoAlto.click();
  await new Promise(res=>setTimeout(res,150));
  await mgNpsComercial(p.id, 'proximo', 'Diagnóstico em duas semanas');
  const i = __FIX.mgp_pesquisas_interno.find(x=>x.pesquisa_id===p.id);
  const marcado = !!document.querySelector('#mgn-relatorio .rel-comercial .mgn-multi button.on');
  return {temBloco:!!bloco, titulo, fit:i && i.dados.comercial && i.dados.comercial.fit,
          proximo:i && i.dados.comercial && i.dados.comercial.proximo, marcado};
});
ok('20b o Pré-Discovery tem o bloco de uso interno comercial, guardado na tabela interna, e a leitura se chama comercial',
   com.temBloco && com.titulo==='Leitura comercial' && com.fit==='Alto'
   && com.proximo==='Diagnóstico em duas semanas' && com.marcado, JSON.stringify(com));

const revisao = await page.evaluate(async ()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='mgpr');
  mgNpsRelatorio(p.id);
  const antes = !!document.querySelector('#mgn-relatorio .rel-leitura button');
  mgNpsEditarLeitura(p.id);
  const ta = document.getElementById('mgn-leitura-txt');
  const tinhaTexto = ta && /Em três linhas/.test(ta.value);
  ta.value = '## Em três linhas\n- Revisado pela equipe.\n## O que pesa\n- Prazo.';
  await mgNpsSalvarLeitura(p.id);
  await new Promise(res=>setTimeout(res,150));
  const i = __FIX.mgp_pesquisas_interno.find(x=>x.pesquisa_id===p.id);
  const r = document.getElementById('mgn-relatorio');
  return {antes, tinhaTexto, guardou: /Revisado pela equipe/.test(i.dados.leitura.texto), revisadoEm: !!i.dados.leitura.revisado_em,
          naTela: /Revisado pela equipe/.test(r.textContent), rotulo:(r.querySelector('.rel-leitura .n')||{}).textContent};
});
ok('20c a leitura pode ser revisada à mão, e a revisão fica guardada com data',
   revisao.antes && revisao.tinhaTexto && revisao.guardou && revisao.revisadoEm && revisao.naTela
   && /revisada em/.test(revisao.rotulo), JSON.stringify(revisao));
await page.evaluate(()=>mgNpsFecharRelatorio());

const carteira = await page.evaluate(()=>{
  mgNpsCliente('');
  const car = [...document.querySelectorAll('#v-nps .mgn-n b')].map(b=>b.textContent);
  return {car, farol:(document.querySelector('#v-nps .mgn-tab .mgn-farol')||{}).textContent};
});
ok('21 a visão geral calcula o NPS de verdade, não a nota crua',
   carteira.car[0]==='100' && carteira.car[1]==='8,20' && carteira.farol==='Verde',
   JSON.stringify(carteira));

/* ---- 24. a folha das respostas: Salvar em PDF no Pré-Discovery, que não tem retorno ---- */
await page.evaluate(()=>mgNpsCliente('c-1'));   /* o caso 21 deixou a visão geral aberta */
await page.waitForTimeout(400);
const folha = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='pre_discovery');
  mgNpsRelatorio(p.id);
  const sec = document.getElementById('mgn-relatorio');
  const botao = [...sec.querySelectorAll('button')].find(b=>/Salvar em PDF/.test(b.textContent));
  const _p = window.print; let duranteImpressao = null;
  window.print = ()=>{ duranteImpressao = sec.classList.contains('mgn-folha') };
  if(botao) botao.click();
  window.print = _p;
  const papel = [...document.styleSheets].flatMap(s=>{ try{ return [...s.cssRules] }catch(e){ return [] } })
    .filter(r=>r.media && /print/.test(r.media.mediaText))
    .flatMap(r=>[...r.cssRules].map(x=>x.cssText)).join('\n');
  const cab = sec.querySelector('.mgn-so-print');
  return {temBotao: !!botao, duranteImpressao,
          folhaVisivelNoPapel: /\.mgn-folha[^{]*\{[^}]*visibility:\s*visible/.test(papel),
          abasSomemNoPapel: /\.mgn-folha \.mgn-abas[^{]*\{[^}]*display:\s*none/.test(papel),
          cabecalho: cab ? cab.textContent : '',
          cabecalhoSoNoPapel: cab ? getComputedStyle(cab).display === 'none' : false};
});
await page.waitForTimeout(1700);
const folhaLimpa = await page.evaluate(()=>{ const ok = !document.getElementById('mgn-relatorio').classList.contains('mgn-folha'); mgNpsFecharRelatorio(); return ok });
ok('24 o relatório tem Salvar em PDF, e a folha de papel mostra só ele, com o cabeçalho',
   folha.temBotao && folha.duranteImpressao && folha.folhaVisivelNoPapel && folha.abasSomemNoPapel
   && /Cliente Um · Pré-Discovery · respondida em/.test(folha.cabecalho) && folha.cabecalhoSoNoPapel
   && folhaLimpa, JSON.stringify({...folha, folhaLimpa}));

/* ---- 25. enviado sem querer: excluir enquanto o cliente não respondeu ---- */
await page.evaluate(async ()=>{ mgNpsCliente('c-1'); window.confirm = ()=>true; await mgNpsEnviarPesquisa('pre_discovery') });
await page.waitForTimeout(400);
const excluir = await page.evaluate(async ()=>{
  const linhas = ()=>[...document.querySelectorAll('#v-nps tr')];
  const antes = __FIX.mgp_pesquisas.length;
  const pend = __FIX.mgp_pesquisas.find(p=>p.status==='enviado' && p.tipo==='pre_discovery');
  const linha = linhas().find(tr=>/aguardando o cliente/.test(tr.textContent));
  const botao = linha && [...linha.querySelectorAll('button')].find(b=>/excluir envio/.test(b.textContent));
  const respondidaTemExcluir = linhas().some(tr=>/relatório/.test(tr.textContent) && /excluir envio/.test(tr.textContent));
  window.confirm = ()=>false; await mgNpsExcluirEnvio(pend.id);
  const cancelarNaoApaga = __FIX.mgp_pesquisas.length === antes;
  window.confirm = ()=>true; await mgNpsExcluirEnvio(pend.id);
  await new Promise(r=>setTimeout(r,300));
  const sumiuDoBanco = !__FIX.mgp_pesquisas.some(p=>p.id===pend.id);
  const sumiuDaTela = !linhas().some(tr=>/aguardando o cliente/.test(tr.textContent));
  const resp = __FIX.mgp_pesquisas.find(p=>p.status==='respondido');
  await mgNpsExcluirEnvio(resp.id);
  const respondidaFica = __FIX.mgp_pesquisas.some(p=>p.id===resp.id);
  return {rodada: pend && pend.rodada, temBotao: !!botao, respondidaTemExcluir, cancelarNaoApaga,
          sumiuDoBanco, sumiuDaTela, respondidaFica, antes, depois: __FIX.mgp_pesquisas.length};
});
ok('25 o envio pendente tem "excluir envio", cancelar não apaga, confirmar apaga, e a respondida fica',
   excluir.rodada === 2 && excluir.temBotao && !excluir.respondidaTemExcluir && excluir.cancelarNaoApaga
   && excluir.sumiuDoBanco && excluir.sumiuDaTela && excluir.respondidaFica
   && excluir.depois === excluir.antes - 1, JSON.stringify(excluir));

/* ---- 26. cliente sem discovery: a revisão sai sem a seção, o painel diz "não aplicável",
        e o SLA aparece quando a nota cai ---- */
await page.evaluate(()=>{
  __FIX.clients.push({id:'c-2', nome:'Cliente Dois', logo_url:null, resumo:'', plano_midia:false, jornada:{}});
  CLIENTS.push({id:'c-2', nome:'Cliente Dois'});
});
const semDisc = await page.evaluate(async ()=>{
  mgNpsCliente('c-2');
  let perguntou = null; window.confirm = m => { perguntou = m; return true };
  await mgNpsEnviarPesquisa('mgpr');
  await new Promise(r=>setTimeout(r,200));
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='mgpr' && x.client_id==='c-2');
  /* o cliente respondeu com nota baixa; o gatilho do banco (que o dublê não tem) teria gravado o SLA */
  p.status='respondido'; p.respondido_em=new Date().toISOString();
  p.respostas={confianca_recomendacoes:4, confianca_seguranca:5, valor_entende:5, exec_comunicacao:6,
               exec_organizacao:6, exec_prazos:5, exec_proatividade:5, impacto_evolucao:5, futuro_potencial:5,
               nps_nota:4, nps_motivo:'Recomendaria, mas com ressalvas importantes.', nps_motivo_cod:'nps:baixa:5'};
  __FIX.mgp_pesquisas_interno.push({pesquisa_id:p.id, dados:{sla:{task_id:'t-1', prazo:'2026-09-24', mgpi:5.05, nps:4}}});
  localStorage.setItem('__stub_pesquisas', JSON.stringify(__FIX.mgp_pesquisas));
  localStorage.setItem('__stub_interno', JSON.stringify(__FIX.mgp_pesquisas_interno));
  return {perguntou:/não tem Pré-Discovery nem Client Discovery/.test(perguntou||''), comDiscovery:p.com_discovery, id:p.id};
});
await page.evaluate(()=>showView('nps'));
await page.evaluate(async ()=>{ await renderNps(); });
await entrar('admin');
await page.evaluate(()=>showView('nps'));
await page.waitForTimeout(400);
const painel2 = await page.evaluate(()=>{
  mgNpsCliente('c-2');
  const t = document.getElementById('v-nps').textContent;
  const cap = [...document.querySelectorAll('#v-nps .mgn-cap tbody tr b')].map(b=>b.textContent);
  return {naoAplicavel:/Não aplicável: cliente sem discovery inicial/.test(t),
          sla:/SLA de contato/.test(t) && /até 24\/09\/2026/.test(t) && /abrir demanda/.test(t),
          cap, classif:/Recovery Partnership/.test(t)};
});
ok('26 sem discovery a revisão sai sem a seção, o painel marca "não aplicável", e o SLA aparece com prazo e demanda',
   semDisc.perguntou && semDisc.comDiscovery===false && painel2.naoAplicavel && painel2.sla
   && painel2.cap.length===6 && painel2.cap[5]==='NPS' && painel2.classif,
   JSON.stringify({semDisc, painel2}));

/* o cliente dessa empresa veria 6 seções, não 7 */
const seisSecoes = await page.evaluate((id)=>{
  mgNpsAbrir(id, true);
  const faixas = [...document.querySelectorAll('#v-nps .gf-sec .faixa')].map(f=>f.textContent);
  const temContinuidade = [...document.querySelectorAll('#v-nps .gf-sec h2')].some(h=>/Continuidade/.test(h.textContent));
  mgNpsFechar();
  return {n:faixas.length, ultima:faixas[faixas.length-1], temContinuidade};
}, semDisc.id);
ok('27 o formulário dessa revisão tem 6 seções, sem a de continuidade',
   seisSecoes.n===6 && /Seção 6 de 6/.test(seisSecoes.ultima) && !seisSecoes.temContinuidade, JSON.stringify(seisSecoes));

/* =====================================================================
   FASE 6 — o que o cliente não alcança
   ===================================================================== */
await entrar('cliente');
const barrado = await page.evaluate(()=>{ showView('nps'); return VIEW });
ok('22 o cliente não entra na aba da equipe', barrado==='portal', barrado);

const menuDele = await page.evaluate(()=>mgNavItens().map(n=>n.v));
ok('23 a aba não aparece no menu do cliente', !menuDele.includes('nps'), JSON.stringify(menuDele));

/* ---- saída ---- */
await browser.close(); srv.close();
const larg = Math.max(...res.map(r=>r.t.length));
console.log('');
res.forEach(r=>console.log(` ${r.r==='PASSOU'?'✓':'✗'} ${r.t.padEnd(larg)}  ${r.r}${r.r==='FALHOU'?'\n     '+r.d:''}`));
const n = res.filter(r=>r.r==='PASSOU').length;
console.log(`\n ${n}/${res.length} passaram | erros de JS: ${erros.length}`);
erros.slice(0,8).forEach(e=>console.log('   ' + e.slice(0,200)));
process.exit(n===res.length && !erros.length ? 0 : 1);
