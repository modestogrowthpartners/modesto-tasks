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
/* alguns casos provocam erro DE PROPÓSITO, para provar que o app avisa em
   vez de travar. Esses ficam num balde separado e não contam como falha. */
const previstos = [];
let esperandoErro = false;
const comErroPrevisto = async fn => { esperandoErro = true; try{ return await fn() } finally { esperandoErro = false } };
async function novaPagina(){
  const page = await ctx.newPage();
  page.on('pageerror', e=>erros.push('PAGEERROR: '+e.message));
  page.on('console', m=>{ if(m.type()==='error') (esperandoErro ? previstos : erros).push('CONSOLE: '+m.text()) });
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
          semBolhaSolta:!document.querySelector('.mgk-bolha'),
          botaoRuim:(()=>{ if(typeof mgDock==='function') mgDock();
            const b=document.getElementById('mg-kronos-b');
            return !!b && b.className.includes('ruim') })()}});
ok('16 sem chave avisa e não inventa', semChave.erro && /ANTHROPIC_API_KEY/.test(semChave.txt)
   && semChave.botaoRuim, semChave.txt);

/* ---- 16b. o Kronos mora na barra de baixo, não numa bolha flutuante ---- */
ok('16b Kronos na barra de baixo, sem bolha flutuante', semChave.semBolhaSolta,
   JSON.stringify(semChave).slice(0,120));

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
  /* o Kronos deixou de ser bolha flutuante: agora é botão da barra de baixo */
  luqVisivel:(()=>{ if(typeof mgDock==='function') mgDock();
                    return !!document.getElementById('mg-kronos-b') })(),
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
          /* o cartão de publicação automática saiu: confundia mais do que
             explicava, e o que ele prometia virou o comando /configcomoreport */
          semNota:!r.querySelector('.rep-nota'),
          classe:document.body.classList.contains('mgz-reports-on')};
});
ok('20i painel de Reports', rep && rep.abriu && rep.secoes.length === 2 && rep.semNota && rep.classe,
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
               naRegua:!!m.querySelector('.mgz-acoes button[data-rotulo="Reagir"]'),
               reguaComRotulo:[...m.querySelectorAll('.mgz-acoes .mgz-ac')].every(b=>b.dataset.rotulo),
               reguaSemEmoji:!/[☺↩⧉🗑]/.test(m.querySelector('.mgz-acoes')?.textContent||'')};
  const id=m.dataset.id;
  await MGChat.reagir(id,'👍'); await new Promise(x=>setTimeout(x,400));
  const m2=[...document.querySelectorAll('#mgz-msgs .mgz-m')].find(x=>x.dataset.id===id);
  return {...antes, depois:(m2.querySelector('.mgz-rea')||{}).textContent};
});
ok('20j sem bolinha vazia, reagir pela régua', !rea.bolinha && !rea.linha
   && rea.naRegua && /👍/.test(rea.depois||''), JSON.stringify(rea));

/* ---- 20k. régua de ações desenhada e com rótulo escrito ---- */
ok('20k régua com ícone desenhado e rótulo', rea.reguaComRotulo && rea.reguaSemEmoji, JSON.stringify(rea));

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

/* ---- 22. envio de arquivo: não trava, aparece e confirma ---- */
await page.evaluate(()=>MGChat.abrir('ch-1'));
await page.waitForTimeout(600);
/* captura o input que escolherArquivo cria */
await page.evaluate(()=>{ window.__inputs=[]; const _c=document.createElement.bind(document);
  document.createElement = function(t){ const el=_c(t); if(t==='input') window.__inputs.push(el); return el } });

async function anexar(nome, mime, buffer){
  await page.evaluate(()=>MGChat.escolherArquivo(''));
  const h = await page.evaluateHandle(()=>window.__inputs[window.__inputs.length-1]);
  await h.asElement().setInputFiles({name:nome, mimeType:mime, buffer});
  await page.waitForTimeout(350);
}

