/* MGP UTM: a aba do gerador de UTM, só da equipe. Prova que o gerador
   portado calcula como a página solta calculava, que o QR nasce da URL
   final sem depender de CDN, e que nada dele vaza para o resto. */
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
const erros = []; const res = [];
const ok = (n,c,d='') => res.push({t:n, r:c?'PASSOU':'FALHOU', d:String(d).slice(0,200)});
const page = await ctx.newPage();
page.on('pageerror', e=>erros.push('PAGEERROR: '+e.message));
page.on('console', m=>{ if(m.type()==='error') erros.push('CONSOLE: '+m.text()) });
await page.route('**/*', async r=>{ const u=r.request().url();
  if(u.includes('supabase-js')) return r.fulfill({contentType:'application/javascript', body:stub});
  if(u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200, contentType:'text/plain', body:''}) });
async function entrar(como){
  await page.goto(BASE, {waitUntil:'domcontentloaded'});
  await page.evaluate(c=>{ if(c==='cliente') localStorage.setItem('__COMO','cliente'); else localStorage.removeItem('__COMO') }, como);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(3000);
  await page.evaluate(()=>{ document.querySelectorAll('button').forEach(b=>{ const t=b.textContent.trim(); if(t==='Pular'||t==='✕') b.click() }) });
  await page.waitForTimeout(600);
}
await entrar('admin');

const nav = await page.evaluate(()=>({ naNav: NAV.some(n=>n.v==='utm' && n.admin), naVitrine: mgAtalhos().some(a=>a.v==='utm'),
  noMenu: mgNavItens().some(x=>x.v==='utm') }));
ok('1 a aba MGP UTM entra no menu e na vitrine, marcada como da equipe', nav.naNav && nav.naVitrine && nav.noMenu, JSON.stringify(nav));

const abriu = await page.evaluate(async ()=>{ showView('utm'); await new Promise(r=>setTimeout(r,400));
  return {view:VIEW, naTela: !!document.querySelector('#v-utm.on'), titulo: document.getElementById('view-title').textContent,
          qrLib: typeof qrcode, idsSoltos: [...document.querySelectorAll('#v-utm [id]')].filter(e=>!e.id.startsWith('utm-')).length} });
ok('2 a aba abre, se identifica, traz a biblioteca de QR embutida e todo id tem prefixo',
   abriu.view==='utm' && abriu.naTela && abriu.titulo==='MGP UTM' && abriu.qrLib==='function' && abriu.idsSoltos===0, JSON.stringify(abriu));

const meta = await page.evaluate(()=>{ const $=id=>document.getElementById('utm-'+id);
  return {canal:$('canal').value, camp:$('campOut').textContent, param:$('mainOut').textContent,
          sets:[...$('setsOut').querySelectorAll('li span')].map(e=>e.textContent), ads:[...$('adsOut').querySelectorAll('li span')].map(e=>e.textContent)} });
ok('3 Meta é o padrão, e o nome da campanha sai no formato MGP_ORIGEM_OBJETIVO_UTIL',
   meta.canal==='meta' && meta.camp==='MGP_META_VENDAS_SEMANA-CLIENTE'
   && /utm_source=facebook&utm_medium=paid_social&utm_source_platform=\{\{site_source_name\}\}/.test(meta.param)
   && meta.sets[0]==='ALTO-TICKET_18-65_LAL' && meta.ads[0]==='V01_ANIMADO_VIDEO' && meta.ads[1]==='V02_ANIMADO_VIDEO' && meta.ads[2]==='V01_OFERTA-DIRETA_ESTATICO',
   JSON.stringify(meta).slice(0,200));

const combos = await page.evaluate(()=>{ const $=id=>document.getElementById('utm-'+id);
  $('url').value='https://www.cliente.com.br/oferta'; $('url').dispatchEvent(new Event('input'));
  const linhas=[...$('tbl').querySelectorAll('tbody tr')];
  return {n:linhas.length, primeira: linhas[0] ? linhas[0].querySelector('td.url').textContent : '', hint:$('urlHint').textContent} });
