/* Jornada do cliente: o roadmap.
   Confere as três frentes: as etapas no cadastro da empresa, a configuração
   restrita ao Vinícius, e a trilha que o cliente vê ao entrar. */
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
const erros = [], res = [];
const ok = (n,c,d='') => res.push({t:n, r:c?'PASSOU':'FALHOU', d:String(d).slice(0,220)});

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

await page.goto(BASE, {waitUntil:'domcontentloaded'});
await page.evaluate(()=>localStorage.clear());
await entrar('admin');

/* ---- 1. o catálogo segue o fluxo da Patrícia ---- */
const cat = await page.evaluate(()=>mgJornadaEtapas());
ok('1  o catálogo tem as 13 etapas do fluxo, na ordem',
   cat.length === 13 && cat[0].id === 'cadastro' && cat[1].id === 'pre_discovery'
   && cat[2].id === 'diagnostico' && cat[5].id === 'client_discovery'
   && cat[cat.length-1].id === 'cap', JSON.stringify(cat.map(e=>e.id)));
ok('2  as etapas internas estão marcadas como internas',
   cat.filter(e=>e.interna).map(e=>e.id).join(',') === 'client_intelligence,pre_kickoff,cap',
   JSON.stringify(cat.filter(e=>e.interna).map(e=>e.id)));

/* ---- 2. só o Vinícius configura ---- */
const souEu = await page.evaluate(()=>({nome:ME.name, pode:mgJornadaPodeConfigurar()}));
ok('3  o Vinícius pode configurar', souEu.nome === 'Vinícius Reis' && souEu.pode === true,
   JSON.stringify(souEu));

const outro = await page.evaluate(()=>{
  const antes = ME.name; ME.name = 'Outra Pessoa';
  const pode = mgJornadaPodeConfigurar(); ME.name = antes;
  return pode;
});
ok('4  outro admin não configura', outro === false, String(outro));

await page.evaluate(()=>showView('clientes'));
await page.waitForTimeout(700);
const botao = await page.evaluate(()=>({
  jornada: document.querySelectorAll('#v-clientes .crow [data-jornada]').length,
  linhas: document.querySelectorAll('#v-clientes .crow').length,
}));
ok('5  a linha da empresa ganha o botão Jornada',
   botao.linhas >= 1 && botao.jornada === botao.linhas, JSON.stringify(botao));

const semBotao = await page.evaluate(async ()=>{
  const antes = ME.name; ME.name = 'Outra Pessoa';
  await renderClientes();
  const n = document.querySelectorAll('#v-clientes .crow [data-jornada]').length;
  ME.name = antes; await renderClientes();
  return n;
});
ok('6  para outro admin o botão não aparece', semBotao === 0, String(semBotao));

/* ---- 3. o cadastro da empresa ---- */
const cadastro = await page.evaluate(()=>{
  abrirNovoCliente();
  const cxs = [...document.querySelectorAll('#nc-jornada input[data-etapa]')];
  return {
    n: cxs.length,
    marcadas: cxs.filter(i=>i.checked).map(i=>i.dataset.etapa),
    temInterna: cxs.some(i=>['client_intelligence','pre_kickoff','cap'].includes(i.dataset.etapa)),
    temCadastro: cxs.some(i=>i.dataset.etapa==='cadastro'),
  };
});
ok('7  o cadastro oferece as etapas, com Pré-Discovery já marcado',
   cadastro.n === 9 && cadastro.marcadas.join(',') === 'pre_discovery'
   && !cadastro.temInterna && !cadastro.temCadastro, JSON.stringify(cadastro));

const criou = await page.evaluate(async ()=>{
  document.getElementById('nc-nome').value = 'Empresa Nova';
  document.querySelectorAll('#nc-jornada input[data-etapa]').forEach(i=>{
    i.checked = ['pre_discovery','client_discovery','diagnostico'].includes(i.dataset.etapa);
  });
  await criarClienteCompleto();
  const c = CLIENTS.find(x=>x.nome === 'Empresa Nova');
  return {
    achou: !!c,
    etapas: c ? (c.jornada.etapas||[]).filter(e=>e.status!=='pendente')
                 .map(e=>e.id+':'+e.status) : [],
    visiveis: c ? (c.jornada.etapas||[]).filter(e=>e.visivel).map(e=>e.id) : [],
    pesquisas: __FIX.mgp_pesquisas.filter(p=>c && p.client_id===c.id).map(p=>p.tipo+':'+p.status),
    recado: (document.getElementById('nc-res')||{}).textContent || '',
  };
});
ok('8  criar a empresa monta a jornada: cadastro feito, a primeira etapa em andamento',
   criou.achou && criou.etapas.join(',') === 'cadastro:concluido,pre_discovery:andamento',
   JSON.stringify(criou.etapas));