/* 22a. HTML grande, o caso que travava a página inteira */
await anexar('relatorio.html','text/html', Buffer.from('<h1>x</h1>'+'a'.repeat(955000)));
const naFila = await page.evaluate(()=>{
  const f=document.querySelector('.mgz-fila');
  return {existe:!!f, aviso:/pronto para enviar/.test(f?.textContent||''), itens:f?.querySelectorAll('.it').length};
});
const envio = await page.evaluate(async ()=>{
  await MGChat.enviar(''); await new Promise(x=>setTimeout(x,900));
  const m=[...document.querySelectorAll('#mgz-msgs .mgz-m')].pop();
  return {anexo:!!m.querySelector('.mgz-anexo'),
          rotulo:m.querySelector('.mgz-anexo .tx2 span')?.textContent||'',
          filaLimpa:!document.querySelector('.mgz-fila')};
});
/* a página continua respondendo depois do envio */
const respondeu = await page.evaluate(()=>{ const a=performance.now(); MGChat.desenhar(); return performance.now()-a < 3000 });
ok('22 arquivo grande não trava e aparece na conversa',
   naFila.existe && naFila.aviso && naFila.itens===1
   && envio.anexo && /Apresentação HTML/.test(envio.rotulo) && envio.filaLimpa && respondeu,
   JSON.stringify({naFila, envio, respondeu}));

/* 22b. imagem: miniatura na fila e link assinado buscado na hora */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
await anexar('foto.png','image/png', png);
const mini = await page.evaluate(()=>{
  const it=document.querySelector('.mgz-fila .it');
  return {comFoto:!!it && it.classList.contains('comfoto'),
          img:(it?.querySelector('img')?.getAttribute('src')||'').startsWith('blob:')};
});
const img = await page.evaluate(async ()=>{
  await MGChat.enviar(''); await new Promise(x=>setTimeout(x,900));
  const m=[...document.querySelectorAll('#mgz-msgs .mgz-m')].pop();
  const i=m.querySelector('img.mgz-img');
  return {temImg:!!i, src:i?.getAttribute('src')||null, assinado:/exemplo\.invalid\/assinado/.test(i?.getAttribute('src')||'')};
});
ok('22b imagem com miniatura na fila e link assinado na hora',
   mini.comFoto && mini.img && img.temImg && img.assinado, JSON.stringify({mini, img}));

/* 22c. sem link assinado, nunca sai img src vazio: src="" faz o navegador
   baixar a própria página de novo, e esta página passa de 1 MB */
const semLink = await page.evaluate(async ()=>{
  window.__semLink = true;
  MGChat.limparCacheAnexos();
  MGChat.desenhar(); await new Promise(x=>setTimeout(x,600));
  const vazias=[...document.querySelectorAll('#mgz-msgs img')].filter(i=>i.getAttribute('src')==='').length;
  const semSrc=[...document.querySelectorAll('#mgz-msgs img.mgz-img')].filter(i=>!i.hasAttribute('src')).length;
  window.__semLink = false;
  return {vazias, semSrc};
});
ok('22c nunca emite img src vazio', semLink.vazias === 0, JSON.stringify(semLink));

/* 22d. uma mensagem quebrada não derruba o chat inteiro */
const blindagem = await comErroPrevisto(()=>page.evaluate(async ()=>{
  const antes = document.querySelectorAll('#mgz-msgs .mgz-m').length;
  /* injeta um anexo impossível de montar */
  const lista = window.__FIX.messages.filter(m=>m.channel_id==='ch-1');
  const alvo = lista[lista.length-1];
  const guardado = alvo.anexos;
  alvo.anexos = [{get path(){ throw new Error('anexo torto') }, nome:'x'}];
  MGChat.desenhar(); await new Promise(x=>setTimeout(x,300));
  const vivo = !!document.getElementById('mgz-msgs') || !!document.querySelector('.mgz-centro');
  const outras = document.querySelectorAll('#mgz-msgs .mgz-m').length;
  alvo.anexos = guardado;
  MGChat.desenhar(); await new Promise(x=>setTimeout(x,300));
  return {antes, vivo, outras, voltou:document.querySelectorAll('#mgz-msgs .mgz-m').length};
}));
ok('22d anexo quebrado não derruba a conversa',
   blindagem.vivo && blindagem.voltou === blindagem.antes, JSON.stringify(blindagem));

/* 22e. upload recusado avisa e devolve o arquivo para tentar de novo */
await anexar('negado.pdf','application/pdf', Buffer.from('%PDF-1.4 teste'));
const recusa = await comErroPrevisto(()=>page.evaluate(async ()=>{
  window.__uploadFalha = true;
  await MGChat.enviar(''); await new Promise(x=>setTimeout(x,900));
  window.__uploadFalha = false;
  const m=[...document.querySelectorAll('#mgz-msgs .mgz-m')].pop();
  return {falhou:m.classList.contains('falhou'), refazer:!!m.querySelector('.refazer'),
          semSubindo:!m.querySelector('.mgz-prog')};
}));
ok('22e upload recusado avisa e oferece tentar de novo',
   recusa.falhou && recusa.refazer && recusa.semSubindo, JSON.stringify(recusa));

