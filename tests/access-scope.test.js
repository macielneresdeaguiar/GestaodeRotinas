import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createClient} from '@libsql/client';
let dir,db,child,base,cookies={};
const pass='Fixture-Only-Password!';
const ids=['u1','u2','u3','u4','b1','b2','b3','b4','p1','p2','p3','p4','p5','p6'];
const fixture={v:2,CFG:{permsUsuarios:{},nomesUsuarios:{},pub:{repDoc:'PRIVATE_DOC'},tarifas:{c1:{agua:99}},nomeEmpresa:'Fixture'},
 tasks:[{id:'admin',condoId:'c1',tipo:'Administrativo',titulo:'SECRET_ADMIN',status:'Pendente'},{id:'tl',condoId:'c2',tipo:'Administrativo',titulo:'SECRET_TL'},{id:'maintenance',condoId:'c1',tipo:'Manutencao',titulo:'Repair',status:'Pendente'},{id:'incident',condoId:'c1',tipo:'Manutencao',origem:'ronda',titulo:'Door',status:'Pendente',anexo:'ref:incident_photo',obs:'SECRET_NOTE',historico:[]}],
 notas:[{id:'nf',condoId:'c2',obs:'SECRET_INVOICE'}],salas:[{id:'room',condoId:'c1',ocupante:'SECRET_OCCUPANT'}],unidSind:[{id:'private',predio:'PRIVATE_PORTFOLIO',iptu:'SECRET_TAX'}],
 leituras:[{id:'program',condoId:'c1',tipo:'agua',data:'2026-10-30',status:'Programada',anterior:100},{id:'read',condoId:'c1',tipo:'agua',data:'2026-10-29',status:'Registrada',medidor:100,leitura:100,consumo:5,valor:500,responsavel:'Maciel'}],
 brigInsp:[{id:'check',condoId:'c1',userId:'b2',status:'Em andamento'}],brigRondas:[],apontamentos:[{id:'repair',condoId:'c1',descricao:'Maintenance'}],manutObrig:[{id:'mandatory',condoId:'c1',anexo:'ref:secret_photo'}],estoque:[{id:'stock',nome:'Material',qtd:5}],pedidos:[],auditLog:[],notifs:[]};
