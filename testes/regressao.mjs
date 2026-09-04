import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const SP = process.env.SP || new URL('.', import.meta.url).pathname;
const stub = fs.readFileSync(SP + '/stub.js','utf8');
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const erros = [];
page.on('pageerror', e => erros.push('PAGEERROR: '+e.message));
page.on('console', m => { if(m.type()==='error') erros.push('CONSOLE: '+m.text()); });
await page.route('**/*', async r => {
  const u = r.request().url();
  if(u.includes('supabase-js')) return r.fulfill({contentType:'application/javascript', body:stub});
  if(u.startsWith('file://')) return r.continue();
  return r.fulfill({status:200, contentType:'text/plain', body:''});
});
await page.goto('file://' + process.argv[2], {waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);

const telas = ['home','tasks','list','calendar','checklist','projetos','clientes','equipe',
               'docs','chat','briefing','minhas','dashboard','settings'];
const snap = {};
for(const v of telas){
  await page.evaluate(t=>{ try{ showView(t) }catch(e){ console.error('showView '+t+': '+e.message) } }, v);
  await page.waitForTimeout(360);
  snap[v] = await page.evaluate(()=>{
    const alvo = document.querySelector('.content > .view.on');
    return { view: typeof VIEW!=='undefined'?VIEW:'?',
             id: alvo ? alvo.id : null,
             len: alvo ? alvo.innerHTML.length : 0,
             titulo: (document.getElementById('view-title')||{}).textContent||'',
             classes: [...document.body.classList].sort().join(' '),
             dock: (document.getElementById('mg-dock-itens')||{}).innerHTML?.length||0 };
  });
}
snap['_atalhos'] = await page.evaluate(()=>{
  try { return mgAtalhos().map(a=>a.v+':'+(a.ds||'').slice(0,28)).join('|') } catch(e){ return 'ERRO '+e.message }
});
snap['_erros'] = [...new Set(erros)];
console.log(JSON.stringify(snap, null, 1));
await browser.close();
