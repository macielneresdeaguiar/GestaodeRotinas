function ok(c,m){console.log((c?'OK  ':'FAIL')+' '+m); if(!c)process.exitCode=1}
session=USERS[0];
const ag=leituras.filter(l=>l.tipo==='agua'&&l.condoId==='c1'&&l.status==='Registrada').sort((a,b)=>a.data.localeCompare(b.data));
ok(ag.length===79,'79 leituras importadas (obtido '+ag.length+')');
ok(ag[0].data==='2026-06-15'&&ag[0].medidor===66107,'primeira: 15/06 medidor 66107');
const u=ag[ag.length-1];
ok(u.data==='2026-09-02','última leitura em 02/09');
ok(u.medidor===67645,'medidor de 02/09 = 67645 (obtido '+u.medidor+')');
ok(u.consumo===30,'consumo de 02/09 = 30 m³ (obtido '+u.consumo+')');
ok(ag.every(l=>Math.round(l.leitura*100)===l.leitura*100),'leituras com no máximo 2 casas decimais');
ok(ag.every(l=>l.consumo===null||Math.abs(Math.round(l.consumo*100)-l.consumo*100)<1e-6),'consumos com 2 casas decimais');
const pico=ag.find(l=>l.data==='2026-09-01');
ok(pico.medidor===67615&&pico.consumo===119,'01/09: medidor 67615, consumo 119');
let mono=true; for(let i=1;i<ag.length;i++) if(ag[i].medidor<ag[i-1].medidor) mono=false;
ok(mono,'medidor nunca retrocede');
let coer=true; for(let i=1;i<ag.length;i++) if(ag[i].leitura-ag[i].anterior!==ag[i].consumo) coer=false;
ok(coer,'consumo = leitura - anterior em todas as linhas');
const tot=ag.reduce((s,l)=>s+(l.consumo||0),0);
ok(tot===1538,'total = 1538 m³ (67645-66107) — obtido '+tot);
ok(!ag.some(l=>l.data==='2026-08-09'),'09/08 segue sem leitura');
const zer=ag.filter(l=>l.consumo===0).map(l=>l.data);
ok(zer.length===2,'2 dias com consumo zero: '+zer.join(', '));
const prog=leituras.filter(l=>l.tipo==='agua'&&l.condoId==='c1'&&l.status!=='Registrada');
ok(prog.length===1&&prog[0].data==='2026-09-03','próxima leitura programada 03/09');
// gráfico e relatórios
leitTab='agua'; condoFilter='c1'; grafJanela=30;
const g=graficoLeituras();
ok(g.includes('<svg')&&!g.includes('undefined')&&!g.includes('NaN'),'gráfico íntegro');
ok(g.includes('30 de 78 leituras'),'janela de 30 registros');
const s10=consumoDiario('agua','c1',10).filter(x=>x.valor!=null);
ok(s10.length>=9,'relatório de 10 dias com dados reais ('+s10.length+')');
// projeção
const pj=projecaoConta('agua','c1','2026-09');
ok(pj.mediaDia<40,'projeção não dominada pelo pico ('+pj.mediaDia.toFixed(1)+' m³/dia)');
const ago=projecaoConta('agua','c1','2026-08');
ok(ago.consumo===532,'agosto = 532 m³ (obtido '+ago.consumo+')');
// migração v2
CFG.histAguaC1='v1'; leituras=leituras.filter(l=>!(l.tipo==='agua'&&l.condoId==='c1'));
ok(migrarLeiturasAgua()===true,'base na versão antiga é remigrada');
ok(leituras.filter(l=>l.tipo==='agua'&&l.condoId==='c1'&&l.status==='Registrada').length===79,'79 leituras após remigração');
ok(migrarLeiturasAgua()===false,'idempotente');