async function req(route,body,id='u1',headers={},method){
 const r=await fetch(base+route,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-GRC-Client':'daily-2026-10-30','X-GRC-Scope':'scoped-2026-10-30','X-GRC-Workflow':'manager-review-v2','X-GRC-User':id,Origin:base,...(cookies[id]?{Cookie:cookies[id]}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
}
async function get(id='u1'){return (await req('/api/dados',undefined,id)).data;}
async function put(snapshot,versaoBase,id='u1',headers={}){return req('/api/dados',{snapshot,versaoBase},id,headers);}
before(async()=>{
 dir=await mkdtemp(path.join(tmpdir(),'grc-scope-'));const url='file:'+path.join(dir,'test.sqlite');db=createClient({url});
 const src=await readFile(new URL('./auth-diaria.test.js',import.meta.url),'utf8');const creds=JSON.parse(src.match(/const creds=(\{[^\n]+\});/)[1]);
 fixture.creds=Object.fromEntries(ids.map(id=>[id,creds.u1]));
 await db.execute('CREATE TABLE workspace(id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,versao INTEGER NOT NULL,atualizado TEXT NOT NULL,autor TEXT)');
 await db.execute({sql:'INSERT INTO workspace VALUES(?,?,?,?,?)',args:['default',JSON.stringify(fixture),1,new Date().toISOString(),'Fixture']});
 const netServer=net.createServer();await new Promise(r=>netServer.listen(0,'127.0.0.1',r));const port=netServer.address().port;await new Promise(r=>netServer.close(r));base='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,TURSO_DATABASE_URL:url,PORT:String(port)}});let logs='';child.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/auth/perfis')).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,30));}
 for(const id of ids){const r=await req('/api/auth/login',{userId:id,password:pass},id);assert.equal(r.status,200,id);cookies[id]=r.cookie.split(';')[0];}
});
after(async()=>{child?.kill();db?.close();if(dir)await rm(dir,{recursive:true,force:true});});
test('all 14 profiles receive server scopes; Maciel and Alef see every module, others receive no unrelated data',async()=>{
 for(const id of ids){
   const {snapshot:s}=await get(id);assert.equal(s._access.userId,id);
   if(['u1','u2'].includes(id)){assert.ok(s._access.pages.includes('unidsind'));assert.ok(s._access.pages.includes('brigada-inicio'));assert.equal(s.unidSind[0].iptu,'SECRET_TAX');continue;}
   const serialized=JSON.stringify(s);for(const marker of ['SECRET_ADMIN','SECRET_TL','SECRET_INVOICE','PRIVATE_PORTFOLIO','SECRET_TAX','SECRET_OCCUPANT','PRIVATE_DOC'])assert.ok(!serialized.includes(marker),id+' leaked '+marker);
   assert.deepEqual(s.unidSind,[]);assert.equal((await req('/api/historico',undefined,id)).status,403);
   if(id.startsWith('p')){assert.deepEqual(s._access.pages,['inicio','config','leituras']);assert.equal(s.leituras[1].valor,undefined);assert.equal(s.leituras[1].consumo,undefined);assert.equal(s.CFG.tarifas,undefined);assert.deepEqual(s.tasks,[]);}
   if(id.startsWith('b')){assert.deepEqual(s.leituras,[]);assert.ok(!serialized.includes('SECRET_NOTE'));}
 }
 const raw=JSON.parse((await db.execute('SELECT snapshot FROM workspace')).rows[0].snapshot);assert.equal(raw.unidSind,undefined);
 assert.equal(JSON.parse((await db.execute('SELECT snapshot FROM workspace_private')).rows[0].snapshot).unidSind[0].id,'private');
});
test('hidden rows, cross-condominium writes, permission escalation and legacy clients are refused; conflicts stay scoped',async()=>{
 assert.equal((await req('/api/dados',undefined,'p1',{'X-GRC-User':'u1'})).status,403);
 let s=await get('p1');s.snapshot.tasks=[{id:'admin',condoId:'c1',tipo:'Administrativo',titulo:'tamper'}];assert.equal((await put(s.snapshot,s.versao,'p1')).status,403);
 s=await get('p1');s.snapshot.leituras.push({id:'forbidden',condoId:'c2',tipo:'agua'});assert.equal((await put(s.snapshot,s.versao,'p1')).status,403);
 s=await get('u2');s.snapshot.CFG.permsUsuarios.p1={sindico:true};assert.equal((await put(s.snapshot,s.versao,'u2')).status,403);
 s=await get('u1');assert.equal((await put(s.snapshot,s.versao,'u1',{'X-GRC-Workflow':'old'})).status,426);assert.equal((await put(s.snapshot,s.versao,'u1',{'X-GRC-Scope':'old'})).status,426);assert.equal((await put(s.snapshot,null,'u1')).status,400);
 s=await get('b1');const conflict=await put(s.snapshot,s.versao-1,'b1');assert.equal(conflict.status,409);assert.deepEqual(conflict.data.snapshot.unidSind,[]);assert.ok(!JSON.stringify(conflict.data).includes('SECRET_INVOICE'));
});
test('portaria registers a scheduled reading and next one while preserving all other areas and existing financial fields',async()=>{
 const s=await get('p1'),row=s.snapshot.leituras.find(r=>r.id==='program');Object.assign(row,{status:'Registrada',leitura:110,medidor:110,responsavel:'Portaria 1'});
 s.snapshot.leituras.push({id:'next_read',condoId:'c1',tipo:'agua',data:'2026-10-31',status:'Programada',anterior:110});
 assert.equal((await put(s.snapshot,s.versao,'p1')).status,200);
 const all=await get();assert.equal(all.snapshot.tasks.find(t=>t.id==='admin').titulo,'SECRET_ADMIN');assert.equal(all.snapshot.unidSind[0].iptu,'SECRET_TAX');assert.equal(all.snapshot.leituras.find(r=>r.id==='read').valor,500);assert.equal(all.snapshot.leituras.find(r=>r.id==='program').leitura,110);
 const tamper=await get('p1');tamper.snapshot.leituras.find(r=>r.id==='read').leitura=2;assert.equal((await put(tamper.snapshot,tamper.versao,'p1')).status,403);
});
test('attachments are authorized by record or uploader; another profile cannot guess or attach a private file',async()=>{
 const data='data:image/png;base64,aGVsbG8=';
 assert.equal((await req('/api/foto/secret_photo',{dados:data},'u1',{},'PUT')).status,200);
 assert.equal((await req('/api/foto/secret_photo',undefined,'u3')).status,404); // mandatory maintenance is not assigned to this role
 assert.equal((await req('/api/foto/secret_photo',undefined,'p1')).status,404);
 assert.equal((await req('/api/foto/secret_photo',undefined,'u1')).status,200);
 assert.equal((await req('/api/foto/b1_upload',{dados:data},'b1',{},'PUT')).status,200);
 assert.equal((await req('/api/foto/b1_upload',undefined,'b2')).status,404);
 const s=await get('b1');s.snapshot.brigInsp.push({id:'mine',condoId:'c1',userId:'b1',status:'Em andamento',pontos:[{fotos:['ref:b1_upload']}]});assert.equal((await put(s.snapshot,s.versao,'b1')).status,200);
 assert.equal((await req('/api/foto/b1_upload',undefined,'b2')).status,200); // same brigada module, legitimate shared checklist
 const attack=await get('b1');attack.snapshot.brigInsp.find(r=>r.id==='mine').pontos[0].fotos=['ref:secret_photo'];assert.equal((await put(attack.snapshot,attack.versao,'b1')).status,403);
 const other=await get('b1');other.snapshot.brigInsp.find(r=>r.id==='check').status='Concluído';assert.equal((await put(other.snapshot,other.versao,'b1')).status,403);
});
test('ronda creates its linked maintenance incident without granting administrative writes, and versions retain recoverable data',async()=>{
 const s=await get('u4');s.snapshot.brigRondas.push({id:'round',condoId:'c1',userId:'u4',autor:'Fernanda',ok:false,chamadoId:'call',obs:'Door'});
 s.snapshot.tasks.push({id:'call',condoId:'c1',tipo:'Manutencao',origem:'ronda',status:'Pendente',titulo:'Door',criadoPor:'Fake',responsavel:'Maciel'});
 const r=await put(s.snapshot,s.versao,'u4');assert.equal(r.status,200,JSON.stringify(r.data));
 const all=await get();assert.equal(all.snapshot.tasks.find(t=>t.id==='call').criadoPor,'Fernanda');assert.equal(all.snapshot.tasks.find(t=>t.id==='call').responsavel,'Cleiton');assert.equal(all.snapshot.notas[0].obs,'SECRET_INVOICE');
 const backups=await db.execute('SELECT snapshot,privado FROM workspace_backup ORDER BY versao');assert.ok(backups.rows.length>=3);assert.equal(JSON.parse(backups.rows[0].snapshot).tasks[0].titulo,'SECRET_ADMIN');assert.equal(JSON.parse(backups.rows[0].privado).unidSind[0].iptu,'SECRET_TAX');
});

