/* Jornada completa do MGP Chat e do Kronos.
   Serve por HTTP porque em file:// o Chromium desliga o localStorage,
   e sem ele o teste de persistência não valeria nada. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import http from 'http';
const SP = process.env.SP || new URL('.', import.meta.url).pathname;
const stub = fs.readFileSync(SP+'/stub.js','utf8');
const ARQ = process.argv[2] || new URL('../index.html', import.meta.url).pathname;
const html = fs.readFileSync(ARQ);
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); s.end(html) });
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const BASE = 'http://127.0.0.1:' + srv.address().port + '/';

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext();
const erros = [];
async function novaPagina(){
  const page = await ctx.newPage();
  page.on('pageerror', e=>erros.push('PAGEERROR: '+e.message));
  page.on('console', m=>{ if(m.type()==='error') erros.push('CONSOLE: '+m.text()) });
  await page.route('**/*', async r=>{
    const u=r.request().url();
    if(u.includes('supabase-js')) return r.fulfill({contentType:'application/javascript', body:stub});
    if(u.startsWith(BASE)) return r.continue();
    return r.fulfill({status:200, contentType:'text/plain', body:''});
  });
  await page.goto(BASE, {waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2400);
  return page;
}
const res=[];
const ok=(n,c,d='')=>res.push({t:n, r:c?'PASSOU':'FALHOU', d:String(d).slice(0,150)});
let page = await novaPagina();
const irChat = async () => { await page.evaluate(()=>showView('chat')); await page.waitForTimeout(800) };

/* ---- 1. autenticação e identidade ---- */
const eu = await page.evaluate(()=>{const u=MGU.eu();return u?{id:u.id,nome:u.nome,avatar:!!u.avatar}:null});
ok('1  autenticação e identidade', eu && eu.id==='u-admin' && eu.nome==='Vinícius Reis' && eu.avatar, JSON.stringify(eu));

/* ---- 2. o chat ocupa a tela toda ---- */
await irChat();
const cheio = await page.evaluate(()=>{
  const v=document.querySelector('#v-chat.on'); if(!v) return null;
  const r=v.getBoundingClientRect();
  return {larguraTela:Math.round(r.width), janela:window.innerWidth,
          alturaTela:Math.round(r.height), janelaAlt:window.innerHeight,
          semTrilha:!document.querySelector('.mgz-rail'),
          semRolagemH:document.documentElement.scrollWidth<=window.innerWidth+2};
});
ok('2  chat ocupa a tela toda', cheio && cheio.semTrilha && cheio.semRolagemH
   && cheio.larguraTela >= cheio.janela - 2
   && cheio.alturaTela >= cheio.janelaAlt * 0.8, JSON.stringify(cheio));

/* ---- 2b. a barra de baixo não cobre a caixa de escrita ---- */
const barra = await page.evaluate(()=>{
  document.body.classList.add('mg-com-dock');
  const d=document.querySelector('.mg-dock'); if(!d) return null;
  /* o dublê não liga a barra; forçamos para medir o caso real */
  d.style.setProperty('display','inline-flex','important');
  if(window.MGChat) try{ MGChat.desenhar() }catch(e){}
  const caixa=document.querySelector('.mgz-main .mgz-caixa');
  const dica=document.getElementById('mgz-dica');
  const cruza=(a,z)=>!(a.bottom<=z.top||a.top>=z.bottom||a.right<=z.left||a.left>=z.right);
  const D=d.getBoundingClientRect(), C=caixa.getBoundingClientRect();
  const r={sobreCaixa:cruza(D,C), sobreDica:dica?cruza(D,dica.getBoundingClientRect()):false,
           folga:Math.round(D.top-C.bottom), botoes:d.querySelectorAll('button').length};
  d.style.removeProperty('display');
  document.body.classList.remove('mg-com-dock');
  return r;
});
ok('2b barra de baixo não cobre a caixa', barra && !barra.sobreCaixa && !barra.sobreDica
   && barra.folga > 0, JSON.stringify(barra));

/* ---- 3. busca de membro e conversa direta ---- */
const achou = await page.evaluate(()=>MGU.buscar('elias').map(u=>u.nome));
await page.evaluate(()=>MGChat.abrirDireta('u-colega'));
await page.waitForTimeout(800);
const conversa = await page.evaluate(()=>({
  canal:CHAN, titulo:(document.querySelector('#v-chat .mgz-topo .nmc')||{}).textContent,
  avatarNoTopo:!!document.querySelector('#v-chat .mgz-topo .mgu-av')}));