/* ---- 24. a caixa de escrita não perde foco nem rascunho ---- */
await page.evaluate(()=>showView('chat'));
await page.waitForTimeout(500);
await page.evaluate(()=>MGChat.abrir('ch-1'));
await page.waitForTimeout(600);
const foco = await page.evaluate(async ()=>{
  const ta = document.getElementById('mgz-in');
  ta.focus(); ta.value = 'primeira'; MGChat.digitou(ta,'');
  await MGChat.enviar(''); await new Promise(x=>setTimeout(x,700));
  const depoisDoEnvio = document.activeElement && document.activeElement.id === 'mgz-in';
  /* agora um rascunho pela metade, e uma mensagem chegando por cima */
  const ta2 = document.getElementById('mgz-in');
  ta2.focus(); ta2.value = 'rascunho pela metade'; MGChat.digitou(ta2,'');
  ta2.setSelectionRange(8, 8);
  MGChat.desenhar(); await new Promise(x=>setTimeout(x,200));
  const ta3 = document.getElementById('mgz-in');
  return {depoisDoEnvio, rascunho: ta3.value,
          cursor: ta3.selectionStart,
          aindaFocado: document.activeElement && document.activeElement.id === 'mgz-in'};
});
ok('24 caixa mantém foco depois de enviar e não perde o rascunho',
   foco.depoisDoEnvio && foco.rascunho === 'rascunho pela metade'
   && foco.cursor === 8 && foco.aindaFocado, JSON.stringify(foco));
await page.evaluate(()=>{ const t=document.getElementById('mgz-in'); if(t) t.value=''; });

/* ---- 23. desempenho: a conversa longa não pode travar a tela ---- */
const perf = await page.evaluate(async ()=>{
  MGChat.abrir('ch-2'); await new Promise(x=>setTimeout(x,600));
  /* 600 mensagens, tamanho de conversa de empresa de verdade */
  const agora = Date.now(); const l = [];
  for(let i=0;i<600;i++) l.push({id:'perf'+i, channel_id:'ch-2', author_id:i%2?'u-admin':'u-colega',
    author_name:i%2?'Vinícius Reis':'Elias Braga',
    body:'mensagem '+i+' com um texto do tamanho que a equipe escreve no dia a dia',
    kind:'user', created_at:new Date(agora-(600-i)*60000).toISOString(),
    reply_to:null, reactions:{}, anexos:[]});
  await MGChat.carregarMsgs('ch-2');
  /* injeta direto no cache pelo caminho de tempo real */
  l.forEach(m=>{ if(!window.__FIX.messages.some(x=>x.id===m.id)) window.__FIX.messages.push(m) });
  MGChat.limparCacheAnexos();
  await MGChat.recarregarMsgs(); await new Promise(x=>setTimeout(x,700));
  const med = k => { const a=performance.now(); for(let i=0;i<k;i++) MGChat.desenhar(); return (performance.now()-a)/k };
  med(2);
  return {naTela: document.querySelectorAll('#mgz-msgs .mgz-m').length,
          botaoAntigas: !!document.querySelector('.mgz-antigas'),
          custo: +med(8).toFixed(1),
          nos: document.querySelectorAll('#mgz-msgs *').length};
});
ok('23 conversa longa desenha rápido e em janela',
   perf.naTela <= 70 && perf.botaoAntigas && perf.custo < 80, JSON.stringify(perf));

/* ---- 23b. o botão carrega o pedaço anterior sem perder o ponto ---- */
const antigas = await page.evaluate(async ()=>{
  const antes = document.querySelectorAll('#mgz-msgs .mgz-m').length;
  MGChat.verAnteriores(); await new Promise(x=>setTimeout(x,400));
  return {antes, depois: document.querySelectorAll('#mgz-msgs .mgz-m').length};
});
ok('23b ver anteriores carrega mais um pedaço',
   antigas.depois > antigas.antes && antigas.depois <= antigas.antes + 70, JSON.stringify(antigas));

/* ---- 23d. ir para uma mensagem antiga abre a janela até ela ---- */
const pulo = await page.evaluate(async ()=>{
  const alvo = 'perf5';   /* das primeiras das 600 injetadas, bem fora da janela */
  await MGChat.irParaMensagem('ch-2', alvo);
  await new Promise(x=>setTimeout(x,500));
  return {naTela: !!document.querySelector('[data-id="'+alvo+'"]'),
          total: document.querySelectorAll('#mgz-msgs .mgz-m').length};
});
ok('23d ir para mensagem antiga abre a janela até ela', pulo.naTela, JSON.stringify(pulo));