test('full backup restores all thirteen tables including credentials, attachments and private portfolio into a separate empty database',async()=>{
 process.env.TURSO_DATABASE_URL='file:'+path.join(dir,'test.sqlite');
 const {exportDatabase,restoreEmptyDatabase,BACKUP_TABLES}=await import('../server/backup.js');
 const backup=await exportDatabase(db);assert.equal(backup.tables.length,13);
 const target=createClient({url:'file:'+path.join(dir,'restored.sqlite')});
 try{
  const result=await restoreEmptyDatabase(backup,target);assert.equal(result.tables,13);
  for(const name of BACKUP_TABLES){const a=await db.execute('SELECT COUNT(*) n FROM '+name),b=await target.execute('SELECT COUNT(*) n FROM '+name);assert.equal(b.rows[0].n,a.rows[0].n,name);}
  assert.equal(JSON.parse((await target.execute('SELECT snapshot FROM workspace_private')).rows[0].snapshot).unidSind[0].iptu,'SECRET_TAX');
  assert.equal((await target.execute("SELECT scheme FROM auth_user WHERE id='u1'")).rows[0].scheme,'scrypt-v1');
  await assert.rejects(()=>restoreEmptyDatabase(backup,target),/vazia/);
 }finally{target.close()}
 const corrupted=structuredClone(backup);corrupted.tables[0].rows.pop();await assert.rejects(()=>restoreEmptyDatabase(corrupted,db),/corrompido/);
});


