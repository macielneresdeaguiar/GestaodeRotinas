/* Presentation consumes server permissions; the API enforces them independently. */
function scopeAllowed(pageName){
  if(!AUTH.access)return !session||itensNavegacao().some(i=>i[0]===pageName);
  const alias={tarefas:'tarefas-adm'};
  return AUTH.access.pages.includes(alias[pageName]||pageName);
}
function scopeApplyMetadata(access){
  if(!access)return;
  AUTH.access=access;
  const u=USERS.find(u=>u.id===access.userId);
  if(u){u.perms=structuredClone(access.perms);u.nome=access.name;}
}
async function scopePrepare(d){
  if(!d.access||d.access.policy!=='scoped-2026-10-30')throw new Error('Atualização de acesso indisponível. Tente novamente.');
  const cached=AUTH.cachedAccess;
  if(!cached||cached.userId!==d.userId||cached.key!==d.access.key){
    document.querySelector('#app').style.display='none';document.querySelector('#content').innerHTML='';
    if(typeof workflowDraftClear==='function')workflowDraftClear();
    AUTH.temCache=false;SYNC.base=null;SYNC.baseIdx=null;SYNC.sujos={};SYNC._bootSujosMarcados=false;
    localStorage.removeItem(BASE_KEY);localStorage.removeItem(FOTOS_FILA_KEY);
    _filaFotos=[];_fotoCache.clear();_fotoBaixando.clear();
    if(_idbOk&&_idb)await new Promise(resolve=>{try{const tx=_idb.transaction('fotos','readwrite');tx.objectStore('fotos').clear();tx.oncomplete=resolve;tx.onerror=resolve;}catch(e){resolve()}});
    AUTH.access=d.access;
    aplicarSnapshot({v:2,_access:d.access,CFG:{}});
  }
  scopeApplyMetadata(d.access);
}
function scopeFilterSnapshot(snap){
  const a=AUTH.access;
  if(!a)return snap;
  snap._access=a;
  return snap;
}
function scopeDiscardCache(){if(typeof workflowDraftClear==='function')workflowDraftClear();
  AUTH.temCache=false;AUTH.cachedAccess=null;_pendenteGravar=null;
  try{localStorage.removeItem(DB_KEY);localStorage.removeItem(BASE_KEY);localStorage.removeItem(FOTOS_FILA_KEY);localStorage.removeItem(SESSION_KEY);}catch(e){}
  _filaFotos=[];_fotoCache.clear();_fotoBaixando.clear();SYNC.base=null;SYNC.baseIdx=null;SYNC.sujos={};
  if(_idbOk&&_idb){try{const tx=_idb.transaction([IDB_STORE,'fotos'],'readwrite');tx.objectStore(IDB_STORE).clear();tx.objectStore('fotos').clear();}catch(e){}}
}
