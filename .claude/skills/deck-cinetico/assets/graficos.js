(function(){
  var MES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  function mesL(p){var q=String(p).split('-');return MES[+q[1]-1]+'/'+q[0].slice(2);}
  function novo(p){return String(p)>='2026-08';}
  function brl(v){return 'R$ '+Math.round(v).toLocaleString('pt-BR');}
  function num(v){return Number(v).toLocaleString('pt-BR');}
  function dec(v,c){return Number(v).toFixed(c).replace('.',',');}
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function el(id){return document.getElementById(id);}

  function stack(id,s,uni){
    var n=el(id); if(!n) return;
    var linhas=[
      {t:'Criativos no ar',a:s.antigo.n,r:s.recente.n,f:num},
      {t:'Investimento 30d',a:s.antigo.g,r:s.recente.g,f:brl},
      {t:uni,a:s.antigo.res,r:s.recente.res,f:num}
    ];
    n.innerHTML=linhas.map(function(l){
      var t=l.a+l.r,pa=t?l.a/t*100:0,pr=100-pa,ra=Math.round(pa),rr=100-ra;
      return '<div><div class="lbl"><span>'+l.t+'</span><span><b>'+l.f(l.a)+'</b> antigos, <b>'+l.f(l.r)+'</b> recentes</span></div>'+
        '<div class="sbar"><i class="a" style="--w:'+pa.toFixed(1)+'%">'+(pa>=12?ra+'%':'')+'</i>'+
        '<i class="r" style="--w:'+pr.toFixed(1)+'%">'+(pr>=12?rr+'%':'')+'</i></div></div>';
    }).join('');
  }

  function hist(id,h){
    var n=el(id); if(!n) return;
    var ks=Object.keys(h).sort(),mx=0;
    ks.forEach(function(k){if(h[k]>mx)mx=h[k];});
    n.innerHTML=ks.map(function(k){
      var alt=Math.max(7,h[k]/mx*100);
      return '<div class="mo"><b>'+h[k]+'</b><i class="'+(novo(k)?'':'a')+'" style="--h:'+alt.toFixed(1)+'%"></i><small>'+mesL(k)+'</small></div>';
    }).join('');
  }

  function linha(id,ser,uni){
    var n=el(id); if(!n) return;
    var mx=0; ser.forEach(function(d){if(d.g>mx)mx=d.g;});
    n.innerHTML=ser.map(function(d){
      var alt=Math.max(6,d.g/mx*100);
      var dica=mesL(d.p)+': '+brl(d.g)+(uni&&d.r?', '+num(d.r)+' '+uni:'');
      return '<div class="mo"><span class="dica">'+dica+'</span><i style="--h:'+alt.toFixed(1)+'%"></i><small>'+mesL(d.p).split('/')[0]+'</small></div>';
    }).join('');
  }

  function rank(id,rows,tipo){
    var n=el(id); if(!n) return;
    var uni=tipo==='whats'?'conversa':'lead';
    var top=rows.slice().sort(function(a,b){return b.res-a.res||b.g-a.g;}).slice(0,12);
    var mx=top[0]?top[0].res:1; if(!mx) mx=1;
    n.innerHTML=top.map(function(d){
      var rec=novo(d.first),w=Math.max(1.4,d.res/mx*100);
      var custo=d.res?'R$ '+dec(d.c,2)+' por '+uni:'sem '+uni;
      return '<div class="li"><span class="nm" title="'+esc(d.n)+'">'+esc(d.n)+
        '<small>'+(rec?'RECENTE, ':'')+'estreia '+mesL(d.first)+', '+d.ads+(d.ads>1?' anúncios':' anúncio')+'</small></span>'+
        '<span class="br'+(rec?' nov':'')+'" style="--w:'+w.toFixed(1)+'%"></span>'+
        '<span class="vl">'+num(d.res)+'</span>'+
        '<span class="dica">'+brl(d.g)+', '+custo+', CTR '+dec(d.ctr,2)+'%, hook '+dec(d.hook,1)+'%, freq '+dec(d.fq,2)+'</span></div>';
    }).join('');
  }

  function tabela(id,rows,tipo){
    var n=el(id); if(!n) return;
    var uni=tipo==='whats'?'Conversas':'Leads';
    var cst=tipo==='whats'?'Custo/conversa':'CPL';
    var rs=rows.slice().sort(function(a,b){return b.g-a.g;});
    var tg=0,tr=0,ti=0;
    rs.forEach(function(d){tg+=d.g;tr+=d.res;ti+=d.imp;});
    var corpo=rs.map(function(d){
      return '<tr'+(novo(d.first)?' class="rec"':'')+'><td>'+esc(d.n)+
        '</td><td class="v">'+mesL(d.first)+
        '</td><td class="v">'+brl(d.g)+
        '</td><td class="v">'+num(d.imp)+
        '</td><td class="v">'+num(d.res)+
        '</td><td class="v">'+(d.res?'R$ '+dec(d.c,2):'n/d')+
        '</td><td class="v">'+dec(d.ctr,2)+'%</td><td class="v">R$ '+dec(d.cpm,2)+
        '</td><td class="v">'+dec(d.hook,1)+'%</td><td class="v">'+dec(d.fq,2)+'</td></tr>';
    }).join('');
    n.innerHTML='<table><caption>'+rs.length+' criativos ativos, ordenados por investimento. Linha marcada em dourado é criativo recente, estreia em ago ou set/26.</caption>'+
      '<thead><tr><th>Criativo</th><th class="v">Estreia</th><th class="v">Gasto</th><th class="v">Impressões</th><th class="v">'+uni+
      '</th><th class="v">'+cst+'</th><th class="v">CTR</th><th class="v">CPM</th><th class="v">Hook</th><th class="v">Freq</th></tr></thead>'+
      '<tbody>'+corpo+'<tr class="mk"><td><b>Total</b></td><td class="v"></td><td class="v"><b>'+brl(tg)+
      '</b></td><td class="v"><b>'+num(ti)+'</b></td><td class="v"><b>'+num(tr)+'</b></td><td class="v"><b>R$ '+dec(tg/tr,2)+
      '</b></td><td class="v"></td><td class="v"></td><td class="v"></td><td class="v"></td></tr></tbody></table>';
  }

  window.GR={stack:stack,hist:hist,linha:linha,rank:rank,tabela:tabela,mesL:mesL,brl:brl,num:num,dec:dec};

  /* Ligação, um exemplo. Troque pelos ids e pelo formato dos seus dados.

  stack('stackLead', DATA.summ.lead, 'Leads gerados');      // {antigo:{n,g,res}, recente:{n,g,res}}
  hist('histLead', DATA.hist.lead);                          // {'2026-05':10, '2026-09':23}
  linha('tlDz1', DATA.champ.whats['Criativo X'], 'conversas');// [{p:'2026-03', g:5438.04, r:978}, ...]
  rank('rankWhats', DATA.rows.whats, 'whats');               // [{n,g,imp,res,c,ctr,cpm,hook,fq,ads,first}, ...]
  tabela('tblWhats', DATA.rows.whats, 'whats');

  */
})();