ok('4 com a URL, a tabela traz uma linha por conjunto × anúncio, com macro', combos.n===6 && /\?utm_source=facebook/.test(combos.primeira) && combos.hint==='OK.', JSON.stringify(combos).slice(0,200));

const flyer = await page.evaluate(async ()=>{ const $=id=>document.getElementById('utm-'+id);
  $('canal').value='flyer'; $('canal').dispatchEvent(new Event('change'));
  $('peca').value='flyer familia'; $('peca').dispatchEvent(new Event('input'));
  $('aamm').value='2609'; $('aamm').dispatchEvent(new Event('input'));
  await new Promise(r=>setTimeout(r,250));
  return {final:$('mainOut').textContent, content:$('contentOut').textContent, qrSvg: !!$('qr').querySelector('svg'),
          qrInfo:$('qrInfo').textContent, blocoPago: $('blkSets').hidden, blocoPeca: $('blkPeca').hidden, chars: $('mainHint').textContent} });
ok('5 flyer monta a URL final com utm_content e creative_format=qr, e o QR nasce dela',
   flyer.final==='https://www.cliente.com.br/oferta?utm_source=flyer&utm_medium=offline&utm_campaign=MGP_FLYER_VENDAS_SEMANA-CLIENTE&utm_content=FLYER-FAMILIA_A5_2609&utm_creative_format=qr'
   && flyer.content==='FLYER-FAMILIA_A5_2609' && flyer.qrSvg && /módulos/.test(flyer.qrInfo) && flyer.blocoPago && !flyer.blocoPeca && /171 caracteres/.test(flyer.chars),
   JSON.stringify(flyer).slice(0,200));

const lote = await page.evaluate(async ()=>{ const $=id=>document.getElementById('utm-'+id);
  $('lotClear').click(); $('lotAdd').click(); await new Promise(r=>setTimeout(r,100));
  return {linhas: $('lot').querySelectorAll('tbody tr').length, guardado: (JSON.parse(localStorage.getItem('mgp_lote')||'[]')).length} });
ok('6 o lote guarda a URL desta sessão e persiste no navegador', lote.linhas===1 && lote.guardado===1, JSON.stringify(lote));

const utmJa = await page.evaluate(()=>{ const $=id=>document.getElementById('utm-'+id);
  $('url').value='https://x.com/?utm_source=a'; $('url').dispatchEvent(new Event('input')); return {hint:$('urlHint').textContent, cls:$('urlHint').className} });
ok('7 URL que já tem UTM é recusada com aviso, em vez de duplicar parâmetro', /já tem UTM/.test(utmJa.hint) && /err/.test(utmJa.cls), JSON.stringify(utmJa));

const saiu = await page.evaluate(async ()=>{ showView('board'); await new Promise(r=>setTimeout(r,300));
  return {view:VIEW, utmSumiu: !document.querySelector('#v-utm.on'), boardNaTela: !!document.querySelector('#v-board.on')} });
ok('8 sair da aba devolve o quadro, sem deixar o gerador por cima', saiu.view==='board' && saiu.utmSumiu && saiu.boardNaTela, JSON.stringify(saiu));

await entrar('cliente');
const cli = await page.evaluate(()=>{ showView('utm'); return {view:VIEW, noMenu: mgNavItens().some(x=>x.v==='utm'), naVitrine: mgAtalhos().some(a=>a.v==='utm')} });
ok('9 o cliente não vê a aba e cai no portal se tentar', cli.view==='portal' && !cli.noMenu && !cli.naVitrine, JSON.stringify(cli));

await browser.close(); srv.close();
const larg = Math.max(...res.map(r=>r.t.length));
console.log('');
res.forEach(r=>console.log(` ${r.r==='PASSOU'?'✓':'✗'} ${r.t.padEnd(larg)}  ${r.r}${r.r==='FALHOU'?'\n     '+r.d:''}`));
const n = res.filter(r=>r.r==='PASSOU').length;
console.log(`\n ${n}/${res.length} passaram | erros de JS: ${erros.length}`);
erros.slice(0,8).forEach(e=>console.log('   ' + e.slice(0,200)));
process.exit(n===res.length && !erros.length ? 0 : 1);
