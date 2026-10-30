/* Field workflow: persistent open defects, explicit review, local drafts and delivery state. */
function workflowCarry(insp){
  const open=brigNCAbertas(insp.condoId).filter(h=>String(h.insp.andar)===String(insp.andar)&&h.insp.sistema===insp.sistema&&String(h.insp.data||'')<String(insp.data||''));
  for(const p of insp.pontos){
    const h=open.find(h=>h.ponto.desc===p.desc);if(!h)continue;
    Object.assign(p,{sit:'NÃO CONFORME',itens:structuredClone(h.ponto.itens||{}),obs:h.ponto.obs||'',qtd:h.ponto.qtd||brigQtdDesc(p.desc),fotos:[...(h.ponto.fotos||[])],repeteDe:h.insp.id,origemPonto:h.idx,revisaoPendente:true,pendenciaDesde:h.ponto.pendenciaDesde||h.insp.data});
  }
  return insp;
}
function workflowCheckConfirmed(insp,old,index,targetIndex){
  if(!insp||!old||insp.status==='Concluído'||insp.id===old.id||insp.condoId!==old.condoId||String(insp.andar)!==String(old.andar)||insp.sistema!==old.sistema)return false;
  const prior=old.pontos?.[index];if(!prior||brigPendenciaResolvida(old,prior))return false;
  const at=targetIndex??insp.pontos.findIndex(p=>p.desc===prior.desc),p=insp.pontos[at];
  if(!p||p.desc!==prior.desc)return false;
  Object.assign(p,{sit:'NÃO CONFORME',itens:structuredClone(prior.itens||{}),qtd:prior.qtd||brigQtdDesc(prior.desc),obs:prior.obs||'',fotos:[...(prior.fotos||[])],repeteDe:old.id,origemPonto:index,pendenciaDesde:prior.pendenciaDesde||old.data,revisaoPendente:false,confirmadoPor:session.nome,confirmadoEm:nowStamp()});
  return true;
}
function workflowConfirmAll(id){
  const i=_bi(id);if(!i||i.status==='Concluído')return;
  const ps=i.pontos.filter(p=>p.revisaoPendente);if(!ps.length)return;
  if(!confirm('Você conferiu os '+ps.length+' ponto(s) no local e as mesmas falhas continuam? Os detalhes anteriores serão mantidos.'))return;
  ps.forEach(p=>{p.revisaoPendente=false;p.confirmadoPor=session.nome;p.confirmadoEm=nowStamp()});
  save();render();toast('Pendências conferidas. Os registros anteriores foram preservados.');
}
function workflowCheckNotice(i){
  const n=i.pontos.filter(p=>p.revisaoPendente).length;if(!n||i.status==='Concluído')return '';
  return `<section class="workflow-review" aria-label="Pendências de meses anteriores"><strong>${n} pendência(s) anterior(es) carregada(s)</strong><p>Descrição, falhas e fotos foram mantidas. Confira no local: confirme que continuam ou marque Conforme após verificar o reparo. Elas não se encerram apenas porque o mês virou.</p><button class="btn" onclick="workflowConfirmAll('${i.id}')">Conferi: todas continuam pendentes</button></section>`;
}
function workflowState(collection,id){
  const current=(dbSnapshot()[collection]||[]).find(r=>r.id===id);if(!current)return 'Sem registro';
  const base=(SYNC.base?.[collection]||[]).find(r=>r.id===id);
  const signature=row=>{if(!row)return '';const value={...row};if(collection==='tasks'&&['Pendente','Atrasada'].includes(value.status))value.status='Pendente';return JSON.stringify(value)};
  const pending=signature(current)!==signature(base)||refsDe(current).some(ref=>_filaFotos.includes(idDaRef(ref)));
  if(pending)return estaOffline()?'Salvo neste aparelho · aguardando conexão':'Salvo neste aparelho · aguardando envio';
  return 'Enviado ao servidor';
}
function workflowRow(collection,id){return ` data-record-collection="${collection}" data-record-id="${esc(id)}"`;}
function workflowRecords(){
  document.querySelectorAll('#content [onclick]').forEach(el=>{
    const match=(el.getAttribute('onclick')||'').match(/(openTask|editTask|completeTask|formLeitura|formApont|avancarApont|histApont)\('([^']+)'/);if(!match)return;
    const collection=/Leitura/.test(match[1])?'leituras':/Apont/.test(match[1])?'apontamentos':'tasks';
    const container=el.closest('tr,.feed-item,.kcard,.check');if(container&&!container.dataset.recordId){container.dataset.recordCollection=collection;container.dataset.recordId=match[2];}
  });
  document.querySelectorAll('#content [data-record-collection]').forEach(row=>{
    let badge=row.querySelector('.workflow-delivery');
    if(!badge){badge=document.createElement('span');badge.className='workflow-delivery';const target=row.tagName==='TR'?row.cells?.[0]:row;target?.append(badge);}
    const text=workflowState(row.dataset.recordCollection,row.dataset.recordId);
    if(badge.textContent!==text)badge.textContent=text;
    badge.dataset.pending=String(!text.startsWith('Enviado'));
  });
  document.querySelectorAll('#content [data-record-collection]').forEach(row=>{
    if(row.querySelector('.workflow-next'))return;
    const col=row.dataset.recordCollection;
    if(!['tasks','apontamentos'].includes(col))return;
    const item=(dbSnapshot()[col]||[]).find(r=>r.id===row.dataset.recordId);if(!item)return;
    const done=/Conclu|Resolvido|Cancelad/.test(item.status||'');
    const action=done?'Atendimento concluído':!P().edit&&!P().complete?'Acompanhar atendimento':/Andamento/.test(item.status||'')?'Registrar a solução':'Iniciar atendimento';
    const owner=item.responsavel||(col==='apontamentos'?'Cleiton':'a definir');
    const deadline=item.dataProgramada||item.vencimento||item.prazo;
    const next=document.createElement('div');next.className='workflow-next';
    next.textContent=(done?'':'Próximo passo: ')+action+' · responsável: '+owner+(deadline?' · prazo: '+fmt(deadline):'');
    (row.cells?.[0]||row).append(next);
  });
}

