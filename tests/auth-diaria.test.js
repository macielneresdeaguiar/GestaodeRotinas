import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

let directory,db,child,base,managerCookie,userCookie;
const password='Fixture-Only-Password!';
const headers=()=>({'Content-Type':'application/json','X-GRC-Client':'daily-2026-10-30','X-GRC-Scope':'scoped-2026-10-30',Origin:base});
async function request(route,body,cookie,extra={}) {
  const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...headers(),'X-GRC-User':cookie===userCookie?'u2':'u1',...(cookie?{Cookie:cookie}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie'),headers:r.headers};
}
const cookieOf=r=>r.cookie.split(';')[0];
before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'grc-auth-test-'));
  process.env.TURSO_DATABASE_URL='file:'+path.join(directory,'test.sqlite');
  const database=await import('../server/db.js');db=database.db;await database.migrate();
  // Fixed test-only legacy credentials; no production data.
  const creds={"u1":{"salt":"fixture-salt-u1","hash":"162b58ec90814720","trocadaEm":"30/10/2026 10:00"},"u2":{"salt":"fixture-salt-u2","hash":"680f35beb2d38e00","trocadaEm":"30/10/2026 10:00"}};
  await db.execute({sql:'INSERT INTO workspace VALUES(?,?,?,?,?)',args:['default',JSON.stringify({v:2,CFG:{permsUsuarios:{},nomesUsuarios:{},coordPodeExcluirPrestador:false},creds,tasks:[{id:'t1',titulo:'Preservar tarefa'}],salas:[{id:'s1',numero:'201',atividade:'Seguro'}],notas:[]}),50,new Date().toISOString(),'Fixture']});
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port)}});
  let errors='';child.stderr.on('data',x=>errors+=x);
  for(let i=0;i<100;i++){
    try{const r=await fetch(base+'/api/auth/perfis');if(r.ok)return}catch{}
    if(child.exitCode!==null)throw new Error(errors);
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Server did not start '+errors);
});
after(async()=>{child?.kill();db?.close();if(directory)await rm(directory,{recursive:true,force:true});});

