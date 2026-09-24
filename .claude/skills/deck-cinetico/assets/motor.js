(function(){
  var reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $=function(s,r){return (r||document).querySelector(s);};
  var $$=function(s,r){return [].slice.call((r||document).querySelectorAll(s));};
  var raiz=document.documentElement;
  var clamp=function(v){return v<0?0:v>1?1:v;};
  var suave=function(t){t=clamp(t);return t*t*(3-2*t);};
  var fx=function(v,a,b){return suave((v-a)/(b-a));};

  $$('.anima').forEach(function(h){
    var txt=h.textContent.trim(); h.textContent='';
    txt.split(/\s+/).forEach(function(p,i){
      if(i) h.appendChild(document.createTextNode(' '));
      var s=document.createElement('span'); s.className='pl'; s.textContent=p;
      s.style.transitionDelay=(i*0.028)+'s'; h.appendChild(s);
    });
  });

  var cenas=$$('.cena');
  function hex(h){h=h.replace('#','');return [parseInt(h.substr(0,2),16),parseInt(h.substr(2,2),16),parseInt(h.substr(4,2),16)];}
  function rgb(c){return 'rgb('+Math.round(c[0])+','+Math.round(c[1])+','+Math.round(c[2])+')';}
  function lerp3(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}
  function lum(c){return (.2126*c[0]+.7152*c[1]+.0722*c[2])/255;}
  var paleta=cenas.map(function(c){return {bg:hex(c.dataset.bg||'#05303F'),fg:hex(c.dataset.fg||'#EAF3F6'),ac:hex(c.dataset.ac||'#31C2DE'),ato:c.dataset.ato||''};});

  if('IntersectionObserver' in window){
    var obs=new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ var c=e.target.closest('.cena'); if(c&&!c.classList.contains('viva')) c.classList.add('viva'); } });
    },{threshold:0,rootMargin:'0px 0px -12% 0px'});
    cenas.forEach(function(c){
      var f=Array.prototype.filter.call(c.children,function(x){return !x.classList.contains('ghost');});
      (f.length?f:[c]).forEach(function(x){obs.observe(x);});
    });
  } else cenas.forEach(function(c){c.classList.add('viva');});
  cenas[0].classList.add('viva');

  if(window.matchMedia('(pointer:fine)').matches && !reduz){
    $$('.cx').forEach(function(c){
      c.addEventListener('mousemove',function(e){
        var r=c.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
        c.style.transform='perspective(900px) rotateY('+(x*6)+'deg) rotateX('+(-y*6)+'deg) translateY(-4px)';
        c.style.transition='transform .12s ease, border-color .4s, box-shadow .4s';
      });
      c.addEventListener('mouseleave',function(){ c.style.transform=''; c.style.transition='transform .55s cubic-bezier(.16,.84,.28,1), border-color .4s, box-shadow .4s'; });
    });
  }

  var malha=$('#malha'),ctx=malha.getContext('2d'),corBase=hex('#05303F'),dk=1,W=96,H=60,yAtual=0;
  var blobs=[{x:.2,y:.25,r:.55,vx:.00012,vy:.00016,cl:'#0E6C8E',cd:'#31C2DE'},
             {x:.78,y:.35,r:.5,vx:.0001,vy:.00008,cl:'#8FD0E2',cd:'#0B5570'},
             {x:.5,y:.82,r:.6,vx:.00007,vy:.00013,cl:'#D6E9F0',cd:'#052532'}];
  function fundo(ts){
    ctx.globalCompositeOperation='source-over';ctx.fillStyle=rgb(corBase);ctx.fillRect(0,0,W,H);
    ctx.globalCompositeOperation=dk?'lighter':'multiply';
    blobs.forEach(function(b,i){
      var x=(b.x+Math.sin(ts*b.vx+i)*.18)*W,y=(b.y+Math.cos(ts*b.vy+i*1.7)*.16)*H-((yAtual*.014)%H);
      var r=b.r*Math.max(W,H),c=lerp3(hex(b.cl),hex(b.cd),dk),g=ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,'rgba('+Math.round(c[0])+','+Math.round(c[1])+','+Math.round(c[2])+',.5)');
      g.addColorStop(1,'rgba('+Math.round(c[0])+','+Math.round(c[1])+','+Math.round(c[2])+',0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    });
    ctx.globalCompositeOperation='source-over';
  }

  /* cenário do pátio */
  var pilhas=$('#pilhas');
  if(pilhas){
    var alturas=[3,5,2,4,6,3,5,2,4,3,5,4];
    alturas.forEach(function(n,i){
      var p=document.createElement('div'); p.className='pilha';
      for(var k=0;k<n;k++) p.appendChild(document.createElement('span'));
      pilhas.appendChild(p);
      if(i%4===1){ var h=document.createElement('div'); h.className='holofote'; h.style.left=(6+i*8)+'%'; pilhas.parentElement.appendChild(h); }
    });
  }
  var postes=$('#postes');
  if(postes){ for(var pz=0;pz<14;pz++){ var el=document.createElement('i'); el.style.left=(pz*9)+'%'; el.style.height=(38+((pz*37)%26))+'%'; postes.appendChild(el); } }

  var tabSec=$('#tablet'), trava=$('#trava'), travaTxt=$('#travaTxt'), travaSub=$('#travaSub'), tabRot=$('#tabRot');
  var kpis=$$('.kpi'), trs=$$('.pn-tab .tr'), pnTh=$('#pnTh'), pnPe=$('#pnPe');
  var jnSec=$('#jornada'), ptPalco=$('#palco'), palco=ptPalco, comboio=$('#comboio'), carreta=$('#carreta'), stacker=$('#stacker'), ctr40=$('#ctr40'), lanca=$('#lanca'), pontaL=$('#pontaL'), rig=$('#rig'), leito=$('#leito'), ctrItens=$$('#ctrLista li'), ctrMio=$('#ctrMio'), ctrSelo=$('#ctrSelo');
  var faixa=$('#faixa'), faixaPista=$('#faixaPista'), morros=$('#morros'), postes2=$('#postes'), pilhasEl=$('#pilhas'), poeira=$('#poeira'), rotaEl=$('#rota'), rotaMarcas=$('#rotaMarcas'), rotaFill=$('#rotaFill');
  var jnFase=$('#jnFase'), jnHint=$('#jnHint'), jnTitulo=$('#jnTitulo'), jnOlho=$('#jnOlho'), jnNota=$('#jnNota');
  var barra=$('#barra'), rotAto=$('#ato');
  var ghosts=$$('.ghost').map(function(g){return {el:g,sec:g.closest('.cena'),par:parseFloat(g.dataset.par||'.14'),top:0};});
  var M=[], giro=0, ultP=0;
  var G={base:{x:0,y:0},alvo:{x:0,y:0},alto:{x:0,y:0},entrada:0,rdBase:{x:0,y:0},rdAlvo:{x:0,y:0}};

  var ANG_ALTO=40, ANG_BAIXO=14;

  function centro(el,ref){
    var r=el.getBoundingClientRect(), p=ref.getBoundingClientRect();
    return {x:r.left-p.left+r.width/2, y:r.top-p.top+r.height/2, w:r.width, h:r.height};
  }
  function estreito(){ return window.innerWidth<=820; }

  function porAngulo(a){ lanca.setAttribute('transform','rotate('+a+' 604 296)'); return centro(pontaL,ptPalco); }

  function geoPatio(){
    if(!ctr40||!ptPalco||!ptPalco.clientWidth) return;
    var tc=ctr40.style.transform, ts=stacker.style.transform, tl=lanca.getAttribute('transform'), tk=carreta.style.transform, tm=comboio.style.transform;
    ctr40.style.transform='none'; stacker.style.transform='none'; carreta.style.transform='none'; comboio.style.transform='none';

    var cb=centro(ctr40,ptPalco); G.base={x:cb.x,y:cb.y}; G.hCtr=cb.h;
    var lt=centro(leito,ptPalco);
    G.alvo={x:lt.x, y:lt.y - cb.h/2 + 5};

    /* cabo (52) + spreader (17) + meia altura do contêiner */
    G.folga = 79 + cb.h/2;

    /* ângulo em que o spreader deixa o contêiner na altura do leito */
    var alvoSpY = G.alvo.y - G.folga, lo=2, hi=64;
    for(var it=0; it<24; it++){
      var mid=(lo+hi)/2, sp=porAngulo(mid);
      if(sp.y > alvoSpY) lo=mid; else hi=mid;
    }
    ANG_BAIXO = (lo+hi)/2;
    var spB = porAngulo(ANG_BAIXO);
    G.dxFim = G.alvo.x - spB.x;

    var spA = porAngulo(ANG_ALTO);
    G.dxIni = G.dxFim + ptPalco.clientWidth*0.10;
    G.spAlto = {x:spA.x, y:spA.y};
    G.foraX = -(centro(stacker,ptPalco).x + stacker.offsetWidth*0.62);

    ctr40.style.transform=tc; stacker.style.transform=ts; lanca.setAttribute('transform',tl); carreta.style.transform=tk; comboio.style.transform=tm;
  }

  function medir(){
    var vh=window.innerHeight;
    if(jnSec) jnSec.style.height = estreito()? '' : (vh*16)+'px';
    if(tabSec) tabSec.style.height = estreito()? '' : (vh*5)+'px';
    M=cenas.map(function(c){return {top:c.offsetTop,h:c.offsetHeight};});
    ghosts.forEach(function(g){g.top=g.sec.offsetTop;});
    if(!estreito()){ geoPatio(); }
  }
  function idx(s){return cenas.indexOf(s);}
  function prog(i){var m=M[i],vh=window.innerHeight,c=m.h-vh;return c>0?clamp((yAtual-m.top)/c):0;}

  var ticking=false,ato='',uB='',uF='',uA='',yS=0,primeira=true;

  function pintar(){
    ticking=false;
    var yA=window.scrollY,vh=window.innerHeight;
    if(primeira||reduz||Math.abs(yA-yS)>vh*2.5){yS=yA;primeira=false;} else {yS+=(yA-yS)*.2;if(Math.abs(yA-yS)<.3)yS=yA;}
    var y=yAtual=yS;
    if(!M.length) medir();

    var doc=document.documentElement.scrollHeight-vh;
    barra.style.width=(doc>0?clamp(y/doc)*100:0)+'%';

    var ref=y+vh*.1,i=0;
    for(var k=0;k<M.length;k++){ if(M[k].top<=ref) i=k; else break; }
    var px=i+1<M.length?i+1:null,t=0;
    var dist=px!==null?M[px].top-y:1e9;
    if(px!==null) t=suave((vh*.48-dist)/(vh*.33));
    var tf=suave((t-.32)/.36);
    var pa=paleta[i],pb=paleta[px!==null?px:i];
    var bg=lerp3(pa.bg,pb.bg,t),fg=lerp3(pa.fg,pb.fg,tf),ac=lerp3(pa.ac,pb.ac,tf);
    var sB=rgb(bg),sF=rgb(fg),sA=rgb(ac);
    if(sB!==uB){raiz.style.setProperty('--bg',sB);uB=sB;corBase=bg;dk=lum(bg)<.45?1:0;}
    if(sF!==uF){raiz.style.setProperty('--fg',sF);uF=sF;}
    if(sA!==uA){raiz.style.setProperty('--ac',sA);uA=sA;}
    var a=(t>.6&&px!==null)?paleta[px].ato:pa.ato;
    if(a!==ato){ato=a;rotAto.textContent=a;}

    ghosts.forEach(function(g){ g.el.style.transform='translate3d(0,'+((y-g.top)*g.par)+'px,0)'; });

    /* ---- tablet ---- */
    if(tabSec && !estreito()){
      var pt=prog(idx(tabSec));
      var abre=fx(pt,.16,.32), some=fx(pt,.34,.46);
      trava.classList.toggle('aberto',abre>.6);
      trava.style.opacity=String(1-some);
      trava.style.transform='translateY('+(-some*100)+'%)';
      travaTxt.textContent = abre>.6 ? 'Canal conectado' : 'Canal não conectado';
      travaSub.textContent = abre>.6 ? 'Número em API oficial' : 'Aguardando número em API';
      kpis.forEach(function(kp,n){ var v=fx(pt,.40+n*.03,.49+n*.03); kp.style.opacity=String(v); kp.style.transform='translateY('+((1-v)*10)+'px) scale('+(.96+.04*v)+')'; });
      pnTh.style.opacity=String(fx(pt,.52,.57));
      trs.forEach(function(tr,n){ var v=fx(pt,.55+n*.03,.63+n*.03); tr.style.opacity=String(v); tr.style.transform='translateX('+(-(1-v)*12)+'px)'; });
      if(pnPe) pnPe.style.opacity=String(fx(pt,.82,.9));
      var rot = pt<.3?'Role para destravar':(pt<.5?'Canal liberado':'Fila com origem do anúncio em cada contato');
      if(tabRot.textContent!==rot) tabRot.textContent=rot;
    }

    /* ---- jornada: carga e estrada ---- */
    if(jnSec && !estreito()){
      var pp=prog(idx(jnSec));
      var chega  = fx(pp,.01,.07);
      var entraS = fx(pp,.07,.14);
      var desce  = fx(pp,.16,.30);
      var recua  = fx(pp,.36,.44);
      var vira   = fx(pp,.46,.56);
      var viagem = clamp((pp-.56)/.44);

      carreta.style.transform='translate3d('+((1-chega)*120)+'%,0,0)';

      var ang = ANG_ALTO + (ANG_BAIXO-ANG_ALTO)*desce;
      lanca.setAttribute('transform','rotate('+ang+' 604 296)');

      var dx = G.dxIni + (G.dxFim-G.dxIni)*desce;
      var sX = G.foraX + (dx-G.foraX)*entraS;
      if(recua>0) sX = dx + (G.foraX-dx)*recua;
      stacker.style.opacity=String(entraS*(1-fx(pp,.42,.46)));
      stacker.style.transform='translate3d('+sX+'px,0,0)';

      var sp = centro(pontaL,ptPalco);
      var cx2 = sp.x, cy2 = sp.y + G.folga;
      if(recua>0){ cx2=G.alvo.x; cy2=G.alvo.y; }
      ctr40.style.opacity=String(entraS);
      ctr40.style.transform='translate3d('+(cx2-G.base.x)+'px,'+(cy2-G.base.y)+'px,0)';
      rig.style.opacity=String(1-fx(pp,.32,.40));

      ctrItens.forEach(function(li,n){
        var v=fx(pp,.18+n*.04,.28+n*.04);
        li.style.opacity=String(v); li.style.transform='translateY('+((1-v)*8)+'px)';
      });

      /* transição do pátio para a estrada */
      var esc = 1 - vira*0.64;
      comboio.style.transform='scale('+esc+')';
      var some=fx(pp,.46,.52);
      ctrMio.style.opacity=String(1-some);
      $('.ctr-cab',ctr40).style.opacity=String(1-some);
      ctrSelo.style.opacity=String(fx(pp,.52,.58));
      pilhasEl.style.opacity=String(.22*(1-vira));
      $$('.holofote').forEach(function(h){ h.style.opacity=String(1-vira); });
      morros.style.opacity=String(.2*vira);
      postes2.style.opacity=String(vira);
      faixaPista.parentElement.style.opacity=String(vira);
      rotaEl.style.opacity=String(vira);
      faixa.style.opacity=String(vira);
      jnNota.style.opacity=String(.85*(1-vira));

      /* viagem */
      var excesso=faixa.scrollWidth-palco.clientWidth+palco.clientWidth*.10;
      faixa.style.transform='translate3d('+(-excesso*viagem)+'px,0,0)';
      var mc=faixa.children, rm=rotaMarcas.children, ult=mc.length-1;
      for(var m2=0;m2<mc.length;m2++){
        var ligado = m2===0 ? true : viagem>=(m2/ult)*.85;
        mc[m2].classList.toggle('on', ligado);
        if(rm[m2]) rm[m2].classList.toggle('on', ligado);
      }
      rotaFill.style.width=(clamp(viagem/.85)*100)+'%';

      var vel = (pp>.52 && pp<1) ? 1 : 0;
      var dP = Math.abs(pp-ultP); ultP=pp;
      giro += vel*(6 + dP*900);
      $$('.carreta .roda').forEach(function(r){ r.style.transform='rotate('+giro+'deg)'; });
      faixaPista.style.transform='translate3d('+(-(giro*1.6)%118)+'px,0,0)';
      morros.querySelector('svg').style.transform='translate3d('+(-(viagem*22))+'%,0,0)';
      var bal = vel? Math.sin(giro/26)*1.8 : 0;
      comboio.style.transform='scale('+esc+') translateY('+bal+'px)';
      poeira.style.opacity=String(vel*.4*Math.min(1,dP*120+.3));

      var fase;
      if(pp<.07) fase='Pátio de carga';
      else if(pp<.30) fase='Assentando a carga';
      else if(pp<.47) fase='Travando os pinos';
      else if(pp<.58) fase='Saindo do pátio';
      else fase='Na estrada · dia '+Math.min(7,Math.max(1,Math.ceil(viagem*7)));
      if(jnFase.textContent!==fase) jnFase.textContent=fase;

      var tit = vira>.5 ? 'Com a carga na carreta, são sete dias de estrada até a operação virar'
                        : 'Precisamos de um número limpo. Ele é a carga que falta no caminhão';
      var olh = vira>.5 ? 'Cronograma de sete dias' : 'O insumo que destrava o cronograma';
      if(jnTitulo.textContent!==tit){ jnTitulo.textContent=tit; }
      if(jnOlho.textContent!==olh){ jnOlho.textContent=olh; jnOlho.classList.toggle('al', vira<=.5); }
      jnHint.style.opacity=String(1-fx(pp,.03,.10));
    }
  }
  function agenda(){ if(!ticking){ticking=true;requestAnimationFrame(pintar);} }

  window.addEventListener('scroll',agenda,{passive:true});
  window.addEventListener('resize',function(){medir();agenda();});
  window.addEventListener('load',function(){medir();agenda();});
  medir(); pintar();
  (function laco(ts){ fundo(ts||0); if(!reduz) agenda(); requestAnimationFrame(laco); })(0);
})();
