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

/* ---- 20c. janela da plataforma no lugar do diálogo do navegador ---- */
const semNativo = await page.evaluate(()=>{
  /* se algum caminho ainda chamar prompt/confirm, o teste percebe */
  window.__nativo = 0;
  window.prompt = () => { window.__nativo++; return null };
  window.confirm = () => { window.__nativo++; return false };
  return true;
});
await page.evaluate(()=>{ MGChat.novoCanalEquipe() });   /* sem await: a janela só resolve no clique */
await page.waitForTimeout(500);
const jan = await page.evaluate(()=>{
  const j=document.querySelector('.mgj-fundo'); if(!j) return null;
  return {abriu:true, titulo:(j.querySelector('h3')||{}).textContent,
          campos:[...j.querySelectorAll('.mgj-campo')].map(c=>c.dataset.campo),
          icones:j.querySelectorAll('.mgj-icones button').length,
          cores:j.querySelectorAll('.mgj-cores button').length,
          gente:j.querySelectorAll('.mgj-gente .p').length,
          nativoChamado:window.__nativo};
});
ok('20c janela da plataforma, sem diálogo do navegador',
   jan && jan.abriu && jan.nativoChamado === 0
   && jan.campos.join(',') === 'nome,icone,cor,descricao,membros'
   && jan.icones > 8 && jan.cores > 4 && jan.gente >= 2, JSON.stringify(jan));

/* ---- 20d. criar canal personalizado de verdade ---- */
const canalNovo = await page.evaluate(async ()=>{
  const j=document.querySelector('.mgj-fundo');
  j.querySelector('[data-campo="nome"] input').value = 'plano-de-midia';
  j.querySelector('[data-campo="icone"] button[data-v="🎯"]').click();
  j.querySelector('[data-campo="cor"] button').click();
  j.querySelector('[data-campo="descricao"] textarea').value = 'onde combinamos o plano';
  const antes = CHANNELS.length;
  j.querySelector('[data-ok]').click();
  await new Promise(r=>setTimeout(r,900));
  const c = CHANNELS.find(x=>x.nome==='plano-de-midia');
  return {antes, depois:CHANNELS.length, achou:!!c,
          icone:c&&c.icone, cor:!!(c&&c.cor), desc:c&&c.descricao,
          fechou:!document.querySelector('.mgj-fundo'), aberto:CHAN===(c&&c.id)};
});
ok('20d canal criado com ícone, cor e descrição',
   canalNovo.achou && canalNovo.depois === canalNovo.antes+1 && canalNovo.icone === '🎯'
   && canalNovo.cor && canalNovo.desc === 'onde combinamos o plano'
   && canalNovo.fechou && canalNovo.aberto, JSON.stringify(canalNovo));

/* ---- 20e. validação mostra o erro no campo, não em alerta ---- */
await page.evaluate(()=>{ MGChat.novoCanalEquipe() });   /* sem await: a janela só resolve no clique */
await page.waitForTimeout(400);
const val = await page.evaluate(async ()=>{
  const j=document.querySelector('.mgj-fundo');
  j.querySelector('[data-ok]').click();
  await new Promise(r=>setTimeout(r,200));
  const c=j.querySelector('[data-campo="nome"]');
  const r={ruim:c.classList.contains('ruim'),
           msg:(c.querySelector('.erro')||{}).textContent,
           aindaAberta:!!document.querySelector('.mgj-fundo')};
  document.querySelector('.mgj-fundo [data-fechar]').click();
  return r;
});
ok('20e validação no próprio campo', val.ruim && /nome/i.test(val.msg||'') && val.aindaAberta,
   JSON.stringify(val));

/* ---- 20f. aba de conversas diretas com prévia ---- */
await page.evaluate(()=>{ MGChat.trocarAba('diretas') });
await page.waitForTimeout(700);
const diretas = await page.evaluate(()=>{
  const l=[...document.querySelectorAll('.mgz-side .mgz-md')];
  const comPrevia=l.filter(b=>b.querySelector('.pv') && b.querySelector('.pv').textContent.trim());
  return {abas:document.querySelectorAll('.mgz-abas button').length,
          ativa:(document.querySelector('.mgz-abas button.on')||{}).textContent,
          itens:l.length, comPrevia:comPrevia.length,
          temHora:!!document.querySelector('.mgz-md .hr'),
          temFiltro:!!document.querySelector('.mgz-filtro button')};
});
ok('20f aba de diretas com prévia e horário',
   diretas.abas === 2 && /Diretas/.test(diretas.ativa||'') && diretas.itens >= 1
   && diretas.comPrevia >= 1 && diretas.temHora && diretas.temFiltro, JSON.stringify(diretas));

