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
 const r=await fetch(base+route,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-GRC-Client':'daily-2026-10-30','X-GRC-Scope':'scoped-2026-10-30','X-GRC-User':id,Origin:base,...(cookies[id]?{Cookie:cookies[id]}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
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
 s=await get('u1');assert.equal((await put(s.snapshot,s.versao,'u1',{'X-GRC-Scope':'old'})).status,426);assert.equal((await put(s.snapshot,null,'u1')).status,400);
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

test('full backup restores all ten tables including credentials, attachments and private portfolio into a separate empty database',async()=>{
 process.env.TURSO_DATABASE_URL='file:'+path.join(dir,'test.sqlite');
 const {exportDatabase,restoreEmptyDatabase,BACKUP_TABLES}=await import('../server/backup.js');
 const backup=await exportDatabase(db);assert.equal(backup.tables.length,10);
 const target=createClient({url:'file:'+path.join(dir,'restored.sqlite')});
 try{
  const result=await restoreEmptyDatabase(backup,target);assert.equal(result.tables,10);
  for(const name of BACKUP_TABLES){const a=await db.execute('SELECT COUNT(*) n FROM '+name),b=await target.execute('SELECT COUNT(*) n FROM '+name);assert.equal(b.rows[0].n,a.rows[0].n,name);}
  assert.equal(JSON.parse((await target.execute('SELECT snapshot FROM workspace_private')).rows[0].snapshot).unidSind[0].iptu,'SECRET_TAX');
  assert.equal((await target.execute("SELECT scheme FROM auth_user WHERE id='u1'")).rows[0].scheme,'scrypt-v1');
  await assert.rejects(()=>restoreEmptyDatabase(backup,target),/vazia/);
 }finally{target.close()}
 const corrupted=structuredClone(backup);corrupted.tables[0].rows.pop();await assert.rejects(()=>restoreEmptyDatabase(corrupted,db),/corrompido/);
});
