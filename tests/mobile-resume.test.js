import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createClient } from '@libsql/client';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

let base,child,directory,db,html,cookie='',saved={},failure='',lastWindow,requestCounts={};
const password='Fixture-Only-Password!';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,message){for(let i=0;i<120;i++){if(fn())return;await pause(40)}throw new Error(message);}
before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'grc-mobile-'));
  const url='file:'+path.join(directory,'test.sqlite');db=createClient({url});
  await db.execute('CREATE TABLE workspace(id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,versao INTEGER NOT NULL,atualizado TEXT NOT NULL,autor TEXT)');
  // Test vectors correspond to the existing password format. No real account data.
  const authTest=await readFile(new URL('./auth-diaria.test.js',import.meta.url),'utf8');
  const credentials=JSON.parse(authTest.match(/const creds=(\{[^\n]+\});/)[1]);
  await db.execute({sql:'INSERT INTO workspace VALUES(?,?,?,?,?)',args:['default',JSON.stringify({v:2,
    CFG:{permsUsuarios:{},nomesUsuarios:{},coordPodeExcluirPrestador:false},creds:credentials,
    tasks:[],salas:[],notas:[],leituras:[],estoque:[],prestadores:[],apontamentos:[],pedidos:[]}),1,new Date().toISOString(),'Test fixture']});
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,TURSO_DATABASE_URL:url,PORT:String(port)}});
  let errors='';child.stderr.on('data',x=>errors+=x);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/auth/perfis')).ok)break}catch{}if(child.exitCode!==null)throw new Error(errors);await pause(50)}
  html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
});
after(async()=>{lastWindow?.close();child?.kill();db?.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function settle(w){try{await w.eval('AUTH.background||Promise.resolve()');for(let i=0;i<30&&w.eval('SYNC.enviando');i++)await pause(20)}catch(e){}await pause(80)}
function cache(w){saved={};for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);saved[k]=w.localStorage.getItem(k)}}
async function open(width=390){
  const errors=[];const vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(!/HTMLCanvasElement|navigation/.test(e.message))errors.push(e.message)});
  const dom=new JSDOM(html,{url:base,runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc,
    beforeParse(w){
      Object.defineProperty(w,'innerWidth',{value:width,writable:true});
      w.structuredClone=structuredClone;w.AbortController=AbortController;w.AbortSignal=AbortSignal;w.scrollTo=()=>{};
      w.matchMedia=()=>({matches:false,addListener(){},addEventListener(){}});w.confirm=()=>true;
      for(const [k,v]of Object.entries(saved))w.localStorage.setItem(k,v);
      w.fetch=async(input,options={})=>{
        const url=new URL(typeof input==='string'?input:input.url,base);
        requestCounts[url.pathname]=(requestCounts[url.pathname]||0)+1;
        if(failure==='network'||failure==='data'&&url.pathname==='/api/dados')throw new TypeError('Fixture: network unavailable');
        const r=await fetch(url,{...options,headers:{...options.headers,Origin:base,...(cookie?{Cookie:cookie}:{})}});
        const setCookie=r.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
        return r;
      };
    }});
  lastWindow=dom.window;
  await until(()=>typeof dom.window.mobilePrepararPagina==='function','mobile.js did not initialize');
  return {w:dom.window,errors};
}

test('closing/reopening restores the session; data/network failure does not demand a new password; logout and midnight still lock',async()=>{
  let {w,errors}=await open();await until(()=>w.eval('AUTH.ready&&!AUTH.initializing'),'Profile list not ready');
  w.document.querySelector('#loginPass').value=password;
  await w.doLogin();await until(()=>w.document.querySelector('#app').style.display==='block','Initial login failed');
  assert.equal(w.document.querySelector('#loginPass').value,'');
  assert.equal(w.localStorage.getItem('grc.savedpass.v1'),null);
  const loginRequests=requestCounts['/api/auth/login'];await settle(w);cache(w);w.close();
  failure='data';({w,errors}=await open());
  await until(()=>w.document.querySelector('#app').style.display==='block','Valid cookie should open cached app even if data download fails');
  assert.equal(requestCounts['/api/auth/login'],loginRequests);assert.equal(w.document.querySelector('#sessionResume').hidden,true);
  await settle(w);cache(w);w.close();failure='network';({w,errors}=await open());
  await until(()=>!w.document.querySelector('#sessionResumeRetry').hidden,'Connection retry should be offered without a password challenge');
  assert.equal(w.localStorage.getItem('grc.logout.pending'),null);
  failure='';await w.authInicializar();await until(()=>w.document.querySelector('#app').style.display==='block','Reconnect should restore without password');
  assert.equal(requestCounts['/api/auth/login'],loginRequests);
  w.document.querySelector('#critico').classList.add('open');
  w.eval('AUTH.expiresAt=Date.now()-1');w.dispatchEvent(new w.Event('focus'));
  assert.equal(w.document.querySelector('#app').style.display,'none','At midnight UI locks');
  assert.equal(w.document.querySelector('#critico').classList.contains('open'),false);
  // Restore the still-valid fixture server session and then explicitly log out.
  await w.authInicializar();await until(()=>w.document.querySelector('#app').style.display==='block','Restore fixture');
  await w.logout();await settle(w);cache(w);w.close();({w,errors}=await open());
  await until(()=>!w.eval('AUTH.initializing'),'Logout initialization did not finish');
  assert.equal(w.document.querySelector('#app').style.display,'none');
  assert.equal((await w.fetch('/api/auth/session')).status,401);assert.deepEqual(errors,[]);
  await settle(w);cache(w);w.close();
});