ok('9  o cliente nasce vendo só o cadastro e a etapa atual',
   criou.visiveis.join(',') === 'cadastro,pre_discovery', JSON.stringify(criou.visiveis));
ok('10 as etapas marcadas já criam os questionários do cliente',
   criou.pesquisas.sort().join(',') === 'client_discovery:enviado,pre_discovery:enviado',
   JSON.stringify(criou.pesquisas));
ok('11 a janela diz o que foi montado', /Jornada montada/.test(criou.recado)
   && /aguardam resposta/.test(criou.recado), criou.recado.slice(-180));

/* ---- 4. configurar a jornada da Cliente Um, que o cliente do teste vê ---- */
const cfg = await page.evaluate(async ()=>{
  mgJornadaAbrir('c-1');
  const linhas = document.querySelectorAll('#jor-corpo .mgj-l').length;
  const et = mgJornadaEtapas();
  const iCad = et.findIndex(e=>e.id==='cadastro');
  const iDia = et.findIndex(e=>e.id==='diagnostico');
  const iInt = et.findIndex(e=>e.id==='client_intelligence');
  mgJornadaCampo(iCad,'status','concluido');
  mgJornadaCampo(iDia,'status','andamento');
  mgJornadaCampo(iInt,'status','andamento');   /* interna: não deve virar visível */
  const aberto = document.getElementById('jor-corpo').textContent;
  await mgJornadaSalvar();
  const c = CLIENTS.find(x=>x.id==='c-1');
  return {
    linhas,
    temColunaVe: /Cliente vê/.test(aberto),
    visiveis: (c.jornada.etapas||[]).filter(e=>e.visivel).map(e=>e.id),
    dataCad: (c.jornada.etapas||[]).find(e=>e.id==='cadastro').data,
  };
});
ok('12 a janela lista as 13 etapas e a coluna do que o cliente vê',
   cfg.linhas === 13 && cfg.temColunaVe, JSON.stringify({linhas:cfg.linhas, ve:cfg.temColunaVe}));
ok('13 concluir sem data carimba hoje', cfg.dataCad === new Date().toISOString().slice(0,10),
   String(cfg.dataCad));
ok('14 etapa interna em andamento não fica visível para o cliente',
   !cfg.visiveis.includes('client_intelligence')
   && cfg.visiveis.includes('cadastro') && cfg.visiveis.includes('diagnostico'),
   JSON.stringify(cfg.visiveis));

/* ---- 5. a trilha na página do cliente ---- */
await entrar('cliente');
const trilha = await page.evaluate(()=>{
  const sec = document.querySelector('#v-portal .mgj-bloco');
  return {
    existe: !!sec,
    titulo: sec ? (sec.querySelector('h2')||{}).textContent : '',
    contador: sec ? (sec.querySelector('.n')||{}).textContent : '',
    etapas: [...(sec ? sec.querySelectorAll('.mgj-et') : [])].map(e=>
      (e.querySelector('.tx b')||{}).textContent.replace('agora','').trim() + '=' + e.className.replace('mgj-et ','')),
    primeiro: (document.querySelector('#v-portal .mgp-bloco h2')||{}).textContent,
  };
});
ok('15 o cliente vê a trilha, e ela vem primeiro na página',
   trilha.existe && trilha.titulo === 'Onde estamos' && trilha.primeiro === 'Onde estamos',
   JSON.stringify({t:trilha.titulo, p:trilha.primeiro}));
ok('16 a trilha mostra só as etapas visíveis, com a atual em andamento',
   trilha.etapas.join(' | ') === 'Cadastro na plataforma=concluido | Diagnóstico=andamento',
   JSON.stringify(trilha.etapas));
ok('17 o contador conta as concluídas sobre as visíveis',
   trilha.contador === '1 de 2', trilha.contador);

const semInterna = await page.evaluate(()=>
  (document.querySelector('#v-portal .mgj-bloco')||{}).textContent || '');
ok('18 nada de etapa interna na página do cliente',
   !/Client Intelligence|Pré-Kickoff|CAP/.test(semInterna), semInterna.slice(0,140));

const naoConfigura = await page.evaluate(()=>mgJornadaPodeConfigurar());
ok('19 o cliente não configura jornada', naoConfigura === false, String(naoConfigura));

await browser.close(); srv.close();
const larg = Math.max(...res.map(r=>r.t.length));
console.log('');
res.forEach(r=>console.log(` ${r.r==='PASSOU'?'✓':'✗'} ${r.t.padEnd(larg)}  ${r.r}${r.r==='FALHOU'?'\n     '+r.d:''}`));
const n = res.filter(r=>r.r==='PASSOU').length;
console.log(`\n ${n}/${res.length} passaram | erros de JS: ${erros.length}`);
erros.slice(0,8).forEach(e=>console.log('   ' + e.slice(0,200)));
process.exit(n===res.length && !erros.length ? 0 : 1);
