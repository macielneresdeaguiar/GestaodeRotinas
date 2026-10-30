/* Field-first home: actions are based solely on the current server scope. */
function viewInicio(){
  const a=AUTH.access,p=P();
  const allowed=k=>scopeAllowed(k);
  const day=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
  let primary=p.leiturasSimples?['leituras','water','Registrar leitura','Água e energia em poucos passos']:
    p.brigada&&!p.tipos.length?['brigada-inicio','shieldCheck','Iniciar check-list','Continue o ciclo de inspeções do prédio']:
    p.manutencao&&!p.tipos.length?['apontamentos','wrench','Atender serviços','Veja os chamados e registre o atendimento']:
    p.leituras&&!p.tipos.length?['leituras','water','Registrar leitura','Confira o medidor e registre o valor']:
    ['hoje','today','Organizar meu dia','Tarefas, prioridades e próximas entregas'];
  const shortcuts=[['hoje','today','Meu dia'],['brigada-inicio','shieldCheck','Check-list'],['brigada-ronda','route','Fazer ronda'],
    ['leituras','water','Leituras'],['apontamentos','wrench','Serviços'],['estoque','box','Estoque'],['pedidos','cart','Materiais'],
    ['notas','invoice','Notas fiscais'],['ocupacao','building','Ocupação'],['analises','helmet','Projetos'],['config','settings','Minha conta']].filter(([k])=>allowed(k)&&k!==primary[0]);
  const done=s=>/Conclu|Resolvido|Cancelad|Registrada/.test(s||'');
  const pending=[];
  if(allowed('leituras')){const n=leituras.filter(l=>!done(l.status)&&l.data<=today()).length;if(n)pending.push(['leituras','water',n+' leitura(s) para registrar','Confira o medidor antes de confirmar']);}
  if(allowed('apontamentos')){const n=apontamentos.filter(x=>!done(x.status)).length;if(n)pending.push(['apontamentos','wrench',n+' serviço(s) em aberto','Confira prioridade e andamento']);}
  if(allowed('hoje')){const n=tasks.filter(t=>!t.arquivada&&!done(t.status)&&t.vencimento&&t.vencimento<=today()).length;if(n)pending.push(['hoje','today',n+' tarefa(s) até hoje','Abra o dia para executar ou reagendar']);}
  if(allowed('manutobrig')){const n=manutObrig.filter(m=>m.proxima&&m.proxima<=today()).length;if(n)pending.push(['manutobrig','shieldCheck',n+' manutenção(ões) no prazo ou vencida(s)','Confira os laudos e responsáveis']);}
  if(allowed('notas')){const n=notas.filter(n=>nfStatus(n)==='Vencida').length;if(n)pending.push(['notas','invoice',n+' nota(s) fiscal(is) vencida(s)','Confira a próxima ação e o responsável']);}
  const card=([k,icon,label,detail],className='field-link')=>`<button type="button" class="${className}" onclick="go('${k}')">${ic(icon)}<span><strong>${esc(label)}</strong>${detail?`<small>${esc(detail)}</small>`:''}</span>${ic('chevR')}</button>`;
  $('#content').innerHTML=`<div class="field-home">
    <section class="field-welcome"><div class="field-eyebrow">${esc(day)}</div><h1>Olá, ${esc(session.nome.split(' ')[0])}.</h1><p>Seu espaço de trabalho · ${esc(session.role)}</p><span class="field-scope">${ic('lock')}${a?.fullRead?'Visão completa da administração':'Somente as áreas liberadas para você'}</span></section>
    ${card(primary,'field-primary')}
    <section aria-labelledby="fieldShortcuts"><div class="field-section-head"><h2 id="fieldShortcuts">O que você precisa fazer?</h2><button class="btn ghost sm" onclick="abrirMaisMenu()">Ver tudo</button></div><div class="field-shortcuts">${shortcuts.map(x=>card(x)).join('')}</div></section>
    <section aria-labelledby="fieldPending"><div class="field-section-head"><h2 id="fieldPending">Precisa de atenção</h2><button class="btn ghost sm" onclick="abrirNotifs()" aria-label="Ver avisos">${ic('bell')}</button></div>${pending.length?pending.map(x=>card(x,'field-pending')).join(''):'<div class="field-clear">'+ic('checkCircle')+'<div><strong>Tudo certo por aqui</strong><p>Nenhuma pendência de prazo nas suas áreas.</p></div></div>'}</section>
    <button type="button" class="field-help" onclick="abrirSync()">${ic('cloud')}<span><strong>Seus registros ficam neste aparelho até o envio</strong><small>Toque para conferir a sincronização antes de encerrar o turno.</small></span>${ic('chevR')}</button>
  </div>`;
}
function fieldWorkTabs(){
  const choices=[['hoje','Hoje'],['rotina','Rotinas'],['afazeres','Sem data'],['calendario','Calendário'],['tarefas-adm','Administrativas'],['tarefas-gestor','Gestão']];
  if(!choices.some(([k])=>k===page)||document.querySelector('#workSwitch'))return;
  const nav=document.createElement('nav');nav.id='workSwitch';nav.className='field-work-switch';nav.setAttribute('aria-label','Visões do trabalho');
  nav.innerHTML=choices.filter(([k])=>scopeAllowed(k)).map(([k,l])=>`<button type="button" ${page===k?'aria-current="page"':''} onclick="go('${k}')">${l}</button>`).join('');
  document.querySelector('#content').prepend(nav);
}
// Save explicit changes from existing synchronous form actions, not page rendering.
for(const eventName of ['click','change','input'])document.addEventListener(eventName,()=>{
  if(typeof AUTH==='undefined'||!AUTH.ok||!session||_booting)return;
  const before=_assina(dbSnapshot());
  setTimeout(()=>{if(AUTH.ok&&session&&!_booting&&before!==_assina(dbSnapshot()))save()},0);
},true);
