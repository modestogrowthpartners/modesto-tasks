/* Visão do cliente: uma página só.
   Entra como Flavia Marcos, que é cliente da Cliente Um, e confere que
   ela vê o que é dela e não vê o que é da equipe. */
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
const page = await ctx.newPage();
page.on('pageerror', e=>erros.push('PAGEERROR: '+e.message));
page.on('console', m=>{ if(m.type()==='error') erros.push('CONSOLE: '+m.text()) });
await page.route('**/*', async r=>{
  const u = r.request().url();
  if(u.includes('supabase-js')) return r.fulfill({contentType:'application/javascript', body:stub});
  if(u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200, contentType:'text/plain', body:''});
});
await page.goto(BASE, {waitUntil:'domcontentloaded'});
await page.evaluate(()=>{ localStorage.setItem('__COMO','cliente');
  localStorage.removeItem('__stub_messages'); localStorage.removeItem('__stub_channels') });
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(3200);
await page.evaluate(()=>{ document.querySelectorAll('button').forEach(b=>{
  const t=b.textContent.trim(); if(t==='Pular'||t==='✕') b.click() }) });
await page.waitForTimeout(900);

const res=[];
const ok=(n,c,d='')=>res.push({t:n, r:c?'PASSOU':'FALHOU', d:String(d).slice(0,170)});

/* ---- 1. entrou como cliente ---- */
const eu = await page.evaluate(()=>ME ? {nome:ME.name, admin:isAdmin(), empresa:ME.client_id} : null);
ok('1  entra como cliente da empresa', eu && !eu.admin && eu.empresa === 'c-1', JSON.stringify(eu));

/* ---- 2. cai direto no portal, sem passar pelo Kanban ---- */
const abriu = await page.evaluate(()=>({view:VIEW, naTela:!!document.querySelector('#v-portal.on')}));
ok('2  abre direto no portal', abriu.view === 'portal' && abriu.naTela, JSON.stringify(abriu));

/* ---- 3. a página tem os três blocos, nesta ordem ---- */
const blocos = await page.evaluate(()=>
  [...document.querySelectorAll('.mgp-bloco h2, .mgp-conversa .tx b')].map(h=>h.textContent.trim()));
ok('3  uma página com demandas, documentos e chat',
   JSON.stringify(blocos) === JSON.stringify(['Demandas em aberto','Documentos','MGP Chat']),
   JSON.stringify(blocos));

/* ---- 4. mostra as demandas em aberto da empresa dele ---- */
const dem = await page.evaluate(()=>({
  n: document.querySelectorAll('.mgp-dem').length,
  titulo: (document.querySelector('.mgp-dem .tx b')||{}).textContent,
  estado: (document.querySelector('.mgp-dem .est')||{}).textContent,
}));
ok('4  demandas em aberto da empresa', dem.n === 1 && dem.titulo === 'Demanda de teste'
   && dem.estado === 'Não iniciado', JSON.stringify(dem));

/* ---- 4b. demanda concluída não aparece ---- */
const semConcluida = await page.evaluate(async ()=>{
  const t = TASKS.find(x=>x.id==='t-1'); const antes = t.status;
  t.status = 'Concluído Atendimento'; renderPortal();
  const n = document.querySelectorAll('.mgp-dem').length;
  t.status = antes; renderPortal();
  return {n, voltou: document.querySelectorAll('.mgp-dem').length};
});
ok('4b demanda concluída sai da lista', semConcluida.n === 0 && semConcluida.voltou === 1,
   JSON.stringify(semConcluida));

/* ---- 4c. demanda de outra empresa nunca aparece ---- */
const soMinha = await page.evaluate(async ()=>{
  TASKS.push({id:'t-outra', client_id:'c-outra', title:'Demanda de outro cliente',
    status:'Não iniciado', archived:false, due:null, description:''});
  renderPortal();
  const txt = document.querySelector('#v-portal').textContent;
  TASKS.pop(); renderPortal();
  return !/outro cliente/i.test(txt);
});
ok('4c demanda de outra empresa não aparece', soMinha);

