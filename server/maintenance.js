import {randomUUID} from 'node:crypto';
import {db,lerWorkspace} from './db.js';
import {accessFor,attachmentRefs} from './access.js';
const clone=x=>structuredClone(x);
const stamp=()=>new Date().toISOString();
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const normalize=x=>String(x||'').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
export const pointKey=(i,p)=>JSON.stringify([i.condoId||'c1',String(i.andar),i.sistema,normalize(p.desc)]);
function error(status,message){throw Object.assign(new Error(message),{status});}
const canSee=a=>a.fullRead||a.perms.brigada||a.perms.manutencao;
const canRepair=a=>a.fullRead||a.perms.manutencao;
const canVerify=a=>a.fullRead||a.perms.brigada;
const condoAllowed=(a,c)=>a.perms.condos.includes(c)&&c!=='c2';
function unresolved(snapshot,i,p){
 if(p.sit!=='NÃO CONFORME'||p.resolvido||i.resolvido)return false;
 const linked=(snapshot.tasks||[]).filter(t=>t.brigInspId===i.id||t.brigInspIds?.includes(i.id)||i.chamadoId===t.id);
 if(linked.length)return !linked.every(t=>t.status==='Concluída'||t.arquivada);
 return !(snapshot.brigInsp||[]).some(n=>n.id!==i.id&&n.status==='Concluído'&&n.condoId===i.condoId&&String(n.andar)===String(i.andar)&&n.sistema===i.sistema&&
 String(n.data+' '+(n.hora||''))>String(i.data+' '+(i.hora||''))&&(n.pontos||[]).some(q=>q.desc===p.desc&&q.sit==='CONFORME'&&(!q.repeteDe||q.reparoConferido)));
}
export function openDefects(s,a){
 const found=new Map();
 for(const i of [...(s.brigInsp||[])].sort((x,y)=>String(x.data).localeCompare(String(y.data)))){
  if(i.status!=='Concluído'||!condoAllowed(a,i.condoId))continue;
  (i.pontos||[]).forEach((p,idx)=>{
   if(!unresolved(s,i,p))return;const key=pointKey(i,p),old=found.get(key);
   found.set(key,{key,inspectionId:i.id,pointIndex:idx,condoId:i.condoId,andar:String(i.andar),sistema:i.sistema,ponto:p.desc,descricao:p.obs||'',fotos:clone(p.fotos||[]),quantidade:p.qtd||1,desde:old?.desde||p.pendenciaDesde||i.data});
  });
 }
 return [...found.values()];
}
export async function initializeMaintenance(){
 await db.batch([
  'CREATE TABLE IF NOT EXISTS maintenance_case (id TEXT PRIMARY KEY, point_key TEXT NOT NULL, open_key TEXT UNIQUE, condo_id TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS maintenance_event (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, created TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS maintenance_by_point ON maintenance_case(point_key)',
  'CREATE INDEX IF NOT EXISTS maintenance_events_by_case ON maintenance_event(case_id,created)'
 ],'write');
}
function decode(row){return row?{...JSON.parse(row.data),estado:row.state,versao:Number(row.version)}:null;}
async function select(id,client=db){return decode((await client.execute({sql:'SELECT * FROM maintenance_case WHERE id=?',args:[id]})).rows[0]);}
async function event(tx,c,a,action,note){
 await tx.execute({sql:'INSERT INTO maintenance_event VALUES(?,?,?,?,?,?,?)',args:[randomUUID(),c.id,stamp(),a.userId,a.name,action,note||'']});
}
async function context(req){
 const ws=await lerWorkspace('default');const a=accessFor(req.auth.user_id,ws?.snapshot);
 if(!canSee(a))error(403,'Esta área é restrita à brigada e manutenção.');
 return {ws,a};
}
function publicCase(c,a){if(!c||!condoAllowed(a,c.condoId))error(404,'Atendimento não encontrado.');return c;}
export async function maintenancePhotoAllowed(id,userId){
 const ws=await lerWorkspace('default'),a=accessFor(userId,ws?.snapshot);
 if(!canSee(a))return false;
 const rows=(await db.execute('SELECT * FROM maintenance_case')).rows;
 return rows.some(row=>{const c=decode(row);return condoAllowed(a,c.condoId)&&attachmentRefs({fotos:c.fotos,reparoFotos:c.reparoFotos}).has(id);});
}
async function validPhotos(refs,userId,existing=[]){
 if(!Array.isArray(refs)||refs.length>8)error(400,'Anexe no máximo oito fotos.');
 for(const ref of refs){
  if(typeof ref!=='string'||!/^ref:[A-Za-z0-9_-]{3,80}$/.test(ref))error(400,'Aguarde o envio das fotos antes de confirmar.');
  if(existing.includes(ref))continue;
  const r=(await db.execute({sql:'SELECT f.id,o.user_id FROM foto f JOIN foto_owner o ON o.id=f.id WHERE f.id=?',args:[ref.slice(4)]})).rows[0];
  if(!r||r.user_id!==userId)error(403,'Foto não enviada por esta conta.');
 }
 return [...new Set(refs)];
}
export async function assertLinkedDefects(incoming,current){
 const active=(await db.execute("SELECT point_key FROM maintenance_case WHERE open_key IS NOT NULL")).rows;
 if(!active.length)return;const keys=new Set(active.map(r=>r.point_key));
 const before=new Map((current.brigInsp||[]).map(i=>[i.id,i]));
 for(const i of incoming.brigInsp||[])for(const [idx,p]of (i.pontos||[]).entries()){
  if(!keys.has(pointKey(i,p)))continue;const old=before.get(i.id)?.pontos?.[idx];
  if((p.resolvido&&!old?.resolvido)||(i.resolvido&&!before.get(i.id)?.resolvido)||(i.status==='Concluído'&&p.sit==='CONFORME'&&(!old||old.sit!=='CONFORME'||before.get(i.id)?.status!=='Concluído')))
   error(403,'Esta pendência tem atendimento vinculado. Use Conferir reparo para encerrá-la.');
 }
}
async function resolveWorkspace(tx,c,a,note){
 const row=(await tx.execute("SELECT * FROM workspace WHERE id='default'")).rows[0];
 const s=JSON.parse(row.snapshot);let changed=false;
 for(const i of s.brigInsp||[]){
  let touched=false;
  for(const p of i.pontos||[])if(p.sit==='NÃO CONFORME'&&pointKey(i,p)===c.key&&!p.resolvido){
   Object.assign(p,{resolvido:true,resolvidoEm:day(),resolvidoPor:a.name,obsResolucao:note||c.reparo,atendimentoId:c.id});touched=true;
  }
  if(touched){changed=true;(i.historico=i.historico||[]).push({q:a.name,w:stamp(),t:'Reparo conferido e pendência resolvida',obs:note||c.reparo,atendimentoId:c.id});if(i.pontos.filter(p=>p.sit==='NÃO CONFORME').every(p=>p.resolvido))i.resolvido=true;}
 }
 if(!changed)return;
 const privateRow=(await tx.execute("SELECT snapshot FROM workspace_private WHERE id='default'")).rows[0];
 await tx.execute({sql:'INSERT OR IGNORE INTO workspace_backup VALUES(?,?,?,?,?)',args:['default',Number(row.versao),row.snapshot,privateRow?.snapshot||'{}',stamp()]});
 await tx.execute({sql:"UPDATE workspace SET snapshot=?,versao=versao+1,atualizado=?,autor=? WHERE id='default' AND versao=?",args:[JSON.stringify(s),stamp(),a.name,Number(row.versao)]});
 await tx.execute({sql:'INSERT INTO evento(workspace,versao,autor,dispositivo,bytes,criado) VALUES(?,?,?,?,?,?)',args:['default',Number(row.versao)+1,a.name,'Conferência de manutenção',JSON.stringify(s).length,stamp()]});
}
const wrap=fn=>async(req,res)=>{try{await fn(req,res)}catch(e){console.error('[maintenance]',e.message);res.status(e.status||500).json({erro:e.status?e.message:'Não foi possível processar o atendimento.'})}};
export function installMaintenance(app){
 app.get('/api/atendimentos',wrap(async(req,res)=>{
  const {ws,a}=await context(req);
  const cases=(await db.execute('SELECT * FROM maintenance_case ORDER BY rowid DESC LIMIT 500')).rows.map(decode).filter(c=>condoAllowed(a,c.condoId));
  res.json({atendimentos:cases,pendencias:canVerify(a)?openDefects(ws.snapshot,a):[],permissoes:{reparar:canRepair(a),conferir:canVerify(a)},hoje:day()});
 }));
 app.post('/api/atendimentos',wrap(async(req,res)=>{
  const {ws,a}=await context(req);if(!canVerify(a))error(403,'Somente brigada ou administração encaminha uma pendência.');
  const {inspectionId,pointIndex}=req.body||{},i=ws.snapshot.brigInsp?.find(i=>i.id===inspectionId),p=i?.pontos?.[pointIndex];
  if(!i||!Number.isInteger(pointIndex)||!p||i.status!=='Concluído'||!condoAllowed(a,i.condoId)||!unresolved(ws.snapshot,i,p))error(400,'Pendência não disponível para encaminhamento.');
  const key=pointKey(i,p),origin=openDefects(ws.snapshot,a).find(d=>d.key===key);
  const c={id:randomUUID(),key,condoId:i.condoId,andar:String(i.andar),sistema:i.sistema,ponto:p.desc,descricao:p.obs||'',quantidade:p.qtd||1,fotos:clone(p.fotos||[]),desde:origin?.desde||i.data,criadoEm:stamp(),responsavel:ws.snapshot.CFG?.nomesUsuarios?.u3||'Cleiton',responsavelId:'u3',prazo:null,reparo:'',reparoFotos:[]};
  const tx=await db.transaction('write');
  try{
   const liveRow=(await tx.execute("SELECT snapshot FROM workspace WHERE id='default'")).rows[0];
   const live=JSON.parse(liveRow.snapshot),liveInspection=live.brigInsp?.find(n=>n.id===inspectionId),livePoint=liveInspection?.pontos?.[pointIndex];
   if(!livePoint||liveInspection.status!=='Concluído'||pointKey(liveInspection,livePoint)!==key||!unresolved(live,liveInspection,livePoint))error(409,'Este ponto mudou. Atualize o check-list antes de encaminhar.');
   c.descricao=livePoint.obs||'';c.fotos=clone(livePoint.fotos||[]);c.quantidade=livePoint.qtd||1;
   const r=await tx.execute({sql:'INSERT OR IGNORE INTO maintenance_case VALUES(?,?,?,?,?,?,?)',args:[c.id,key,key,c.condoId,'Encaminhado',1,JSON.stringify(c)]});
   if(r.rowsAffected)await event(tx,c,a,'Encaminhado',c.descricao);
   const value=decode((await tx.execute({sql:'SELECT * FROM maintenance_case WHERE open_key=?',args:[key]})).rows[0]);
   await tx.commit();res.json({ok:true,existente:!r.rowsAffected,atendimento:value});
  }catch(e){await tx.rollback();throw e}finally{tx.close()}
 }));
 app.get('/api/atendimentos/:id',wrap(async(req,res)=>{
  const {a}=await context(req),c=publicCase(await select(req.params.id),a);
  const history=(await db.execute({sql:'SELECT created,actor_name,action,note FROM maintenance_event WHERE case_id=? ORDER BY created,id',args:[c.id]})).rows;
  const samePoint=(await db.execute({sql:'SELECT * FROM maintenance_case WHERE point_key=? ORDER BY rowid DESC LIMIT 30',args:[c.key]})).rows.map(decode);
  res.json({atendimento:c,historico:history,mesmoPonto:samePoint});
 }));
 app.post('/api/atendimentos/:id/acao',wrap(async(req,res)=>{
  const {a}=await context(req),{acao,versao,descricao='',prazo,fotos=[]}=req.body||{};
  if(!['iniciar','atualizar','concluir','confirmar','devolver'].includes(acao)||!Number.isSafeInteger(versao))error(400,'Ação ou versão inválida.');
  if(typeof descricao!=='string'||descricao.length>4000)error(400,'Descrição inválida.');
  if(['confirmar','devolver'].includes(acao)?!canVerify(a):!canRepair(a))error(403,'Esta etapa não está liberada para seu perfil.');
  const initial=publicCase(await select(req.params.id),a);
  const repairPhotos=acao==='concluir'?await validPhotos(fotos,a.userId,initial.reparoFotos):null;
  const tx=await db.transaction('write');
  try{
   const c=publicCase(await select(req.params.id,tx),a);
   if(c.versao!==versao){await tx.rollback();return res.status(409).json({erro:'Outro usuário atualizou este atendimento. Reabra antes de continuar.',atendimento:c});}
   let state=c.estado;
   if(acao==='iniciar'){if(!['Encaminhado','Em atendimento'].includes(state))error(409,'Atendimento não disponível para início.');state='Em atendimento';}
   if(acao==='atualizar'){if(state==='Resolvido')error(409,'Atendimento já resolvido.');}
   if(acao==='concluir'){if(!['Encaminhado','Em atendimento'].includes(state)||descricao.trim().length<5)error(400,'Descreva o reparo realizado antes de enviar para conferência.');state='Aguardando conferência';c.reparo=descricao.trim();c.reparoFotos=repairPhotos;c.reparadoEm=stamp();c.reparadoPor=a.name;}
   if(acao==='confirmar'){if(state!=='Aguardando conferência')error(409,'Primeiro a manutenção deve registrar o reparo.');await resolveWorkspace(tx,c,a,descricao.trim());state='Resolvido';c.conferidoEm=stamp();c.conferidoPor=a.name;}
   if(acao==='devolver'){if(state!=='Aguardando conferência'||descricao.trim().length<5)error(400,'Explique por que o reparo precisa de nova atuação.');state='Em atendimento';}
   if(prazo!==undefined){if(prazo!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(prazo))error(400,'Prazo inválido.');c.prazo=prazo;}
   c.atualizadoEm=stamp();c.estado=state;c.versao++;
   await tx.execute({sql:'UPDATE maintenance_case SET state=?,version=?,data=?,open_key=? WHERE id=?',args:[state,c.versao,JSON.stringify(c),state==='Resolvido'?null:c.key,c.id]});
   await event(tx,c,a,({iniciar:'Atendimento iniciado',atualizar:'Previsão atualizada',concluir:'Reparo enviado para conferência',confirmar:'Reparo conferido e resolvido',devolver:'Reparo devolvido à manutenção'})[acao],descricao.trim());
   await tx.commit();res.json({ok:true,atendimento:c});
  }catch(e){await tx.rollback();throw e}finally{tx.close()}
 }));
}