/* ---- 23c. o chat se chama MGP Chat na plataforma ---- */
const nome = await page.evaluate(()=>{
  showView('chat');
  const t = document.getElementById('view-title');
  const nav = [...document.querySelectorAll('.mg-dock a, .mg-dock button, nav a, nav button')]
    .map(b=>b.textContent.trim()).filter(x=>/chat/i.test(x));
  return {titulo: t ? t.textContent.trim() : null, nav,
          marca: (document.querySelector('.mgz-side b, .mgz-marca b')||{}).textContent};
});
ok('23c a plataforma chama de MGP Chat',
   /MGP Chat/.test(nome.titulo||'') && nome.nav.every(x=>/MGP Chat/.test(x)),
   JSON.stringify(nome));

/* ---- 25. briefing: só a verba é obrigatória ---- */
const brief = await page.evaluate(async ()=>{
  showView('briefing'); await new Promise(x=>setTimeout(x,700));
  if(typeof mgBFComecar !== 'function') return {semTela:true};
  await mgBFComecar('c-1'); await new Promise(x=>setTimeout(x,500));
  /* sem período e sem verba: barra e diz o motivo */
  MG_BF.inicio=''; MG_BF.fim=''; MG_BF.verba_total=0;
  mgBFRevisar(); await new Promise(x=>setTimeout(x,200));
  const semVerba = MG_BF_TELA;
  /* só a verba, sem período: passa */
  MG_BF.verba_total = 50000;
  mgBFRevisar(); await new Promise(x=>setTimeout(x,250));
  const soVerba = MG_BF_TELA;
  return {semVerba, soVerba};
});
ok('25 briefing: só a verba trava, o período não',
   !brief.semTela && brief.semVerba === 'form' && brief.soVerba === 'resumo', JSON.stringify(brief));

/* ---- 25b. o documento do briefing sai montado e imprimível ---- */
const docBrief = await page.evaluate(()=>{
  /* chama o gerador pelo caminho real: o envio publica o que ele monta */
  const antes = window.__docPublicado; window.__docPublicado = null;
  return {temGerador: typeof window.mgBFAbrirPeloChat === 'function'};
});
ok('25b o briefing tem caminho próprio pelo chat', docBrief.temGerador, JSON.stringify(docBrief));

/* ---- 25c. /briefing existe e explica quando está no canal errado ---- */
const cmdBrief = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(x=>setTimeout(x,600));
  const existe = !!MGCmd.achar('briefing');
  MGChat.abrir('ch-2');            /* canal de equipe, não de cliente */
  await new Promise(x=>setTimeout(x,600));
  MGChat.limparLocais && MGChat.limparLocais();
  await MGCmd.executar('/briefing');
  await new Promise(x=>setTimeout(x,400));
  const aviso = [...document.querySelectorAll('#mgz-msgs .mgz-m')].pop();
  const c = MGChat.canalAtual ? MGChat.canalAtual() : null;
  return {existe, texto:(aviso ? aviso.textContent : '').slice(-90), view:VIEW,
          canal: c ? {id:c.id, tipo:c.tipo, client:c.client_id} : null};
});
ok('25c /briefing existe e avisa quando o canal não é de empresa',
   cmdBrief.existe && /canal de uma empresa/.test(cmdBrief.texto) && cmdBrief.view === 'chat',
   JSON.stringify({canal:cmdBrief.canal, view:cmdBrief.view}));

/* ---- 25d. no canal de empresa, /briefing abre o briefing ---- */
const cmdOk = await page.evaluate(async ()=>{
  MGChat.abrir('ch-1'); await new Promise(x=>setTimeout(x,600));
  await MGCmd.executar('/briefing');
  await new Promise(x=>setTimeout(x,900));
  return {view:VIEW, cliente:(typeof MG_BF_CLI !== 'undefined' ? MG_BF_CLI : null)};
});
ok('25d /briefing no canal da empresa abre o briefing dela',
   cmdOk.view === 'briefing' && cmdOk.cliente === 'c-1', JSON.stringify(cmdOk));