const WORKFLOW_DRAFT_PREFIX='grc.drafts.v1.';
let workflowDraftContext=null,workflowDraftRestoring=false,workflowDraftClick='';
function workflowDraftKey(){return AUTH.ok&&AUTH.access?WORKFLOW_DRAFT_PREFIX+AUTH.userId+'.'+AUTH.access.key:null;}
function workflowDrafts(){try{const d=JSON.parse(localStorage.getItem(workflowDraftKey())||'null');if(d&&d.userId===AUTH.userId&&d.expiresAt>Date.now())return d.forms||{};}catch(e){}return {};}
function workflowDraftWrite(forms){const key=workflowDraftKey();if(!key)return;try{localStorage.setItem(key,JSON.stringify({expiresAt:Date.now()+7*86400000,userId:AUTH.userId,forms}));}catch(e){toast('Não foi possível guardar o rascunho neste aparelho.');}}
function workflowDraftClear(){for(const key of Object.keys(localStorage))if(key.startsWith(WORKFLOW_DRAFT_PREFIX))localStorage.removeItem(key);workflowDraftContext=null;}
function workflowDraftFields(){return [...document.querySelectorAll('#modalBody input,#modalBody textarea,#modalBody select')].filter(el=>!['password','file','hidden','search'].includes(el.type)&&!el.disabled&&!/senha|token|invite|pwOld|pwNew/i.test(el.id));}
function workflowDraftIdentity(fields){
  const actions=[...document.querySelectorAll('#modalFoot button[onclick]')].map(b=>b.getAttribute('onclick')).join('|');
  // Business forms only. Search, menu, authentication and administrative import dialogs are excluded.
  if(!fields.length||!/save|salvar|confirmarDelegacao|ltpSalvar/i.test(actions)||/senha|backup|import|código|permiss/i.test(document.querySelector('#modalTitle')?.textContent||''))return null;
  return (document.querySelector('#modalTitle')?.textContent||'')+'|'+actions+'|'+fields.map(el=>el.id||el.name||el.type).join(',');
}
function workflowDraftSave(){
  if(workflowDraftRestoring||!workflowDraftContext||!AUTH.ok)return;
  const fields=workflowDraftFields();if(workflowDraftIdentity(fields)!==workflowDraftContext.key)return;
  const values=fields.map((el,index)=>({index,id:el.id,type:el.type,value:el.value,checked:el.checked}));
  const forms=workflowDrafts();const action=workflowDraftContext.key;const attachments={};
  if(/saveApont/i.test(action))attachments.apontamentos=_fotosTmp.filter(ehRef);
  if(/brigRondaSalvar/i.test(action))attachments.ronda=_rondaFotos.filter(ehRef);
  forms[workflowDraftContext.key]={values,attachments,updatedAt:Date.now()};workflowDraftWrite(forms);
  const label=document.querySelector('#workflowDraftStatus');if(label)label.textContent='Rascunho salvo neste aparelho';
}
function workflowDraftRemove(key){const forms=workflowDrafts();delete forms[key];workflowDraftWrite(forms);}
function workflowDraftResume(){
  const ctx=workflowDraftContext,draft=ctx&&workflowDrafts()[ctx.key];if(!draft)return;
  workflowDraftRestoring=true;
  try{
    const fields=workflowDraftFields();for(const v of draft.values){const el=fields[v.index];if(!el||el.id!==v.id||el.type!==v.type)continue;el.value=v.value;if(['checkbox','radio'].includes(el.type))el.checked=v.checked;}
    if(draft.attachments?.apontamentos){_fotosTmp=draft.attachments.apontamentos.slice();const box=document.querySelector('#apFotos');if(box)box.innerHTML=_fotosTmp.map((f,n)=>thumbFoto(f,n)).join('');}
    if(draft.attachments?.ronda){_rondaFotos=draft.attachments.ronda.slice();brigRondaFotosBox();}
    if(document.querySelector('#ltMedidor')){calcLeit();leitAvaliarObs();}
    document.querySelector('#workflowDraftStatus').textContent='Rascunho recuperado · confira antes de salvar';
    document.querySelector('#workflowDraftResume').hidden=true;
  }finally{workflowDraftRestoring=false}
}
function workflowDraftDiscard(){if(!workflowDraftContext)return;workflowDraftRemove(workflowDraftContext.key);document.querySelector('#workflowDraftBanner')?.remove();}
function workflowPrepareDraft(){
  const modal=document.querySelector('#modal');if(!modal)return;
  if(!modal.classList.contains('open')){
    if(workflowDraftContext&&workflowDraftClick==='save')workflowDraftRemove(workflowDraftContext.key);
    workflowDraftContext=null;workflowDraftClick='';return;
  }
  const fields=workflowDraftFields(),key=workflowDraftIdentity(fields);if(!key){workflowDraftContext=null;return;}
  if(workflowDraftContext?.key===key&&document.querySelector('#workflowDraftBanner'))return;
  workflowDraftContext={key};workflowDraftClick='';
  const banner=document.createElement('div');banner.id='workflowDraftBanner';banner.className='workflow-draft';
  const exists=!!workflowDrafts()[key];
  banner.innerHTML=`<span id="workflowDraftStatus">${exists?'Há um rascunho anterior deste formulário':'O preenchimento é guardado neste aparelho'}</span><button type="button" class="btn ghost sm" id="workflowDraftResume" ${exists?'':'hidden'} onclick="workflowDraftResume()">Retomar rascunho</button><button type="button" class="btn ghost sm" onclick="workflowDraftDiscard()">Descartar rascunho</button>`;
  document.querySelector('#modalBody').prepend(banner);
}
const workflowDocument=document;
let workflowScheduled=false;
function workflowSchedule(){if(workflowScheduled||!workflowDocument.defaultView?.document)return;workflowScheduled=true;requestAnimationFrame(()=>{workflowScheduled=false;if(!workflowDocument.defaultView?.document)return;if(typeof AUTH!=='undefined'&&AUTH.ok){workflowRecords();workflowPrepareDraft();}});}
document.addEventListener('input',e=>{if(e.target.closest('#modalBody'))workflowDraftSave();},true);
document.addEventListener('change',e=>{if(e.target.closest('#modalBody'))workflowDraftSave();},true);
document.addEventListener('click',e=>{
  if(e.target.closest('#modalFoot button')){workflowDraftClick=/Salvar|Registrar|Confirmar|Enviar/i.test(e.target.closest('button').textContent)?'save':'';}
},true);
window.addEventListener('beforeunload',workflowDraftSave);
new MutationObserver(workflowSchedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
