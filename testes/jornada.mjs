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
   diretas.abas === 3 && /Diretas/.test(diretas.ativa||'') && diretas.itens >= 1
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
  med(2);                                   /* aquece */
  /* mediana de cinco lotes, e não a média de um: uma coleta de lixo no
     meio de um lote sozinho já empurrava a medição para cima do limite e
     fazia o caso falhar sem nada ter piorado */
  const lotes = [med(8), med(8), med(8), med(8), med(8)].sort((x,y)=>x-y);
  return {naTela: document.querySelectorAll('#mgz-msgs .mgz-m').length,
          botaoAntigas: !!document.querySelector('.mgz-antigas'),
          custo: +lotes[2].toFixed(1),
          pior: +lotes[4].toFixed(1),
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

/* ---- 26b. a aba não promete o que ainda não existe ---- */
const semPromessa = await page.evaluate(()=>({
  semCartao: !document.querySelector('.mgr-aviso'),
  texto: (document.querySelector('#v-reports')||{}).textContent || '',
}));
ok('26b a aba não escreve promessa de relatório automático',
   semPromessa.semCartao && !/autom[áa]tico/i.test(semPromessa.texto)
   && !/chave da Anthropic/i.test(semPromessa.texto),
   semPromessa.texto.slice(0,110));

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

/* ---- 32. upload: tipo fora da lista é recusado com aviso legível ---- */
const tipos = await page.evaluate(()=>({
  aceita: ['foto.png','doc.pdf','plano.xlsx','relatorio.html','notas.txt','pacote.zip']
    .map(n=>({n, ok: MGChat.tipoPermitido({name:n, type:''})})),
  recusa: ['virus.exe','script.sh','mapa.svg','lib.dll','app.apk']
    .map(n=>({n, ok: MGChat.tipoPermitido({name:n, type:''})})),
  porMime: [
    {n:'sem extensão, mime bom', ok: MGChat.tipoPermitido({name:'x', type:'application/pdf'})},
    {n:'svg por mime',           ok: MGChat.tipoPermitido({name:'x.svg', type:'image/svg+xml'})},
    {n:'mime com charset',       ok: MGChat.tipoPermitido({name:'p.html', type:'text/html;charset=utf-8'})},
  ],
}));
ok('32 upload aceita o que o acervo aceita e recusa o resto',
   tipos.aceita.every(x=>x.ok) && tipos.recusa.every(x=>!x.ok)
   && tipos.porMime[0].ok && !tipos.porMime[1].ok && tipos.porMime[2].ok,
   JSON.stringify(tipos));

/* ---- 32b. o arquivo recusado não entra na fila e a pessoa é avisada ---- */
const recusado = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(x=>setTimeout(x,400));
  MGChat.abrir('ch-1'); await new Promise(x=>setTimeout(x,600));
  window.__inputs=[]; const _c=document.createElement.bind(document);
  document.createElement = function(t){ const el=_c(t); if(t==='input') window.__inputs.push(el); return el };
  MGChat.escolherArquivo('');
  return true;
});
const h = await page.evaluateHandle(()=>window.__inputs[window.__inputs.length-1]);
await h.asElement().setInputFiles({name:'malicioso.exe', mimeType:'application/x-msdownload',
                                   buffer:Buffer.from('MZ')});
await page.waitForTimeout(400);
const filaVazia = await page.evaluate(()=>({
  semFila: !document.querySelector('.mgz-fila'),
  aviso: (document.querySelector('.toast, #toast')||{}).textContent || ''
}));
ok('32b executável não entra na fila de envio', recusado && filaVazia.semFila,
   JSON.stringify(filaVazia));

/* ---- 33. cabeçalhos: só declara o que a tag meta realmente aplica ---- */
const cab = await page.evaluate(()=>{
  const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const ref = document.querySelector('meta[name="referrer"]');
  const c = csp ? csp.getAttribute('content') : '';
  return {referrer: ref ? ref.getAttribute('content') : null,
          upgrade: /upgrade-insecure-requests/.test(c),
          /* estas são ignoradas em meta; declarar aqui só gera erro no console */
          semFrameAncestors: !/frame-ancestors/.test(c),
          semUnsafeEval: !/unsafe-eval/.test(c),
          objectNone: /object-src 'none'/.test(c)};
});
ok('33 CSP e referrer sem regra inerte',
   cab.referrer === 'strict-origin-when-cross-origin' && cab.upgrade
   && cab.semFrameAncestors && cab.semUnsafeEval && cab.objectNone,
   JSON.stringify(cab));

/* ---- 34. Novidades: aba própria com não lidas e recentes ---- */
const novidades = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(x=>setTimeout(x,500));
  MGChat.trocarAba('novidades'); await new Promise(x=>setTimeout(x,500));
  const secoes = [...document.querySelectorAll('.mgz-side .mgz-sec')].map(s=>s.textContent.trim());
  const itens = [...document.querySelectorAll('.mgz-nv')].map(b=>({
    novo: b.classList.contains('novo'),
    txt: b.textContent.replace(/\s+/g,' ').trim().slice(0,50),
  }));
  return {abas:[...document.querySelectorAll('.mgz-abas button')].map(b=>b.textContent.replace(/\s+/g,'')),
          secoes, itens, total: MGChat.totalNaoLidas(),
          botaoLerTudo: !!document.querySelector('.mgz-filtro .nova')};
});
ok('34 Novidades é aba própria, com não lidas primeiro',
   novidades.abas.length === 3 && /Novidades/.test(novidades.abas[2])
   && novidades.itens.length >= 1
   && (novidades.total === 0 || novidades.secoes.includes('Não lidas'))
   && (novidades.itens[0] ? novidades.itens[0].novo === (novidades.total > 0) : true),
   JSON.stringify(novidades).slice(0,220));

/* ---- 34b. marcar tudo como lido zera o contador ---- */
const lerTudo = await page.evaluate(async ()=>{
  const antes = MGChat.totalNaoLidas();
  await MGChat.marcarTudoLido();
  await new Promise(x=>setTimeout(x,700));
  return {antes, depois: MGChat.totalNaoLidas()};
});
ok('34b marcar tudo como lido zera as não lidas',
   lerTudo.antes === 0 || lerTudo.depois < lerTudo.antes, JSON.stringify(lerTudo));

/* ---- 35. excluir canal fica ao lado do nome, na lateral ---- */
const menuLateral = await page.evaluate(async ()=>{
  MGChat.trocarAba('tudo'); await new Promise(x=>setTimeout(x,500));
  const linha = document.querySelector('.mgz-linha');
  const pontos = linha ? linha.querySelector('.mgz-mais') : null;
  if(!pontos) return {temPontos:false};
  /* botão dentro de botão é HTML inválido: o ⋯ tem que ser irmão, não filho */
  const aninhado = !!document.querySelector('.mgz-i .mgz-mais');
  pontos.click(); await new Promise(x=>setTimeout(x,300));
  const m = document.querySelector('.mgz-menu');
  const opcoes = m ? [...m.querySelectorAll('button')].map(b=>b.textContent.trim()) : [];
  document.body.click(); await new Promise(x=>setTimeout(x,300));
  return {temPontos:true, aninhado, opcoes, fechou: !document.querySelector('.mgz-menu')};
});
ok('35 canal tem menu de opções na lateral, com excluir',
   menuLateral.temPontos && !menuLateral.aninhado
   && menuLateral.opcoes.some(o=>/Configurar/.test(o))
   && menuLateral.opcoes.some(o=>/Excluir/.test(o))
   && menuLateral.fechou, JSON.stringify(menuLateral));

/* ---- 35b. o menu de canal é só do administrador ----
   equipe trabalha no canal mas não cria nem apaga; cliente idem */
const menuPorPapel = await page.evaluate(async ()=>{
  const antes = ME.role;
  const ver = async papel => {
    ME.role = papel; MGChat.desenhar();
    await new Promise(r=>setTimeout(r,150));
    return !!document.querySelector('.mgz-mais');
  };
  const r = {admin: await ver('admin'), equipe: await ver('equipe'), cliente: await ver('client')};
  ME.role = antes; MGChat.desenhar();
  return r;
});
ok('35b só o administrador vê o menu de canal',
   menuPorPapel.admin && !menuPorPapel.equipe && !menuPorPapel.cliente,
   JSON.stringify(menuPorPapel));

/* ---- 36. o papel equipe trabalha em tudo, menos administrar ---- */
const papeis = await page.evaluate(async ()=>{
  const antes = ME.role;
  ME.role = 'equipe';
  const r = {
    ehDaCasa: isAdmin(),          /* trabalha: vê demandas, clientes, docs */
    ehDono: ehDono(),             /* administra: não                        */
    abaEquipe: !!(typeof mgAtalhos==='function' && mgAtalhos().find(a=>a.v==='equipe')),
    menuEquipe: !!(typeof mgNavItens==='function' && mgNavItens().find(n=>n.v==='equipe')),
  };
  showView('equipe'); await new Promise(x=>setTimeout(x,300));
  r.tentouAbrirEquipe = VIEW;
  ME.role = antes;
  return r;
});
ok('36 equipe trabalha em tudo mas não administra',
   papeis.ehDaCasa && !papeis.ehDono && !papeis.abaEquipe
   && !papeis.menuEquipe && papeis.tentouAbrirEquipe !== 'equipe',
   JSON.stringify(papeis));

/* ---- 36b. o administrador continua com tudo ---- */
const dono = await page.evaluate(()=>({
  ehDaCasa: isAdmin(), ehDono: ehDono(),
  menuEquipe: !!(typeof mgNavItens==='function' && mgNavItens().find(n=>n.v==='equipe')),
}));
ok('36b o administrador continua com tudo',
   dono.ehDaCasa && dono.ehDono && dono.menuEquipe, JSON.stringify(dono));


/* =====================================================================
   37 — colar print na anotação da demanda
   ===================================================================== */
await page.bringToFront();
await page.evaluate(async ()=>{ showView('tasks'); await new Promise(r=>setTimeout(r,250)); });
await page.evaluate(async ()=>{ await openDetail('t-1'); await new Promise(r=>setTimeout(r,300)); });

/* ---- 37. o seletor passa a ter os três níveis ---- */
const niveis = await page.evaluate(()=>{
  const s = document.getElementById('d-note-vis');
  return s ? [...s.options].map(o=>o.value) : [];
});
ok('37 anotação tem cliente, equipe e pessoal',
   niveis.length === 3 && niveis.includes('public') && niveis.includes('equipe') && niveis.includes('private'),
   JSON.stringify(niveis));

/* ---- 37b. Ctrl+V com imagem entra na fila, com miniatura ---- */
const colou = await page.evaluate(async ()=>{
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  const ta = document.getElementById('d-note-input');
  const dt = new DataTransfer();
  dt.items.add(new File([arr], 'print.png', {type:'image/png'}));
  ta.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles:true, cancelable:true}));
  await new Promise(r=>setTimeout(r,250));
  return {
    naFila: mgNotaFila().length,
    miniaturas: document.querySelectorAll('#mg-nota-fila .mg-nf-i img').length,
    temBotaoImagem: !!document.querySelector('.mg-nota-img'),
  };
});
ok('37b Ctrl+V põe o print na fila, com miniatura',
   colou.naFila === 1 && colou.miniaturas === 1 && colou.temBotaoImagem, JSON.stringify(colou));

/* ---- 37c. o que não é imagem é recusado ---- */
const recusou = await page.evaluate(async ()=>{
  const antes = mgNotaFila().length;
  await mgNotaAceitar([new File(['#!/bin/sh'], 'script.sh', {type:'application/x-sh'})]);
  return {antes, depois: mgNotaFila().length};
});
ok('37c arquivo que não é imagem não entra na anotação',
   recusou.depois === recusou.antes, JSON.stringify(recusou));

/* ---- 37d. anotação de cliente vira thread [DEMANDA] no canal dele ---- */
const naThread = await page.evaluate(async ()=>{
  document.getElementById('d-note-vis').value = 'public';
  document.getElementById('d-note-input').value = 'ajustei as mensagens do bot';
  await addNote();
  await new Promise(r=>setTimeout(r,300));
  const msgs = window.__FIX.messages.filter(m=>m.channel_id === 'ch-1');
  const raiz = msgs.find(m=>/^\[DEMANDA\]/.test(m.body||''));
  const resposta = msgs.find(m=>raiz && m.reply_to === raiz.id);
  const t = TASKS.find(x=>x.id === 't-1');
  return {
    temRaiz: !!raiz,
    tituloNaRaiz: !!(raiz && raiz.body.includes('Demanda de teste')),
    respostaNaThread: !!resposta,
    corpoDaResposta: resposta ? resposta.body : '',
    comAnexo: !!(resposta && resposta.anexos && resposta.anexos.length === 1),
    guardouNaDemanda: !!(t && raiz && t.chat_msg_id === raiz.id),
    filaEsvaziou: mgNotaFila().length === 0,
    notaComAnexo: !!(window.__FIX.task_notes.slice(-1)[0].anexos || []).length,
  };
});
ok('37d anotação de cliente abre a thread [DEMANDA] no canal dele',
   naThread.temRaiz && naThread.tituloNaRaiz && naThread.respostaNaThread
   && naThread.corpoDaResposta === 'ajustei as mensagens do bot'
   && naThread.comAnexo && naThread.guardouNaDemanda
   && naThread.filaEsvaziou && naThread.notaComAnexo, JSON.stringify(naThread));