ok('3  busca e conversa direta', achou.length===1 && conversa.canal && conversa.titulo==='Elias Braga'
   && conversa.avatarNoTopo, JSON.stringify(conversa));

/* ---- 4. conversa não duplica ---- */
const antes = await page.evaluate(()=>CHANNELS.filter(c=>c.tipo==='dm').length);
await page.evaluate(()=>MGChat.abrirDireta('u-colega'));
await page.waitForTimeout(500);
const depois = await page.evaluate(()=>CHANNELS.filter(c=>c.tipo==='dm').length);
ok('4  não duplica conversa', antes===depois, antes+' -> '+depois);

/* ---- 5. enviar mensagem ---- */
await page.evaluate(()=>{const t=document.getElementById('mgz-in');t.value='mensagem raiz do teste';MGChat.digitou(t,'')});
await page.evaluate(()=>MGChat.enviar());
await page.waitForTimeout(900);
const enviada = await page.evaluate(()=>{
  const m=[...document.querySelectorAll('#mgz-msgs .mgz-m')].pop();
  return m?{txt:m.querySelector('.tx').textContent.trim(), quem:(m.querySelector('.quem')||{}).textContent,
            pendente:m.classList.contains('enviando')}:null});
ok('5  envio de mensagem', enviada && enviada.txt==='mensagem raiz do teste'
   && enviada.quem==='Vinícius Reis' && !enviada.pendente, JSON.stringify(enviada));

/* ---- 6. thread: Responder abre o painel da direita ---- */
const idRaiz = await page.evaluate(()=>{
  const m=[...document.querySelectorAll('#mgz-msgs .mgz-m')].pop(); return m?m.dataset.id:null});
await page.evaluate(id=>MGChat.abrirThread(id), idRaiz);
await page.waitForTimeout(800);
const th = await page.evaluate(()=>{
  const p=document.querySelector('#v-chat .mgz-th'); if(!p) return null;
  return {abriu:true, raizTexto:(p.querySelector('.mgz-th-raiz .tx')||{}).textContent.trim(),
          raizAutor:(p.querySelector('.mgz-th-raiz b')||{}).textContent,
          temCaixa:!!p.querySelector('#mgz-in-th'),
          conversaContinua:!!document.querySelector('#mgz-msgs'),
          classe:document.body.classList.contains('mgz-thread-on')}});
ok('6  thread abre à direita', th && th.abriu && th.raizTexto==='mensagem raiz do teste'
   && th.raizAutor==='Vinícius Reis' && th.temCaixa && th.conversaContinua && th.classe, JSON.stringify(th));

/* ---- 7. responder dentro da thread e persistir ---- */
await page.evaluate(()=>{const t=document.getElementById('mgz-in-th');t.value='resposta dentro da thread';MGChat.digitou(t,'th')});
await page.evaluate(()=>MGChat.enviarThread());
await page.waitForTimeout(900);
const resp = await page.evaluate(()=>{
  const p=document.querySelector('.mgz-th');
  const ms=[...p.querySelectorAll('.mgz-m')];
  const naConversa=[...document.querySelectorAll('#mgz-msgs .mgz-m .tx')].map(x=>x.textContent.trim());
  return {naThread:ms.map(m=>m.querySelector('.tx').textContent.trim()),
          fio:(document.querySelector('#mgz-msgs .mgz-fio')||{}).textContent||'',
          vazouNaConversa:naConversa.includes('resposta dentro da thread')}});
ok('7  resposta fica na thread', resp.naThread.includes('resposta dentro da thread')
   && !resp.vazouNaConversa && /1 resposta/.test(resp.fio), JSON.stringify(resp));

/* ---- 8. persistência depois de recarregar ---- */
const canalId = await page.evaluate(()=>CHAN);
await page.close(); page = await novaPagina();
await irChat();
await page.evaluate(id=>MGChat.abrir(id), canalId);
await page.waitForTimeout(1100);
const persist = await page.evaluate(()=>({
  conversa:[...document.querySelectorAll('#mgz-msgs .mgz-m .tx')].map(x=>x.textContent.trim()),
  fio:(document.querySelector('#mgz-msgs .mgz-fio')||{}).textContent||''}));
ok('8  persistência após recarregar', persist.conversa.includes('mensagem raiz do teste')
   && !persist.conversa.includes('resposta dentro da thread') && /1 resposta/.test(persist.fio),
   JSON.stringify(persist));

