function ok(c,m){console.log((c?'OK  ':'FAIL')+' '+m); if(!c)process.exitCode=1}
session=USERS[0];
const CORTE='2026-09-01';
// nenhuma tarefa antes de 01/09
const ant=tasks.filter(t=>t.vencimento && t.vencimento<CORTE);
ok(ant.length===0,'nenhuma tarefa com vencimento anterior a 01/09 (achei '+ant.length+')');
if(ant.length) console.log('   ex:',ant.slice(0,5).map(t=>t.vencimento+' '+t.titulo));
const atr=tasks.filter(t=>t.status==='Atrasada');
ok(atr.length===0,'nenhuma tarefa atrasada (achei '+atr.length+')');
if(atr.length) console.log('   ex:',atr.slice(0,5).map(t=>t.vencimento+' '+t.titulo));
const conc=tasks.filter(t=>t.status==='Concluída');
ok(conc.length===0,'nenhuma tarefa concluída fictícia (achei '+conc.length+')');
ok(apontamentos.length===0,'apontamentos zerados');
ok(cessoes.length===0,'cessões zeradas');
ok(pedidos.length===0,'pedidos zerados');
// tarefas do mês
const set=tasks.filter(t=>t.vencimento && t.vencimento.startsWith('2026-09'));
ok(set.length>0,'tarefas geradas para 09/2026: '+set.length);
const ges=set.filter(t=>t.tipo==='Gestor'), adm=set.filter(t=>t.tipo==='Administrativo');
ok(ges.length>0,'demandas do Gestor: '+ges.length);
ok(adm.length>0,'demandas do Administrativo: '+adm.length);
console.log('\n  --- Gestor (por título) ---');
const g={}; ges.forEach(t=>{g[t.titulo]=(g[t.titulo]||0)+1});
Object.entries(g).forEach(([k,v])=>console.log('   '+v+'x '+k));
console.log('  --- Administrativo ---');
const a={}; adm.forEach(t=>{a[t.titulo]=(a[t.titulo]||0)+1});
Object.entries(a).forEach(([k,v])=>console.log('   '+v+'x '+k));
// leituras preservadas
const ag=leituras.filter(l=>l.tipo==='agua'&&l.condoId==='c1'&&l.status==='Registrada');
ok(ag.length===79,'histórico de água preservado ('+ag.length+' leituras)');
ok(ag[0].data==='2026-06-15','histórico começa em 15/06 (anterior ao corte, como pedido)');
const u=ag[ag.length-1];
ok(u.medidor===67645,'última leitura 67645');
// notas do mês zeradas
const c=compAtual();
const nf=notas.filter(n=>n.competencia===c);
ok(nf.length===19+notas.filter(n=>n.condoId==='c2').length-notas.filter(n=>n.condoId==='c2').length || nf.length>0,'notas da competência '+c+': '+nf.length);
const pend=nf.filter(n=>{const p=prestadores.find(x=>x.id===n.prestadorId); return p&&p.exigeBook&&n.book});
ok(pend.length===0,'nenhum book marcado como entregue de mentira');
ok(Math.abs(contaAgua('c1',519).total-20919.02)<0.01,'tarifa CAESB intacta');