/* ---- 37e. a segunda anotação entra na MESMA thread ---- */
const segunda = await page.evaluate(async ()=>{
  const antes = window.__FIX.messages.filter(m=>/^\[DEMANDA\]/.test(m.body||'')).length;
  document.getElementById('d-note-vis').value = 'public';
  document.getElementById('d-note-input').value = 'subi os criativos';
  await addNote();
  await new Promise(r=>setTimeout(r,300));
  const raizes = window.__FIX.messages.filter(m=>/^\[DEMANDA\]/.test(m.body||''));
  const raiz = raizes[0];
  const respostas = window.__FIX.messages.filter(m=>raiz && m.reply_to === raiz.id);
  return {antes, raizes: raizes.length, respostas: respostas.length};
});
ok('37e a segunda anotação vai para a mesma thread',
   segunda.raizes === 1 && segunda.respostas === 2, JSON.stringify(segunda));

/* ---- 37f. anotação de equipe NÃO chega no cliente ---- */
const soEquipe = await page.evaluate(async ()=>{
  const antes = window.__FIX.messages.filter(m=>m.channel_id === 'ch-1').length;
  document.getElementById('d-note-vis').value = 'equipe';
  document.getElementById('d-note-input').value = 'conta do cliente está sem verba, avisar o comercial';
  await addNote();
  await new Promise(r=>setTimeout(r,300));
  const n = window.__FIX.task_notes.slice(-1)[0];
  return {antes, depois: window.__FIX.messages.filter(m=>m.channel_id === 'ch-1').length,
          salvou: n.body, nivel: n.visibility};
});
ok('37f anotação de equipe fica na demanda, não vai para o cliente',
   soEquipe.depois === soEquipe.antes && soEquipe.nivel === 'equipe'
   && /comercial/.test(soEquipe.salvou), JSON.stringify(soEquipe));

await page.evaluate(()=>closeDetail());

/* =====================================================================
   38 — mensagem recebida vira aviso na tela
   ===================================================================== */

/* ---- 38. chegou mensagem de outra pessoa: aparece o cartão ---- */
const aviso = await page.evaluate(async ()=>{
  showView('tasks'); await new Promise(r=>setTimeout(r,200));
  document.querySelectorAll('.mg-aviso').forEach(e=>e.remove());
  window.__disparar('messages','INSERT',{
    id:'m-rt-1', channel_id:'ch-2', author_id:'u-colega', author_name:'Elias Braga',
    body:'olha o relatório de setembro', kind:'user',
    created_at:new Date().toISOString(), reply_to:null, reactions:{}, anexos:[]});
  await new Promise(r=>setTimeout(r,250));
  const c = document.querySelector('.mg-aviso');
  return {
    apareceu: !!c,
    quem: c ? c.querySelector('.tt').textContent : '',
    corpo: c ? c.querySelector('.cp').textContent : '',
    onde: c ? (c.querySelector('.on')||{}).textContent : '',
  };
});
/* ---- 38a. o cartão traz a foto de quem mandou ---- */
const retratoNoAviso = await page.evaluate(async ()=>{
  /* fora do chat, senão a conversa aberta engole o aviso de propósito */
  showView('tasks'); await new Promise(r=>setTimeout(r,250));
  document.querySelectorAll('.mg-aviso').forEach(e=>e.remove());
  /* quem manda a foto para o MGU é user_directory, não profiles: no dublê
     são objetos diferentes, e mexer no lugar errado não muda nada */
  const eu = window.__FIX.user_directory.find(p=>p.id === 'u-colega');
  const antes = eu.avatar_url;
  eu.avatar_url = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
  await MGU.carregar(true).catch(()=>{});

  window.__disparar('messages','INSERT',{
    id:'m-foto-1', channel_id:'ch-2', author_id:'u-colega', author_name:'Elias Braga',
    body:'olha a foto no cartão', kind:'user',
    created_at:new Date().toISOString(), reply_to:null, reactions:{}, anexos:[]});
  await new Promise(r=>setTimeout(r,300));
  const c = document.querySelector('.mg-aviso');
  const av = c && c.querySelector('.mgu-av');
  const img = av && av.querySelector('img');
  const r = {
    temAvatar: !!av,
    temFoto: !!img,
    daPessoaCerta: av ? av.getAttribute('data-uid') === 'u-colega' : null,
    naoEscapou: c ? !/&lt;(span|img)/.test(c.innerHTML) : null,
  };

  /* sem foto, o mesmo lugar mostra as iniciais */
  document.querySelectorAll('.mg-aviso').forEach(e=>e.remove());
  eu.avatar_url = null;
  await MGU.carregar(true).catch(()=>{});
  window.__disparar('messages','INSERT',{
    id:'m-foto-2', channel_id:'ch-2', author_id:'u-colega', author_name:'Elias Braga',
    body:'agora sem foto', kind:'user',
    created_at:new Date().toISOString(), reply_to:null, reactions:{}, anexos:[]});
  await new Promise(r=>setTimeout(r,300));
  const c2 = document.querySelector('.mg-aviso');
  const av2 = c2 && c2.querySelector('.mgu-av');
  r.semFotoViraIniciais = !!av2 && !av2.querySelector('img')
                       && /EB/i.test(av2.textContent || '');

  eu.avatar_url = antes;
  await MGU.carregar(true).catch(()=>{});
  document.querySelectorAll('.mg-aviso').forEach(e=>e.remove());
  return r;
});
ok('38a o cartão de mensagem traz a foto de quem enviou',
   retratoNoAviso.temAvatar && retratoNoAviso.temFoto
   && retratoNoAviso.daPessoaCerta && retratoNoAviso.naoEscapou
   && retratoNoAviso.semFotoViraIniciais,
   JSON.stringify(retratoNoAviso));

ok('38 mensagem recebida vira aviso na tela, fora do chat',
   aviso.apareceu && aviso.quem === 'Elias Braga'
   && /relatório de setembro/.test(aviso.corpo) && /geral/.test(aviso.onde),
   JSON.stringify(aviso));

/* ---- 38b. clicar no aviso abre a conversa ---- */
const clicou = await page.evaluate(async ()=>{
  /* o caso monta o próprio cartão: depender do que outro caso deixou na
     tela é o tipo de amarra que faz um teste quebrar por causa do vizinho */
  showView('tasks'); await new Promise(r=>setTimeout(r,200));
  document.querySelectorAll('.mg-aviso').forEach(e=>e.remove());
  window.__disparar('messages','INSERT',{
    id:'m-rt-1b', channel_id:'ch-2', author_id:'u-colega', author_name:'Elias Braga',
    body:'clique aqui', kind:'user',
    created_at:new Date().toISOString(), reply_to:null, reactions:{}, anexos:[]});
  await new Promise(r=>setTimeout(r,300));
  const c = document.querySelector('.mg-aviso');
  if(!c) return {erro:'sem aviso'};
  c.click();
  await new Promise(r=>setTimeout(r,500));
  return {view: VIEW, canal: CHAN, sumiu: !document.querySelector('.mg-aviso')};
});
ok('38b clicar no aviso abre a conversa certa',
   clicou.view === 'chat' && clicou.canal === 'ch-2', JSON.stringify(clicou));

/* ---- 38c. a minha própria mensagem não vira aviso ---- */
const semEco = await page.evaluate(async ()=>{
  showView('tasks'); await new Promise(r=>setTimeout(r,200));
  document.querySelectorAll('.mg-aviso').forEach(e=>e.remove());
  window.__disparar('messages','INSERT',{
    id:'m-rt-2', channel_id:'ch-2', author_id:ME.id, author_name:ME.name,
    body:'mandei eu mesmo', kind:'user',
    created_at:new Date().toISOString(), reply_to:null, reactions:{}, anexos:[]});
  await new Promise(r=>setTimeout(r,250));
  return {avisos: document.querySelectorAll('.mg-aviso').length};
});
ok('38c a minha própria mensagem não vira aviso', semEco.avisos === 0, JSON.stringify(semEco));

/* ---- 38d. a conversa que já estou olhando não vira aviso ---- */
const semRuido = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(r=>setTimeout(r,300));
  await MGChat.abrir('ch-1'); await new Promise(r=>setTimeout(r,300));
  document.querySelectorAll('.mg-aviso').forEach(e=>e.remove());
  window.__disparar('messages','INSERT',{
    id:'m-rt-3', channel_id:'ch-1', author_id:'u-colega', author_name:'Elias Braga',
    body:'estou olhando esta conversa agora', kind:'user',
    created_at:new Date().toISOString(), reply_to:null, reactions:{}, anexos:[]});
  await new Promise(r=>setTimeout(r,250));
  return {avisos: document.querySelectorAll('.mg-aviso').length, canal: CHAN, view: VIEW};
});
ok('38d conversa aberta na tela não gera aviso',
   semRuido.avisos === 0 && semRuido.canal === 'ch-1', JSON.stringify(semRuido));

/* ---- 38e. o aviso entra também na central de notificações ---- */
const central = await page.evaluate(async ()=>{
  buildNotifs();
  const doChat = (NOTIFS||[]).filter(n=>n.mgChat);
  return {quantos: doChat.length, texto: doChat.length ? doChat[0].text : ''};
});
ok('38e a mensagem também entra na central de notificações',
   central.quantos >= 1 && /Elias Braga/.test(central.texto), JSON.stringify(central));

/* =====================================================================
   39 — velocidade: sincronização incremental
   ===================================================================== */

/* ---- 39. nada mudou, nada é redesenhado ---- */
const sync = await page.evaluate(async ()=>{
  showView('tasks'); await new Promise(r=>setTimeout(r,250));
  mgSyncReiniciar();                    /* parte de um estado conhecido */
  const conta = {n:0};
  const _r = window.render;
  window.render = function(){ conta.n++; return _r.apply(this, arguments) };

  await refresh();                      /* nada mudou */
  const parado = conta.n;

  const t = window.__FIX.tasks.find(x=>x.id==='t-1');
  t.title = 'Demanda renomeada por outro usuário';
  t.updated_at = new Date(Date.now() + 120000).toISOString();
  await refresh();                      /* uma mudou */
  const mexido = conta.n;

  window.render = _r;
  return {parado, mexido, tituloNaTela: (TASKS.find(x=>x.id==='t-1')||{}).title,
          escondido: document.hidden, temMarco: !!mgSyncEstado().marco};
});
ok('39 sync só redesenha quando alguma demanda muda de verdade',
   !sync.escondido && sync.temMarco && sync.parado === 0 && sync.mexido === 1
   && sync.tituloNaTela === 'Demanda renomeada por outro usuário', JSON.stringify(sync));

/* ---- 39c. de tempos em tempos ele volta a ler a tabela inteira ----
   é a rede de segurança para demanda apagada sem evento de tempo real */
const rede = await page.evaluate(async ()=>{
  mgSyncReiniciar();
  for(let i = 0; i < 10; i++) await refresh();      /* dez incrementais */
  const antes = mgSyncEstado().rodadas;
  await refresh();                                   /* a seguinte é completa */
  return {antes, depois: mgSyncEstado().rodadas};
});
ok('39c a cada dez rodadas ele relê a tabela inteira',
   rede.antes === 10 && rede.depois === 0, JSON.stringify(rede));

/* ---- 39b. demanda apagada some na hora ---- */
const apagou = await page.evaluate(async ()=>{
  const antes = TASKS.length;
  window.__disparar('tasks','DELETE',{id:'t-1'});
  await new Promise(r=>setTimeout(r,200));
  return {antes, depois: TASKS.length, aindaTem: TASKS.some(t=>t.id==='t-1')};
});
ok('39b demanda apagada por outro sai da tela na hora',
   apagou.depois === apagou.antes - 1 && !apagou.aindaTem, JSON.stringify(apagou));


/* =====================================================================
   40 — Ctrl+V também na caixa do MGP Chat, e o menu sem "Início"
   ===================================================================== */

/* ---- 40. colar print na caixa do chat põe na fila de envio ---- */
const colouChat = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(r=>setTimeout(r,300));
  await MGChat.abrir('ch-1'); await new Promise(r=>setTimeout(r,300));
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  const ta = document.getElementById('mgz-in');
  if(!ta) return {erro:'sem caixa'};
  const dt = new DataTransfer();
  dt.items.add(new File([arr], 'print.png', {type:'image/png'}));
  ta.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles:true, cancelable:true}));
  await new Promise(r=>setTimeout(r,300));
  const it = document.querySelector('.mgz-fila .it');
  return {
    naFila: document.querySelectorAll('.mgz-fila .it').length,
    comMiniatura: !!(it && it.querySelector('img')),
    nome: it ? (it.querySelector('.nm')||{}).textContent : '',
  };
});
ok('40 Ctrl+V na caixa do MGP Chat põe o print na fila de envio',
   colouChat.naFila === 1 && colouChat.comMiniatura && /print\.png/.test(colouChat.nome||''),
   JSON.stringify(colouChat));

/* ---- 40b. executável colado no chat é recusado, como no botão ---- */
const chatRecusa = await page.evaluate(async ()=>{
  const antes = document.querySelectorAll('.mgz-fila .it').length;
  const n = MGChat.receberArquivos(
    [new File(['MZ'], 'virus.exe', {type:'application/x-msdownload'})], '');
  await new Promise(r=>setTimeout(r,200));
  return {antes, entraram:n, depois: document.querySelectorAll('.mgz-fila .it').length};
});
ok('40b executável colado no chat continua sendo recusado',
   chatRecusa.entraram === 0 && chatRecusa.depois === chatRecusa.antes,
   JSON.stringify(chatRecusa));

/* ---- 40c. o menu Ir para tem Início e não tem tela de cliente ----
   'minhas' e 'portal' são telas do CLIENTE; para a equipe elas
   duplicavam MGP Tasks e Início. Quem fica é Início. */