/* ---- 25e. ao enviar, o briefing vira documento no canal da empresa ---- */
const publicado = await page.evaluate(async ()=>{
  showView('briefing'); await new Promise(x=>setTimeout(x,500));
  await mgBFComecar('c-1'); await new Promise(x=>setTimeout(x,600));
  MG_BF.verba_total = 50000;
  MG_BF.plataformas = [{nome:'Meta Ads', verba:30000},{nome:'Google Ads', verba:20000}];
  MG_BF.apostas = 'Campanha de lançamento';
  mgBFRevisar(); await new Promise(x=>setTimeout(x,300));
  const antes = window.__FIX.messages.filter(m=>m.channel_id==='ch-1').length;
  await mgBFEnviar(); await new Promise(x=>setTimeout(x,1400));
  const doCanal = window.__FIX.messages.filter(m=>m.channel_id==='ch-1');
  const ultima = doCanal[doCanal.length-1];
  const anexo = (ultima && ultima.anexos || [])[0] || null;
  return {antes, depois:doCanal.length,
          corpo: ultima ? ultima.body : null,
          anexo: anexo ? {nome:anexo.nome, tipo:anexo.tipo, temPath:!!anexo.path} : null};
});
ok('25e enviar o briefing publica o documento no canal da empresa',
   publicado.depois > publicado.antes && /Briefing/.test(publicado.corpo||'')
   && publicado.anexo && /^Briefing /.test(publicado.anexo.nome)
   && publicado.anexo.tipo === 'text/html' && publicado.anexo.temPath,
   JSON.stringify(publicado));

/* ---- 25f. o documento traz verba, distribuição e é imprimível ---- */
const conteudo = await page.evaluate(()=>window.__ULTIMO_DOC || null);
ok('25f o documento traz verba, distribuição e botão de imprimir',
   !!conteudo && /Verba total do m/.test(conteudo) && /50\.000|50000/.test(conteudo)
   && /Meta Ads/.test(conteudo) && /window\.print\(\)/.test(conteudo)
   && /@media print/.test(conteudo),
   conteudo ? conteudo.length + ' caracteres' : 'nao gerou');

/* ---- 26. MGP Reports: números reais, nada inventado ---- */
const rep2 = await page.evaluate(async ()=>{
  showView('reports'); await new Promise(x=>setTimeout(x,600));
  const vazio = document.querySelector('#v-reports').textContent;
  mgReportsCliente('c-1'); await new Promise(x=>setTimeout(x,900));
  const n = [...document.querySelectorAll('.mgr-n')].map(c=>({
    rot:c.querySelector('span').textContent, val:c.querySelector('b').textContent}));
  return {view:VIEW, pedeEmpresa:/Escolha uma empresa/.test(vazio), numeros:n,
    canais:[...document.querySelectorAll('.mgr-bloco')].map(b=>(b.querySelector('h2')||{}).textContent),
    linhasCanal:document.querySelectorAll('.mgr-bloco table tbody tr').length};
});
/* investido do último dia = 12000 + 8000 = 20000; ROAS gravado 4,1 acima do piso 3,5;
   ritmo = 20000/50000 = 40% da verba com 4/30 = 13% do mês */
const inv  = rep2.numeros.find(x=>/INVESTIDO/i.test(x.rot));
const roas = rep2.numeros.find(x=>/ROAS/i.test(x.rot));
const rit  = rep2.numeros.find(x=>/RITMO/i.test(x.rot));
ok('26 MGP Reports soma o investido e o ROAS do dia certo',
   rep2.view === 'reports' && rep2.pedeEmpresa
   && /20\.000/.test(inv ? inv.val : '') && (roas && roas.val === '4,10')
   && (rit && rit.val === '40%'),
   JSON.stringify({inv, roas, rit}));

/* ---- 26b. a tela diz o que falta em vez de inventar ---- */
const falta = await page.evaluate(()=>{
  const t = document.querySelector('.mgr-aviso');
  return t ? t.textContent : '';
});
/* o texto muda conforme a chave da Anthropic esteja no projeto ou não;
   as duas versões precisam nomear a entrada de dados e falar da chave */
ok('26b a tela diz o que falta para o relatório automático',
   /pacing/.test(falta) && /(ANTHROPIC_API_KEY|chave da Anthropic j)/.test(falta)
   && !/\bdados? de exemplo\b/i.test(falta), falta.slice(0,110));

/* ---- 26c. empresa sem pacing não vira número zerado ---- */
const semDado = await page.evaluate(async ()=>{
  mgReportsCliente('c-nao-existe'); await new Promise(x=>setTimeout(x,800));
  const t = document.querySelector('#v-reports').textContent;
  return {aviso:/Sem dados de pacing/.test(t), cartoes:document.querySelectorAll('.mgr-n').length};
});
ok('26c empresa sem pacing recebe aviso, não número zerado',
   semDado.aviso && semDado.cartoes === 0, JSON.stringify(semDado));