/* ---- 9. menu de comandos com a barra ---- */
await page.evaluate(()=>{const t=document.getElementById('mgz-in');t.value='/';MGChat.digitou(t,'')});
await page.waitForTimeout(320);
const menu = await page.evaluate(()=>{
  const m=document.getElementById('mgz-cmdmenu'); if(!m) return null;
  return {itens:[...m.querySelectorAll('button b')].map(b=>b.textContent), temSel:!!m.querySelector('.sel')}});
ok('9  menu de comandos', menu && menu.itens.length>=5 && menu.itens.includes('/demanda') && menu.temSel,
   JSON.stringify(menu&&menu.itens));

/* ---- 10. comando desconhecido não some em silêncio ---- */
await page.evaluate(()=>{const t=document.getElementById('mgz-in');t.value='/naoexiste';MGChat.digitou(t,'');return MGChat.enviar()});
await page.waitForTimeout(600);
const desconhecido = await page.evaluate(()=>{
  const m=[...document.querySelectorAll('#mgz-msgs .mgz-m.luq .tx')].pop();
  return m?m.textContent:'' });
ok('10 comando inválido avisa', /não existe/i.test(desconhecido), desconhecido);

/* ---- 11. comando local sem IA: /buscar ---- */
await page.evaluate(()=>{const t=document.getElementById('mgz-in');t.value='/buscar mensagem raiz';MGChat.digitou(t,'');return MGChat.enviar()});
await page.waitForTimeout(800);
const buscaRes = await page.evaluate(()=>({
  n:document.querySelectorAll('#mgz-msgs .mgz-busca-res .r').length,
  cab:(document.querySelector('#mgz-msgs .mgz-th-conta')||{}).textContent||''}));
ok('11 comando /buscar', buscaRes.n>=1 && /resultado/.test(buscaRes.cab), JSON.stringify(buscaRes));
await page.evaluate(()=>MGChat.limparBusca());
await page.waitForTimeout(300);

/* ---- 12. Kronos: painel abre e responde ---- */
await page.evaluate(()=>{window.__KRONOS_MODO='texto'; MGKronos.abrir()});
await page.waitForTimeout(400);
await page.evaluate(()=>MGKronos.perguntar('quais demandas estão em aberto?'));
await page.waitForTimeout(900);
const luq = await page.evaluate(()=>{
  const p=document.querySelector('.mgk-painel.on'); if(!p) return null;
  return {bolhas:[...p.querySelectorAll('.mgk-b')].map(b=>b.textContent.trim()),
          passos:[...p.querySelectorAll('.mgk-passos span')].map(s=>s.textContent),
          pensando:!!p.querySelector('.mgk-pensa')}});
ok('12 Kronos responde', luq && luq.bolhas.length===2 && /1 em aberto/.test(luq.bolhas[1])
   && luq.passos.length===1 && !luq.pensando, JSON.stringify(luq&&luq.bolhas));

/* ---- 13. comando com IA propõe e pede confirmação ---- */
await page.evaluate(()=>{window.__KRONOS_MODO='confirmar'; MGKronos.fechar()});
await page.evaluate(()=>{const t=document.getElementById('mgz-in');
  t.value='/demanda revisar os criativos da campanha';MGChat.digitou(t,'');return MGChat.enviar()});
await page.waitForTimeout(900);
const proposta = await page.evaluate(()=>{
  const c=[...document.querySelectorAll('#mgz-msgs .mgz-m.luq')].pop(); if(!c) return null;
  return {titulo:(c.querySelector('.mgz-th-raiz b')||{}).textContent,
          campos:[...c.querySelectorAll('.mgz-th-raiz .tx')].map(x=>x.textContent.trim()),
          temConfirmar:!!c.querySelector('.btn-p'),
          demandasAntes:window.__FIX.tasks.length}});
ok('13 comando propõe e pede confirmação', proposta && proposta.titulo==='Criar demanda'
   && proposta.campos.length===3 && proposta.temConfirmar, JSON.stringify(proposta));

/* ---- 14. confirmar cria o registro de verdade ---- */
const nAntes = await page.evaluate(()=>window.__FIX.tasks.length);
await page.evaluate(()=>{document.querySelector('#mgz-msgs .mgz-m.luq .btn-p').click()});
await page.waitForTimeout(900);
const criou = await page.evaluate(()=>({
  n:window.__FIX.tasks.length,
  cartao:(()=>{const c=[...document.querySelectorAll('#mgz-msgs .mgz-m.luq')].pop();
    return c?c.textContent:''})()}));