const menuIr = await page.evaluate(async ()=>{
  const itens = mgNavItens().map(n=>n.v);
  mgNavAbrir();
  await new Promise(r=>setTimeout(r,150));
  const rotulos = [...document.querySelectorAll('#mg-navp button')].map(b=>b.textContent.trim());
  mgNavFechar();
  return {itens, rotulos,
          temHome:    itens.includes('home'),
          temMinhas:  itens.includes('minhas'),
          temPortal:  itens.includes('portal'),
          rotuloInicio: rotulos.filter(r=>/Início/.test(r)).length,
          rotuloDemandas: rotulos.filter(r=>/^▤?\s*Demandas$/.test(r)).length};
});
ok('40c o menu da equipe mantém Início e larga as telas do cliente',
   menuIr.temHome && !menuIr.temMinhas && !menuIr.temPortal
   && menuIr.rotuloInicio === 1 && menuIr.rotuloDemandas === 0,
   JSON.stringify(menuIr));

/* ---- 40d. o cliente continua com as duas abas dele ----
   'minhas' era a lista solta de demandas do cliente. Desde que o portal
   virou página única, as demandas dele moram dentro do portal e
   ABAS_DO_CLIENTE é só portal e chat. Ou seja: a entrada 'minhas' não
   servia mais a ninguém, e sair do menu da equipe não tira nada do
   cliente. Este caso é o que prova isso. */
const menuCli = await page.evaluate(async ()=>{
  const antes = ME.role, antesCli = ME.client_id;
  ME.role = 'client'; ME.client_id = 'c-1';
  const itens = mgNavItens().map(n=>n.v);
  const abas = (typeof ABAS_DO_CLIENTE !== 'undefined') ? [...ABAS_DO_CLIENTE] : [];
  ME.role = antes; ME.client_id = antesCli;
  return {itens, abas};
});
ok('40d o cliente segue com portal e chat, e as demandas dentro do portal',
   menuCli.itens.join(',') === 'portal,chat'
   && menuCli.abas.includes('portal') && menuCli.abas.includes('chat'),
   JSON.stringify(menuCli));


/* =====================================================================
   41 — Peso e limpeza
   ===================================================================== */

/* ---- 41. a aba só existe para o administrador ---- */
const abaPeso = await page.evaluate(async ()=>{
  const antes = ME.role;
  const ver = papel => { ME.role = papel; mgDesenhaPref();
    return !!MG_PREF_ABAS.find(a=>a.id==='peso') };
  const r = {admin: ver('admin'), equipe: ver('equipe'), cliente: ver('client')};
  ME.role = antes; mgDesenhaPref();
  return r;
});
ok('41 Peso e limpeza é só do administrador',
   abaPeso.admin && !abaPeso.equipe && !abaPeso.cliente, JSON.stringify(abaPeso));

/* ---- 41b. a medição separa logo, acervo e órfão ---- */
const medida = await page.evaluate(async ()=>{
  const p = await mgPesoMedir();
  return {
    logos: p.logos.length,
    logoBytes: p.logosBytes,
    arquivos: p.arquivos.length,
    acervoBytes: p.acervoBytes,
    orfaos: p.orfaos.map(o=>o.caminho),
    falhou: p.falhou,
  };
});
ok('41b a medição encontra as logos, o acervo e o que está sem dono',
   !medida.falhou && medida.logos === 1 && medida.logoBytes > 20000
   && medida.arquivos === 3 && medida.acervoBytes > 1000000
   && medida.orfaos.length === 1 && /orfao\.html$/.test(medida.orfaos[0]),
   JSON.stringify({...medida, orfaos:medida.orfaos.length}));

/* ---- 41c. a prévia encolhe de verdade, e a imagem continua imagem ---- */
const previa = await page.evaluate(async ()=>{
  const antes = mgPesoEstado().logos[0].bytes;
  await mgPesoPreverLogos();
  const l = mgPesoEstado().logos[0];
  if(!l.novo) return {erro:'sem prévia'};
  /* prova que o resultado é uma imagem legível, não um base64 quebrado */
  const img = await new Promise((ok2,nao)=>{
    const i = new Image(); i.onload=()=>ok2(i); i.onerror=()=>nao(new Error('x')); i.src = l.novo.url;
  }).catch(()=>null);
  return {antes, depois: l.novo.bytes, lado: Math.max(l.novo.largura, l.novo.altura),
          abriu: !!img, larguraReal: img ? img.naturalWidth : 0};
});
ok('41c a prévia encolhe a logo e o resultado continua sendo imagem',
   previa.depois < previa.antes * 0.8 && previa.lado === 160
   && previa.abriu && previa.larguraReal === 160,
   JSON.stringify(previa));

/* ---- 41d1. nada é trocado sem confirmar ---- */
const semOk = await page.evaluate(async ()=>{
  const _c = MGJanela.confirmar;
  let perguntou = false;
  MGJanela.confirmar = async ()=>{ perguntou = true; return false };   /* usuário diz não */
  const antes = window.__FIX.clients[0].logo_url.length;
  await mgPesoAplicarLogos();
  await new Promise(r=>setTimeout(r,200));
  MGJanela.confirmar = _c;
  return {perguntou, antes, depois: window.__FIX.clients[0].logo_url.length};
});
ok('41d a logo não é trocada sem a confirmação',
   semOk.perguntou && semOk.depois === semOk.antes, JSON.stringify(semOk));

/* ---- 41e. confirmando, grava no banco e a tela passa a usar a menor ----
   a janela de confirmação é dublada aqui de propósito: o que este caso
   testa é o que acontece DEPOIS do sim. O caso acima cobre o não. */
const trocou = await page.evaluate(async ()=>{
  const _c = MGJanela.confirmar;
  MGJanela.confirmar = async ()=>true;
  const antes = window.__FIX.clients[0].logo_url.length;
  await mgPesoAplicarLogos();
  MGJanela.confirmar = _c;
  await new Promise(r=>setTimeout(r,250));
  return {antes, noBanco: window.__FIX.clients[0].logo_url.length,
          naMemoria: CLIENTS[0].logo_url.length};
});
ok('41e trocar a logo grava no banco e a plataforma passa a usar a menor',
   trocou.noBanco < trocou.antes * 0.8 && trocou.naMemoria === trocou.noBanco,
   JSON.stringify(trocou));

/* ---- 41f. remover o órfão tira do acervo e não encosta no resto ---- */
const limpou = await page.evaluate(async ()=>{
  const _c = MGJanela.confirmar;
  MGJanela.confirmar = async ()=>true;
  const antes = window.__FIX.__acervo.map(a=>a.caminho);
  await mgPesoLimparOrfaos();
  MGJanela.confirmar = _c;
  await new Promise(r=>setTimeout(r,350));
  return {antes, depois: window.__FIX.__acervo.map(a=>a.caminho),
          orfaosAgora: mgPesoEstado().orfaos.length};
});
ok('41f remover os sem dono tira só eles',
   limpou.antes.length === 3 && limpou.depois.length === 2
   && !limpou.depois.some(c=>/orfao\.html$/.test(c))
   && limpou.orfaosAgora === 0,
   JSON.stringify(limpou));


/* =====================================================================
   42 — Resumo semanal
   ===================================================================== */

/* ---- 42. a semana é de segunda a domingo ---- */
const faixa = await page.evaluate(()=>{
  const s = mgSemana(0), a = mgSemana(1);
  return {diaInicio: s.ini.getDay(), dias: Math.round((s.fim - s.ini)/86400000),
          rotulo: s.rotulo, anteriorAntes: a.ini < s.ini,
          umaSemanaAtras: Math.round((s.ini - a.ini)/86400000)};
});
ok('42 a semana vai de segunda a domingo',
   faixa.diaInicio === 1 && faixa.dias === 7 && faixa.umaSemanaAtras === 7
   && faixa.anteriorAntes && /^\d\d\/\d\d a \d\d\/\d\d$/.test(faixa.rotulo),
   JSON.stringify(faixa));

/* ---- 42b. separa otimização de tarefa, e deixa o interno de fora ---- */
const dadosSem = await page.evaluate(async ()=>{
  const d = await mgSemanaDados(mgSemana(0));
  const c = d.find(x=>x.cid === 'c-1');
  return c ? {nome:c.nome, otim:c.otimizacoes, tarefas:c.tarefas, empresas:d.length}
           : {erro:'empresa não veio'};
});
/* as outras otimizações da lista vêm dos casos 37d e 37e, que gravaram
   anotação de cliente nesta mesma semana. Estão certas ali. O que este
   caso prova é o corte: entra a de cliente, sai a interna, e o texto
   longo vira uma linha só. */
ok('42b o resumo separa otimização de tarefa e ignora a anotação interna',
   dadosSem.otim && dadosSem.otim.some(o=>/retargeting/.test(o))
   && !dadosSem.otim.some(o=>/interno/.test(o))
   && !dadosSem.otim.some(o=>/segunda linha/.test(o))
   && dadosSem.otim.every(o=>!o.includes('\n'))
   && dadosSem.tarefas.length === 1
   && /Subir campanha de setembro · Everton/.test(dadosSem.tarefas[0]),
   JSON.stringify(dadosSem));

/* ---- 42c. o texto sai em bullets, com as duas listas ---- */
const textoSem = await page.evaluate(async ()=>{
  const d = await mgSemanaDados(mgSemana(0));
  const c = d.find(x=>x.cid === 'c-1');
  const txt = mgResumoTexto(c, mgSemana(0));
  return {txt, bullets: (txt.match(/^• /gm)||[]).length,
          otim: c.otimizacoes.length, tarefas: c.tarefas.length};
});
ok('42c o texto sai com as duas listas em bullets, e a conta bate',
   /^Resumo da semana · /.test(textoSem.txt)
   && textoSem.txt.includes('OTIMIZAÇÕES (' + textoSem.otim + ')')
   && textoSem.txt.includes('TAREFAS CONCLUÍDAS (' + textoSem.tarefas + ')')
   && textoSem.bullets === textoSem.otim + textoSem.tarefas
   && !/ — /.test(textoSem.txt),
   JSON.stringify({bullets:textoSem.bullets, otim:textoSem.otim, tarefas:textoSem.tarefas}));

/* ---- 42d. empresa sem movimento não entra na lista ---- */
const semMovimento = await page.evaluate(async ()=>{
  const d = await mgSemanaDados(mgSemana(2));      /* retrasada: nada lá */
  return {empresas: d.length};
});
ok('42d semana sem movimento não gera resumo vazio',
   semMovimento.empresas === 0, JSON.stringify(semMovimento));

/* ---- 42e. a janela pergunta empresa e semana, e o comando existe ---- */
const janelaSem = await page.evaluate(async ()=>{
  const _a = MGJanela.abrir;
  const vistas = [];
  MGJanela.abrir = async o => { vistas.push(o); return null };   /* usuário fecha */
  await mgResumoSemanal();
  MGJanela.abrir = _a;
  const cmd = MGCmd.achar('resumosemanal') || MGCmd.achar('resumo');
  return {
    campos: (vistas[0] && vistas[0].campos || []).map(c=>c.nome),
    temTodas: !!(vistas[0] && vistas[0].campos[0].opcoes||[]).find(o=>o.v === '*'),
    semanas: (vistas[0] && vistas[0].campos[1] && vistas[0].campos[1].opcoes || []).length,
    comando: !!cmd,
  };
});
ok('42e a janela pede empresa e semana, e o comando está registrado',
   janelaSem.campos.join(',') === 'empresa,quando' && janelaSem.temTodas
   && janelaSem.semanas === 3 && janelaSem.comando, JSON.stringify(janelaSem));

/* ---- 42f. enviar publica no canal da empresa, com o texto editado ---- */
const enviouSem = await page.evaluate(async ()=>{
  const _a = MGJanela.abrir;
  let passo = 0;
  MGJanela.abrir = async o => {
    passo++;
    if(passo === 1) return {empresa:'c-1', quando:'0'};
    return {texto: (o.campos[0].valor || '') + '\n• linha que eu acrescentei na mão',
            acao:'canal'};
  };
  const antes = window.__FIX.messages.filter(m=>m.channel_id === 'ch-1').length;
  await mgResumoSemanal();
  await new Promise(r=>setTimeout(r,350));
  MGJanela.abrir = _a;
  const nova = window.__FIX.messages.filter(m=>m.channel_id === 'ch-1').slice(-1)[0];
  return {antes, depois: window.__FIX.messages.filter(m=>m.channel_id === 'ch-1').length,
          corpo: (nova||{}).body || ''};
});
ok('42f enviar publica no canal da empresa, respeitando a edição',
   enviouSem.depois === enviouSem.antes + 1
   && /^Resumo da semana/.test(enviouSem.corpo)
   && /linha que eu acrescentei na mão/.test(enviouSem.corpo),
   JSON.stringify({...enviouSem, corpo: enviouSem.corpo.slice(0,60)}));

/* ---- 42g. guardar no acervo cria o documento da empresa ---- */
const acervoSem = await page.evaluate(async ()=>{
  const _a = MGJanela.abrir;
  let passo = 0;
  MGJanela.abrir = async o => {
    passo++;
    return passo === 1 ? {empresa:'c-1', quando:'0'} : {texto:o.campos[0].valor, acao:'acervo'};
  };
  const antes = window.__FIX.documents.length;
  await mgResumoSemanal();
  await new Promise(r=>setTimeout(r,350));
  MGJanela.abrir = _a;
  const d = window.__FIX.documents.slice(-1)[0];
  return {antes, depois: window.__FIX.documents.length,
          titulo:(d||{}).titulo, tipo:(d||{}).tipo, cliente:(d||{}).client_id,
          caminho:(d||{}).storage_path};
});
ok('42g guardar no acervo cria o weekly da empresa',
   acervoSem.depois === acervoSem.antes + 1 && acervoSem.tipo === 'weekly'
   && acervoSem.cliente === 'c-1' && /^Resumo da semana · /.test(acervoSem.titulo||'')
   && /^c-1\/documentos\//.test(acervoSem.caminho||''),
   JSON.stringify(acervoSem));

