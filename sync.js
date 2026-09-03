function ok(c,m){console.log((c?'OK  ':'FAIL')+' '+m); if(!c)process.exitCode=1}
ok(ic('cloud').includes('<svg'),'ícone cloud existe');
ok(badgeSync()==='<span id="syncBadge"></span>','badge vazio quando o sync está desligado');
SYNC.ligado=true; SYNC.estado='ok'; SYNC.ultimo='03/09/2026 21:30';
const b=badgeSync();
ok(b.includes('Sincronizado')&&!b.includes('undefined'),'badge "Sincronizado" íntegro');
SYNC.estado='erro'; SYNC.erro='Sem internet';
ok(badgeSync().includes('Sem conexão'),'badge de erro');
SYNC.estado='conflito';
ok(badgeSync().includes('Conflito'),'badge de conflito');
SYNC.ligado=false;
// snapshot -> aplicar snapshot mantém integridade
session=USERS[0];
const snap=JSON.parse(JSON.stringify(dbSnapshot()));
const nT=tasks.length, nL=leituras.length;
tasks=[]; leituras=[];
aplicarSnapshot(snap);
ok(tasks.length===nT,'aplicarSnapshot restaura tarefas ('+tasks.length+')');
ok(leituras.length===nL,'aplicarSnapshot restaura leituras ('+leituras.length+')');
ok(typeof salvarLocal==='function','salvarLocal existe');
ok(Math.abs(contaAgua('c1',519).total-20919.02)<0.01,'tarifa CAESB preservada após snapshot');
ok(!snap.v || snap.v===DB_VER,'snapshot versionado');