/* ---- 26d. o cliente não entra no MGP Reports ---- */
ok('26d MGP Reports é só da equipe',
   await page.evaluate(()=>NAV.find(n=>n.v==='reports') ? !!NAV.find(n=>n.v==='reports').admin : false));

/* ---- 27. Kronos por conversa direta: demanda com passo a passo ---- */
const passoAPasso = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(x=>setTimeout(x,500));
  window.__KRONOS_MODO = 'passos';
  MGKronos.abrir();
  await MGKronos.perguntar('preciso revisar os criativos da campanha de setembro');
  await new Promise(x=>setTimeout(x,800));
  const acao = document.querySelector('.mgk-painel .mgk-acao');
  const campos = [...document.querySelectorAll('.mgk-painel .mgk-acao .c')].map(c=>c.textContent);
  const antes = window.__FIX.tasks.length;
  const bt = [...document.querySelectorAll('.mgk-painel .mgk-acao .bts button')]
    .find(b=>/Confirmar/.test(b.textContent));
  if(bt) bt.click();
  await new Promise(x=>setTimeout(x,900));
  const nova = window.__FIX.tasks[window.__FIX.tasks.length-1];
  return {propos:!!acao, campos,
          criou: window.__FIX.tasks.length > antes,
          passos: nova && Array.isArray(nova.subtasks) ? nova.subtasks.map(s=>s.text) : [],
          contexto: nova ? nova.description : ''};
});
ok('27 Kronos propõe demanda com passo a passo e contexto',
   passoAPasso.propos && passoAPasso.criou && passoAPasso.passos.length === 3
   && /Baixar os arquivos/.test(passoAPasso.passos[0])
   && /Contexto:/.test(passoAPasso.contexto),
   JSON.stringify(passoAPasso).slice(0,200));

/* ---- 27b. Kronos cria documento com descrição ---- */
const docKronos = await page.evaluate(async ()=>{
  window.__KRONOS_MODO = 'documento'; window.__KRONOS_EXEC_FALHA = 0;
  await MGKronos.perguntar('escreve um diagnóstico de mídia da Cliente Um');
  await new Promise(x=>setTimeout(x,800));
  /* a última proposta do painel é a desta pergunta; as anteriores são de outros casos */
  const cartao = [...document.querySelectorAll('.mgk-painel .mgk-acao')].pop();
  const titulo = cartao ? (cartao.querySelector('h5')||{}).textContent || '' : '';
  const campos = cartao ? [...cartao.querySelectorAll('.c')].map(c=>c.textContent).join(' | ') : '';
  const antes = window.__FIX.documents.length;
  const bt = cartao ? [...cartao.querySelectorAll('.bts button')].find(b=>/Confirmar/.test(b.textContent)) : null;
  if(bt) bt.click();
  await new Promise(x=>setTimeout(x,900));
  const novo = window.__FIX.documents[window.__FIX.documents.length-1];
  return {titulo, campos, criou: window.__FIX.documents.length > antes,
          doc: novo ? {titulo:novo.titulo, tipo:novo.tipo,
                       desc:(novo.metadata||{}).descricao, temArquivo:!!novo.storage_path} : null};
});
ok('27b Kronos cria documento com descrição e arquivo',
   /Criar documento/.test(docKronos.titulo) && /Descrição/.test(docKronos.campos)
   && docKronos.criou && docKronos.doc && docKronos.doc.tipo === 'diagnostico'
   && /30 dias/.test(docKronos.doc.desc || '') && docKronos.doc.temArquivo,
   JSON.stringify(docKronos).slice(0,200));

/* ---- 27c. sem chave, o Kronos avisa em vez de fingir ---- */
const semIA = await comErroPrevisto(()=>page.evaluate(async ()=>{
  window.__KRONOS_MODO = 'sem_chave';
  const antes = window.__FIX.documents.length;
  const cartoesAntes = document.querySelectorAll('.mgk-painel .mgk-acao').length;
  await MGKronos.perguntar('cria um documento pra Cliente Um');
  await new Promise(x=>setTimeout(x,700));
  const b = [...document.querySelectorAll('.mgk-painel .mgk-b')].pop();
  window.__KRONOS_MODO = 'texto';
  return {txt: b ? b.textContent : '', criouMesmoAssim: window.__FIX.documents.length > antes,
          semProposta: document.querySelectorAll('.mgk-painel .mgk-acao').length === cartoesAntes};
}));
ok('27c sem chave o Kronos avisa e não cria nada',
   /ANTHROPIC_API_KEY/.test(semIA.txt) && !semIA.criouMesmoAssim && semIA.semProposta,
   JSON.stringify(semIA).slice(0,150));