/* ---- 42h. o resumo é da equipe, não do cliente ---- */
const semPapel = await page.evaluate(async ()=>{
  const antes = ME.role;
  ME.role = 'client';
  const cmd = MGCmd.achar('resumosemanal');
  const podeCliente = !!(cmd && (!cmd.permissao || cmd.permissao()));
  ME.role = 'equipe';
  const cmd2 = MGCmd.achar('resumosemanal');
  const podeEquipe = !!(cmd2 && (!cmd2.permissao || cmd2.permissao()));
  ME.role = antes;
  return {podeCliente, podeEquipe};
});
ok('42h o resumo é da equipe e não do cliente',
   !semPapel.podeCliente && semPapel.podeEquipe, JSON.stringify(semPapel));


/* =====================================================================
   43 — lateral: empresa de um canal só é a própria conversa
   ===================================================================== */
const lateral = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(r=>setTimeout(r,300));
  MGChat.trocarAba('tudo'); await new Promise(r=>setTimeout(r,400));
  const so = document.querySelector('.mgz-i.mgz-so');
  if(!so) return {erro:'sem linha de empresa'};
  const antes = CHAN;
  so.click(); await new Promise(r=>setTimeout(r,400));
  return {
    rotulo: (so.querySelector('.nm')||{}).textContent,
    grupos: document.querySelectorAll('.mgz-emp').length,
    linhasSo: document.querySelectorAll('.mgz-i.mgz-so').length,
    antes, depois: CHAN,
    umClique: CHAN === 'ch-1',
  };
});
ok('43 empresa de um canal só abre a conversa num clique',
   lateral.umClique && lateral.linhasSo === 1 && lateral.grupos === 0
   && /Cliente Um/.test(lateral.rotulo||''),
   JSON.stringify(lateral));

/* ---- 43b. ganhando um segundo canal, volta a ser grupo ---- */
const virouGrupo = await page.evaluate(async ()=>{
  window.__FIX.channels.push({id:'ch-1b', tipo:'client', nome:'cliente-um-criativos',
    client_id:'c-1', cor:null, icone:null, descricao:null,
    created_by:ME.id, created_at:new Date().toISOString(), config:{}});
  await MGChat.carregarCanais();
  MGChat.desenhar(); await new Promise(r=>setTimeout(r,400));
  const r = {grupos: document.querySelectorAll('.mgz-emp').length,
             linhasSo: document.querySelectorAll('.mgz-i.mgz-so').length,
             abertoPorPadrao: !!document.querySelector('.mgz-emp.aberta')};
  window.__FIX.channels = window.__FIX.channels.filter(c=>c.id !== 'ch-1b');
  await MGChat.carregarCanais(); MGChat.desenhar();
  return r;
});
ok('43b com dois canais a empresa volta a ser grupo, já aberto',
   virouGrupo.grupos === 1 && virouGrupo.linhasSo === 0 && virouGrupo.abertoPorPadrao,
   JSON.stringify(virouGrupo));

/* ---- 43c. a opção de manter aberta existe e é respeitada ---- */
const opcao = await page.evaluate(async ()=>{
  const html = mgPrefConteudo('msgs');
  const tem = /Manter as empresas abertas/.test(html);
  mgSetEmpresas('off');
  const desligada = mgP('empresasSempre');
  mgSetEmpresas('on');
  return {tem, desligada, religada: mgP('empresasSempre')};
});
ok('43c a opção de manter as empresas abertas existe e grava',
   opcao.tem && opcao.desligada === 'off' && opcao.religada === 'on',
   JSON.stringify(opcao));

/* =====================================================================
   44 — card limpo: descrição e tempo só ao abrir
   ===================================================================== */
const card = await page.evaluate(async ()=>{
  showView('board'); await new Promise(r=>setTimeout(r,500));
  const html = $('v-board').innerHTML;
  const um = document.querySelector('.card-t');
  return {
    temDescricao: /class="card-desc"/.test(html),
    temEstimativa: /class="card-est"/.test(html),
    temCronometro: /class="tchip/.test(html),
    temChipDeTempo: /mg-tempo-chip/.test(html),
    temTitulo: !!(um && um.querySelector('.tt')),
    temCliente: !!(um && um.querySelector('.cbadge')),
    temPrioridade: !!(um && um.querySelector('.prio')),
  };
});
ok('44 o card do quadro não carrega descrição nem tempo',
   !card.temDescricao && !card.temEstimativa && !card.temCronometro
   && !card.temChipDeTempo && card.temTitulo && card.temCliente && card.temPrioridade,
   JSON.stringify(card));

/* ---- 44b. mas os dois continuam inteiros ao abrir o card ---- */
const dentro = await page.evaluate(async ()=>{
  /* o caso 39b apaga a t-1 da memória de propósito, então aqui usamos uma
     demanda que ainda existe, com descrição e tempo gravados */
  const alvo = TASKS[0];
  alvo.description = 'contexto completo da demanda, que não cabe no card';
  alvo.time_spent = 5400;
  await openDetail(alvo.id); await new Promise(r=>setTimeout(r,450));
  const corpo = document.getElementById('slide').innerHTML;
  const desc = document.getElementById('d-desc');
  const r = {
    descricaoNoDetalhe: !!desc && /não cabe no card/.test(desc.value || ''),
    tempoNoDetalhe: /[Tt]empo/.test(corpo),
  };
  closeDetail();
  return r;
});
ok('44b descrição e tempo seguem inteiros ao abrir o card',
   dentro.descricaoNoDetalhe && dentro.tempoNoDetalhe, JSON.stringify(dentro));

/* =====================================================================
   45 — a marca do Kronos é o sprite de pixel
   ===================================================================== */
const marcaKronos = await page.evaluate(()=>{
  const linha = mgGatoLinha(17), cheio = mgGato(20);
  const conta = s => (s.match(/<rect/g)||[]).length;
  const d = document.createElement('div'); d.innerHTML = cheio;
  const svg = d.querySelector('svg');
  return {
    quadrosLinha: conta(linha),
    quadrosCheio: conta(cheio),
    herdaCor: /currentColor/.test(linha),
    corPropria: /#D2694A/i.test(cheio),
    semSuavizar: svg.getAttribute('shape-rendering') === 'crispEdges',
    caixa: svg.getAttribute('viewBox'),
    proporcao: svg.getAttribute('width') + 'x' + svg.getAttribute('height'),
  };
});
/* a grade do gato de frente tem 29 quadrados (2+4+7+5+6+5); a versão
   cheia soma os dois olhos e o focinho */
ok('45 o Kronos é um gato de pixel, com cor herdada no traço',
   marcaKronos.quadrosLinha === 29 && marcaKronos.quadrosCheio === 32
   && marcaKronos.herdaCor && marcaKronos.corPropria
   && marcaKronos.semSuavizar && marcaKronos.caixa === '0 0 7 6'
   && marcaKronos.proporcao === '20x17',
   JSON.stringify(marcaKronos));

/* ---- 45b. o gato atravessa a barra, e some quando não deve andar ---- */
const passeio = await page.evaluate(async ()=>{
  const r = {};
  /* A barra é escondida por !important enquanto as boas-vindas estão
     abertas, e mgEstadoDaTela repõe a classe a cada 700 ms. O que este
     caso testa é "dada uma barra em cena, o gato anda sobre ela", então
     forçamos a barra a aparecer em vez de brigar com o ciclo. */
  const barra = document.querySelector('.mg-dock');
  if(barra) barra.style.setProperty('display', 'inline-flex', 'important');
  document.body.classList.remove('mg-sem-anim');
  await new Promise(x=>setTimeout(x,200));
  r.temBarra = (document.querySelector('.mg-dock') || {getClientRects:()=>[]}).getClientRects().length > 0;
  r.podeAndar = mgGatoPodeAndar();
  mgGatoPassear();
  await new Promise(x=>setTimeout(x,250));
  const g = document.querySelector('.mg-gato-anda');
  r.apareceu = !!g;
  /* ele mora no body de propósito: a barra é overflow-x:auto e recortaria
     um filho posicionado acima dela */
  r.noBody   = !!(g && g.parentElement === document.body);
  r.fixo     = !!g && getComputedStyle(g).position === 'fixed';
  r.semClique = !!g && getComputedStyle(g).pointerEvents === 'none';
  r.quatroPoses = !!g && [0,1,2,3].every(i => !!g.querySelector('.p' + i));
  r.temTempo  = !!(g && /\ds$/.test(g.style.getPropertyValue('--mg-gato-tempo')));
  r.temPasso  = !!(g && /\ds$/.test(g.style.getPropertyValue('--mg-passo')));

  /* com as animações desligadas ele não sai do lugar */
  if(g) g.remove();
  document.body.classList.add('mg-sem-anim');
  r.respeitaPreferencia = !mgGatoPodeAndar();
  mgGatoPassear();
  await new Promise(x=>setTimeout(x,150));
  r.ficouQuieto = !document.querySelector('.mg-gato-anda');
  document.body.classList.remove('mg-sem-anim');
  return r;
});
ok('45b o gato atravessa a barra e obedece a preferência de animação',
   passeio.temBarra && passeio.podeAndar && passeio.apareceu
   && passeio.noBody && passeio.fixo && passeio.semClique
   && passeio.quatroPoses && passeio.temTempo && passeio.temPasso
   && passeio.respeitaPreferencia && passeio.ficouQuieto,
   JSON.stringify(passeio));

/* ---- 45c. o gato de perfil tem as duas poses de pata, e só elas mudam ---- */
const gatoLado = await page.evaluate(()=>{
  const d = document.createElement('div');
  d.innerHTML = mgGatoDePerfil(18);
  const svg = d.querySelector('svg');
  const poses = [0,1,2,3].map(i =>
    [...svg.querySelectorAll('.p' + i + ' rect')].map(r=>r.getAttribute('x')).join(','));
  /* a mesma linha do corpo em todas as poses: só as patas mudam */
  const alturaDasPatas = [...svg.querySelectorAll('[class^="p"] rect')]
    .map(r=>r.getAttribute('y'));
  return {caixa: svg.getAttribute('viewBox'),
          corpo: svg.querySelectorAll(':scope > rect').length,
          poses, todasDiferentes: new Set(poses).size === 4,
          umaLinhaSo: new Set(alturaDasPatas).size === 1};
});
ok('45c o gato de perfil tem quatro poses de pata, e só elas mudam',
   gatoLado.caixa === '0 0 11 7' && gatoLado.corpo === 45
   && gatoLado.todasDiferentes && gatoLado.umaLinhaSo
   && gatoLado.poses[0] === '1,3,6,8' && gatoLado.poses[3] === '2,7',
   JSON.stringify(gatoLado));

/* ---- 45d. trocar de aba é o que chama o gato ---- */
const naTroca = await page.evaluate(async ()=>{
  const barra = document.querySelector('.mg-dock');
  if(barra) barra.style.setProperty('display', 'inline-flex', 'important');
  document.querySelectorAll('.mg-gato-anda').forEach(e=>e.remove());
  mgFecharLupa && mgFecharLupa();
  /* a suíte trocou de aba dezenas de vezes até aqui, então a pausa entre
     passadas já está correndo. Zeramos para medir a troca desta vez. */
  mgGatoZerarPausa();

  /* a pausa mínima existe para clique rápido não enfileirar gato */
  showView('calendar'); await new Promise(r=>setTimeout(r,300));
  showView('board');    await new Promise(r=>setTimeout(r,700));
  const veioNaPrimeira = !!document.querySelector('.mg-gato-anda');

  document.querySelectorAll('.mg-gato-anda').forEach(e=>e.remove());
  showView('list'); await new Promise(r=>setTimeout(r,700));
  const veioNaSegunda = !!document.querySelector('.mg-gato-anda');

  document.querySelectorAll('.mg-gato-anda').forEach(e=>e.remove());
  return {veioNaPrimeira, respeitouAPausa: !veioNaSegunda};
});
ok('45d o gato aparece ao trocar de aba, com pausa entre uma e outra',
   naTroca.veioNaPrimeira && naTroca.respeitouAPausa, JSON.stringify(naTroca));

/* ---- 45e. ele atravessa de verdade, e é desenhado ----
   Dois defeitos que só aparecem medindo, e que passaram batido antes:
   translateX(100%) media a largura do PRÓPRIO gato e não a da barra,
   então ele andava 100 px no tempo de atravessar a tela inteira; e a
   barra é overflow-x:auto, o que recortava um filho posicionado fora
   dela, deixando o bicho invisível mesmo estando lá. */
const travessia = await page.evaluate(async ()=>{
  const barra = document.querySelector('.mg-dock');
  barra.style.setProperty('display', 'inline-flex', 'important');
  document.querySelectorAll('.mg-gato-anda').forEach(e=>e.remove());
  mgGatoZerarPausa(); mgGatoPassear();
  await new Promise(r=>setTimeout(r,300));

  const onde = ()=>{
    const g = document.querySelector('.mg-gato-anda');
    if(!g) return null;
    const r = g.getBoundingClientRect();
    return {x:r.left, y:r.top, w:r.width,
            pintado: document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) !== null};
  };
  const a1 = onde();
  await new Promise(r=>setTimeout(r,1500));
  const a2 = onde();
  if(!a1 || !a2) return {erro:'sumiu no meio'};

  const larguraBarra = barra.getBoundingClientRect().width;
  return {
    andou: Math.round(a2.x - a1.x),
    porSegundo: Math.round((a2.x - a1.x) / 1.5),
    larguraBarra: Math.round(larguraBarra),
    pintado: a2.pintado,
    acimaDaBarra: a2.y + 18 <= Math.round(barra.getBoundingClientRect().top) + 2,
  };
});
ok('45e o gato atravessa a barra de verdade, e é desenhado na tela',
   travessia.andou > 40 && travessia.porSegundo > 25 && travessia.porSegundo < 80
   && travessia.pintado && travessia.acimaDaBarra,
   JSON.stringify(travessia));


