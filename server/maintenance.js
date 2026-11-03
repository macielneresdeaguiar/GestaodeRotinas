import {db} from './db.js';
import {attachmentRefs} from './access.js';
export async function initializeMaintenance(){
 await db.batch([
  'CREATE TABLE IF NOT EXISTS maintenance_case (id TEXT PRIMARY KEY, point_key TEXT NOT NULL, open_key TEXT UNIQUE, condo_id TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS maintenance_event (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, created TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS maintenance_by_point ON maintenance_case(point_key)',
  'CREATE INDEX IF NOT EXISTS maintenance_events_by_case ON maintenance_event(case_id,created)'
 ],'write');
}

function decode(row){return row?{...JSON.parse(row.data),estado:row.state,versao:Number(row.version)}:null;}
export async function maintenancePhotoAllowed(id,userId){
 if(userId!=='u1')return false;
 const rows=(await db.execute('SELECT * FROM maintenance_case')).rows;
 return rows.some(row=>{const c=decode(row);return attachmentRefs({fotos:c.fotos,reparoFotos:c.reparoFotos}).has(id);});
}
// Retired module: preserve its tables and provide read-only recovery to Maciel.
// No new handoff, repair or verification can be performed through an old app.
export function installMaintenance(app){
 const owner=(req,res,next)=>req.auth?.user_id==='u1'?next():res.status(403).json({erro:'A gestão e conferência do check-list são exclusivas de Maciel.'});
 const wrap=fn=>async(req,res)=>{try{await fn(req,res)}catch(e){console.error('[maintenance archive]',e.message);res.status(500).json({erro:'Não foi possível ler o histórico preservado.'})}};
 app.get('/api/atendimentos',owner,wrap(async(req,res)=>{
  const rows=(await db.execute('SELECT * FROM maintenance_case ORDER BY rowid DESC')).rows;
  res.json({desativado:true,atendimentos:rows.map(decode),pendencias:[],aviso:'Módulo retirado. Maciel gerencia e confere pelo Check-list por Andar.'});
 }));
 app.get('/api/atendimentos/:id',owner,wrap(async(req,res)=>{
  const c=decode((await db.execute({sql:'SELECT * FROM maintenance_case WHERE id=?',args:[req.params.id]})).rows[0]);
  if(!c)return res.status(404).json({erro:'Registro não encontrado.'});
  const history=(await db.execute({sql:'SELECT created,actor_name,action,note FROM maintenance_event WHERE case_id=? ORDER BY created,id',args:[c.id]})).rows;
  res.json({desativado:true,atendimento:c,historico:history});
 }));
 const retired=(req,res)=>res.status(410).json({erro:'Módulo retirado. Atualize o aplicativo. Maciel confere e resolve as pendências em Check-list por Andar.'});
 app.post('/api/atendimentos',owner,retired);
 app.post('/api/atendimentos/:id/acao',owner,retired);
}