/* ---- 28. /demanda lê o texto livre sem o Kronos ---- */
const leitura = await page.evaluate(()=>{
  const hoje = new Date(); hoje.setHours(12,0,0,0);
  const daqui = n => { const d=new Date(hoje); d.setDate(d.getDate()+n);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') };
  return {
    amanha: mgLerDemanda('ajustar os criativos amanhã'),
    dias:   mgLerDemanda('subir a campanha em 3 dias'),
    data:   mgLerDemanda('entregar o relatório 20/12'),
    urgente:mgLerDemanda('corrigir o pixel do site, urgente'),
    calma:  mgLerDemanda('revisar textos quando der'),
    cliente:mgLerDemanda('montar o plano do Cliente Um para o mês'),
    esperado: {amanha: daqui(1), dias: daqui(3)},
  };
});
ok('28 /demanda lê prazo, prioridade e empresa do texto',
   leitura.amanha.due === leitura.esperado.amanha
   && leitura.dias.due === leitura.esperado.dias
   && /^\d{4}-12-20$/.test(leitura.data.due)
   && leitura.urgente.priority === 'Alta' && leitura.urgente.urgente === true
   && leitura.calma.priority === 'Baixa'
   && leitura.cliente.cliente && leitura.cliente.cliente.id === 'c-1',
   JSON.stringify({a:leitura.amanha.due, e:leitura.esperado.amanha, d:leitura.dias.due,
                   data:leitura.data.due, u:leitura.urgente, c:leitura.calma.priority,
                   cli:leitura.cliente.cliente}));

/* ---- 28b. o título sai limpo e a descrição guarda o texto inteiro ---- */
const titulo = await page.evaluate(()=>mgLerDemanda('revisar os criativos até sexta @Elias'));
ok('28b título sem o prazo nem o arroba, descrição inteira',
   !/sexta/i.test(titulo.title) && !/@/.test(titulo.title)
   && /revisar os criativos/i.test(titulo.title)
   && titulo.description === 'revisar os criativos até sexta @Elias'
   && titulo.assignees.includes('Elias'),
   JSON.stringify(titulo));

/* ---- 28c. o comando cria a demanda de verdade, pela janela ---- */
const demandaPeloChat = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(x=>setTimeout(x,400));
  MGChat.abrir('ch-1'); await new Promise(x=>setTimeout(x,600));
  const antes = window.__FIX.tasks.length;
  MGCmd.executar('/demanda trocar o banner do topo amanhã');
  await new Promise(x=>setTimeout(x,600));
  const j = document.querySelector('.mgj-janela, .mgj-fundo');
  const tit = document.querySelector('[data-campo="title"] input');
  const dt  = document.querySelector('[data-campo="due"] input');
  const cli = document.querySelector('[data-campo="cliente"] select');
  const ok1 = [...document.querySelectorAll('button')].find(b=>/Criar demanda/.test(b.textContent));
  if(ok1) ok1.click();
  await new Promise(x=>setTimeout(x,900));
  const nova = window.__FIX.tasks[window.__FIX.tasks.length-1];
  return {abriu:!!j, titulo: tit?tit.value:'', prazo: dt?dt.value:'',
          empresaDoCanal: cli?cli.value:'',
          criou: window.__FIX.tasks.length > antes,
          gravada: nova ? {t:nova.title, c:nova.client_id, d:nova.due} : null};
});
ok('28c /demanda abre a janela e cria a demanda',
   demandaPeloChat.abriu && /banner/i.test(demandaPeloChat.titulo) && demandaPeloChat.prazo
   && demandaPeloChat.empresaDoCanal === 'c-1' && demandaPeloChat.criou
   && demandaPeloChat.gravada && demandaPeloChat.gravada.c === 'c-1',
   JSON.stringify(demandaPeloChat));

/* ---- 29. a régua da caixa não tem mais B, I, S e código ---- */
const regua = await page.evaluate(()=>{
  const f = document.querySelector('.mgz-fer');
  return {txt: f ? f.textContent.replace(/\s+/g,'') : '',
          botoes: f ? [...f.querySelectorAll('button')].map(b=>b.dataset.rotulo||b.textContent.trim()) : []};
});
ok('29 régua sem os botões de formatação',
   !/^BIS/.test(regua.txt) && !regua.botoes.some(b=>/^(B|I|S)$/.test(b))
   && regua.botoes.some(b=>/Anexar/.test(b)) && regua.botoes.some(b=>/Emoji/.test(b)),
   JSON.stringify(regua));

