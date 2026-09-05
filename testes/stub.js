/* Supabase falso: reproduz o contrato que o app usa, sem rede e sem banco.
   Serve para caçar erro de JS e validar a jornada completa. */
(function(){
  const UID='u-admin', UID2='u-colega', UCLI='u-cli', CID='c-1';
  const perfis=[
    {id:UID, nome:'Vinícius Reis', role:'admin', client_id:null,
     avatar_url:'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
     email:'vinicius@x.com', created_at:'2025-03-14T10:00:00Z'},
    {id:UID2, nome:'Elias Braga', role:'admin', client_id:null, avatar_url:null, email:'elias@x.com', created_at:'2025-06-02T10:00:00Z'},
    {id:UCLI, nome:'Flavia Marcos', role:'client', client_id:CID, avatar_url:null, email:'flavia@x.com'},
  ];
  const FIX={
    profiles: perfis.map(p=>({...p, checklist:{items:[],notes:''}})),
    user_directory: perfis,
    clients:[{id:CID,nome:'Cliente Um',logo_url:null,resumo:'resumo',plano_midia:true}],
    tasks:[{id:'t-1',client_id:CID,title:'Demanda de teste',description:'desc',status:'Não iniciado',
            priority:'Alta',assignees:['Vinícius','Renato'],assignee_ids:[UID],due:'2026-09-10',recurrence:'none',
            subtasks:[{text:'sub',done:false}],time_spent:120,timer_start:null,position:10,
            created_at:'2026-09-01T10:00:00Z',updated_at:'2026-09-02T10:00:00Z',completed_at:null,
            archived:false,urgente:false,anexos:[],project_id:'p-1'}],
    projects:[{id:'p-1',client_id:CID,nome:'Projeto Teste',cor:'#C7871E'}],
    documents:[{id:'d-1',client_id:CID,titulo:'Doc Teste',tipo:'apresentacao',
                storage_path:CID+'/x.pdf',metadata:{},created_at:'2026-09-01T10:00:00Z'}],
    channels:[
      {id:'ch-1',tipo:'client',nome:'cliente-um',client_id:CID,cor:null,created_by:UID,created_at:'2026-09-01T10:00:00Z',config:{}},
      {id:'ch-2',tipo:'team',nome:'geral',client_id:null,cor:null,created_by:UID,created_at:'2026-09-01T10:00:00Z'},
      {id:'ch-3',tipo:'dm',nome:'dm:'+[UID,UID2].sort().join(':'),client_id:null,cor:null,created_by:UID,created_at:'2026-09-01T10:00:00Z'}],
    channel_members:[{channel_id:'ch-1',profile_id:UID,last_read_at:'2026-09-01T10:00:00Z',apelido:null,avatar_url:null},
                     {channel_id:'ch-3',profile_id:UID,last_read_at:'2026-09-01T10:00:00Z',apelido:null,avatar_url:null},
                     {channel_id:'ch-3',profile_id:UID2,last_read_at:'2026-09-01T10:00:00Z',apelido:null,avatar_url:null}],
    messages:[{id:'m-1',channel_id:'ch-1',author_id:UID2,author_name:'Elias Braga',body:'bom dia',
               kind:'user',created_at:new Date(Date.now()-3600e3).toISOString(),reply_to:null,reactions:{},anexos:[]}],
    task_notes:[], briefings:[],
    media_plans:[{id:'mp-1', client_id:CID, plano:{verba_total:50000}, atualizado_em:'2026-09-01T10:00:00Z'}],
    pacing:[
      {id:'pc-1', conta:'Cliente Um Ads', client_id:CID, dia:'2026-09-04', mes:'2026-09', moeda:'BRL',
       dias_fechados:4, dias_no_mes:30, receita:82000, pedidos:41, conversoes:52, roas:4.1, roas_piso:3.5,
       canais:[{canal:'Meta Ads', investido:12000},{canal:'Google Ads', investido:8000}]},
      {id:'pc-2', conta:'Cliente Um Ads', client_id:CID, dia:'2026-09-03', mes:'2026-09', moeda:'BRL',
       dias_fechados:3, dias_no_mes:30, receita:60000, pedidos:30, conversoes:38, roas:4.0, roas_piso:3.5,
       canais:[{canal:'Meta Ads', investido:9000},{canal:'Google Ads', investido:6000}]}],
    assistant_messages:[], assistant_actions:[]
  };
  /* persiste entre recargas, para dar sentido ao teste de persistência:
     o app precisa buscar do backend de novo, não do estado em memória */
  try{
    const sm = localStorage.getItem('__stub_messages'); if(sm) FIX.messages = JSON.parse(sm);
    const sc = localStorage.getItem('__stub_channels'); if(sc) FIX.channels = JSON.parse(sc);
    const sb2 = localStorage.getItem('__stub_members'); if(sb2) FIX.channel_members = JSON.parse(sb2);
  }catch(e){}
  function persistir(){
    try{
      localStorage.setItem('__stub_messages', JSON.stringify(FIX.messages));
      localStorage.setItem('__stub_channels', JSON.stringify(FIX.channels));
      localStorage.setItem('__stub_members', JSON.stringify(FIX.channel_members));
    }catch(e){}
  }
  window.__FIX = FIX;

  function builder(table){
    let rows=(FIX[table]||[]).map(r=>({...r}));
    const filtros=[];
    const api={};
    const passa=r=>filtros.every(([c,v])=>String(r[c])===String(v));
    ['select','order','limit','range','not','or','contains','overlaps','match','ilike','like','gte','lte','gt','lt','is','in']
      .forEach(m=>api[m]=()=>api);
    api.eq=(c,v)=>{ filtros.push([c,v]); return api };
    api.neq=()=>api;
    let novos=null;
    const alvo=()=>novos||rows.filter(passa);
    const um=()=>Promise.resolve({data:alvo()[0]||null,error:null});
    api.single=um; api.maybeSingle=um;
    api.insert=v=>{const a=Array.isArray(v)?v:[v];
      novos=a.map((x,i)=>({id:table[0]+'-n-'+Date.now()+'-'+i,created_at:new Date().toISOString(),
                           reactions:{},anexos:[],kind:'user',...x}));
      novos.forEach(x=>{ (FIX[table]=FIX[table]||[]).push(x); rows.push(x) }); persistir(); return api};
    api.upsert=api.insert;
    /* o dublê copiava as linhas, então update mexia só na cópia e o teste
       nunca via a mudança. Agora ele grava também na fonte. */
    api.update=v=>{
      novos=rows.filter(passa).map(r=>Object.assign(r,v));
      novos.forEach(n=>{ const real=(FIX[table]||[]).find(x=>String(x.id)===String(n.id));
                         if(real) Object.assign(real, v) });
      persistir();
      return api;
    };
    api.delete=()=>{novos=rows.filter(passa).slice();
      FIX[table]=(FIX[table]||[]).filter(r=>!passa(r)); persistir(); return api};
    api.then=(res,rej)=>Promise.resolve({data:alvo(),error:null,count:alvo().length}).then(res,rej);
    return api;
  }
  /* Quem está logado no dublê. Por padrão a Vinícius (admin); pondo
     __COMO='cliente' em localStorage antes de carregar, entra a Flavia,
     que é cliente da Cliente Um. É assim que a jornada testa o portal. */
  let __eu = perfis[0];
  try{ if(localStorage.getItem('__COMO') === 'cliente') __eu = perfis[2] }catch(e){}
  const sess={user:{id:__eu.id, email:__eu.email, confirmed_at:'2026-01-01'}, access_token:'x'};
  function canal(){
    const c={_h:[],on(ev,f,g){c._h.push([ev,f,g]);return c},
      subscribe(cb){ if(cb) setTimeout(()=>cb('SUBSCRIBED'),0); return c },
      presenceState(){ return {[UID]:[{em:1}], [UID2]:[{em:1}]} },
      track(){ return Promise.resolve('ok') },
      send(){ return Promise.resolve('ok') },
      unsubscribe(){ return Promise.resolve('ok') }};
    return c;
  }
  window.supabase={createClient:()=>({
    from:builder,
    rpc:(nome,args)=>{
      args = args||{};
      if(nome==='mg_unread') return Promise.resolve({data:[{channel_id:'ch-1',nao_lidas:2,ultima:new Date().toISOString()}],error:null});
      if(nome==='mg_toggle_reaction') return Promise.resolve({data:{'👍':[UID]},error:null});
      if(nome==='mg_threads'){
        const m={};
        FIX.messages.filter(x=>x.channel_id===args.p_canal && x.reply_to).forEach(x=>{
          const r=String(x.reply_to);
          m[r]=m[r]||{raiz:r,respostas:0,ultima:null,autores:[]};
          m[r].respostas++; m[r].ultima=x.created_at;
          if(x.author_id && m[r].autores.indexOf(x.author_id)<0) m[r].autores.push(x.author_id);
        });
        return Promise.resolve({data:Object.values(m),error:null});
      }
      if(nome==='mg_abrir_dm'){
        const outro=args.p_outro;
        if(!outro||outro===UID) return Promise.resolve({data:null,error:{message:'conversa direta precisa de outra pessoa'}});
        if(!perfis.some(p=>p.id===outro)) return Promise.resolve({data:null,error:{message:'pessoa não encontrada'}});
        const achado=FIX.channels.find(c=>c.tipo==='dm'
          && FIX.channel_members.filter(m=>m.channel_id===c.id).length===2
          && FIX.channel_members.some(m=>m.channel_id===c.id&&m.profile_id===UID)
          && FIX.channel_members.some(m=>m.channel_id===c.id&&m.profile_id===outro));
        if(achado) return Promise.resolve({data:achado.id,error:null});
        const id='ch-dm-'+Date.now();
        FIX.channels.push({id,tipo:'dm',client_id:null,cor:null,created_by:UID,
          created_at:new Date().toISOString(),
          nome:[UID,outro].map(x=>(perfis.find(p=>p.id===x)||{}).nome).sort().join(' ↔ ')});
        FIX.channel_members.push({channel_id:id,profile_id:UID,last_read_at:null,apelido:null,avatar_url:null},
                                 {channel_id:id,profile_id:outro,last_read_at:null,apelido:null,avatar_url:null});
        persistir();
        return Promise.resolve({data:id,error:null});
      }
      if(nome==='mg_ultimas'){
        const m={};
        FIX.messages.forEach(x=>{ const a=m[x.channel_id];
          if(!a||new Date(x.created_at)>new Date(a.em))
            m[x.channel_id]={channel_id:x.channel_id,corpo:String(x.body||'').slice(0,160),
              autor_id:x.author_id,autor_nome:x.author_name,kind:x.kind,
              tem_anexo:!!(x.anexos&&x.anexos.length),em:x.created_at}; });
        return Promise.resolve({data:Object.values(m),error:null});
      }
      if(nome==='mg_abrir_grupo'){
        const ids=[...new Set((args.p_ids||[]).concat(UID))];
        if(ids.length<2) return Promise.resolve({data:null,error:{message:'escolha ao menos uma pessoa'}});
        const achado=FIX.channels.find(c=>c.tipo==='dm'
          && FIX.channel_members.filter(m=>m.channel_id===c.id).length===ids.length
          && ids.every(i=>FIX.channel_members.some(m=>m.channel_id===c.id&&m.profile_id===i)));
        if(achado) return Promise.resolve({data:achado.id,error:null});
        const id='ch-g-'+Date.now();
        FIX.channels.push({id,tipo:'dm',client_id:null,cor:null,icone:null,descricao:null,
          created_by:UID,created_at:new Date().toISOString(),
          nome:args.p_nome||ids.map(i=>(perfis.find(p=>p.id===i)||{}).nome).join(', ')});
        ids.forEach(i=>FIX.channel_members.push({channel_id:id,profile_id:i,
          last_read_at:null,apelido:null,avatar_url:null}));
        persistir();
        return Promise.resolve({data:id,error:null});
      }
      if(nome==='mg_criar_canal'){
        const id='ch-n-'+Date.now();
        FIX.channels.push({id,tipo:args.p_tipo,nome:args.p_nome,client_id:args.p_client_id||null,
          cor:args.p_cor||null,icone:args.p_icone||null,descricao:args.p_descricao||null,
          created_by:UID,created_at:new Date().toISOString()});
        [...new Set((args.p_membros||[]).concat(UID))].forEach(i=>
          FIX.channel_members.push({channel_id:id,profile_id:i,last_read_at:null,apelido:null,avatar_url:null}));
        persistir();
        return Promise.resolve({data:id,error:null});
      }
      if(nome==='mg_atualizar_canal'){
        const c=FIX.channels.find(x=>x.id===args.p_canal);
        if(!c) return Promise.resolve({data:null,error:{message:'canal não encontrado'}});
        if(args.p_nome) c.nome=args.p_nome;
        if(args.p_icone!==undefined) c.icone=args.p_icone||null;
        if(args.p_cor!==undefined) c.cor=args.p_cor||null;
        if(args.p_descricao!==undefined) c.descricao=args.p_descricao||null;
        persistir();
        return Promise.resolve({data:c,error:null});
      }
      if(nome==='mg_definir_membros'){
        FIX.channel_members=FIX.channel_members.filter(m=>m.channel_id!==args.p_canal);
        (args.p_ids||[]).forEach(i=>FIX.channel_members.push({channel_id:args.p_canal,profile_id:i,
          last_read_at:null,apelido:null,avatar_url:null}));
        persistir();
        return Promise.resolve({data:(args.p_ids||[]).length,error:null});
      }
      if(nome==='mg_excluir_canal'){
        FIX.channels=FIX.channels.filter(c=>c.id!==args.p_canal);
        FIX.messages=FIX.messages.filter(m=>m.channel_id!==args.p_canal);
        FIX.channel_members=FIX.channel_members.filter(m=>m.channel_id!==args.p_canal);
        persistir();
        return Promise.resolve({data:true,error:null});
      }
      if(nome==='mg_canais_em_comum'){
        const n=FIX.channel_members.filter(m=>m.profile_id===args.p_outro
          && FIX.channel_members.some(x=>x.channel_id===m.channel_id && x.profile_id===UID)).length;
        return Promise.resolve({data:n,error:null});
      }
      if(nome==='mg_buscar_mensagens'){
        const t=String(args.p_termo||'').toLowerCase();
        if(t.length<2) return Promise.resolve({data:[],error:null});
        return Promise.resolve({data:FIX.messages.filter(m=>String(m.body||'').toLowerCase().includes(t))
          .slice(0,40),error:null});
      }
      if(nome==='mg_kronos_publicar'){
        if(window.__KRONOS_PUBLICAR_FALHA) return Promise.resolve({data:null,error:{message:'sem acesso a esta conversa'}});
        const m={id:'m-luq-'+Date.now(),channel_id:args.p_canal,author_id:null,author_name:'Kronos',
                 body:args.p_texto,kind:'kronos',created_at:new Date().toISOString(),
                 reply_to:args.p_reply_to||null,reactions:{},anexos:[]};
        FIX.messages.push(m); persistir();
        return Promise.resolve({data:m,error:null});
      }
      return Promise.resolve({data:[],error:null});
    },
    /* Edge Function do Kronos. O comportamento é escolhido por
       window.__KRONOS_MODO, para o teste exercitar resposta, proposta,
       falta de chave e falha na execução. */
    functions:{ invoke:(nome,opc)=>{
      const corpo=(opc&&opc.body)||{};
      const modo=window.__KRONOS_MODO||'texto';
      if(modo==='sem_chave') return Promise.resolve({data:{ok:false,codigo:'sem_chave',
        erro:'O Kronos ainda não tem chave de IA configurada. Um administrador precisa definir o segredo ANTHROPIC_API_KEY no projeto Supabase.'},error:null});
      if(modo==='fora') return Promise.resolve({data:{ok:false,codigo:'ia_indisponivel',
        erro:'O provedor de IA está fora do ar. Tenta de novo em instantes.'},error:null});
      if(corpo.modo==='executar'){
        if(window.__KRONOS_EXEC_FALHA) return Promise.resolve({data:{ok:false,codigo:'sem_permissao',
          erro:'O banco recusou: você não tem permissão para isso. Nada foi criado.'},error:null});
        const arg=(corpo.acao&&corpo.acao.argumentos)||{};
        if(corpo.acao&&corpo.acao.ferramenta==='criar_documento'){
          const d={id:'d-k-'+Date.now(), client_id:arg.client_id||CID, titulo:arg.titulo||'Documento',
                   tipo:arg.tipo||'apresentacao',
                   storage_path:arg.conteudo?(arg.client_id||CID)+'/documentos/x.html':null,
                   metadata:{descricao:arg.descricao||'', origem:'kronos'},
                   created_at:new Date().toISOString()};
          FIX.documents.push(d);
          return Promise.resolve({data:{ok:true,tipo:'resultado',
            resultado:{criou:'documento',documento:d}},error:null});
        }
        const t={id:'t-luq-'+Date.now(),title:arg.title||'Demanda',
                 status:'Não iniciado',priority:'Alta',due:'2026-09-20',assignees:['Vinícius'],client_id:CID};
        FIX.tasks.push({...t,description:arg.description||'',recurrence:'none',subtasks:arg.subtasks||[],time_spent:0,timer_start:null,
                        position:99,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
                        completed_at:null,archived:false,urgente:false,anexos:[],project_id:null});
        return Promise.resolve({data:{ok:true,tipo:'resultado',resultado:{criou:'demanda',demanda:t}},error:null});
      }
      /* proposta de documento, com descrição e conteúdo escritos */
      if(modo==='documento') return Promise.resolve({data:{ok:true,tipo:'confirmar',
        texto:'Escrevi o documento. Confere antes de eu publicar:',
        titulo:'Criar documento',
        acao:{ferramenta:'criar_documento',argumentos:{titulo:'Diagnóstico de mídia',tipo:'diagnostico',
              descricao:'Leitura dos últimos 30 dias de mídia paga da Cliente Um.',
              conteudo:'O investimento cresceu 18% no período.\n\nO ROAS ficou acima do piso em 22 dos 30 dias.',
              client_id:CID}},
        campos:[{rotulo:'Documento',valor:'Diagnóstico de mídia'},{rotulo:'Tipo',valor:'Diagnóstico'},
                {rotulo:'Cliente',valor:'Cliente Um'},
                {rotulo:'Descrição',valor:'Leitura dos últimos 30 dias de mídia paga da Cliente Um.'},
                {rotulo:'Conteúdo',valor:'21 palavras escritas'}],
        passos:[{ferramenta:'buscar_clientes'}]},error:null});
      /* proposta de demanda com passo a passo */
      if(modo==='passos') return Promise.resolve({data:{ok:true,tipo:'confirmar',
        texto:'Preparei a demanda com o passo a passo:',
        titulo:'Criar demanda',
        acao:{ferramenta:'criar_demanda',argumentos:{title:'Revisar criativos',
              description:'Contexto: a campanha de setembro sobe na sexta.',
              client_id:CID,priority:'Alta',status:'Não iniciado',
              subtasks:[{text:'Baixar os arquivos do Drive',done:false},
                        {text:'Conferir formatos e pesos',done:false},
                        {text:'Subir no gerenciador',done:false}]}},
        campos:[{rotulo:'Título',valor:'Revisar criativos'},
                {rotulo:'Descrição',valor:'Contexto: a campanha de setembro sobe na sexta.'},
                {rotulo:'Cliente',valor:'Cliente Um'}],
        passos:[{ferramenta:'buscar_clientes'}]},error:null});
      if(modo==='confirmar') return Promise.resolve({data:{ok:true,tipo:'confirmar',
        texto:'Preparei isto. Confere antes de eu executar:',
        titulo:'Criar demanda',
        acao:{ferramenta:'criar_demanda',argumentos:{title:'Revisar criativos',description:'Conferir formatos',
              client_id:CID,priority:'Alta',status:'Não iniciado'}},
        campos:[{rotulo:'Título',valor:'Revisar criativos'},{rotulo:'Cliente',valor:'Cliente Um'},
                {rotulo:'Prioridade',valor:'Alta'}],
        passos:[{ferramenta:'buscar_clientes'}]},error:null});
      return Promise.resolve({data:{ok:true,tipo:'texto',
        texto:'Consultei as demandas e encontrei 1 em aberto para o Cliente Um.',
        passos:[{ferramenta:'buscar_demandas'}]},error:null});
    }},
    auth:{ getSession:()=>Promise.resolve({data:{session:sess},error:null}),
           getUser:()=>Promise.resolve({data:{user:sess.user},error:null}),
           signInWithPassword:()=>Promise.resolve({data:{session:sess,user:sess.user},error:null}),
           signUp:()=>Promise.resolve({data:{user:{id:'novo'},session:null},error:null}),
           signOut:()=>Promise.resolve({error:null}),
           updateUser:()=>Promise.resolve({data:{},error:null}) },
    /* link assinado com cara de link assinado de verdade: o dublê antigo
       devolvia about:blank e escondia o caso de link ausente */
    storage:{ from:()=>({
      createSignedUrl:(caminho)=>Promise.resolve(
        window.__semLink
          ? {data:null, error:{message:'nao autorizado'}}
          : {data:{signedUrl:'https://exemplo.invalid/assinado/'
                   + encodeURIComponent(String(caminho||'')) + '?token=abc'}, error:null}),
      upload:(caminho)=>Promise.resolve(
        window.__uploadFalha ? {data:null, error:{message:'row-level security'}}
                             : {data:{path:caminho}, error:null}),
      remove:()=>Promise.resolve({data:{},error:null}) }) },
    channel:canal
  })};
})();