ok('14 confirmação cria no banco', criou.n===nAntes+1 && /executado/i.test(criou.cartao),
   'tasks '+nAntes+' -> '+criou.n);

/* ---- 15. falha na execução não é anunciada como sucesso ---- */
await page.evaluate(()=>{window.__KRONOS_MODO='confirmar'; window.__KRONOS_EXEC_FALHA=1; MGKronos.abrir()});
await page.evaluate(()=>MGKronos.perguntar('cria uma demanda para o Cliente Um'));
await page.waitForTimeout(800);
const nAntes2 = await page.evaluate(()=>window.__FIX.tasks.length);
await page.evaluate(()=>{document.querySelector('.mgk-painel .mgk-acao .bts button.ok').click()});
await page.waitForTimeout(800);
const falhou = await page.evaluate(()=>{
  const a=[...document.querySelectorAll('.mgk-painel .mgk-acao')].pop();
  return {classe:a?a.className:'', txt:a?a.textContent:'', n:window.__FIX.tasks.length}});
ok('15 falha não vira sucesso', falhou.classe.includes('falhou') && /não deu/.test(falhou.txt)
   && /Nada foi criado/.test(falhou.txt) && falhou.n===nAntes2, JSON.stringify(falhou).slice(0,140));

/* ---- 16. sem chave de IA: aviso claro, sem invenção ---- */
await page.evaluate(()=>{window.__KRONOS_MODO='sem_chave'; window.__KRONOS_EXEC_FALHA=0});
await page.evaluate(()=>MGKronos.perguntar('resuma minha semana'));
await page.waitForTimeout(700);
const semChave = await page.evaluate(()=>{
  const b=[...document.querySelectorAll('.mgk-painel .mgk-b')].pop();
  return {txt:b?b.textContent:'', erro:b?b.className.includes('erro'):false,
          bolhaRuim:document.querySelector('.mgk-bolha').className.includes('ruim')}});
ok('16 sem chave avisa e não inventa', semChave.erro && /ANTHROPIC_API_KEY/.test(semChave.txt)
   && semChave.bolhaRuim, semChave.txt);

/* ---- 17. comando que depende de IA é barrado com explicação ---- */
await page.evaluate(()=>MGKronos.fechar());
await page.evaluate(()=>{const t=document.getElementById('mgz-in');t.value='/resumo';MGChat.digitou(t,'');return MGChat.enviar()});
await page.waitForTimeout(600);
const barrado = await page.evaluate(()=>{
  const m=[...document.querySelectorAll('#mgz-msgs .mgz-m.luq .tx')].pop(); return m?m.textContent:''});
ok('17 comando de IA barrado com motivo', /depende do Kronos/.test(barrado) && /ANTHROPIC_API_KEY/.test(barrado), barrado);

/* ---- 18. @Kronos publica para todo mundo ---- */
await page.evaluate(()=>{window.__KRONOS_MODO='texto'});
const nMsgAntes = await page.evaluate(()=>window.__FIX.messages.length);
await page.evaluate(()=>{const t=document.getElementById('mgz-in');
  t.value='@Kronos resume essa conversa';MGChat.digitou(t,'');return MGChat.enviar()});
await page.waitForTimeout(1400);
const publicou = await page.evaluate(()=>({
  n:window.__FIX.messages.length,
  ultimas:window.__FIX.messages.slice(-2).map(m=>({kind:m.kind, autor:m.author_name})),
  naTela:[...document.querySelectorAll('#mgz-msgs .mgz-m .quem')].map(x=>x.textContent)}));
ok('18 @Kronos publica na conversa', publicou.n===nMsgAntes+2
   && publicou.ultimas[1].kind==='kronos' && publicou.naTela.includes('Kronos'),
   JSON.stringify(publicou.ultimas));

/* ---- 19. consistência da identidade em todos os lugares ---- */
await page.evaluate(()=>MGChat.alternarInfo());
await page.waitForTimeout(400);
const consist = await page.evaluate(()=>{
  const uids = new Set(); const nomes = new Set();
  document.querySelectorAll('#v-chat [data-uid="u-admin"]').forEach(el=>{
    uids.add(el.dataset.uid); nomes.add(el.getAttribute('title'));
  });
  const doMGU = MGU.get('u-admin');
  return {ocorrencias:document.querySelectorAll('#v-chat [data-uid="u-admin"]').length,
          nomesDistintos:[...nomes], nome:doMGU.nome, iniciais:doMGU.iniciais,
          quebradas:[...document.querySelectorAll('#v-chat img')].filter(i=>!i.getAttribute('src')).length}});