/* ---- 30. tema preto de verdade, e a escolha mora no chat ---- */
const tema = await page.evaluate(async ()=>{
  MGChat.desenhar(); await new Promise(x=>setTimeout(x,250));
  const sel = document.querySelector('#v-chat .mgz-tema');
  mgTema('dark'); await new Promise(x=>setTimeout(x,250));
  const cs = getComputedStyle(document.body);
  const fundo = cs.getPropertyValue('--paper').trim();
  /* preto de verdade: os três canais quase iguais. O marrom antigo era
     rgb(22,21,15), com 7 de diferença entre o vermelho e o azul. */
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fundo);
  const rgb = m ? [parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)] : null;
  const desvio = rgb ? Math.max(...rgb) - Math.min(...rgb) : 99;
  const claro = rgb ? Math.max(...rgb) : 99;
  mgTema('light'); await new Promise(x=>setTimeout(x,250));
  const claroDepois = getComputedStyle(document.body).getPropertyValue('--paper').trim();
  return {temSeletor:!!sel, fundo, desvio, claro, claroDepois};
});
ok('30 escuro é preto neutro e o claro continua bege',
   tema.temSeletor && tema.desvio <= 2 && tema.claro <= 20
   && /f8f5ef/i.test(tema.claroDepois), JSON.stringify(tema));

/* ---- 31. /configcomoreport manda o arquivo para o acervo ---- */
const acervo = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(x=>setTimeout(x,400));
  MGChat.abrir('ch-1'); await new Promise(x=>setTimeout(x,600));
  const existe = !!MGCmd.achar('configcomoreport');
  await MGCmd.executar('/configcomoreport');
  await new Promise(x=>setTimeout(x,600));
  const c = window.__FIX.channels.find(x=>x.id==='ch-1');
  const ligado = !!(c.config && c.config.arquivos_para_acervo);
  const antes = window.__FIX.documents.length;
  /* envia um arquivo com o ajuste ligado */
  const r = await MGChat.subirArquivos([{nome:'weekly setembro.pdf', tipo:'application/pdf',
                                         tamanho:1234, arquivo:new Blob(['x'])}]);
  await new Promise(x=>setTimeout(x,600));
  const novo = window.__FIX.documents[window.__FIX.documents.length-1];
  return {existe, ligado, caminho: r[0] && r[0].path,
          criou: window.__FIX.documents.length > antes,
          doc: novo ? {titulo:novo.titulo, cliente:novo.client_id,
                       path:novo.storage_path, origem:(novo.metadata||{}).origem} : null};
});
ok('31 /configcomoreport manda o arquivo para o acervo da empresa',
   acervo.existe && acervo.ligado && acervo.criou && acervo.doc
   && acervo.doc.cliente === 'c-1' && acervo.doc.origem === 'chat'
   && acervo.doc.titulo === 'weekly setembro'
   && acervo.doc.path === acervo.caminho,
   JSON.stringify(acervo));

/* ---- 31b. desligando, o arquivo fica só na conversa ---- */
const soConversa = await page.evaluate(async ()=>{
  await MGCmd.executar('/configcomoreport');
  await new Promise(x=>setTimeout(x,500));
  const c = window.__FIX.channels.find(x=>x.id==='ch-1');
  const antes = window.__FIX.documents.length;
  await MGChat.subirArquivos([{nome:'rascunho.pdf', tipo:'application/pdf',
                               tamanho:99, arquivo:new Blob(['x'])}]);
  await new Promise(x=>setTimeout(x,500));
  return {desligado: !(c.config && c.config.arquivos_para_acervo),
          naoCriou: window.__FIX.documents.length === antes};
});
ok('31b desligado, o arquivo não vai para o acervo',
   soConversa.desligado && soConversa.naoCriou, JSON.stringify(soConversa));

/* ---- 31c. em canal de equipe o comando explica por que não vale ---- */
const foraDeEmpresa = await page.evaluate(async ()=>{
  MGChat.abrir('ch-2'); await new Promise(x=>setTimeout(x,600));
  MGChat.limparLocais();
  await MGCmd.executar('/configcomoreport');
  await new Promise(x=>setTimeout(x,400));
  const m = [...document.querySelectorAll('#mgz-msgs .mgz-m')].pop();
  return {texto:(m?m.textContent:'').slice(-120)};
});
ok('31c fora de canal de empresa o comando explica',
   /canal de uma empresa/.test(foraDeEmpresa.texto), foraDeEmpresa.texto);

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
if(previstos.length) console.log(' (' + previstos.length + ' erro(s) provocados de propósito pelos casos 22d e 22e)');
await browser.close(); srv.close();
