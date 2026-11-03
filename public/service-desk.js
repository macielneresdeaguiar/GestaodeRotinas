/* Linked handoff: server authority, one open case per point, separate repair and verification. */
let serviceDeskData=null,serviceDeskBusy=false,serviceDeskAccount=null;
const serviceDeskEncode=x=>encodeURIComponent(String(x)).replace(/'/g,'%27');
function serviceDeskAvailable(){return !!(AUTH.access&&(AUTH.access.fullRead||P().brigada||P().manutencao));}
function serviceDeskLink(id,index){return serviceDeskAvailable()?`<button class="btn ghost sm" onclick="serviceDeskForward('${serviceDeskEncode(id)}',${index})">Encaminhar / acompanhar manutenção</button>`:'';}
async function serviceDeskRequest(path='',body){
 const r=await fetchPrazo('/api/atendimentos'+path,{credentials:'same-origin',headers:syncHeaders(),...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})},20000);
 const d=await r.json();if(!r.ok)throw new Error(d.erro||'Não foi possível acessar os atendimentos.');return d;
}
function serviceDeskDays(value){return value?Math.max(0,Math.floor((Date.now()-Date.parse(String(value).slice(0,10)+'T12:00:00-03:00'))/86400000)):0;}
function serviceDeskCaseCard(c){
 const age=serviceDeskDays(c.desde),late=c.estado!=='Resolvido'&&c.prazo&&c.prazo<today(),old=age>=30&&c.estado!=='Resolvido';
 const next=c.estado==='Encaminhado'?'Iniciar atendimento':c.estado==='Em atendimento'?'Registrar o reparo':c.estado==='Aguardando conferência'?'Brigada deve verificar no local':'Conferência concluída';
 return `<article class="desk-card ${late||old?'desk-old':''}"><div class="desk-card-head"><strong>${esc(brigAndarNome(c.andar))} · ${esc(brigSis(c.sistema).nome)}</strong><span class="badge ${c.estado==='Resolvido'?'b-conc':c.estado==='Aguardando conferência'?'b-avencer':'b-and'}">${esc(c.estado)}</span></div><h3>${esc(c.ponto)}</h3><p>${esc(c.descricao||'Sem observação adicional.')}</p><div class="desk-meta">Responsável: <b>${esc(c.responsavel)}</b> · ${age} dia(s) desde o apontamento${c.prazo?' · prazo: '+fmt(c.prazo):' · prazo ainda não definido'}</div><div class="desk-next">${late?'Prazo vencido · ':old?'Pendência antiga · ':''}Próximo passo: ${esc(next)}</div><button class="btn" onclick="serviceDeskOpen('${c.id}')">Ver atendimento e histórico</button></article>`;
}
async function viewServiceDesk(){
 if(!serviceDeskAvailable())return;
 const account=AUTH.userId;$('#content').innerHTML='<div class="card">Carregando os atendimentos da sua área…</div>';
 try{
  const d=await serviceDeskRequest();if(!AUTH.ok||AUTH.userId!==account||page!=='atendimentos')return;serviceDeskData=d;serviceDeskAccount=account;
  const open=d.atendimentos.filter(c=>c.estado!=='Resolvido'),waiting=open.filter(c=>c.estado==='Aguardando conferência');
  const old=open.filter(c=>serviceDeskDays(c.desde)>=30||c.prazo&&c.prazo<today());
  const linked=new Set(open.map(c=>c.key)),pending=d.pendencias.filter(p=>!linked.has(p.key));
  $('#content').innerHTML=`<div class="desk-intro"><h2>Brigada e manutenção</h2><p>Uma pendência por ponto. A manutenção registra o reparo; a brigada confere no local antes de encerrar.</p></div><div class="desk-counters"><span><b>${open.length}</b> em aberto</span><span><b>${waiting.length}</b> para conferir</span><span><b>${old.length}</b> antigas / vencidas</span></div><div class="toolbar"><button class="btn ghost" onclick="viewServiceDesk()">Atualizar</button><button class="btn ghost" onclick="serviceDeskHistoryList()">Ver histórico de resolvidos</button></div>${pending.length?`<details class="desk-pending"><summary>${pending.length} pendência(s) ainda sem encaminhamento</summary>${pending.map(p=>`<div class="desk-pending-row"><strong>${esc(brigAndarNome(p.andar))} · ${esc(p.ponto)}</strong><small>Aberta desde ${fmt(p.desde)}</small>${serviceDeskLink(p.inspectionId,p.pointIndex)}</div>`).join('')}</details>`:''}${open.sort((a,b)=>String(a.prazo||'9999').localeCompare(String(b.prazo||'9999'))||String(a.desde).localeCompare(String(b.desde))).map(serviceDeskCaseCard).join('')||'<div class="card empty">Nenhum atendimento encaminhado em aberto nesta área.</div>'}`;
 }catch(e){if(AUTH.ok&&AUTH.userId===account&&page==='atendimentos')$('#content').innerHTML=`<div class="card"><p>${esc(e.message)}</p><button class="btn" onclick="viewServiceDesk()">Tentar novamente</button></div>`;}
}
function serviceDeskHistoryList(){
 if(!serviceDeskAvailable()||serviceDeskAccount!==AUTH.userId||!serviceDeskData)return;
 const closed=serviceDeskData.atendimentos.filter(c=>c.estado==='Resolvido');
 openModal('Atendimentos resolvidos',closed.map(serviceDeskCaseCard).join('')||'<p>Nenhum atendimento resolvido ainda.</p>');
}
async function serviceDeskForward(encoded,index){
 if(serviceDeskBusy||!serviceDeskAvailable())return;const id=decodeURIComponent(encoded);
 const i=brigInsp.find(i=>i.id===id),p=i?.pontos?.[index];if(!p)return toast('Abra novamente o check-list para localizar este ponto.');
 openModal('Encaminhar pendência à manutenção',`<p><b>${esc(brigAndarNome(i.andar))} · ${esc(brigSis(i.sistema).nome)}</b></p><h3>${esc(p.desc)}</h3><p>${esc(p.obs||'Sem observação adicional.')}</p><p>A descrição e as fotos já registradas acompanham o atendimento. Se ele já existir, será aberto o mesmo registro.</p>`,`<button class="btn ghost" onclick="closeModal()">Cancelar</button><button class="btn" onclick="serviceDeskCreate('${serviceDeskEncode(id)}',${index})">Confirmar encaminhamento</button>`);
}
async function serviceDeskCreate(encoded,index){
 if(serviceDeskBusy||!serviceDeskAvailable())return;const account=AUTH.userId;serviceDeskBusy=true;
 try{const d=await serviceDeskRequest('',{inspectionId:decodeURIComponent(encoded),pointIndex:index});if(!AUTH.ok||AUTH.userId!==account)return;closeModal();toast(d.existente?'Este ponto já tem atendimento. Abrindo o mesmo registro.':'Pendência encaminhada à manutenção.');go('atendimentos');await serviceDeskOpen(d.atendimento.id);}catch(e){toast(e.message)}finally{serviceDeskBusy=false;}
}
async function serviceDeskOpen(id){
 const account=AUTH.userId;if(!serviceDeskAvailable())return;
 try{
  const d=await serviceDeskRequest('/'+encodeURIComponent(id)),c=d.atendimento;
  if(!AUTH.ok||AUTH.userId!==account)return;
  const repair=AUTH.access.fullRead||P().manutencao,verify=AUTH.access.fullRead||P().brigada;
  const photoHtml=(refs,label)=>(refs||[]).length?`<h4>${label}</h4><div class="bg-fotos">${refs.map(ref=>`<img class="fthumb" src="${srcFoto(ref)}"${attrFoto(ref)} alt="${label}">`).join('')}</div>`:'';
  const repeat=d.mesmoPonto.length>1?`<details><summary>${d.mesmoPonto.length} atendimentos registrados neste ponto</summary>${d.mesmoPonto.map(x=>`<p>${fmt(x.criadoEm.slice(0,10))} · ${esc(x.estado)} · ${esc(x.reparo||x.descricao)}</p>`).join('')}</details>`:'';
  openModal('Atendimento · '+brigAndarNome(c.andar),`<h3>${esc(c.ponto)}</h3><p>${esc(c.descricao)}</p><p><b>${esc(c.estado)}</b> · responsável: ${esc(c.responsavel)} · ${serviceDeskDays(c.desde)} dia(s)</p><p>Previsão: ${c.prazo?fmt(c.prazo):'a definir'}</p>${photoHtml(c.fotos,'Fotos do apontamento')}${c.reparo?`<h4>Reparo registrado por ${esc(c.reparadoPor)}</h4><p>${esc(c.reparo)}</p>${photoHtml(c.reparoFotos,'Fotos do reparo')}`:''}${repeat}<h4>Linha do tempo</h4><ol class="desk-timeline">${d.historico.map(h=>`<li><strong>${esc(h.action)}</strong><small>${esc(h.actor_name)} · ${new Date(h.created).toLocaleString('pt-BR')}</small><p>${esc(h.note)}</p></li>`).join('')}</ol>`,
   `<button class="btn ghost" onclick="closeModal()">Fechar</button>${repair&&['Encaminhado','Em atendimento'].includes(c.estado)?`<button class="btn" onclick="serviceDeskActionForm('${c.id}','iniciar',${c.versao})">Iniciar / atualizar prazo</button><button class="btn green" onclick="serviceDeskActionForm('${c.id}','concluir',${c.versao})">Registrar reparo</button>`:''}${verify&&c.estado==='Aguardando conferência'?`<button class="btn green" onclick="serviceDeskActionForm('${c.id}','confirmar',${c.versao})">Conferi no local: resolvido</button><button class="btn danger" onclick="serviceDeskActionForm('${c.id}','devolver',${c.versao})">Ainda não resolveu</button>`:''}`);
 }catch(e){toast(e.message);}
}
let serviceDeskRepairPhotos=[];
function serviceDeskActionForm(id,action,version){
 serviceDeskRepairPhotos=[];
 const titles={iniciar:'Iniciar atendimento / definir prazo',concluir:'Registrar o reparo realizado',confirmar:'Confirmar reparo verificado no local',devolver:'Devolver à manutenção'};
 openModal(titles[action],`<p>${action==='confirmar'?'Confirme apenas depois de verificar o resultado no ponto.':action==='concluir'?'Descreva o serviço feito. A pendência só encerra após a conferência da brigada.':'Registre o andamento para a equipe acompanhar.'}</p><div class="field"><label for="deskNote">Descrição / observação</label><textarea id="deskNote" rows="4" placeholder="O que foi feito ou o que ainda falta"></textarea></div>${['iniciar','concluir'].includes(action)?'<div class="field"><label for="deskDue">Previsão de atendimento</label><input id="deskDue" type="date"></div>':''}${action==='concluir'?'<div class="field"><label for="deskPhoto">Fotos do reparo (opcional)</label><input id="deskPhoto" type="file" accept="image/*" multiple onchange="serviceDeskPhoto(this)"><div id="deskPhotoStatus"></div></div>':''}`,
  `<button class="btn ghost" onclick="closeModal()">Cancelar</button><button class="btn" onclick="serviceDeskSave('${id}','${action}',${version})">Salvar ${action==='confirmar'?'conferência':action==='concluir'?'reparo':'atualização'}</button>`);
}
async function serviceDeskPhoto(input){
 const account=AUTH.userId;const files=[...input.files].slice(0,8-serviceDeskRepairPhotos.length);
 try{for(const f of files){const photo=await guardarFoto(await comprimirImagem(f));if(!AUTH.ok||AUTH.userId!==account)return;serviceDeskRepairPhotos.push(photo);}if($('#deskPhotoStatus'))$('#deskPhotoStatus').textContent=serviceDeskRepairPhotos.length+' foto(s) adicionada(s).';}catch(e){toast('Não foi possível processar uma das fotos.');}
}
async function serviceDeskSave(id,action,version){
 if(serviceDeskBusy)return;serviceDeskBusy=true;
 try{
  const note=$('#deskNote').value.trim();if(['concluir','devolver'].includes(action)&&note.length<5)throw new Error('Descreva o reparo ou a pendência com mais detalhes.');
  if(serviceDeskRepairPhotos.length){await enviarFotos();if(serviceDeskRepairPhotos.some(ref=>_filaFotos.includes(idDaRef(ref))))throw new Error('As fotos ainda aguardam envio. Mantenha o formulário aberto e tente quando houver conexão.');}
  await serviceDeskRequest('/'+encodeURIComponent(id)+'/acao',{acao:action,versao:version,descricao:note,...($('#deskDue')&&$('#deskDue').value?{prazo:$('#deskDue').value}:{}),fotos:serviceDeskRepairPhotos});
  if(!AUTH.ok||AUTH.userId!==account)return;
  closeModal();toast(action==='concluir'?'Reparo enviado. Aguardando conferência da brigada.':action==='confirmar'?'Conferência registrada e pendência resolvida.':'Andamento atualizado.');
  if(action==='confirmar'&&SYNC.ligado)await syncBaixar();if(page==='atendimentos')await viewServiceDesk();
 }catch(e){toast(e.message);}finally{serviceDeskBusy=false;}
}
