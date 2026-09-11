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
   FASE 2 — o cliente responde
   ===================================================================== */
await entrar('cliente');

const bloco = await page.evaluate(()=>({
  titulos:[...document.querySelectorAll('#v-portal .mgp-bloco h2')].map(h=>h.textContent.trim()),
  itens: document.querySelectorAll('#v-portal .mgp-bloco .mgp-doc').length,
}));
ok('5  o cliente vê as pesquisas logo abaixo do cabeçalho',
   bloco.titulos[0]==='Pesquisas' && bloco.titulos.includes('Demandas em aberto'),
   JSON.stringify(bloco.titulos));

/* responde o Pré-Discovery */
const abriuForm = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='pre_discovery');
  mgNpsResponder(p.id);
  return {titulo:(document.querySelector('#v-portal .mgn-cab h1')||{}).textContent,
          perguntas: document.querySelectorAll('#v-portal .mgn-p').length};
});
ok('6  o formulário do Pré-Discovery abre dentro da página do cliente',
   abriuForm.titulo==='Pré-Discovery' && abriuForm.perguntas===13, JSON.stringify(abriuForm));

await page.evaluate(async ()=>{
  mgNpsSet('pd_dor', 'CAC subindo e margem caindo no retargeting');
  mgNpsSet('pd_objetivo', 'Dobrar a receita nova em 12 meses');
  await mgNpsEnviarResposta();
});
await page.waitForTimeout(500);
const pdSalvo = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='pre_discovery');
  return {status:p.status, dor:p.respostas.pd_dor, temData:!!p.respondido_em};
});
ok('7  a resposta do cliente é gravada e a pesquisa fecha',
   pdSalvo.status==='respondido' && pdSalvo.temData
   && pdSalvo.dor==='CAC subindo e margem caindo no retargeting', JSON.stringify(pdSalvo));

/* o Client Discovery abre com o que ele já contou */
const recap = await page.evaluate(()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='client_discovery');
  mgNpsResponder(p.id);
  return {aba:(document.querySelector('#v-portal .mgn-abas button.on')||{}).textContent,
          itens:[...document.querySelectorAll('#v-portal .mgn-recap .it b')].map(b=>b.textContent),
          texto:(document.querySelector('#v-portal .mgn-recap .it span')||{}).textContent};
});
ok('8  o Client Discovery abre com as respostas do Pré-Discovery',
   /O que você já nos contou/.test(recap.aba) && recap.itens.includes('Principal dor')
   && recap.texto==='Dobrar a receita nova em 12 meses', JSON.stringify(recap).slice(0,200));

await page.evaluate(async ()=>{
  mgNpsSet('cd_economics', 'ROAS piso 3,5 e CAC máximo de R$ 180');
  mgNpsSet('cd_restricoes', 'Estoque limitado na linha premium');
  mgNpsSet('cd_postura', 'Queremos provocação, não relatório');
  await mgNpsEnviarResposta();
});
await page.waitForTimeout(500);

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
  return {itens:(p.interno.continuidade||[]).map(c=>({i:c.item, ini:c.inicio, r:c.responsavel})),
          proxima:p.proxima_em};
});
ok('9  a revisão nasce com a continuidade do discovery já preenchida',
   cont.itens.length===5
   && cont.itens[0].ini==='CAC subindo e margem caindo no retargeting'
   && cont.itens[2].ini==='ROAS piso 3,5 e CAC máximo de R$ 180'
   && cont.itens[0].r==='Customer Success' && !!cont.proxima, JSON.stringify(cont).slice(0,220));

/* =====================================================================
   FASE 4 — o cliente responde a revisão e recebe o retorno
   ===================================================================== */
await entrar('cliente');
await page.evaluate(async ()=>{
  const p = __FIX.mgp_pesquisas.find(x=>x.tipo==='mgpr');
  mgNpsResponder(p.id);
  /* Confiança avg(9,9)=9 · Valor 9 · Execução avg(6,7,6,5)=6 · Impacto 9 ·
     Futuro 8  ->  MGPI (9+9+6+9+8)/5 = 8,2 */
  mgNpsSet('confianca_recomendacoes',9); mgNpsSet('confianca_seguranca',9);
  mgNpsSet('valor_entende',9);
  mgNpsSet('exec_comunicacao',6); mgNpsSet('exec_organizacao',7);
  mgNpsSet('exec_prazos',6);      mgNpsSet('exec_proatividade',5);
  mgNpsSet('impacto_evolucao',9); mgNpsSet('futuro_potencial',8);
  mgNpsMulti('temas','IA'); mgNpsMulti('temas','Growth');
  mgNpsSet('nps_nota',9); mgNpsSet('nps_motivo','Time presente, mas prazo escorrega');
  await mgNpsEnviarResposta();
});
await page.waitForTimeout(600);

const snap = await page.evaluate(()=>({
  titulos:[...document.querySelectorAll('#v-portal .mgn-snap .it h3')].map(h=>h.textContent),
  fortes:(document.querySelector('#v-portal .mgn-snap .it p')||{}).textContent,
  corpo:(document.querySelector('#v-portal .mgn-snap')||{}).textContent||'',
}));
ok('10 o cliente recebe o retorno na hora, com os cinco blocos',
   snap.titulos.join('|')==='Principais pontos fortes percebidos|Oportunidades identificadas|'
     +'Temas que você destacou para gerar mais valor|Nosso compromisso|Próxima revisão',
   JSON.stringify(snap.titulos));

ok('11 o retorno não mostra nota nem classificação',
   !/8,2|8\.2|MGPI|Silver|Gold|Platinum|Bronze|Recovery|Farol/i.test(snap.corpo),
   snap.corpo.slice(0,160));

ok('12 o retorno traz os pilares fortes e os fracos, cada um no seu lugar',
   /Confiança na condução estratégica/.test(snap.corpo)
   && /Revisar processos, prazos e cadência/.test(snap.corpo)
   && /IA · Growth/.test(snap.corpo)
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

const carteira = await page.evaluate(()=>{
  mgNpsCliente('');
  const car = [...document.querySelectorAll('#v-nps .mgn-n b')].map(b=>b.textContent);
  return {car, farol:(document.querySelector('#v-nps .mgn-tab .mgn-farol')||{}).textContent};
});
ok('17 a visão geral calcula o NPS de verdade, não a nota crua',
   carteira.car[0]==='100' && carteira.car[1]==='8,20' && carteira.farol==='Verde',
   JSON.stringify(carteira));

/* =====================================================================
   FASE 6 — o que o cliente não alcança
   ===================================================================== */
await entrar('cliente');
const barrado = await page.evaluate(()=>{ showView('nps'); return VIEW });
ok('18 o cliente não entra na aba da equipe', barrado==='portal', barrado);

const menuDele = await page.evaluate(()=>mgNavItens().map(n=>n.v));
ok('19 a aba não aparece no menu do cliente', !menuDele.includes('nps'), JSON.stringify(menuDele));

/* ---- saída ---- */
await browser.close(); srv.close();
const larg = Math.max(...res.map(r=>r.t.length));
console.log('');
res.forEach(r=>console.log(` ${r.r==='PASSOU'?'✓':'✗'} ${r.t.padEnd(larg)}  ${r.r}${r.r==='FALHOU'?'\n     '+r.d:''}`));
const n = res.filter(r=>r.r==='PASSOU').length;
console.log(`\n ${n}/${res.length} passaram | erros de JS: ${erros.length}`);
erros.slice(0,8).forEach(e=>console.log('   ' + e.slice(0,200)));
process.exit(n===res.length && !erros.length ? 0 : 1);
