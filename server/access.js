/* Server authority: menu visibility alone never grants access. */
import { createHash, randomUUID } from 'node:crypto';
const clone=x=>structuredClone(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const all=['inicio','dashboard','hoje','rotina','tarefas-adm','tarefas-gestor','afazeres','calendario','notas','cessoes','vendascustas','publicidade','emails','leituras','analises','unidades','ocupacao','locacao','unidsind','brigada-inicio','brigada','brigada-form','brigada-ronda','apontamentos','manutobrig','estoque','pedidos','relatorios','relmensal','config'];
export const COLLECTIONS=['tasks','afazeres','notas','cessoes','vcUnidades','vcCiclos','vcVendas','anuncios','leituras','analises','salas','unidSind','brigInsp','brigRondas','apontamentos','manutObrig','estoque','movEstoque','pedidos','prestadores','auditLog','notifs'];
const names={u1:'Maciel',u2:'Alef',u3:'Cleiton',u4:'Fernanda',b1:'Anderson',b2:'Nilson',b3:'Suelen',b4:'Alana',p1:'Portaria 1',p2:'Portaria 2',p3:'Portaria 3',p4:'Portaria 4',p5:'Portaria 5',p6:'Portaria 6'};
export const FULL_READ=new Set(['u1','u2']);
const flags=['manutencao','manutobrig','estoque','estoqueTotal','apontamentos','brigada','leituras','leiturasSimples','ronda','ia','create','edit','complete','delete','sindico'];
function defaults(id){
  const p={condos:['c1'],tipos:[],create:true,edit:false,complete:false,delete:false};
  if(FULL_READ.has(id))return {...p,condos:['c1','c2'],tipos:['Administrativo','Gestor'],manutencao:true,manutobrig:true,estoque:true,estoqueTotal:id==='u1',apontamentos:true,brigada:true,leituras:true,ronda:true,ia:true,sindico:true,edit:true,complete:true,delete:id==='u1'};
  if(id==='u3')return {...p,manutencao:true,apontamentos:true,estoque:true,estoqueTotal:true,edit:true,complete:true};
  if(id==='u4')return {...p,leituras:true,ronda:true};
  if(/^b[1-4]$/.test(id))return {...p,brigada:true};
  if(/^p[1-6]$/.test(id))return {...p,leituras:true,leiturasSimples:true};
  return {...p,condos:[],create:false};
}
export function accessFor(id,snapshot){
  const p=defaults(id),over=snapshot?.CFG?.permsUsuarios?.[id]||{};
  for(const k of flags)if(typeof over[k]==='boolean')p[k]=over[k];
  for(const t of ['Administrativo','Gestor'])if(typeof over['tipos:'+t]==='boolean')p.tipos=over['tipos:'+t]?[...new Set([...p.tipos,t])]:p.tipos.filter(x=>x!==t);
  if(Array.isArray(over.condos))p.condos=over.condos.filter(x=>['c1','c2'].includes(x));
  // Explicit owner requirement: these two accounts always see every module.
  if(FULL_READ.has(id))Object.assign(p,defaults(id));
  if(!FULL_READ.has(id))p.sindico=false;
  const pages=new Set(['inicio','config']);
  if(!p.leiturasSimples)pages.add('dashboard');
  if(p.tipos.length)for(const k of ['hoje','rotina','tarefas-adm','afazeres','calendario','notas','cessoes','vendascustas','publicidade','emails','leituras','analises','unidades','ocupacao','locacao','relatorios','relmensal'])pages.add(k);
  if(p.tipos.includes('Gestor'))pages.add('tarefas-gestor');
  if(p.brigada)for(const k of ['brigada-inicio','brigada','brigada-form','brigada-ronda'])pages.add(k);
  if(p.ronda)pages.add('brigada-ronda');
  if(p.leituras)pages.add('leituras');
  if(p.manutencao)pages.add('apontamentos');if(p.manutobrig)pages.add('manutobrig');
  if(p.estoque){pages.add('estoque');pages.add('pedidos');}
  if(FULL_READ.has(id))all.forEach(k=>pages.add(k));
  const key=createHash('sha256').update(JSON.stringify({id,p})).digest('hex').slice(0,20);
  return {policy:'scoped-2026-10-30',userId:id,key,fullRead:FULL_READ.has(id),manageAccess:id==='u1',perms:p,pages:[...pages],name:snapshot?.CFG?.nomesUsuarios?.[id]||names[id]||id};
}
function inCondo(row,a,k){
  const c=row.condoId;
  if(!c)return a.perms.condos.includes('c1');
  if(c==='geral')return a.perms.tipos.length>0;
  if(!a.perms.condos.includes(c))return false;
  return c!=='c2'||['notas','prestadores'].includes(k); // Taguá participates only in invoices.
}
function allowedCollection(k,a){
  if(a.fullRead)return true;
  const p=a.perms;
  if(['tasks','afazeres'].includes(k))return p.tipos.length||p.manutencao||p.brigada||p.ronda;
  if(['notas','cessoes','vcUnidades','vcCiclos','vcVendas','anuncios','analises','salas','prestadores'].includes(k))return !!p.tipos.length;
  if(k==='leituras')return p.leituras||!!p.tipos.length;
  if(k==='brigInsp')return p.brigada;
  if(k==='brigRondas')return p.brigada||p.ronda||p.manutencao;
  if(k==='apontamentos')return p.manutencao;
  if(k==='manutObrig')return p.manutobrig;
  if(['estoque','movEstoque','pedidos'].includes(k))return p.estoque;
  return false; // Private portfolio, audit and notification messages never cross profiles.
}
function rowVisible(row,k,a){
  if(!row||typeof row!=='object')return false;
  if(a.fullRead)return true;
  if(!inCondo(row,a,k))return false;
  if(k==='tasks')return a.perms.tipos.includes(row.tipo)||a.perms.manutencao&&['Manutencao','Manutenção'].includes(row.tipo)||
    (a.perms.brigada||a.perms.ronda)&&row.origem==='ronda';
  if(k==='afazeres')return a.perms.tipos.includes(row.tipo||'Administrativo');
  return true;
}
const cfgPublic=['nomeEmpresa','slogan','logo','nomesUsuarios'];
const cfgOperational=['notif','ia','brigCicloMensal'];
export function scopedSnapshot(snapshot,a){
  const out={v:2,savedAt:snapshot.savedAt,_access:a,CFG:{},notifState:{}};
  for(const k of COLLECTIONS)out[k]=allowedCollection(k,a)?clone((snapshot[k]||[]).filter(r=>rowVisible(r,k,a))):[];
  // Incidents are shared only within the operational team. Strip unrelated notes/attachments.
  if(!a.fullRead&&!a.perms.manutencao&&!a.perms.tipos.length)out.tasks=out.tasks.map(r=>Object.fromEntries(['id','condoId','tipo','titulo','status','origem','rondaId','responsavel','prioridade','vencimento','dataProgramada','criadoPor','vistoDeNovo','vistoPorUltimo','historico'].filter(k=>k in r).map(k=>[k,clone(r[k])])));
  if(a.perms.leiturasSimples)out.leituras=out.leituras.map(r=>Object.fromEntries(['id','condoId','tipo','data','medidor','leitura','anterior','fator','status','obs','responsavel','anexo','historico','regressiva','atipico','atipicoMotivo','atipicoEfeito','userId','criadoPorId'].filter(k=>k in r).map(k=>[k,clone(r[k])])));
  const cfg=snapshot.CFG||{};
  if(a.fullRead)out.CFG=clone(cfg);
  else {
    for(const k of [...cfgPublic,...cfgOperational])if(cfg[k]!==undefined)out.CFG[k]=clone(cfg[k]);
    if(a.perms.leituras||a.perms.tipos.length){
      for(const k of ['tarifas','tarifaFaixas'])if(cfg[k]!==undefined&&!a.perms.leiturasSimples)out.CFG[k]=clone(cfg[k]);
    }
  }
  out.CFG.permsUsuarios=a.manageAccess?clone(cfg.permsUsuarios||{}):{};
  // Only the current user's effective permissions are needed by the client.
  out.CFG.permsUsuarios[a.userId]={...a.perms};
  if(!a.fullRead){out.notifs=[];out.auditLog=[];}
  return out;
}
function reject(message){const e=new Error(message);e.status=403;throw e;}
function owned(row,a){return row.userId===a.userId||row.criadoPorId===a.userId||row.criadoPor===a.name||row.autor===a.name||row.solicitante===a.name||row.responsavel===a.name;}
function writeAllowed(k,a,old,row){
  const p=a.perms;
  if(a.userId==='u1')return true;
  if(['estoque','movEstoque'].includes(k)&&!p.estoqueTotal)return false;
  if(!old)return p.create;
  if(k==='leituras'&&old.status!=='Registrada')return p.create;
  if(k==='leituras'&&row.status!=='Registrada'&&old.status!=='Registrada')return p.create;
  if(k==='brigInsp'||k==='brigRondas')return p.edit||owned(old,a);
  if(['estoque','movEstoque'].includes(k))return p.estoqueTotal;
  if(k==='pedidos')return p.delete||owned(old,a)&&old.status==='Aberto'&&row.status==='Aberto';
  if(k==='tasks'&&!p.manutencao&&!p.tipos.length)return false; // handled as incident confirmation below
  return p.edit;
}
export function mergeScoped(incoming,current,a){
  if(!incoming||incoming.v!==2||!incoming.CFG)throw Object.assign(new Error('snapshot_invalido'),{status:400});
  const result=clone(current),view=scopedSnapshot(current,a);
  for(const k of COLLECTIONS){
    if(['notifs','auditLog'].includes(k))continue;
    const sent=incoming[k];if(sent===undefined)continue;
    if(!Array.isArray(sent))throw Object.assign(new Error('Coleção inválida: '+k),{status:400});
    if(!allowedCollection(k,a)){
      if(sent.length)reject('Esta conta não pode gravar a área '+k+'.');continue;
    }
    const oldRows=current[k]||[],visible=new Map(view[k].map(r=>[r.id,r])),oldMap=new Map(oldRows.map(r=>[r.id,r]));
    const updates=new Map(),seen=new Set();
    for(const row of sent){
      if(!row||typeof row.id!=='string'||row.id.length>120||!row.id||seen.has(row.id))throw Object.assign(new Error('Registro inválido ou duplicado em '+k),{status:400});
      seen.add(row.id);
      const old=oldMap.get(row.id),shown=visible.get(row.id);
      if(shown&&same(row,shown))continue;
      if(old&&!shown)reject('Registro fora da área desta conta.');
      if(!rowVisible(row,k,a))reject('Condomínio ou tipo não permitido.');
      if(k==='tasks'&&!a.fullRead&&!a.perms.manutencao&&!a.perms.tipos.length){
        if(!old){
          if(!a.perms.create||row.origem!=='ronda'||!['Manutencao','Manutenção'].includes(row.tipo))reject('Somente chamados de ronda são permitidos.');
          if(!(incoming.brigRondas||[]).some(r=>r.chamadoId===row.id&&r.userId===a.userId&&!r.ok))reject('Chamado sem ronda correspondente.');
          updates.set(row.id,{...clone(row),responsavel:'Cleiton',criadoPor:a.name,criadoPorId:a.userId,tipo:'Manutencao',status:'Pendente',vencimento:null});continue;
        }
        const changes=Object.keys(row).filter(key=>!same(row[key],shown[key]));
        if(changes.some(key=>!['vistoDeNovo','vistoPorUltimo','historico'].includes(key)))reject('Somente a confirmação da ocorrência é permitida.');
        const repeats=(incoming.brigRondas||[]).filter(r=>r.chamadoId===row.id&&r.userId===a.userId&&r.repeteDe&&!(current.brigRondas||[]).some(x=>x.id===r.id));
        if(!repeats.length)reject('Confirmação sem registro de ronda.');
        updates.set(row.id,{...old,vistoDeNovo:Number(old.vistoDeNovo||0)+repeats.length,vistoPorUltimo:row.vistoPorUltimo,historico:[...(old.historico||[]),...(row.historico||[]).slice((shown.historico||[]).length).map(h=>({...h,q:a.name}))]});continue;
      }
      if(!writeAllowed(k,a,old,row))reject('Esta conta não pode alterar este registro de '+k+'.');
      const clean={...(old||{}),...clone(row)};
      if(k==='leituras'&&a.perms.leiturasSimples){for(const key of ['valor','custo','tarifa','valorAgua','valorEnergia','total'])if(key in row&&!same(row[key],shown?.[key]))reject('Valores financeiros não são permitidos neste perfil.');}
      if(k==='pedidos'&&!old)Object.assign(clean,{status:'Aberto',decisao:null,decisor:null,motivo:'',solicitante:a.name});
      if(k==='leituras'&&!a.fullRead&&row.status==='Registrada'&&old?.status!=='Registrada')clean.responsavel=a.name;
      if(old){
        for(const key of ['userId','criadoPorId','criadoPor','autor','solicitante'])if(old[key]!==undefined)clean[key]=old[key];
      }else{
        clean.criadoPorId=a.userId;
        for(const key of ['userId','criadoPor','autor','solicitante'])if(key in clean)clean[key]=key==='userId'?a.userId:a.name;
      }
      updates.set(row.id,clean);
    }
    const removed=new Set();
    for(const [id,shown]of visible)if(!seen.has(id)){
      // Limited views cannot delete another team's rows, even by omission.
      const old=oldMap.get(id);
      const consumeReading=k==='leituras'&&old.status!=='Registrada'&&sent.some(r=>r.tipo===old.tipo&&r.condoId===old.condoId&&r.data===old.data&&r.status==='Registrada');
      if(a.perms.delete||consumeReading)removed.add(id);
      else if(a.perms.edit&&['u2'].includes(a.userId))reject('Esta conta não pode excluir registros.');
      // Operational clients historically omit other rows: omission is not deletion authority.
    }
    result[k]=oldRows.filter(r=>!removed.has(r.id)).map(r=>updates.get(r.id)||r);
    for(const [id,row]of updates)if(!oldMap.has(id))result[k].push(row);
  }
  if(a.userId==='u1')result.CFG=clone(incoming.CFG);
  else if(a.fullRead){
    for(const key of ['permsUsuarios','nomesUsuarios','coordPodeExcluirPrestador']){
      const actual=key==='permsUsuarios'?view.CFG[key]:current.CFG?.[key];
      if(!same(incoming.CFG[key],actual))reject('Somente Maciel altera os acessos da equipe.');
    }
    const {permsUsuarios,nomesUsuarios,coordPodeExcluirPrestador,...cfg}=incoming.CFG;
    result.CFG={...result.CFG,...clone(cfg)};
  }
  else if(!same(incoming.CFG.permsUsuarios,view.CFG.permsUsuarios))reject('Somente Maciel altera os acessos da equipe.');
  // No notifications/audit/global configuration are trusted from restricted clients.
  const changed=COLLECTIONS.filter(k=>!['auditLog','notifs'].includes(k)&&!same(result[k],current[k]));
  if(changed.length||!same(result.CFG,current.CFG)){
    const when=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date());
    result.auditLog=[...(current.auditLog||[]),{id:'lg_'+randomUUID(),quando:when,autor:a.name,acao:'Alteração confirmada no servidor',alvo:changed.join(', ')||'Configurações',detalhe:'Conta '+a.userId+' · gravação autorizada por perfil',condo:'—',motivo:'—'}];
  }
  delete result.creds;delete result._access;delete result.authStatus;
  return result;
}
export function attachmentRefs(snapshot){
  const ids=new Set();
  function walk(x){if(typeof x==='string'&&/^ref:[A-Za-z0-9_-]{3,80}$/.test(x))ids.add(x.slice(4));else if(x&&typeof x==='object')Object.values(x).forEach(walk);}
  walk(snapshot);return ids;
}