/* ---- 20g. conversa em grupo ---- */
const grupo = await page.evaluate(async ()=>{
  MGChat.novaConversa();                       /* sem await, pelo mesmo motivo */
  await new Promise(r=>setTimeout(r,400));
  const j=document.querySelector('.mgj-fundo');
  const ps=[...j.querySelectorAll('.mgj-gente .p')];
  ps[0].click(); if(ps[1]) ps[1].click();
  const antes=CHANNELS.length;
  j.querySelector('[data-ok]').click();
  await new Promise(r=>setTimeout(r,900));
  const c=CHANNELS.find(x=>x.id===CHAN);
  return {antes, depois:CHANNELS.length, tipo:c&&c.tipo,
          membros:Object.keys(CH_MEMBROS[CHAN]||{}).length,
          pilha:!!document.querySelector('.mgz-topo .mgz-pilha')};
});
ok('20g conversa em grupo', grupo.depois === grupo.antes+1 && grupo.tipo === 'dm'
   && grupo.membros >= 3, JSON.stringify(grupo));
await page.evaluate(()=>MGChat.trocarAba('tudo'));
await page.waitForTimeout(400);

/* ---- 20h. mensagens alinhadas na mesma coluna ---- */
await page.evaluate(()=>MGChat.abrir('ch-2'));
await page.waitForTimeout(700);
const alinha = await page.evaluate(async ()=>{
  for(const t of ['primeira','segunda','terceira']){
    const ta=document.getElementById('mgz-in'); ta.value=t; MGChat.digitou(ta,'');
    await MGChat.enviar(); await new Promise(r=>setTimeout(r,450));
  }
  const ms=[...document.querySelectorAll('#mgz-msgs .mgz-m')].slice(-3);
  const x = ms.map(m=>Math.round(m.querySelector('.tx').getBoundingClientRect().left));
  const horaLat = ms.map(m=>{const h=m.querySelector('.hora-lat');
    return h?Math.round(getComputedStyle(h).opacity*100):null});
  const tamHora = (()=>{const h=document.querySelector('#mgz-msgs .mgz-m .hora');
    return h?parseFloat(getComputedStyle(h).fontSize):null})();
  return {esquerdas:x, iguais:new Set(x).size === 1, horaLat, tamHora,
          seguiu:ms.filter(m=>m.classList.contains('segue')).length};
});
ok('20h mensagens na mesma coluna', alinha.iguais && alinha.seguiu >= 1
   && alinha.horaLat.every(o=>o===0) && alinha.tamHora <= 11,
   JSON.stringify(alinha));

/* ---- 20i. painel de Reports no canal de cliente ---- */
await page.evaluate(()=>MGChat.abrir('ch-1'));
await page.waitForTimeout(600);
await page.evaluate(()=>MGChat.alternarReports());
await page.waitForTimeout(500);
const rep = await page.evaluate(()=>{
  const r=document.querySelector('.mgz-rep'); if(!r) return null;
  return {abriu:true, titulo:(r.querySelector('.rep-topo b')||{}).textContent,
          secoes:[...r.querySelectorAll('h4')].map(h=>h.textContent.split('·')[0].trim()),
          nota:!!r.querySelector('.rep-nota'),
          classe:document.body.classList.contains('mgz-reports-on')};
});
ok('20i painel de Reports', rep && rep.abriu && rep.secoes.length === 2 && rep.nota && rep.classe,
   JSON.stringify(rep));
await page.evaluate(()=>MGChat.alternarReports());

/* ---- 20j. mensagem sem reação não mostra bolinha vazia ---- */
await page.evaluate(()=>MGChat.abrir('ch-2'));
await page.waitForTimeout(600);
const rea = await page.evaluate(async ()=>{
  const ta=document.getElementById('mgz-in'); ta.value='sem reacao'; MGChat.digitou(ta,'');
  await MGChat.enviar(); await new Promise(x=>setTimeout(x,500));
  const m=[...document.querySelectorAll('#mgz-msgs .mgz-m')].pop();
  const antes={bolinha:!!m.querySelector('.mgz-rea.add'), linha:!!m.querySelector('.mgz-reacoes'),
               naRegua:!!m.querySelector('.mgz-acoes button[title="Reagir"]')};
  const id=m.dataset.id;
  await MGChat.reagir(id,'👍'); await new Promise(x=>setTimeout(x,400));
  const m2=[...document.querySelectorAll('#mgz-msgs .mgz-m')].find(x=>x.dataset.id===id);
  return {...antes, depois:(m2.querySelector('.mgz-rea')||{}).textContent};
});
ok('20j sem bolinha vazia, reagir pela régua', !rea.bolinha && !rea.linha
   && rea.naRegua && /👍/.test(rea.depois||''), JSON.stringify(rea));

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