test('all module screens render; mobile menu matches desktop access for every profile; cards have labels and search keeps focus',async()=>{
  let {w,errors}=await open();await until(()=>w.eval('AUTH.ready&&!AUTH.initializing'),'Profiles not loaded');
  w.document.querySelector('#loginPass').value=password;await w.doLogin();
  await until(()=>w.document.querySelector('#app').style.display==='block','Login failed');
  assert.equal(w.nextDate('2026-01-31','Mensal'),'2026-02-28');
  assert.equal(w.nextDate('2024-02-29','Anual'),'2025-02-28');
  assert.equal(w.nextDate('2026-10-31','Trimestral'),'2027-01-31');
  assert.equal(w.nextDate('2026-12-31','Diária'),'2027-01-01');
  // Domain seed only in this isolated fixture, to exercise populated rows and graphs.
  w.seed();w.eval("salas=[{id:'s_fixture',condoId:'c1',numero:'201',andar:'2',status:'Ocupada',area:40,ocupante:'Empresa de teste',atividade:'Teste',vagas:1}];");w.eval("session=USERS.find(u=>u.id==='u1');AUTH.temCache=true;");
  const modules=Array.from(new Set([...w.itensNavegacao().filter(item=>item[0]!=='#').map(item=>item[0]),'rotina','tarefas-adm','tarefas-gestor','afazeres','calendario']));
  assert.ok(modules.includes('analises')&&modules.includes('manutobrig')&&modules.includes('unidades'));
  for(const module of modules){
    assert.doesNotThrow(()=>w.go(module),module);
    w.mobilePrepararPagina();assert.ok(w.document.querySelector('#content').textContent.trim().length>0,module);
  }
  w.go('ocupacao');w.mobilePrepararPagina();
  assert.ok(w.document.querySelector('table[data-mobile-cards]'));
  for(const cell of w.document.querySelectorAll('table[data-mobile-cards] tbody td'))assert.ok(cell.dataset.l||cell.dataset.mobileFull);
  assert.ok(w.document.querySelector('.mobile-charts'));assert.ok(w.document.querySelector('.mobile-tools'));
  let search=w.document.querySelector('input[placeholder="Buscar sala, espaço ou atividade"]');
  search.focus();search.value='20';search.setSelectionRange(2,2);search.dispatchEvent(new w.Event('input',{bubbles:true}));
  search=w.document.querySelector('input[placeholder="Buscar sala, espaço ou atividade"]');
  assert.equal(w.document.activeElement,search);assert.equal(search.selectionStart,2);assert.equal(search.value,'20');
  w.go('estoque');w.go('ocupacao');w.mobileVoltar();assert.equal(w.eval('page'),'estoque');
  const ids=w.eval('USERS.map(u=>u.id)');
  for(const id of ids){
    const {accessFor}=await import('../server/access.js');const a=accessFor(id,{CFG:{}});
    w.eval(`scopeApplyMetadata(${JSON.stringify(a)});session=USERS.find(u=>u.id===${JSON.stringify(id)});`);
    const expected=w.itensNavegacao().filter(item=>item[0]!=='#').map(item=>item[2]);
    w.buildNav();w.buildTabbar();w.abrirMaisMenu();
    const actual=Array.from(w.document.querySelectorAll('#moduleList [data-module-search]')).map(el=>el.dataset.moduleSearch);
    assert.deepEqual(actual,Array.from(expected),id);
    assert.ok(w.tabsDoPerfil().some(t=>t[0]==='menu'),id);
    if(id==='p1')assert.deepEqual(actual,['Meu espaço','Leituras — Água e Energia','Configurações']);
    w.closeModal();
  }
  w.eval("AUTH.access=null;session=USERS.find(u=>u.id==='u1');");w.abrirMaisMenu();w.filtrarMaisMenu('analise');
  assert.ok(Array.from(w.document.querySelectorAll('#moduleList .module-link')).filter(b=>!b.hidden).some(b=>b.textContent.includes('Análise')));
  assert.deepEqual(errors,[]);
  console.log('Module screens exercised:',modules.length,'profiles:',ids.length);
  await settle(w);w.close();
});


test('changing accounts discards the previous user cache and prevents opening another module',async()=>{
  saved={};failure='';let {w}=await open();await until(()=>w.eval('AUTH.ready&&!AUTH.initializing'),'Profiles');
  w.document.querySelector('#loginPass').value=password;await w.doLogin();await until(()=>w.document.querySelector('#app').style.display==='block','Manager login');await settle(w);
  const invite=await w.authPedido('/invite',{userId:'p1'});
  w.eval("salas=[{id:'s_private_fixture',ocupante:'OTHER_AREA_MARKER'}];");w.salvarLocal();
  const login=await w.authPedido('/login',{userId:'p1',password,inviteCode:invite.code});
  await w.authRetomarConfirmada(login,false);
  assert.equal(w.eval('session.id'),'p1');assert.equal(w.eval('salas.length'),0);assert.equal(w.eval('unidSind.length'),0);
  w.go('unidsind');assert.notEqual(w.eval('page'),'unidsind');
  w.go('notas');assert.notEqual(w.eval('page'),'notas');
  w.salvarLocal();assert.ok(!w.localStorage.getItem('grc.db.v1').includes('OTHER_AREA_MARKER'));
  w.go('inicio');w.mobilePrepararPagina();assert.match(w.document.querySelector('#content').textContent,/Registrar leitura/);
  const version=w.eval('SYNC.versao');w.go('config');w.go('inicio');await pause(1200);assert.equal(w.eval('SYNC.versao'),version,'Navigation must not write a new server version');
  await w.logout();assert.equal(w.localStorage.getItem('grc.db.v1'),null);assert.equal(w.localStorage.getItem('grc.base.v1'),null);
  await settle(w);w.close();saved={};
});