ok('19 identidade consistente', consist.ocorrencias>=3 && consist.nomesDistintos.length<=2
   && consist.nome==='Vinícius Reis' && consist.quebradas===0, JSON.stringify(consist));

/* ---- 19b. cartão de perfil na conversa direta ---- */
await page.evaluate(()=>MGChat.abrirDireta('u-colega'));
await page.waitForTimeout(700);
await page.evaluate(()=>MGChat.verPerfil('u-colega'));
await page.waitForTimeout(900);
const perfil = await page.evaluate(()=>{
  const p=document.querySelector('.mgz-perfil'); if(!p) return null;
  const dado = r => { const d=[...p.querySelectorAll('.dado')].find(x=>x.querySelector('span').textContent===r);
                      return d?d.querySelector('b').textContent.trim():null };
  return {nome:(p.querySelector('.ficha > b')||{}).textContent,
          faixa:!!p.querySelector('.faixa'), foto:!!p.querySelector('.foto .mgu-av'),
          desde:dado('Membro desde'), comum:dado('Canais em comum'),
          tag:(p.querySelector('.tag')||{}).textContent}});
ok('19b cartão de perfil com dado real', perfil && perfil.nome==='Elias Braga' && perfil.faixa
   && perfil.foto && /2025/.test(perfil.desde||'') && perfil.comum==='1' && perfil.tag==='Equipe Modesto',
   JSON.stringify(perfil));

/* ---- 20. navegação: sai do chat e volta ---- */
await page.evaluate(()=>showView('tasks')); await page.waitForTimeout(500);
const fora = await page.evaluate(()=>({
  chatEscondido:!document.querySelector('#v-chat.on'),
  luqVisivel:!!document.querySelector('.mgk-bolha'),
  corpo:document.body.className.includes('mg-e-chat')}));
await irChat();
const voltou = await page.evaluate(()=>({
  canal:CHAN, lateral:!!document.querySelector('.mgz-side'),
  eu:(document.querySelector('.mgz-eu .tx b')||{}).textContent}));
ok('20 navegação preserva estado', fora.chatEscondido && !fora.corpo && fora.luqVisivel
   && voltou.canal && voltou.lateral && voltou.eu==='Vinícius Reis',
   JSON.stringify({fora,voltou}));

/* ---- 20b. responsável da demanda resolvido pelo id ---- */
await page.evaluate(()=>showView('tasks'));
await page.waitForTimeout(700);
const resp2 = await page.evaluate(()=>{
  const b=document.querySelector('.card-t .mg-resp'); if(!b) return null;
  const avs=[...b.querySelectorAll('.mgu-av')].map(a=>({uid:a.dataset.uid,t:a.getAttribute('title')}));
  return {rotulo:(b.querySelector('.quem')||{}).textContent, avs,
          temEu:!!b.querySelector('.selo-eu')}});
ok('20b responsável vem do id', resp2 && resp2.avs[0].uid==='u-admin'
   && /Vinícius Reis/.test(resp2.avs[0].t) && resp2.temEu
   && resp2.avs.some(a=>a.uid==='nome:renato'), JSON.stringify(resp2));

/* ---- 21. responsivo ---- */
await page.setViewportSize({width:390,height:780}); await page.waitForTimeout(600);
const cel = await page.evaluate(()=>{
  const vis = s => { const e=document.querySelector(s); return !!e && getComputedStyle(e).display!=='none' };
  document.body.classList.add('mgz-conversa');
  const comConversa = {lateral:vis('.mgz-side'), conversa:vis('.mgz-main')};
  document.body.classList.remove('mgz-conversa');
  const semConversa = {lateral:vis('.mgz-side'), conversa:vis('.mgz-main')};
  return {comConversa, semConversa, semRolagem:document.documentElement.scrollWidth<=390+2}});
await page.setViewportSize({width:1440,height:900});
ok('21 responsivo no celular', cel.comConversa.conversa && !cel.comConversa.lateral
   && cel.semConversa.lateral && !cel.semConversa.conversa && cel.semRolagem,
   JSON.stringify(cel));

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