/* =====================================================================
   46 — a conversa para de pular, o Elias volta a ser equipe,
        vídeo entra e a imagem abre na própria página
   ===================================================================== */

/* ---- 46. redesenhar não move quem está lendo mais acima ---- */
const semTranco = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(r=>setTimeout(r,300));
  await MGChat.abrir('ch-1'); await new Promise(r=>setTimeout(r,400));
  const cx = document.getElementById('mgz-msgs');
  if(!cx) return {erro:'sem conversa'};

  /* enche a conversa para haver o que rolar */
  for(let i=0;i<40;i++){
    window.__FIX.messages.push({id:'m-rol-'+i, channel_id:'ch-1', author_id:'u-colega',
      author_name:'Elias Braga', body:'mensagem de rolagem '+i, kind:'user',
      created_at:new Date(Date.now()-(60-i)*60000).toISOString(),
      reply_to:null, reactions:{}, anexos:[]});
  }
  await MGChat.carregarMsgs('ch-1');
  MGChat.desenhar(); await new Promise(r=>setTimeout(r,300));

  const cx2 = document.getElementById('mgz-msgs');
  cx2.scrollTop = 0;                              /* lendo a mais antiga */
  await new Promise(r=>setTimeout(r,60));
  MGChat.desenhar(); await new Promise(r=>setTimeout(r,200));
  const noTopoDepois = document.getElementById('mgz-msgs').scrollTop;

  /* no meio da conversa */
  const cx3 = document.getElementById('mgz-msgs');
  const meio = Math.round(cx3.scrollHeight / 3);
  cx3.scrollTop = meio;
  await new Promise(r=>setTimeout(r,60));
  MGChat.desenhar(); await new Promise(r=>setTimeout(r,200));
  const noMeioDepois = document.getElementById('mgz-msgs').scrollTop;

  /* colado no fim, tem que continuar colado */
  const cx4 = document.getElementById('mgz-msgs');
  cx4.scrollTop = cx4.scrollHeight;
  await new Promise(r=>setTimeout(r,60));
  MGChat.desenhar(); await new Promise(r=>setTimeout(r,200));
  const cx5 = document.getElementById('mgz-msgs');
  const colado = cx5.scrollHeight - cx5.scrollTop - cx5.clientHeight < 80;

  return {noTopoDepois, meio, noMeioDepois, colado,
          rolavel: cx5.scrollHeight > cx5.clientHeight + 100};
});
ok('46 redesenhar não puxa quem está lendo mais acima',
   semTranco.rolavel && semTranco.noTopoDepois === 0
   && Math.abs(semTranco.noMeioDepois - semTranco.meio) <= 2
   && semTranco.colado,
   JSON.stringify(semTranco));

/* ---- 46b. enviar continua levando para a última mensagem ---- */
const aoEnviar = await page.evaluate(async ()=>{
  const cx = document.getElementById('mgz-msgs');
  cx.scrollTop = 0;                                /* longe do fim */
  const ta = document.getElementById('mgz-in');
  ta.value = 'mandei do meio da conversa';
  MGChat.digitou(ta, '');
  await MGChat.enviar();
  await new Promise(r=>setTimeout(r,500));
  const c2 = document.getElementById('mgz-msgs');
  return {noFim: c2.scrollHeight - c2.scrollTop - c2.clientHeight < 80,
          ultima: (window.__FIX.messages.filter(m=>m.channel_id==='ch-1').slice(-1)[0]||{}).body};
});
ok('46b enviar leva para a última mensagem',
   aoEnviar.noFim && aoEnviar.ultima === 'mandei do meio da conversa',
   JSON.stringify(aoEnviar));

/* ---- 46c. quem é do time aparece como equipe, não como cliente ---- */
const papelNaTela = await page.evaluate(()=>{
  const conta = id => { const u = MGU.get(id) || {};
    return {papel:u.papel, equipe:!!u.ehEquipe, cliente:!!u.ehCliente} };
  return {admin: conta('u-admin'), equipe: conta('u-colega'), cliente: conta('u-cli')};
});
ok('46c quem é equipe conta como equipe, e não como cliente',
   papelNaTela.equipe.papel === 'equipe'
   && papelNaTela.admin.equipe   && !papelNaTela.admin.cliente
   && papelNaTela.equipe.equipe  && !papelNaTela.equipe.cliente
   && !papelNaTela.cliente.equipe && papelNaTela.cliente.cliente,
   JSON.stringify(papelNaTela));

/* ---- 46d. vídeo passa a ser aceito, executável continua fora ---- */
const video = await page.evaluate(()=>({
  mp4:  MGChat.tipoPermitido(new File(['x'], 'criativo.mp4',  {type:'video/mp4'})),
  mov:  MGChat.tipoPermitido(new File(['x'], 'criativo.mov',  {type:'video/quicktime'})),
  webm: MGChat.tipoPermitido(new File(['x'], 'criativo.webm', {type:'video/webm'})),
  exe:  MGChat.tipoPermitido(new File(['x'], 'virus.exe',     {type:'application/x-msdownload'})),
  icone: mgIconeArquivo('criativo.mp4', 'video/mp4'),
}));
ok('46d vídeo é aceito e o executável continua recusado',
   video.mp4 && video.mov && video.webm && !video.exe && video.icone === '🎬',
   JSON.stringify(video));

/* ---- 46e. imagem e vídeo abrem na própria página, o resto em guia ---- */
const lupa = await page.evaluate(async ()=>{
  let abriuGuia = 0;
  const _open = window.open;
  window.open = ()=>{ abriuGuia++; return null };

  await MGChat.abrirAnexo('c-1/chat/foto.png');
  await new Promise(r=>setTimeout(r,250));
  const cx = document.getElementById('mg-lupa');
  const r = {
    abriuLupa: !!(cx && cx.classList.contains('on')),
    temImagem: !!(cx && cx.querySelector('img')),
    guiaNaImagem: abriuGuia,
  };
  /* Esc fecha */
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  await new Promise(r2=>setTimeout(r2,150));
  r.fechouComEsc = !document.getElementById('mg-lupa').classList.contains('on');

  /* vídeo também */
  await MGChat.abrirAnexo('c-1/chat/criativo.mp4');
  await new Promise(r2=>setTimeout(r2,250));
  r.videoNaLupa = !!document.querySelector('#mg-lupa.on video');
  mgFecharLupa();

  /* PDF continua em guia nova */
  await MGChat.abrirAnexo('c-1/chat/plano.pdf');
  await new Promise(r2=>setTimeout(r2,250));
  r.pdfEmGuia = abriuGuia === 1;
  r.pdfSemLupa = !document.querySelector('#mg-lupa.on');

  window.open = _open;
  return r;
});
ok('46e imagem e vídeo abrem na página; PDF segue abrindo em guia',
   lupa.abriuLupa && lupa.temImagem && lupa.guiaNaImagem === 0
   && lupa.fechouComEsc && lupa.videoNaLupa && lupa.pdfEmGuia && lupa.pdfSemLupa,
   JSON.stringify(lupa));


/* =====================================================================
   47 — o gato pula
   ===================================================================== */

/* ---- 47. abrir o Kronos faz o gato saltar do botão até o painel ---- */
const salto = await page.evaluate(async ()=>{
  const barra = document.querySelector('.mg-dock');
  if(barra) barra.style.setProperty('display', 'inline-flex', 'important');
  document.querySelectorAll('.mg-gato-salto').forEach(e=>e.remove());
  MGKronos.fechar();
  await new Promise(r=>setTimeout(r,150));

  const botao = document.getElementById('mg-kronos-b');
  const deOnde = botao ? botao.getBoundingClientRect() : null;

  MGKronos.abrir();
  const pontos = [];
  for(let i=0;i<7;i++){
    await new Promise(r=>setTimeout(r,70));
    const caixa = document.querySelector('.mg-gato-salto');
    const s = caixa && caixa.querySelector('.arco');
    if(!s){ pontos.push(null); continue }
    const r = s.getBoundingClientRect();
    pontos.push({x:Math.round(r.x), y:Math.round(r.y),
                 /* de onde a animação parte, que é o botão. A posição do
                    primeiro quadro já é a de 70 ms depois, então ela não
                    serve para dizer onde o pulo começou. */
                 partiu: {x: parseInt(caixa.style.left,10), y: parseInt(caixa.style.top,10)},
                 pintado: document.elementFromPoint(r.x+r.width/2, r.y+r.height/2) !== null});
  }
  const vistos = pontos.filter(Boolean);
  const painel = document.querySelector('.mgk-painel');
  const av = painel ? painel.querySelector('.mgk-topo .av svg') : null;

  await new Promise(r=>setTimeout(r,700));
  return {
    quadros: vistos.length,
    subiu: vistos.length > 2 && Math.min(...vistos.map(p=>p.y)) < vistos[0].y - 40,
    desceu: vistos.length > 2 && vistos[vistos.length-1].y > Math.min(...vistos.map(p=>p.y)),
    saiuDoBotao: !!deOnde && vistos.length > 0
              && Math.abs(vistos[0].partiu.y - (deOnde.top  + deOnde.height/2)) < 20
              && Math.abs(vistos[0].partiu.x - (deOnde.left + deOnde.width/2))  < 20,
    sempreVisivel: vistos.every(p=>p.pintado),
    sumiuNoFim: !document.querySelector('.mg-gato-salto'),
    avatarVoltou: av ? getComputedStyle(av).opacity : null,
    painelAberto: !!(painel && painel.classList.contains('on')),
  };
});
ok('47 abrir o Kronos faz o gato saltar do botão até o painel, em arco',
   salto.painelAberto && salto.quadros >= 4 && salto.subiu && salto.desceu
   && salto.saiuDoBotao && salto.sempreVisivel && salto.sumiuNoFim
   && salto.avatarVoltou === '1',
   JSON.stringify(salto));

