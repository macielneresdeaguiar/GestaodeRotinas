import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, lerWorkspace } from './db.js';
import { accessFor } from './access.js';

const scrypt = promisify(scryptCallback);
const COOKIE = '__Host-grc_session';
const DEV_COOKIE = 'grc_session_dev';
const POLICY = 'daily-2026-10-30';
const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (a,b) => typeof a==='string' && typeof b==='string' &&
  Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const clone = x => JSON.parse(JSON.stringify(x));

// Roster comes from the same versioned account definitions as the existing app.
// Names/permissions overridden by CFG remain in the existing workspace.
const ACCOUNT_IDS = ['u1','u2','u3','u4','b1','b2','b3','b4','p1','p2','p3','p4','p5','p6'];

export function dailyExpiry(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone:'America/Sao_Paulo', year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  // Resolve next calendar midnight through the named timezone, not host timezone.
  const target = Date.UTC(+parts.year,+parts.month-1,+parts.day+1);
  let result = target;
  for(let i=0;i<3;i++) {
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
      timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
    }).formatToParts(new Date(result)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    result += target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  }
  return result;
}

function legacyHash(password,salt) {
  const hash = str => {
    let h1=0x811c9dc5,h2=0x01000193;
    for(let i=0;i<str.length;i++) {
      const c=str.charCodeAt(i);
      h1=((h1^c)*0x01000193)>>>0;
      h2=((h2^(c+i))*0x85ebca6b)>>>0;
    }
    return (h1>>>0).toString(16).padStart(8,'0')+(h2>>>0).toString(16).padStart(8,'0');
  };
  let out=salt+'|'+password;
  for(let i=0;i<600;i++)out=hash(out+'|'+i+'|'+salt);
  return out;
}
async function encodedPassword(password) {
  const salt=randomBytes(16).toString('hex');
  const key=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return {scheme:'scrypt-v1',salt,hash:key.toString('hex')};
}
async function verify(password,row) {
  if(!row?.hash)return false;
  if(row.scheme==='legacy-v1')return equal(legacyHash(password,row.salt),row.hash);
  if(row.scheme!=='scrypt-v1')return false;
  const key=await scrypt(password,row.salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return equal(key.toString('hex'),row.hash);
}
const getUser = async id => (await db.execute({sql:'SELECT * FROM auth_user WHERE id=?',args:[id]})).rows[0];
const privateSnapshot = snapshot => {
  const clean=clone(snapshot);
  delete clean.creds;
  delete clean.authStatus;
  return clean;
};

export async function initializeAuth() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS auth_user (
      id TEXT PRIMARY KEY, scheme TEXT, hash TEXT, salt TEXT,
      changed_at TEXT, revision INTEGER NOT NULL DEFAULT 1,
      invite_hash TEXT, invite_until INTEGER)`,
    `CREATE TABLE IF NOT EXISTS auth_session (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL, revision INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS auth_meta (id TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS auth_throttle (
      id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, until_ms INTEGER NOT NULL)`
  ],'write');
  const initialized=await db.execute("SELECT value FROM auth_meta WHERE id='credentials-imported'");
  if(!initialized.rows.length) {
    const ws=await lerWorkspace('default');
    if(!ws?.snapshot?.creds?.u1?.hash)throw new Error('Autenticação: conta do gestor ausente. Migração cancelada.');
    const commands=ACCOUNT_IDS.map(id=>{
      const c=ws.snapshot.creds[id];
      return {sql:'INSERT OR IGNORE INTO auth_user(id,scheme,hash,salt,changed_at) VALUES(?,?,?,?,?)',
        args:[id,c?.hash?'legacy-v1':null,c?.hash||null,c?.salt||null,c?.trocadaEm||null]};
    });
    commands.push({sql:"INSERT OR IGNORE INTO auth_meta(id,value) VALUES('credentials-imported',?)",args:[POLICY]});
    // Same transaction as credential copies: no interval with credentials lost.
    commands.push({sql:"UPDATE workspace SET snapshot=json_remove(snapshot,'$.creds'), versao=versao+1 WHERE id='default'",args:[]});
    await db.batch(commands,'write');
  }
  await db.execute({sql:'DELETE FROM auth_session WHERE expires_at<=?',args:[Date.now()]});
}

export async function credentialStatus() {
  const rows=(await db.execute('SELECT id,hash,changed_at FROM auth_user')).rows;
  return Object.fromEntries(rows.filter(r=>r.hash).map(r=>[r.id,{definida:true,trocadaEm:r.changed_at}]));
}
function readCookie(req,name) {
  const pairs=(req.headers.cookie||'').split(';').map(v=>v.trim());
  const p=pairs.find(v=>v.startsWith(name+'='));
  return p?p.slice(name.length+1):'';
}
function secureRequest(req) {
  // Render terminates TLS; Express trusts exactly the immediate proxy.
  return req.secure;
}
function cookieName(req) { return secureRequest(req)?COOKIE:DEV_COOKIE; }
function setCookie(req,res,token,expiry) {
  const secure=secureRequest(req);
  res.cookie(secure?COOKIE:DEV_COOKIE,token,{
    httpOnly:true,secure,sameSite:'strict',path:'/',expires:new Date(expiry)
  });
}
function clearCookie(req,res) {
  res.clearCookie(cookieName(req),{httpOnly:true,secure:secureRequest(req),sameSite:'strict',path:'/'});
}
async function resolveSession(req) {
  const token=readCookie(req,cookieName(req));
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  const result=await db.execute({sql:`SELECT s.user_id,s.expires_at,s.token_hash
    FROM auth_session s JOIN auth_user u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND s.revision=u.revision AND u.hash IS NOT NULL`,
    args:[digest(token),Date.now()]});
  return result.rows[0]||null;
}
async function issueSession(req,res,user) {
  const token=randomBytes(32).toString('hex'),expiry=dailyExpiry();
  const previous=readCookie(req,cookieName(req));
  if(previous)await db.execute({sql:'DELETE FROM auth_session WHERE token_hash=?',args:[digest(previous)]});
  await db.execute({sql:'INSERT INTO auth_session VALUES(?,?,?,?)',args:[digest(token),user.id,expiry,user.revision]});
  setCookie(req,res,token,expiry);
  return {userId:user.id,expiresAt:new Date(expiry).toISOString(),access:accessFor(user.id,(await lerWorkspace('default'))?.snapshot)};
}
function sameOrigin(req) {
  const origin=req.get('origin');
  if(!origin)return false;
  try { return new URL(origin).host===req.get('host') && ['https:','http:'].includes(new URL(origin).protocol); }
  catch { return false; }
}
async function throttle(req,id) {
  // Persisted across Render restarts, per account plus per IP to bound guessing.
  const keys=['user:'+id,'ip:'+req.ip].map(digest),now=Date.now();
  for(const key of keys) {
    await db.execute({sql:`INSERT INTO auth_throttle(id,attempts,until_ms) VALUES(?,1,?)
      ON CONFLICT(id) DO UPDATE SET
        attempts=CASE WHEN until_ms<=? THEN 1 ELSE attempts+1 END,
        until_ms=CASE WHEN until_ms<=? THEN excluded.until_ms ELSE until_ms END`,
      args:[key,now+15*60*1000,now,now]});
    const r=(await db.execute({sql:'SELECT attempts FROM auth_throttle WHERE id=?',args:[key]})).rows[0];
    if(r.attempts>(key===keys[0]?15:60))return false;
  }
  return true;
}
function passwordInput(v) { return typeof v==='string' && v.length>=6 && v.length<=256; }
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res,next)}catch(e){console.error('[auth]',e.message);res.status(500).json({erro:'Falha ao verificar acesso. Tente novamente.'})}};

export function installAuth(app) {
  app.set('trust proxy',1);
  app.use('/api',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    res.set('X-Content-Type-Options','nosniff');
    if(!['GET','HEAD','OPTIONS'].includes(req.method) &&
       (!sameOrigin(req)||req.get('x-grc-client')!==POLICY))
      return res.status(403).json({erro:'origem_invalida',atualizeApp:true});
    next();
  });
  app.get('/api/auth/perfis',wrap(async(_req,res)=>{
    const ws=await lerWorkspace('default');
    res.json({policy:POLICY,creds:await credentialStatus(),nomes:ws?.snapshot?.CFG?.nomesUsuarios||{}});
  }));
  app.get('/api/auth/session',wrap(async(req,res)=>{
    const sess=await resolveSession(req);
    if(!sess)return res.status(401).json({erro:'sessao_expirada'});
    res.json({userId:sess.user_id,expiresAt:new Date(sess.expires_at).toISOString(),access:accessFor(sess.user_id,(await lerWorkspace('default'))?.snapshot)});
  }));
  app.post('/api/auth/login',wrap(async(req,res)=>{
    const {userId,password,inviteCode}=req.body||{};
    if(typeof userId!=='string'||typeof password!=='string'||password.length>256)
      return res.status(400).json({erro:'Informe usuário e senha.'});
    if(!await throttle(req,userId))return res.status(429).json({erro:'Muitas tentativas. Aguarde 15 minutos.'});
    let user=await getUser(userId);
    if(!user)return res.status(401).json({erro:'Usuário ou senha incorretos.'});
    if(!user.hash) {
      if(!passwordInput(password)||typeof inviteCode!=='string'||!user.invite_hash||
         user.invite_until<=Date.now()||!equal(digest(inviteCode.trim()),user.invite_hash))
        return res.status(401).json({erro:'Peça ao gestor um código de primeiro acesso válido.'});
      const p=await encodedPassword(password);
      const r=await db.execute({sql:`UPDATE auth_user SET scheme=?,hash=?,salt=?,changed_at=?,
        revision=revision+1,invite_hash=NULL,invite_until=NULL WHERE id=? AND invite_hash=? AND hash IS NULL AND invite_until>?`,
        args:[p.scheme,p.hash,p.salt,new Date().toISOString(),user.id,user.invite_hash,Date.now()]});
      if(!r.rowsAffected)return res.status(409).json({erro:'Código já utilizado. Tente entrar novamente.'});
    } else {
      if(!await verify(password,user))return res.status(401).json({erro:'Usuário ou senha incorretos.'});
      // Existing passwords remain valid; upgrade to scrypt only after verifying them.
      if(user.scheme==='legacy-v1') {
        const p=await encodedPassword(password);
        await db.execute({sql:"UPDATE auth_user SET scheme=?,hash=?,salt=? WHERE id=? AND hash=? AND revision=?",
          args:[p.scheme,p.hash,p.salt,user.id,user.hash,user.revision]});
        // A concurrent reset/change must invalidate this login, never resurrect it.
        const current=await getUser(user.id);
        if(current.revision!==user.revision||!await verify(password,current))
          return res.status(409).json({erro:'Senha alterada. Entre novamente.'});
      }
    }
    const verified=await getUser(userId);
    if(!verified.hash||!await verify(password,verified))
      return res.status(409).json({erro:'Acesso alterado. Entre novamente.'});
    user=verified;
    await db.execute({sql:'DELETE FROM auth_throttle WHERE id=?',args:[digest('user:'+userId)]});
    res.json({ok:true,...await issueSession(req,res,user),creds:await credentialStatus()});
  }));
  app.post('/api/auth/logout',wrap(async(req,res)=>{
    const token=readCookie(req,cookieName(req));
    if(token)await db.execute({sql:'DELETE FROM auth_session WHERE token_hash=?',args:[digest(token)]});
    clearCookie(req,res);res.json({ok:true});
  }));
  // Render health check stays public and reveals no operational data.
  app.get('/api/saude',wrap(async(req,res,next)=>{
    if(await resolveSession(req))return next();
    await db.execute('SELECT 1');
    res.json({ok:true,protegido:true,autenticacao:POLICY});
  }));
  // All remaining API routes require a validated, unexpired server-side session.
  // SITE_TOKEN, cached profiles and client-supplied authors cannot bypass this.
  app.use('/api',wrap(async(req,res,next)=>{
    const sess=await resolveSession(req);
    if(!sess){clearCookie(req,res);return res.status(401).json({erro:'sessao_expirada',atualizeApp:true})}
    const expected=req.get('x-grc-user');
    if((expected&&expected!==sess.user_id)||(!['GET','HEAD','OPTIONS'].includes(req.method)&&!expected))return res.status(403).json({erro:'A conta deste aparelho mudou. Reabra o aplicativo.',atualizeApp:true});
    req.auth=sess;next();
  }));
  app.post('/api/auth/password',wrap(async(req,res)=>{
    const {currentPassword,newPassword}=req.body||{};
    if(!passwordInput(newPassword)||typeof currentPassword!=='string'||currentPassword.length>256)
      return res.status(400).json({erro:'A nova senha deve ter entre 6 e 256 caracteres.'});
    if(!await throttle(req,req.auth.user_id))return res.status(429).json({erro:'Muitas tentativas. Aguarde 15 minutos.'});
    const u=await getUser(req.auth.user_id);
    if(!await verify(currentPassword,u))return res.status(403).json({erro:'A senha atual está incorreta.'});
    const p=await encodedPassword(newPassword);
    const r=await db.execute({sql:'UPDATE auth_user SET scheme=?,hash=?,salt=?,changed_at=?,revision=revision+1 WHERE id=? AND revision=?',
      args:[p.scheme,p.hash,p.salt,new Date().toISOString(),u.id,u.revision]});
    if(!r.rowsAffected)return res.status(409).json({erro:'A senha foi alterada em outro aparelho.'});
    await db.execute({sql:'DELETE FROM auth_session WHERE user_id=?',args:[u.id]});
    res.json({ok:true,...await issueSession(req,res,await getUser(u.id)),creds:await credentialStatus()});
  }));
  app.post('/api/auth/invite',wrap(async(req,res)=>{
    if(req.auth.user_id!=='u1')return res.status(403).json({erro:'Somente o gestor libera acessos.'});
    const id=req.body?.userId;
    if(!ACCOUNT_IDS.includes(id)||id==='u1')return res.status(400).json({erro:'Conta inválida.'});
    const code=randomBytes(18).toString('base64url'),until=Date.now()+24*60*60*1000;
    await db.batch([
      {sql:'UPDATE auth_user SET scheme=NULL,hash=NULL,salt=NULL,revision=revision+1,invite_hash=?,invite_until=? WHERE id=?',args:[digest(code),until,id]},
      {sql:'DELETE FROM auth_session WHERE user_id=?',args:[id]}
    ],'write');
    res.json({ok:true,code,expiresAt:new Date(until).toISOString(),creds:await credentialStatus()});
  }));
}

export async function publicSnapshot(snapshot) {
  return {...privateSnapshot(snapshot),creds:await credentialStatus()};
}
export function sanitizeIncoming(snapshot) { return privateSnapshot(snapshot); }
