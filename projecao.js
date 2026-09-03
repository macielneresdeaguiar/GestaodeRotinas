function ok(c,m){console.log((c?'OK  ':'FAIL')+' '+m); if(!c)process.exitCode=1}
session=USERS[0];
const p=projecaoConta('agua','c1','2026-09');
console.log('projeção set/26:', JSON.stringify({proj:+p.projConsumo.toFixed(1),valor:+p.valor.toFixed(2),mediaDia:+p.mediaDia.toFixed(2),bruta:+p.mediaBruta.toFixed(2),outlier:p.outlier,base:p.baseProj},null,0));
ok(p.mediaDia<40,'média diária da projeção não é dominada pelo pico ('+p.mediaDia.toFixed(1)+')');
ok(p.projConsumo<900,'consumo projetado plausível ('+p.projConsumo.toFixed(0)+' m³)');
ok(p.valor<30000,'valor projetado plausível: R$ '+p.valor.toFixed(2));
ok(p.outlier===true,'pico de 118,9 sinalizado como atípico');
const ago=projecaoConta('agua','c1','2026-08');
console.log('agosto (mês fechado):', +ago.consumo.toFixed(1),'m³ · média',+ago.mediaDia.toFixed(2),'· R$',ago.valor.toFixed(2));
ok(ago.consumo===532,'consumo real de agosto = 532 m³ (obtido '+ago.consumo.toFixed(1)+')');
ok(ago.mediaDia>10&&ago.mediaDia<30,'média diária de agosto coerente ('+ago.mediaDia.toFixed(1)+')');
const c=cardProjecao('agua','c1');
ok(!c.includes('undefined')&&!c.includes('NaN'),'card sem undefined/NaN');