test('brigada has monthly checklists and daily rounds; the retired service desk stays unavailable',async()=>{
 for(const id of ids){
  const s=await get(id);assert.ok(!s.snapshot._access.pages.includes('atendimentos'),id);
  if(id.startsWith('b')){
   assert.deepEqual(s.snapshot._access.pages,['inicio','config','brigada-inicio','brigada','brigada-form','brigada-ronda']);
   assert.ok(s.snapshot.brigRondas.some(r=>r.id==='round'));assert.ok(s.snapshot.tasks.every(t=>t.origem==='ronda'));assert.ok(!JSON.stringify(s.snapshot).includes('SECRET_NOTE'));
  }
  if(id!=='u1'){assert.equal((await req('/api/atendimentos',undefined,id)).status,403);assert.equal((await req('/api/atendimentos',{inspectionId:'check',pointIndex:0},id)).status,403);}
 }
 const archive=await req('/api/atendimentos',undefined,'u1');assert.equal(archive.status,200);assert.equal(archive.data.desativado,true);
 assert.equal((await req('/api/atendimentos',{inspectionId:'check',pointIndex:0},'u1')).status,410);
 for(const id of ['b1','b2','b3','b4']){
  const attempt=await get(id);attempt.snapshot.brigRondas.push({id:'daily-'+id,condoId:'c1',userId:id,ok:true});assert.equal((await put(attempt.snapshot,attempt.versao,id)).status,200);
 }
 const report=await get('b1');report.snapshot.brigRondas.push({id:'brig-incident',condoId:'c1',userId:'b1',ok:false,chamadoId:'brig-call',obs:'Porta danificada'});
 report.snapshot.tasks.push({id:'brig-call',condoId:'c1',tipo:'Manutencao',origem:'ronda',status:'Pendente',titulo:'Porta danificada'});
 assert.equal((await put(report.snapshot,report.versao,'b1')).status,200);
 const repeat=await get('b2');repeat.snapshot.brigRondas.push({id:'brig-repeat',condoId:'c1',userId:'b2',ok:false,chamadoId:'brig-call',repeteDe:'brig-incident'});repeat.snapshot.tasks.find(t=>t.id==='brig-call').vistoDeNovo=1;
 assert.equal((await put(repeat.snapshot,repeat.versao,'b2')).status,200);
 const tamper=await get('b1');tamper.snapshot.tasks.find(t=>t.id==='brig-call').status='Concluída';assert.equal((await put(tamper.snapshot,tamper.versao,'b1')).status,403);
 const all=await get();assert.equal(all.snapshot.tasks.find(t=>t.id==='brig-call').responsavel,'Cleiton');assert.equal(all.snapshot.tasks.find(t=>t.id==='brig-call').vistoDeNovo,1);
});
test('only Maciel can verify and close checklist defects, including own reports, monthly carryovers and linked legacy tasks',async()=>{
 const create=await get('b2');
 create.snapshot.brigInsp.push({id:'manager_defect',condoId:'c1',andar:'24',sistema:'iluminacao',data:'2026-09-01',userId:'b2',status:'Concluído',pontos:[{desc:'Luminária do corredor',sit:'NÃO CONFORME',obs:'Sem acender',fotos:[]}],historico:[]});
 assert.equal((await put(create.snapshot,create.versao,'b2')).status,200);
 for(const id of ['b1','b2','u2']){
  let s=await get(id),row=s.snapshot.brigInsp.find(i=>i.id==='manager_defect');
  Object.assign(row.pontos[0],{resolvido:true,resolvidoPor:id,obsResolucao:'Serviço conferido'});row.resolvido=true;
  assert.equal((await put(s.snapshot,s.versao,id)).status,403,id);
 }
 let bad=await get('b2');bad.snapshot.brigInsp.find(i=>i.id==='manager_defect').pontos=[];assert.equal((await put(bad.snapshot,bad.versao,'b2')).status,403);
 bad=await get('b2');bad.snapshot.brigInsp.find(i=>i.id==='manager_defect').pontos[0].sit='CONFORME';assert.equal((await put(bad.snapshot,bad.versao,'b2')).status,403);
 bad=await get('b2');bad.snapshot.brigInsp.push({id:'false-month',condoId:'c1',andar:'24',sistema:'iluminacao',data:'2026-10-01',userId:'b2',status:'Concluído',pontos:[{desc:'Luminária do corredor',sit:'CONFORME'}]});assert.equal((await put(bad.snapshot,bad.versao,'b2')).status,403);
 const next=await get('b2');next.snapshot.brigInsp.push({id:'manager_review',condoId:'c1',andar:'24',sistema:'iluminacao',data:'2026-10-01',userId:'b2',status:'Concluído',pontos:[{desc:'Luminária do corredor',sit:'NÃO CONFORME',obs:'Sem acender',fotos:[],repeteDe:'manager_defect',revisaoPendente:false,confirmadoPor:'Nilson'}]});assert.equal((await put(next.snapshot,next.versao,'b2')).status,200);
 const link=await get();link.snapshot.tasks.push({id:'linked-checklist',condoId:'c1',tipo:'Manutencao',origem:'manual',brigInspId:'manager_defect',titulo:'Trocar luminária',status:'Pendente',responsavel:'Cleiton'});assert.equal((await put(link.snapshot,link.versao)).status,200);
 const bypass=await get('u3');bypass.snapshot.tasks.find(t=>t.id==='linked-checklist').status='Concluída';assert.equal((await put(bypass.snapshot,bypass.versao,'u3')).status,403);
 const unlink=await get('u3');delete unlink.snapshot.tasks.find(t=>t.id==='linked-checklist').brigInspId;assert.equal((await put(unlink.snapshot,unlink.versao,'u3')).status,403);
 const manager=await get();for(const i of manager.snapshot.brigInsp.filter(i=>['manager_defect','manager_review'].includes(i.id))){Object.assign(i.pontos[0],{resolvido:true,resolvidoPor:'Maciel',obsResolucao:'Luminária substituída e conferida no local'});i.resolvido=true;}
 assert.equal((await put(manager.snapshot,manager.versao)).status,200);
 const all=await get();for(const i of all.snapshot.brigInsp.filter(i=>['manager_defect','manager_review'].includes(i.id))){assert.equal(i.pontos[0].resolvidoPorId,'u1');assert.equal(i.userId,'b2');}
 const after=await get('b2');after.snapshot.brigInsp.push({id:'after-manager-review',condoId:'c1',andar:'24',sistema:'iluminacao',data:'2026-11-01',userId:'b2',status:'Concluído',pontos:[{desc:'Luminária do corredor',sit:'CONFORME'}]});assert.equal((await put(after.snapshot,after.versao,'b2')).status,200);
 assert.equal((await get()).snapshot.unidSind[0].iptu,'SECRET_TAX');
 const legacy=await get('b2');assert.equal((await put(legacy.snapshot,legacy.versao,'b2',{'X-GRC-Workflow':'monthly-review-v1'})).status,426);
});
test('retired maintenance records and evidence are preserved for Maciel without reopening access to the team',async()=>{
 const c={id:'archived_case',key:'fixture_key',condoId:'c1',ponto:'Histórico preservado',fotos:['ref:archive_evidence'],reparoFotos:[]};
 await db.execute({sql:'INSERT INTO maintenance_case VALUES(?,?,?,?,?,?,?)',args:[c.id,c.key,c.key,'c1','Encaminhado',1,JSON.stringify(c)]});
 await db.execute({sql:'INSERT INTO maintenance_event VALUES(?,?,?,?,?,?,?)',args:['event_fixture',c.id,new Date().toISOString(),'b1','Anderson','Encaminhado','Histórico original']});
 assert.equal((await req('/api/foto/archive_evidence',{dados:'data:image/png;base64,aGVsbG8='},'u1',{},'PUT')).status,200);
 assert.equal((await req('/api/atendimentos/'+c.id,undefined,'u1')).data.historico[0].note,'Histórico original');
 for(const id of ['b1','u2','u3','p1']){assert.equal((await req('/api/atendimentos/'+c.id,undefined,id)).status,403);assert.equal((await req('/api/foto/archive_evidence',undefined,id)).status,404);}
 assert.equal((await req('/api/atendimentos/'+c.id+'/acao',{acao:'confirmar',versao:1},'u1')).status,410);
 assert.equal((await db.execute({sql:'SELECT state FROM maintenance_case WHERE id=?',args:[c.id]})).rows[0].state,'Encaminhado');
});