test('midnight is the next São Paulo calendar day, including year boundary',async()=>{
  const {dailyExpiry}=await import('../server/auth.js');
  assert.equal(new Date(dailyExpiry(new Date('2026-10-31T02:59:59Z'))).toISOString(),'2026-10-31T03:00:00.000Z');
  assert.equal(new Date(dailyExpiry(new Date('2026-10-31T03:00:00Z'))).toISOString(),'2026-11-01T03:00:00.000Z');
  assert.equal(new Date(dailyExpiry(new Date('2027-01-01T02:00:00Z'))).toISOString(),'2027-01-01T03:00:00.000Z');
});
test('anonymous API access and legacy token are refused; profile list has no credentials',async()=>{
  for(const route of ['/api/dados','/api/historico','/api/foto/nonexistent'])assert.equal((await request(route)).status,401,route);
  assert.equal((await request('/api/dados',undefined,null,{'x-grc-token':'old-token'})).status,401);
  assert.equal((await request('/api/fotos/faltam',{ids:[]})).status,401);
  const health=await request('/api/saude');assert.equal(health.status,200);assert.equal(health.body.versao,undefined);assert.equal(health.body.fotos,undefined);
  const p=await request('/api/auth/perfis');assert.equal(p.status,200);assert.equal(p.body.creds.u1.definida,true);assert.ok(!JSON.stringify(p.body).includes('fixture-salt'));
  const ws=JSON.parse((await db.execute('SELECT snapshot FROM workspace')).rows[0].snapshot);assert.equal(ws.creds,undefined);assert.equal(ws.tasks[0].titulo,'Preservar tarefa');
});
test('origin, client protocol, wrong password and uninvited signup are rejected',async()=>{
  assert.equal((await request('/api/auth/login',{userId:'u1',password},null,{Origin:'https://other.invalid'})).status,403);
  assert.equal((await request('/api/auth/login',{userId:'u1',password},null,{'X-GRC-Client':'old'})).status,403);
  assert.equal((await request('/api/auth/login',{userId:'u1',password:'wrong'})).status,401);
  assert.equal((await request('/api/auth/login',{userId:'p1',password})).status,401);
});
test('existing password logs in, upgrades hash and issues persistent HttpOnly daily cookie',async()=>{
  const r=await request('/api/auth/login',{userId:'u1',password});assert.equal(r.status,200);managerCookie=cookieOf(r);
  assert.match(r.cookie,/HttpOnly/);assert.match(r.cookie,/SameSite=Strict/);assert.match(r.cookie,/Expires=/);assert.equal(new Date(r.body.expiresAt).getUTCHours(),3);
  assert.equal((await db.execute("SELECT scheme FROM auth_user WHERE id='u1'")).rows[0].scheme,'scrypt-v1');
  const sess=await request('/api/auth/session',undefined,managerCookie);assert.equal(sess.status,200);assert.equal(sess.body.userId,'u1');
  const data=await request('/api/dados',undefined,managerCookie);assert.equal(data.status,200);assert.equal(data.body.snapshot.creds.u1.definida,true);assert.equal(data.body.snapshot.creds.u1.hash,undefined);assert.equal(data.headers.get('cache-control'),'no-store');
  const tls=await request('/api/auth/login',{userId:'u2',password},null,{'X-Forwarded-Proto':'https'});assert.match(tls.cookie,/__Host-grc_session=/);assert.match(tls.cookie,/; Secure/);
});
test('non-manager cannot reset accounts or grant permissions; stale credential writes cannot overwrite passwords',async()=>{
  const login=await request('/api/auth/login',{userId:'u2',password});userCookie=cookieOf(login);
  assert.equal((await request('/api/auth/invite',{userId:'u1'},userCookie)).status,403);
  const data=await request('/api/dados',undefined,userCookie);data.body.snapshot.CFG.permsUsuarios.u2={'delete':true};
  assert.equal((await request('/api/dados',{snapshot:data.body.snapshot,versaoBase:data.body.versao},userCookie)).status,403);
  const good=await request('/api/dados',undefined,managerCookie);good.body.snapshot.creds={u1:{hash:'attacker',salt:'bad'}};
  const saved=await request('/api/dados',{snapshot:good.body.snapshot,versaoBase:good.body.versao,autor:'attacker'},managerCookie);assert.equal(saved.status,200);
  const raw=JSON.parse((await db.execute('SELECT snapshot FROM workspace')).rows[0].snapshot);assert.equal(raw.creds,undefined);assert.equal(raw.salas[0].atividade,'Seguro');
});
test('invitation is manager-only, single-use and revokes old sessions',async()=>{
  const inv=await request('/api/auth/invite',{userId:'u2'},managerCookie);assert.equal(inv.status,200);
  assert.equal((await request('/api/dados',undefined,userCookie)).status,401);
  const invalid=await request('/api/auth/login',{userId:'u2',password:'New-Fixture-Only!',inviteCode:'bad'});assert.equal(invalid.status,401);
  const redeem=await request('/api/auth/login',{userId:'u2',password:'New-Fixture-Only!',inviteCode:inv.body.code});assert.equal(redeem.status,200);userCookie=cookieOf(redeem);
  assert.equal((await db.execute("SELECT invite_hash FROM auth_user WHERE id='u2'")).rows[0].invite_hash,null);
  assert.equal((await request('/api/auth/login',{userId:'u2',password,inviteCode:inv.body.code})).status,401);
});
test('password change revokes other sessions, logout revokes token, expiry is checked by server',async()=>{
  const second=await request('/api/auth/login',{userId:'u1',password});const secondCookie=cookieOf(second);
  const changed=await request('/api/auth/password',{currentPassword:password,newPassword:'Changed-Fixture-Only!'},managerCookie);assert.equal(changed.status,200);managerCookie=cookieOf(changed);
  assert.equal((await request('/api/dados',undefined,secondCookie)).status,401);
  assert.equal((await request('/api/auth/login',{userId:'u1',password})).status,401);
  assert.equal((await request('/api/auth/logout',{},managerCookie)).status,200);
  assert.equal((await request('/api/dados',undefined,managerCookie)).status,401);
  await db.execute({sql:'UPDATE auth_session SET expires_at=? WHERE user_id=?',args:[Date.now()-1000,'u2']});
  assert.equal((await request('/api/dados',undefined,userCookie)).status,401);
});
test('persistent rate limit bounds incorrect password attempts',async()=>{
  let response;for(let i=0;i<16;i++)response=await request('/api/auth/login',{userId:'p2',password:'bad'});
  assert.equal(response.status,429);
});