/* ---- 47b. clicar num gato faz ele pular, e dá para repetir ---- */
const pulaAoClicar = await page.evaluate(async ()=>{
  const av = document.querySelector('.mgk-topo .av svg');
  if(!av) return {erro:'sem gato no cabeçalho'};
  const bate = async ()=>{
    av.dispatchEvent(new MouseEvent('click', {bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    return {classe: av.classList.contains('mg-pula'),
            anim: getComputedStyle(av).animationName};
  };
  const um = await bate();
  await new Promise(r=>setTimeout(r,700));
  const limpou = !av.classList.contains('mg-pula');
  const dois = await bate();                 /* repete: a classe tem que voltar */
  await new Promise(r=>setTimeout(r,700));
  return {um, limpou, dois};
});
ok('47b clicar no gato faz ele pular, e o pulo pode se repetir',
   pulaAoClicar.um && pulaAoClicar.um.classe && pulaAoClicar.um.anim === 'mgPulo'
   && pulaAoClicar.limpou && pulaAoClicar.dois.classe && pulaAoClicar.dois.anim === 'mgPulo',
   JSON.stringify(pulo));

/* ---- 47c. o gato que atravessa a barra não pula ao ser clicado ----
   ele é pointer-events:none de propósito, para não roubar o clique dos
   botões da barra por onde passa */
const naoPula = await page.evaluate(async ()=>{
  document.querySelectorAll('.mg-gato-anda').forEach(e=>e.remove());
  mgGatoZerarPausa(); mgGatoPassear();
  await new Promise(r=>setTimeout(r,250));
  const g = document.querySelector('.mg-gato-anda svg');
  if(!g) return {erro:'sem gato andando'};
  g.dispatchEvent(new MouseEvent('click', {bubbles:true}));
  await new Promise(r=>setTimeout(r,100));
  const r = {pulou: g.classList.contains('mg-pula'),
             semClique: getComputedStyle(g.closest('.mg-gato-anda')).pointerEvents === 'none'};
  document.querySelectorAll('.mg-gato-anda').forEach(e=>e.remove());
  return r;
});
ok('47c o gato que atravessa a barra não pula nem rouba o clique',
   !naoPula.pulou && naoPula.semClique, JSON.stringify(naoPula));


/* =====================================================================
   48 — mudança de um chega em todo mundo na hora
   ===================================================================== */

/* ---- 48. as seis tabelas do dia a dia são ouvidas ---- */
const ouvindo = await page.evaluate(async ()=>{
  mgVivoLigar();
  await new Promise(r=>setTimeout(r,200));
  return {
    ligou: typeof mgVivoMudou === 'function',
    /* o dublê guarda os handlers; conferimos que os seis foram pedidos */
    tabelas: ['profiles','channels','channel_members','clients','documents','projects'],
  };
});
ok('48 o ouvinte de tempo real sobe com a sessão',
   ouvindo.ligou, JSON.stringify(ouvindo));

/* ---- 48b. foto trocada por outro aparece sem recarregar ---- */
const fotoNova = await page.evaluate(async ()=>{
  showView('chat'); await new Promise(r=>setTimeout(r,300));
  await MGChat.abrir('ch-2'); await new Promise(r=>setTimeout(r,400));

  const colega = window.__FIX.user_directory.find(p=>p.id === 'u-colega');
  const antes = colega.avatar_url;
  const foto = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

  const tinhaFoto = !!document.querySelector('.mgu-av[data-uid="u-colega"] img');
  colega.avatar_url = foto;                       /* outra pessoa trocou a foto */
  window.__disparar('profiles','UPDATE',{id:'u-colega', avatar_url:foto});
  await new Promise(r=>setTimeout(r,900));        /* o ciclo junta a rajada */
  const agoraTem = !!document.querySelector('.mgu-av[data-uid="u-colega"] img');

  colega.avatar_url = antes;
  await MGU.carregar(true).catch(()=>{});
  return {tinhaFoto, agoraTem};
});
ok('48b foto trocada por outra pessoa aparece sem recarregar a página',
   !fotoNova.tinhaFoto && fotoNova.agoraTem, JSON.stringify(fotoNova));

/* ---- 48c. canal criado por outro entra na lateral sozinho ---- */
const canalAoVivo = await page.evaluate(async ()=>{
  MGChat.trocarAba('tudo'); await new Promise(r=>setTimeout(r,300));
  const antes = CHANNELS.length;

  window.__FIX.channels.push({id:'ch-vivo', tipo:'team', nome:'canal-que-nasceu-agora',
    client_id:null, cor:null, icone:null, descricao:null,
    created_by:'u-colega', created_at:new Date().toISOString(), config:{}});
  window.__disparar('channels','INSERT',{id:'ch-vivo'});
  await new Promise(r=>setTimeout(r,900));

  const r = {antes, depois: CHANNELS.length,
             naTela: /canal-que-nasceu-agora/.test(document.getElementById('v-chat').innerHTML)};
  window.__FIX.channels = window.__FIX.channels.filter(c=>c.id !== 'ch-vivo');
  await MGChat.carregarCanais(); MGChat.desenhar();
  return r;
});
ok('48c canal criado por outro aparece na lateral sozinho',
   canalAoVivo.depois === canalAoVivo.antes + 1 && canalAoVivo.naTela,
   JSON.stringify(canalAoVivo));

/* ---- 48d. empresa nova entra na lista sem recarregar ---- */
const empresaNova = await page.evaluate(async ()=>{
  const antes = CLIENTS.length;
  window.__FIX.clients.push({id:'c-vivo', nome:'Empresa Recém Criada',
    logo_url:null, resumo:'', plano_midia:false});
  window.__disparar('clients','INSERT',{id:'c-vivo'});
  await new Promise(r=>setTimeout(r,900));
  const r = {antes, depois: CLIENTS.length,
             achou: !!CLIENTS.find(c=>c.id === 'c-vivo')};
  window.__FIX.clients = window.__FIX.clients.filter(c=>c.id !== 'c-vivo');
  await loadClients();
  return r;
});
ok('48d empresa criada por outro entra na lista sem recarregar',
   empresaNova.depois === empresaNova.antes + 1 && empresaNova.achou,
   JSON.stringify(empresaNova));

/* ---- 48e. a rajada vira uma recarga só ---- */
const rajada = await page.evaluate(async ()=>{
  let recargas = 0;
  const _lc = window.loadClients;
  window.loadClients = async function(){ recargas++; return _lc.apply(this, arguments) };
  /* criar uma empresa dispara vários eventos seguidos na vida real */
  for(let i=0;i<8;i++) window.__disparar('clients','UPDATE',{id:'c-1'});
  await new Promise(r=>setTimeout(r,900));
  window.loadClients = _lc;
  return {eventos:8, recargas};
});
ok('48e oito eventos seguidos viram uma recarga só',
   rajada.recargas === 1, JSON.stringify(rajada));

/* =====================================================================
   49. Datas, autoria, menções e o sino no topo

   Fixture própria: a t-1 passa por quarenta e oito casos antes de chegar
   aqui e pode ter sido arquivada por qualquer um deles. Caso que depende
   do estado deixado pelo vizinho quebra por motivo que não é o dele.
   ===================================================================== */
await page.evaluate(async ()=>{
  window.__FIX.tasks = (window.__FIX.tasks||[]).filter(t=>t.id!=='t-aj');
  window.__FIX.tasks.push({id:'t-aj', client_id:'c-1', title:'Demanda dos ajustes',
    description:'sem menção nenhuma', status:'Não iniciado', priority:'Alta',
    assignees:['Vinícius'], assignee_ids:['u-admin'], due:null, start_date:null,
    recurrence:'none', subtasks:[{text:'sub', done:false}], time_spent:0, timer_start:null,
    position:99, created_at:'2026-09-01T10:00:00Z', updated_at:'2026-09-01T10:00:00Z',
    completed_at:null, created_by:'u-colega',
    archived:false, urgente:false, anexos:[], project_id:null});
  window.__FIX.task_mentions = [];
  await loadTasks(); render();
});

/* ---- 49. início e prazo final no detalhe; abertura sem campo ---- */
const datas = await page.evaluate(async ()=>{
  await openDetail('t-aj');
  await new Promise(r=>setTimeout(r,320));
  const s = document.getElementById('slide');
  const rot = [...s.querySelectorAll('.frow .fl')].map(e=>e.textContent.trim());
  const ini = document.getElementById('d-start');
  const fim = document.getElementById('d-due');
  if(ini) ini.value = '2026-09-15';
  if(fim) fim.value = '2026-09-30';
  await saveDetail();
  await new Promise(r=>setTimeout(r,320));
  const t = TASKS.find(x=>x.id==='t-aj');
  return {rot, temInicio:!!ini, temFim:!!fim,
          gravouInicio: t.start_date, gravouFim: t.due,
          /* a abertura não pode ter campo editável em lugar nenhum */
          editaAbertura: !!s.querySelector('input[value*="2026-09-01"]')};
});
ok('49 início e prazo final são campos, e a abertura não é editável',
   datas.temInicio && datas.temFim && datas.gravouInicio === '2026-09-15'
   && datas.gravouFim === '2026-09-30' && !datas.editaAbertura
   && datas.rot.includes('Início') && datas.rot.includes('Prazo final'),
   JSON.stringify(datas));

/* ---- 49b. recorrência mensal ---- */
const mensal = await page.evaluate(async ()=>{
  const sel = document.getElementById('d-rec');
  const opts = sel ? [...sel.options].map(o=>o.value) : [];
  /* 31/01 + 1 mês tem que cair em 28/02, e não em 03/03 */
  await maybeRecur({id:'t-aj', client_id:'c-1', title:'Recorrente', description:'',
                    priority:'Média', assignees:[], due:'2027-01-31', recurrence:'monthly'});
  await new Promise(r=>setTimeout(r,260));
  const nova = (window.__FIX.tasks||[]).filter(t=>t.title==='Recorrente').pop();
  return {opts, prazo: nova && nova.due, criou: !!nova};
});
ok('49b recorrência tem Mensal, e o mês curto não vira 3 de março',
   mensal.opts.includes('monthly') && mensal.criou && mensal.prazo === '2027-02-28',
   JSON.stringify(mensal));

/* ---- 49c. quem abriu aparece no card fechado e no aberto ---- */
const autoria = await page.evaluate(async ()=>{
  await showView('board');
  await new Promise(r=>setTimeout(r,420));
  const card = document.querySelector('.card-t[data-id="t-aj"]');
  const fechado = card ? (card.querySelector('.mg-aberta')||{}).textContent || '' : '';
  await openDetail('t-aj');
  await new Promise(r=>setTimeout(r,340));
  const linha = document.querySelector('#slide .slide-h .mg-abriu');
  return {fechado, aberto: linha ? linha.textContent : '',
          temFoto: !!(linha && linha.querySelector('.mgu-av'))};
});
ok('49c a data de abertura e quem abriu aparecem nos dois estados do card',
   /Aberta em/.test(autoria.fechado) && /Elias/.test(autoria.fechado)
   && /Aberta em/.test(autoria.aberto) && /Elias/.test(autoria.aberto)
   && autoria.temFoto,
   JSON.stringify(autoria));

/* ---- 49d. cliente fora de responsáveis ---- */
const semCliente = await page.evaluate(async ()=>{
  await loadTeam(); buildAssigneeOptions();
  const equipe = MGU.todos({equipe:true}).map(u=>u.nome);
  return {opts: ASSIGNEE_OPTS.slice(),
          time: TEAM.map(u=>u.nome),
          equipe,
          /* a Flavia existe no diretório, então o teste prova o filtro
             e não a ausência do cadastro */
          conhecida: !!MGU.get('Flavia')};
});
ok('49d cliente não entra na lista de responsáveis',
   semCliente.conhecida
   && !semCliente.opts.some(n=>/flavia/i.test(n))
   && !semCliente.time.some(n=>/flavia/i.test(n))
   && semCliente.opts.some(n=>/vin[íi]cius|elias/i.test(n)),
   JSON.stringify(semCliente));

/* ---- 49e. o @ abre a lista e insere o nome ---- */
const arroba = await page.evaluate(async ()=>{
  await openDetail('t-aj');
  await new Promise(r=>setTimeout(r,340));
  const ta = document.getElementById('d-note-input');
  ta.focus(); ta.value = 'olha isso @el';
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.dispatchEvent(new Event('input', {bubbles:true}));
  await new Promise(r=>setTimeout(r,160));
  /* rolar o painel não pode fechar a lista: focar a caixa já rola sozinho,
     e era isso que matava a lista no mesmo quadro em que ela nascia */
  const painel = document.querySelector('#slide .slide-b');
  if(painel){ painel.scrollTop = painel.scrollTop + 30;
              painel.dispatchEvent(new Event('scroll', {bubbles:true})); }
  await new Promise(r=>setTimeout(r,120));
  const cx = document.querySelector('.mg-arroba');
  const aberta = !!(cx && cx.classList.contains('on'));
  const nomes = cx ? [...cx.querySelectorAll('.it .nm')].map(e=>e.textContent) : [];
  const it = cx && cx.querySelector('.it');
  if(it) it.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
  await new Promise(r=>setTimeout(r,120));
  const depois = ta.value;
  window.mgArrobaFechar();
  return {aberta, nomes, depois,
          /* eu mesmo não entro na lista: marcar a si próprio não avisa ninguém */
          temEu: nomes.some(n=>/vin[íi]cius/i.test(n))};
});
ok('49e digitar @ abre a lista do time e o clique insere o nome',
   arroba.aberta && arroba.nomes.some(n=>/Elias/.test(n)) && !arroba.temEu
   && /@Elias\s$/.test(arroba.depois),
   JSON.stringify(arroba));

/* ---- 49f. a menção grava e o aviso chega ---- */
const mencao = await page.evaluate(async ()=>{
  await openDetail('t-aj');
  await new Promise(r=>setTimeout(r,340));
  const ta = document.getElementById('d-note-input');
  ta.value = '@Elias confere o pixel, por favor';
  const vis = document.getElementById('d-note-vis'); if(vis) vis.value = 'equipe';
  await addNote();
  await new Promise(r=>setTimeout(r,420));
  const linhas = (window.__FIX.task_mentions||[]);
  return {gravadas: linhas.length,
          alvo: linhas[0] && linhas[0].alvo_id,
          origem: linhas[0] && linhas[0].origem,
          trecho: linhas[0] && linhas[0].trecho};
});
ok('49f marcar alguém na anotação grava a menção para essa pessoa',
   mencao.gravadas === 1 && mencao.alvo === 'u-colega' && mencao.origem === 'nota'
   && /pixel/.test(mencao.trecho||''),
   JSON.stringify(mencao));

const chegou = await page.evaluate(async ()=>{
  document.querySelectorAll('.mg-aviso').forEach(e=>e.remove());
  /* um aviso endereçado a outra pessoa não pode aparecer para mim */
  window.__disparar('task_mentions','INSERT',{id:'me-x', task_id:'t-aj', alvo_id:'u-outro',
    autor_id:'u-colega', autor_nome:'Elias Braga', trecho:'não é para você', lida:false,
    created_at:new Date().toISOString()});
  await new Promise(r=>setTimeout(r,220));
  const alheio = document.querySelectorAll('.mg-aviso').length;

  window.__disparar('task_mentions','INSERT',{id:'me-1', task_id:'t-aj', alvo_id: ME.id,
    autor_id:'u-colega', autor_nome:'Elias Braga', trecho:'dá uma olhada nisso', lida:false,
    created_at:new Date().toISOString()});
  await new Promise(r=>setTimeout(r,320));
  const cartao = document.querySelector('.mg-aviso');
  return {alheio,
          meu: !!cartao,
          titulo: cartao ? (cartao.querySelector('.tt')||{}).textContent : '',
          corpo:  cartao ? (cartao.querySelector('.cp')||{}).textContent : '',
          noSino: (NOTIFS||[]).some(i=>/marcou você/.test(i.text||''))};
});
ok('49g o aviso de menção chega na tela e no sino, e só para quem foi marcado',
   chegou.alheio === 0 && chegou.meu && /Elias/.test(chegou.titulo)
   && /marcou você/.test(chegou.titulo) && /olhada/.test(chegou.corpo) && chegou.noSino,
   JSON.stringify(chegou));

/* ---- 49h. o sino é um só, e fica no topo ---- */
const sino = await page.evaluate(async ()=>{
  await showView('board');
  await new Promise(r=>setTimeout(r,420));
  updateNotifBadge();
  const b = document.getElementById('notif-btn');
  const r = b ? b.getBoundingClientRect() : null;
  const dock = document.querySelector('.mg-dock');
  return {temTopo: !!b,
          rotulo: b ? b.textContent.replace(/\s+/g,' ').trim() : '',
          acimaDoMeio: !!(r && r.top < window.innerHeight/2),
          sinoNaBarra: !!(dock && /mgTocarNotifs/.test(dock.innerHTML)),
          sinosNaBarra: dock ? (dock.innerHTML.match(/🔔/g)||[]).length : 0};
});
ok('49h o sino fica no topo com rótulo, e sai da barra de baixo',
   sino.temTopo && /Avisos/.test(sino.rotulo) && sino.acimaDoMeio
   && !sino.sinoNaBarra && sino.sinosNaBarra === 0,
   JSON.stringify(sino));

/* ---- 49i. uma rolagem só, e escrever vem antes de ler ----
   Já esteve pior de duas formas, e as duas apareceram na tela de quem usa:
   primeiro a caixa de escrever ficava colada no fim da coluna e uma
   checklist de vinte itens a empurrava para fora da tela; depois, com a
   caixa grudada no rodapé e a lista de anotações sem rolagem própria, ela
   passou a boiar no meio das anotações, com texto acima e abaixo dela.
   O que vale agora: o painel é a única coisa que rola, e a caixa de
   escrever fica no alto da coluna, antes da lista. */
const layout = await page.evaluate(async ()=>{
  const t = TASKS.find(x=>x.id==='t-aj');
  const guarda = t.subtasks;
  t.subtasks = Array.from({length:24}, (_,i)=>({text:'item '+(i+1), done:false}));
  await openDetail('t-aj');
  await new Promise(r=>setTimeout(r,480));

  const rolantes = [];
  document.querySelectorAll('#slide *').forEach(e=>{
    const st = getComputedStyle(e);
    if((st.overflowY === 'auto' || st.overflowY === 'scroll')
       && e.scrollHeight > e.clientHeight + 4){
      rolantes.push((e.id ? '#'+e.id : '.') + String(e.className).split(' ')[0]);
    }
  });

  const col   = document.querySelector('#slide .mg-det-grade .mg-det-col:last-child');
  const form  = col ? col.querySelector('.note-form') : null;
  const notas = col ? col.querySelector('#d-notes') : null;
  const saida = {
    rolantes,
    /* a caixa vem ANTES da lista na ordem do documento */
    escreverAntesDeLer: !!(form && notas &&
      (form.compareDocumentPosition(notas) & Node.DOCUMENT_POSITION_FOLLOWING)),
    posicao: form ? getComputedStyle(form).position : null,
    /* e não cobre anotação nenhuma */
    cobreAnotacao: !!(form && notas &&
      form.getBoundingClientRect().bottom > notas.getBoundingClientRect().top + 2)
  };
  t.subtasks = guarda;
  return saida;
});
ok('49i o painel tem uma rolagem só, e a caixa de escrever vem antes da lista',
   layout.rolantes.length === 1 && /slide-b/.test(layout.rolantes[0])
   && layout.escreverAntesDeLer && layout.posicao === 'static'
   && !layout.cobreAnotacao,
   JSON.stringify(layout));

/* =====================================================================
   50. Subtarefas Implementação/Double Check
   ===================================================================== */
await page.evaluate(async ()=>{
  window.__FIX.tasks = (window.__FIX.tasks||[]).filter(t=>t.id!=='t-dc');
  window.__FIX.tasks.push({id:'t-dc', client_id:'c-1', title:'Subir campanha de outubro',
    description:'', status:'Não iniciado', priority:'Alta',
    assignees:['Vinícius'], assignee_ids:['u-admin'], due:null, start_date:null,
    recurrence:'none', subtasks:[{text:'item que eu escrevi à mão', done:false}],
    plataformas:[], time_spent:0, timer_start:null,
    position:98, created_at:'2026-09-02T10:00:00Z', updated_at:'2026-09-02T10:00:00Z',
    completed_at:null, created_by:'u-admin',
    archived:false, urgente:false, anexos:[], project_id:null});
  await loadTasks(); render();
});

/* ---- 50. os cinco botões, dentro do título pedido ---- */
const botoes = await page.evaluate(async ()=>{
  await openDetail('t-dc');
  await new Promise(r=>setTimeout(r,420));
  const cab = document.querySelector('#slide .mg-dc-cab .tt');
  const bs = [...document.querySelectorAll('#slide .mg-dc-plat')].map(b=>b.textContent.trim());
  return {titulo: cab ? cab.textContent.trim() : '', botoes: bs,
          ligados: [...document.querySelectorAll('#slide .mg-dc-plat.on')].length,
          /* o campo de escrever item à mão continua ali */
          manual: !!document.getElementById('d-sub-input')};
});
ok('50 os cinco botões aparecem sob o título de Implementação/Double Check',
   /Subtarefas Implementação\/Double Check/.test(botoes.titulo)
   && botoes.botoes.join('|') === 'Meta|Google|TikTok|Pinterest|Bing'
   && botoes.ligados === 0 && botoes.manual,
   JSON.stringify(botoes));

/* ---- 50b. ligar o Meta abre os blocos na ordem certa ---- */
const ligouMeta = await page.evaluate(async ()=>{
  await mgDCAlternar('meta');
  await new Promise(r=>setTimeout(r,520));
  const t = TASKS.find(x=>x.id==='t-dc');
  const blocos = [...document.querySelectorAll('#slide .mg-dc-bloco')].map(e=>e.textContent.trim());
  const linhas = [...document.querySelectorAll('#slide #d-subs .sub .st')].map(e=>e.textContent.trim());
  return {plataformas: t.plataformas,
          blocos,
          primeiro: linhas[0],
          geral: linhas.filter(x=>x==='Nome da campanha no padrão').length,
          meta: linhas.filter(x=>/Exclusões aplicadas/.test(x)).length,
          fim: linhas.slice(-3),
          /* o item escrito à mão não pode ter sumido nem mudado de lugar */
          manualNoFim: linhas[linhas.length-1] === 'item que eu escrevi à mão',
          total: linhas.length};
});
ok('50b ligar Meta abre implementação, geral, específico e "para todos"',
   ligouMeta.plataformas.join() === 'meta'
   && ligouMeta.primeiro === 'Implementação da campanha'
   && ligouMeta.geral === 1 && ligouMeta.meta === 1
   && ligouMeta.blocos.some(b=>/Implementação/i.test(b))
   && ligouMeta.blocos.some(b=>/Double check e ativação/i.test(b))
   && ligouMeta.blocos.some(b=>/^Meta$/.test(b))
   && ligouMeta.blocos.some(b=>/Para todos/i.test(b))
   && ligouMeta.fim.includes('Campanha Ativada')
   && ligouMeta.manualNoFim
   && ligouMeta.total === 1 + 10 + 2 + 2 + 1,
   JSON.stringify(ligouMeta));

/* ---- 50c. o selo laranja depende dos dois lados ---- */
const selo = await page.evaluate(async ()=>{
  const t = TASKS.find(x=>x.id==='t-dc');
  const antes = mgDCEstado(t).aguardando;
  /* marca a implementação */
  const i = t.subtasks.findIndex(x=>x.mgBloco==='impl');
  toggleSub(i);
  await new Promise(r=>setTimeout(r,320));
  const noDetalhe = (document.querySelector('#slide .slide-h .mg-dc-selo')||{}).textContent || '';
  await showView('board');
  await new Promise(r=>setTimeout(r,420));
  const card = document.querySelector('.card-t[data-id="t-dc"]');
  const noCard = card ? (card.querySelector('.mg-dc-selo')||{}).textContent || '' : '';
  const cor = card && card.querySelector('.mg-dc-selo')
    ? getComputedStyle(card.querySelector('.mg-dc-selo')).backgroundColor : '';
  /* conferindo tudo, o selo sai: selo que nunca some ninguém olha */
  t.subtasks.forEach(x=>{ if(x.mgBloco==='dc'||x.mgBloco==='fim') x.done = true });
  const depoisDeTudo = mgDCEstado(t).aguardando;
  return {antes, noDetalhe, noCard, cor, depoisDeTudo};
});
ok('50c o selo laranja aparece após a implementação e some quando o check acaba',
   selo.antes === false
   && /aguardando double check/i.test(selo.noDetalhe)
   && /aguardando double check/i.test(selo.noCard)
   && selo.cor === 'rgb(224, 122, 31)'
   && selo.depoisDeTudo === false,
   JSON.stringify(selo));

/* ---- 50d. segunda plataforma não duplica o que é comum ---- */
const duas = await page.evaluate(async ()=>{
  const t = TASKS.find(x=>x.id==='t-dc');
  t.subtasks.forEach(x=>{ if(x.mgBloco==='dc'||x.mgBloco==='fim') x.done = false });
  const marcado = t.subtasks.find(x=>x.mgChave==='dc:geral:0');
  marcado.done = true;                        /* já conferi este */
  await openDetail('t-dc');
  await new Promise(r=>setTimeout(r,380));
  await mgDCAlternar('bing');
  await new Promise(r=>setTimeout(r,520));
  const t2 = TASKS.find(x=>x.id==='t-dc');
  const linhas = t2.subtasks.map(x=>x.text);
  return {plataformas: t2.plataformas,
          geral: linhas.filter(x=>x==='Nome da campanha no padrão').length,
          impl:  linhas.filter(x=>x==='Implementação da campanha').length,
          fim:   linhas.filter(x=>x==='Campanha Ativada').length,
          bing:  linhas.filter(x=>/Tag UET/.test(x)).length,
          meta:  linhas.filter(x=>/Exclusões aplicadas/.test(x)).length,
          /* o que já estava conferido continua conferido */
          manteveCheck: !!(t2.subtasks.find(x=>x.mgChave==='dc:geral:0')||{}).done,
          total: t2.subtasks.length};
});
ok('50d ligar a segunda plataforma soma só o específico dela e preserva o check',
   duas.plataformas.join() === 'meta,bing'
   && duas.geral === 1 && duas.impl === 1 && duas.fim === 1
   && duas.bing === 1 && duas.meta === 1
   && duas.manteveCheck
   && duas.total === 1 + 10 + 2 + 8 + 2 + 1,
   JSON.stringify(duas));

/* ---- 50e. desligar leva só o específico, e avisa se tinha check ---- */
const desligou = await page.evaluate(async ()=>{
  const t = TASKS.find(x=>x.id==='t-dc');
  t.subtasks.find(x=>x.mgChave==='dc:bing:0').done = true;
  let perguntou = false;
  const _c = window.confirm;
  window.confirm = (msg)=>{ perguntou = /Bing/.test(msg) && /1 item já conferido/.test(msg); return true };
  await mgDCAlternar('bing');
  await new Promise(r=>setTimeout(r,520));
  window.confirm = _c;
  const t2 = TASKS.find(x=>x.id==='t-dc');
  const linhas = t2.subtasks.map(x=>x.text);
  return {perguntou, plataformas: t2.plataformas,
          bing: linhas.filter(x=>/Tag UET/.test(x)).length,
          geral: linhas.filter(x=>x==='Nome da campanha no padrão').length,
          meta: linhas.filter(x=>/Exclusões aplicadas/.test(x)).length,
          manual: linhas.filter(x=>x==='item que eu escrevi à mão').length,
          total: t2.subtasks.length};
});
ok('50e desligar Bing pergunta antes e tira só os itens dele',
   desligou.perguntou && desligou.plataformas.join() === 'meta'
   && desligou.bing === 0 && desligou.geral === 1 && desligou.meta === 1
   && desligou.manual === 1
   && desligou.total === 1 + 10 + 2 + 2 + 1,
   JSON.stringify(desligou));

/* ---- 50f. sem plataforma nenhuma, a demanda volta ao que era ---- */
const zerou = await page.evaluate(async ()=>{
  const _c = window.confirm; window.confirm = ()=>true;
  await mgDCAlternar('meta');
  await new Promise(r=>setTimeout(r,520));
  window.confirm = _c;
  const t = TASKS.find(x=>x.id==='t-dc');
  const cx = document.getElementById('d-subs');
  /* e dá para escrever item à mão do mesmo jeito */
  const inp = document.getElementById('d-sub-input');
  if(inp){ inp.value = 'outro item meu'; addSub(); }
  await new Promise(r=>setTimeout(r,320));
  const t2 = TASKS.find(x=>x.id==='t-dc');
  return {plataformas: t2.plataformas,
          itens: t2.subtasks.map(x=>x.text),
          automaticos: t2.subtasks.filter(x=>x.mgChave).length,
          blocos: cx ? cx.querySelectorAll('.mg-dc-bloco').length : -1};
});
ok('50f desligar tudo devolve a lista manual, e continua dando para escrever item',
   zerou.plataformas.length === 0 && zerou.automaticos === 0
   && zerou.itens.join('|') === 'item que eu escrevi à mão|outro item meu'
   && zerou.blocos === 0,
   JSON.stringify(zerou));

/* ---- 50h. a checklist cabe na tela, e não um item por vez ----
   O primeiro corte que eu fiz limitou a caixa a 270px sem olhar a altura da
   linha: com os três campos por item, cada linha passava de 130px e a lista
   virava uma janelinha de UM item. "Rola" não prova nada; o que prova é
   quantos itens dá para ver sem rolar. */
const cabe = await page.evaluate(async ()=>{
  const t = TASKS.find(x=>x.id==='t-dc');
  t.plataformas = ['meta'];
  mgDCSincronizar(t);
  await openDetail('t-dc');
  await new Promise(r=>setTimeout(r,480));
  const cx = document.querySelector('#slide .mg-det-col .subs');
  if(!cx) return {erro:'sem caixa'};
  const linhas = [...cx.querySelectorAll('.sub')];
  const conferencia = linhas.filter(l=>l.classList.contains('mg-dc-simples'));
  const alta = conferencia.map(l=>Math.round(l.getBoundingClientRect().height)).sort((x,y)=>x-y);
  const impl = linhas.find(l=>!l.classList.contains('mg-dc-simples'));
  /* a mediana, e não o maior: item comprido quebra em duas linhas de
     propósito, e reprovar por causa dele mediria o texto, não a densidade */
  return {itens: linhas.length,
          alturaTipica: alta.length ? alta[Math.floor(alta.length/2)] : null,
          alturaMaxima:  alta.length ? alta[alta.length-1] : null,
          /* responsável e prazo continuam onde foram pedidos: na
             implementação, e em quem for escrito à mão */
          implTemCampos: !!(impl && impl.querySelector('.mg-sub-campos .rs')),
          conferenciaSemCampos: conferencia.every(
            l => getComputedStyle(l.querySelector('.mg-sub-campos')).display === 'none')};
});
/* A contagem de itens visíveis saiu: a checklist não tem mais janela
   própria, então "visível dentro da caixa" passou a ser sempre tudo e a
   afirmação não provava mais nada. O que continua valendo, e é a causa do
   problema original, é a altura da linha: com os três campos por item ela
   passava de 130px. */
ok('50h o item de conferência é uma linha, e não um bloco de três campos',
   cabe.itens >= 15
   && cabe.alturaTipica !== null && cabe.alturaTipica <= 40
   && cabe.alturaMaxima <= 70          /* duas linhas, nunca as três de antes */
   && cabe.implTemCampos && cabe.conferenciaSemCampos,
   JSON.stringify(cabe));

/* ---- 50g. a checklist interna não vai para o cliente ---- */
const noCliente = await page.evaluate(async ()=>{
  const t = TASKS.find(x=>x.id==='t-dc');
  t.plataformas = ['google'];
  mgDCSincronizar(t);
  const _adm = window.isAdmin;
  window.isAdmin = ()=>false;                 /* olhando com olho de cliente */
  const html = renderSubtasks(t);
  window.isAdmin = _adm;
  return {temInterno: /Rede de Display|Nome da campanha no padrão/.test(html),
          temManual: /item que eu escrevi à mão/.test(html)};
});
ok('50g o cliente não enxerga a conferência interna, só o item escrito à mão',
   !noCliente.temInterno && noCliente.temManual, JSON.stringify(noCliente));

/* =====================================================================
   51. Seletor de responsáveis
   ===================================================================== */

/* ---- 51. o nome escolhido aparece escolhido ----
   O defeito vinha de dois nós com id="asg-pick", um no painel de detalhe e
   outro na janela de nova demanda. getElementById devolve o primeiro do
   documento, e o do painel vem antes. Clicar na janela redesenhava o
   picker escondido: o nome entrava na lista e a tela não mudava. Só
   aparecia depois de abrir uma demanda alguma vez, que é o caminho de
   todo dia, e por isso o caso passa por ali antes. */
const seletor = await page.evaluate(async ()=>{
  const abrir = async (raiz)=>{
    const b = raiz.querySelector('.mg-resp-btn'); if(!b) return null;
    b.click(); await new Promise(r=>setTimeout(r,220));
    return document.querySelector('.mg-resp-lista.on');
  };
  const marcar = async (nome)=>{
    const lista = document.querySelector('.mg-resp-lista.on'); if(!lista) return false;
    const it = [...lista.querySelectorAll('.it')].find(e=>new RegExp(nome).test(e.textContent));
    if(!it) return false;
    it.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
    await new Promise(r=>setTimeout(r,220));
    return true;
  };

  await openDetail('t-aj'); await new Promise(r=>setTimeout(r,380));
  closeDetail(); await new Promise(r=>setTimeout(r,200));
  _selAssignees = [];
  openTaskModal(); await new Promise(r=>setTimeout(r,320));
  const modal = document.getElementById('tmodal-c');

  const lista = await abrir(modal);
  const nomes = lista ? [...lista.querySelectorAll('.it .nm')].map(e=>e.textContent) : [];
  await marcar('Elias');
  await marcar('Everton');
  const btn = modal.querySelector('.mg-resp-btn');
  const saida = {
    abriu: !!lista, nomes,
    etiquetas: [...btn.querySelectorAll('.mg-resp-eti .nm')].map(e=>e.textContent),
    marcados: [...document.querySelectorAll('.mg-resp-lista .it.on .nm')].map(e=>e.textContent),
    array: _selAssignees.slice(),
    /* a lista não pode fechar sozinha a cada nome marcado */
    continuaAberta: !!document.querySelector('.mg-resp-lista.on'),
    idRepetido: document.querySelectorAll('[id="asg-pick"]').length,
    clienteNaLista: nomes.some(n=>/flavia/i.test(n))
  };
  await marcar('Elias');                     /* desmarcar volta atrás */
  saida.depoisDeTirar = [...modal.querySelector('.mg-resp-btn')
    .querySelectorAll('.mg-resp-eti .nm')].map(e=>e.textContent);
  mgRespBuscar('ever'); await new Promise(r=>setTimeout(r,180));
  saida.busca = [...document.querySelectorAll('.mg-resp-lista .it .nm')].map(e=>e.textContent);
  mgRespFechar();
  saida.fechou = !document.querySelector('.mg-resp-lista.on');
  document.getElementById('tmodal').classList.remove('on');
  return saida;
});
ok('51 escolher responsável na janela de nova demanda aparece na tela',
   seletor.abriu
   && seletor.etiquetas.join() === 'Elias,Everton'
   && seletor.marcados.join() === 'Elias,Everton'
   && seletor.array.join() === 'Elias,Everton'
   && seletor.continuaAberta
   && seletor.depoisDeTirar.join() === 'Everton'
   && seletor.busca.join() === 'Everton'
   && seletor.fechou
   && seletor.idRepetido === 0
   && !seletor.clienteNaLista,
   JSON.stringify(seletor));

/* =====================================================================
   52. Varredura: peso do quadro, som e resposta ao toque
   ===================================================================== */

/* ---- 52. o logo não viaja dentro de cada card ----
   Medido com as 456 demandas da conta: o quadro levava 7,1 s para desenhar
   porque cada card carregava o logo inteiro em base64. O caso guarda o
   TAMANHO do card, que é a causa, e não o tempo, que muda com a máquina.
   E mede um card só: clonar centenas de demandas aqui não acrescentava
   nada à afirmação e só deixava a página pesada no fim da suíte. */
const peso = await page.evaluate(async ()=>{
  await showView('board');
  await new Promise(r=>setTimeout(r,500));
  const cru = (CLIENTS.find(c=>c.logo_url)||{}).logo_url || '';
  const alvo = TASKS.find(t=>t.client_id && clientLogo(t.client_id)) || TASKS[0];
  const um = taskCard(alvo, '#000');
  const imgs = [...document.querySelectorAll('#v-board .card-t img')];
  await Promise.all(imgs.map(i=>i.complete ? null
    : new Promise(res=>{ i.onload=res; i.onerror=res })));
  return {
    base64Bruto: cru.length,
    tamanhoDoCard: um.length,
    cardTemBase64: /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{200,}/.test(um),
    imagens: imgs.length,
    carregaram: imgs.filter(i=>i.naturalWidth > 0).length,
    /* um blob por imagem distinta, e não um por card */
    blobs: window.mgLogoCache ? window.mgLogoCache.size : null
  };
});
/* A comparação é entre o logo e o card, não contra um número fixo: o caso
   41 encolhe o logo do cliente antes de chegar aqui, e um teto absoluto
   reprovaria por causa do vizinho. O que precisa valer é a relação: o logo
   é muito maior que o card inteiro, logo ele não está lá dentro. */
ok('52 o card não carrega o logo em base64, e a imagem continua aparecendo',
   peso.base64Bruto > peso.tamanhoDoCard * 3 && !peso.cardTemBase64
   && peso.tamanhoDoCard < 4000
   && peso.imagens > 0 && peso.carregaram === peso.imagens
   && peso.blobs !== null && peso.blobs <= 4,
   JSON.stringify(peso));

/* ---- 52b. o som faz o que o botão diz ----
   Havia duas mgAlternarSom no arquivo. A segunda, sem argumento, apagava a
   primeira: os botões das Configurações mandavam 'on' ou 'off', o valor era
   jogado fora e a função só invertia. Pedir "Ligado" desligava. */
const som = await page.evaluate(async ()=>{
  const ler = ()=>({guardado: localStorage.getItem(MG_SOM_KEY),
                    pref: (typeof PREFS==='object'&&PREFS)?PREFS.som:null,
                    ligado: mgSomLigado()});
  localStorage.setItem(MG_SOM_KEY,'on'); if(typeof PREFS==='object') PREFS.som='on';
  mgAlternarSom('on');   const pedindoLigado = ler();
  mgAlternarSom('off');  const pedindoDesligado = ler();
  mgAlternarSom('on');   const voltando = ler();
  mgAlternarSom();       const semValor = ler();      /* sem valor, alterna */
  return {aceitaValor: mgAlternarSom.length >= 1,
          pedindoLigado, pedindoDesligado, voltando, semValor};
});
ok('52b pedir Ligado liga e pedir Desligado desliga, nas duas guardas',
   som.aceitaValor
   && som.pedindoLigado.ligado === true  && som.pedindoLigado.pref === 'on'
   && som.pedindoDesligado.ligado === false && som.pedindoDesligado.pref === 'off'
   && som.voltando.ligado === true
   && som.semValor.ligado === false,
   JSON.stringify(som));

/* ---- 52c. o botão afunda ao ser pressionado ---- */
const toque = await page.evaluate(async ()=>{
  await showView('board'); await new Promise(r=>setTimeout(r,420));
  const b = document.querySelector('.btn-p, .icon-btn, .mini-btn, button');
  if(!b) return {erro:'sem botão'};
  const parado = getComputedStyle(b).transform;
  const regra = [...document.styleSheets].some(f=>{
    try{ return [...f.cssRules].some(r =>
      r.selectorText && /:active/.test(r.selectorText)
      && r.style && /scale/.test(r.style.transform || '')) }
    catch(e){ return false }
  });
  const temTransicao = /transform/.test(getComputedStyle(b).transitionProperty);
  return {parado, regraDeAperto: regra, temTransicao};
});
ok('52c botão tem transição e afunda quando pressionado',
   toque.regraDeAperto && toque.temTransicao
   && (toque.parado === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(toque.parado)),
   JSON.stringify(toque));

/* =====================================================================
   53. Marcar gente com @ no MGP Chat
   ===================================================================== */
const chatArroba = await page.evaluate(async ()=>{
  await showView('chat'); await new Promise(r=>setTimeout(r,900));
  const ta = document.getElementById('mgz-in');
  if(!ta) return {erro:'sem caixa do chat'};

  ta.focus(); ta.value = 'bom dia @el';
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,260));
  const lista = document.querySelector('.mg-arroba.on');
  const nomes = lista ? [...lista.querySelectorAll('.it .nm')].map(e=>e.textContent) : [];

  /* Enter com a lista aberta escolhe o nome; não envia a mensagem.
     preventDefault sozinho não resolvia: o Enter seguia até a caixa e
     mandava "bom dia @el" pela metade. */
  const ev = new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
  ta.dispatchEvent(ev);
  await new Promise(r=>setTimeout(r,260));
  const depoisDoEnter = (document.getElementById('mgz-in')||{}).value;
  const listaFechou = !document.querySelector('.mg-arroba.on');

  /* e a mensagem enviada sai com o nome marcado */
  const meu = ME.name.split(' ')[0];
  window.__FIX.messages.push({id:'m-arroba', channel_id:'ch-1',
    author_id:'u-colega', author_name:'Elias Braga',
    body:'@'+meu+' confere com contato@empresa.com.br e veja '
       + 'https://modestopartners.com.br isso é *urgente*',
    kind:'user', created_at:new Date().toISOString(),
    reply_to:null, reactions:{}, anexos:[]});
  /* recarregar, e não só abrir: a esta altura da suíte o canal já pode
     estar aberto, e abrir() num canal já aberto não busca mensagem nova */
  await MGChat.abrir('ch-1');
  await MGChat.recarregar();
  await new Promise(r=>setTimeout(r,900));
  const bolha = document.querySelector('.mgz-m[data-id="m-arroba"] .tx');
  const saida = {
    /* o diagnóstico vem primeiro: a linha de falha é cortada em 150 letras */
    achouBolha: !!bolha, canal: MGChat.canal,
    naTela: document.querySelectorAll('.mgz-m').length,
    abriu: !!lista, nomes, depoisDoEnter, listaFechou,
    marcas: bolha ? [...bolha.querySelectorAll('.mgz-arroba')].map(e=>e.textContent) : [],
    meuDestaque: !!(bolha && bolha.querySelector('.mgz-arroba.eu')),
    /* endereço de e-mail não vira marcação, e o resto da mensagem continua */
    emailIntacto: !!(bolha && /contato@empresa/.test(bolha.textContent)
                     && !/>@empresa</.test(bolha.innerHTML)),
    negrito: !!(bolha && bolha.querySelector('b')),
    link: !!(bolha && bolha.querySelector('a[href]'))
  };
  window.__FIX.messages = window.__FIX.messages.filter(m=>m.id !== 'm-arroba');
  if(window.mgArrobaFechar) window.mgArrobaFechar();
  return saida;
});
ok('53 o @ do MGP Chat abre a lista, completa com Enter e marca o nome na mensagem',
   chatArroba.abriu
   && chatArroba.nomes.some(n=>/Elias/.test(n))
   && /@Elias\s$/.test(chatArroba.depoisDoEnter || '')
   && chatArroba.listaFechou
   && chatArroba.marcas.length === 1
   && chatArroba.meuDestaque
   && chatArroba.emailIntacto && chatArroba.negrito && chatArroba.link,
   JSON.stringify(chatArroba));

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