test('cleaning workflow isolates Fernanda stock, versions concurrent changes, preserves monthly prices and emits real PDFs',async()=>{
 const month=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date());
 for(const id of ids.filter(i=>!['u1','u2','u4'].includes(i))){assert.equal((await req('/api/limpeza',undefined,id)).status,403);assert.equal((await req('/api/limpeza/'+month,{action:'abrir',version:0},id)).status,403);}
 for(const id of ['u1','u2','u4'])assert.ok((await get(id)).snapshot._access.pages.includes('limpeza'));
 const catalog={version:0,company:'Condomínio de teste\nEndereço de teste',supplier:'Fornecedor de teste',items:[{id:'fixture_paper',name:'Papel para teste',unit:'Caixa',ideal:8,price:12.5,dispensers:3},{id:'fixture_soap',name:'Sabonete para teste',unit:'Refil',ideal:10,price:4,dispensers:2}]};
 assert.equal((await req('/api/limpeza/catalogo',catalog,'u4')).status,403);
 assert.equal((await req('/api/limpeza/catalogo',catalog,'u2')).status,200);
 let r=await req('/api/limpeza/'+month,{action:'abrir',version:0},'u4');assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.cycle.items[0].stock,null);assert.equal(r.data.cycle.items[0].price,undefined);assert.equal(r.data.cycle.company,undefined);
 let version=r.data.cycle.version;
 assert.equal((await req('/api/limpeza/'+month,{action:'pedido',version,items:[{id:'fixture_paper',quantity:2,price:12.5},{id:'fixture_soap',quantity:10,price:4}]},'u4')).status,403);
 assert.equal((await req('/api/limpeza/'+month,{action:'confirmar',version,items:[{id:'fixture_paper',stock:4},{id:'fixture_soap',stock:null}]},'u4')).status,400);
 assert.equal((await req('/api/limpeza/'+month,{action:'estoque',version,items:[{id:'fixture_paper',stock:4,price:0},{id:'fixture_soap',stock:0}]},'u4')).status,403);
 r=await req('/api/limpeza/'+month,{action:'confirmar',version,items:[{id:'fixture_paper',stock:4},{id:'fixture_soap',stock:0}]},'u4');assert.equal(r.status,200);version=r.data.cycle.version;
 assert.equal(r.data.cycle.confirmedBy,'Fernanda');assert.equal((await req('/api/limpeza',undefined,'u2')).data.reminder.title,'Estoque de limpeza conferido: preparar pedido');
 assert.equal((await req('/api/limpeza/'+month,{action:'estoque',version:version-1,items:[]},'u4')).status,409);
 const updated=structuredClone(catalog);updated.version=1;updated.items[0].price=15;assert.equal((await req('/api/limpeza/catalogo',updated,'u2')).status,200);
 assert.equal((await req('/api/limpeza',undefined,'u2')).data.cycle.items[0].price,12.5,'Existing month keeps original reference');
 r=await req('/api/limpeza/'+month,{action:'finalizar',version,items:[{id:'fixture_paper',quantity:4,price:13},{id:'fixture_soap',quantity:0,price:4}]},'u2');assert.equal(r.status,200);version=r.data.cycle.version;assert.equal(r.data.cycle.status,'Pedido preparado');assert.equal(r.data.reminder,null);
 for(const suffix of ['', '?precos=1']){const pdf=await fetch(base+'/api/limpeza/'+month+'/pdf'+suffix,{headers:{Cookie:cookies.u2}});assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/application\/pdf/);const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>1000);}
 assert.equal((await req('/api/limpeza/'+month+'/pdf',undefined,'u4')).status,403);
 assert.equal((await req('/api/limpeza/'+month,{action:'estoque',version,items:[]},'u4')).status,400);
 assert.equal((await req('/api/limpeza/'+month,{action:'reabrir',version},'u4')).status,403);
 r=await req('/api/limpeza/'+month,{action:'reabrir',version},'u1');assert.equal(r.status,200);assert.ok(r.data.cycle.history.length>=4);
 const {cleaningReminder}=await import('../server/cleaning.js');assert.equal(cleaningReminder('u4',null,'2026-11-14'),null);assert.ok(cleaningReminder('u4',null,'2026-11-15'));assert.ok(cleaningReminder('u4',null,'2026-11-30'));
 const all=await get();assert.equal(all.snapshot.unidSind[0].iptu,'SECRET_TAX');assert.equal(all.snapshot.notas[0].obs,'SECRET_INVOICE');
});