/* ---- 5. documentos da empresa dele ---- */
const doc = await page.evaluate(()=>({
  n: document.querySelectorAll('.mgp-doc').length,
  titulo: (document.querySelector('.mgp-doc .tx b')||{}).textContent,
}));
ok('5  documentos da empresa', doc.n === 1 && doc.titulo === 'Doc Teste', JSON.stringify(doc));

/* ---- 6. barra de baixo do cliente: dois destinos, sem Kronos ---- */
const dock = await page.evaluate(()=>{
  if(typeof mgDock === 'function') mgDock();
  const d = document.getElementById('mg-dock');
  const itens = [...d.querySelectorAll('#mg-dock-itens button')].map(b=>b.textContent.trim());
  return {itens,
          navegacao: itens.filter(t=>!/^🔔/.test(t)),
          sino: itens.some(t=>/^🔔/.test(t)),
          kronos: !!document.getElementById('mg-kronos-b'),
          menuDaEquipe: !!document.getElementById('mg-menu-b')};
});
ok('6  barra com Início, MGP Chat e sino, sem Kronos',
   dock.navegacao.length === 2 && /Início/.test(dock.navegacao[0]) && /MGP Chat/.test(dock.navegacao[1])
   && dock.sino && !dock.kronos && !dock.menuDaEquipe, JSON.stringify(dock));

/* ---- 7. o cliente não alcança as telas da equipe ---- */
const barrado = await page.evaluate(async ()=>{
  const fora = {};
  for(const v of ['tasks','clientes','equipe','dashboard','checklist','docs']){
    showView(v); await new Promise(r=>setTimeout(r,120));
    fora[v] = VIEW;
  }
  showView('portal');
  return fora;
});
ok('7  telas da equipe ficam fora do alcance',
   Object.values(barrado).every(v => v === 'portal' || v === 'chat'), JSON.stringify(barrado));

/* ---- 8. as abas do cliente são só portal e chat ---- */
const abas = await page.evaluate(()=>ABAS_DO_CLIENTE.slice());
ok('8  abas do cliente: portal e chat', JSON.stringify(abas) === JSON.stringify(['portal','chat']),
   JSON.stringify(abas));

/* ---- 9. o MGP Chat abre pelo botão da página ---- */
const chat = await page.evaluate(async ()=>{
  showView('portal'); await new Promise(r=>setTimeout(r,200));
  const b = [...document.querySelectorAll('.mgp-conversa button')].find(x=>/Abrir conversa/.test(x.textContent));
  if(!b) return {achou:false};
  b.click(); await new Promise(r=>setTimeout(r,1200));
  return {achou:true, view:VIEW, lateral:!!document.querySelector('.mgz-side'),
          conversas:[...document.querySelectorAll('.mgz-side .mgz-i')].length};
});
ok('9  o botão da página abre o MGP Chat',
   chat.achou && chat.view === 'chat' && chat.lateral && chat.conversas > 0, JSON.stringify(chat));

/* ---- 10. conta sem empresa ligada recebe aviso, não tela quebrada ---- */
const semEmpresa = await page.evaluate(async ()=>{
  const antes = ME.client_id; ME.client_id = null;
  showView('portal'); await new Promise(r=>setTimeout(r,300));
  const txt = document.querySelector('#v-portal').textContent;
  ME.client_id = antes; renderPortal();
  return {aviso:/não está ligada a uma empresa/.test(txt), voltou:!!document.querySelector('.mgp-dem')};
});
ok('10 conta sem empresa recebe aviso claro', semEmpresa.aviso && semEmpresa.voltou,
   JSON.stringify(semEmpresa));

/* ---- resultado ---- */
const larg = Math.max(...res.map(r=>r.t.length));
console.log('');
for(const r of res){
  console.log(' ' + (r.r==='PASSOU'?'✓':'✗') + ' ' + r.t.padEnd(larg) + '  ' + r.r
    + (r.r==='FALHOU' ? '   ' + r.d : ''));
}
const nOk = res.filter(r=>r.r==='PASSOU').length;
const limpos = [...new Set(erros)].filter(e=>!/favicon|ERR_|net::/.test(e));
console.log('\n ' + nOk + '/' + res.length + ' passaram | erros de JS: ' + limpos.length);
limpos.slice(0,6).forEach(e=>console.log('   ! '+e));
await browser.close(); srv.close();
