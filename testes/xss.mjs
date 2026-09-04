import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const ATAQUE = "Maria D'Ávila\");window.__hack=1;(\"";
const AVATAR = "x\" onerror=\"window.__hack2=1\" data-=\"";
const SP = process.env.SP || new URL('.', import.meta.url).pathname;
let stub = fs.readFileSync(SP + '/stub.js','utf8');
stub = stub.replace("nome:'Elias Braga'", "nome:"+JSON.stringify(ATAQUE))
           .replace("{id:UCLI, nome:'Flavia Marcos', role:'client', client_id:CID, avatar_url:null",
                    "{id:UCLI, nome:'Flavia Marcos', role:'client', client_id:CID, avatar_url:"+JSON.stringify(AVATAR));
// e uma demanda com responsável hostil e título hostil
stub = stub.replace(/assignees:\[[^\]]*\]/, 'assignees:['+JSON.stringify(ATAQUE)+']');

const arq = process.argv[2];
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage();
const erros=[]; p.on('pageerror',e=>erros.push(e.message));
await p.route('**/*', async r=>{
  const u=r.request().url();
  if(u.includes('supabase-js')) return r.fulfill({contentType:'application/javascript', body:stub});
  if(u.startsWith('file://')) return r.continue();
  return r.fulfill({status:200, contentType:'text/plain', body:''});
});
await p.goto('file://'+arq, {waitUntil:'domcontentloaded'});
await p.waitForTimeout(2500);
const out = {};
for(const v of ['tasks','equipe','chat','clientes','home']){
  await p.evaluate(t=>{ try{showView(t)}catch(e){} }, v);
  await p.waitForTimeout(400);
  // clica em tudo que for clicável dentro da view, sem navegar de verdade
  out[v] = await p.evaluate(()=>{
    const alvo=document.querySelector('.content > .view.on'); if(!alvo) return {n:0};
    const bts=[...alvo.querySelectorAll('[onclick]')].slice(0,60);
    let disparados=0;
    for(const b of bts){ try{ b.dispatchEvent(new MouseEvent('click',{bubbles:false})); disparados++ }catch(e){} }
    return {n:disparados};
  });
}
const r = await p.evaluate(()=>({
  injecaoRodou: !!window.__hack, avatarRodou: !!window.__hack2,
  nomeVisivel: document.body.innerText.includes("Maria D'Ávila"),
  imgsQuebradas: [...document.querySelectorAll('img')].filter(i=>!i.getAttribute('src')).length,
}));
console.log(JSON.stringify({...r, handlersDisparados:out, errosJS:[...new Set(erros)].slice(0,4)}, null, 1));
await b.close();
