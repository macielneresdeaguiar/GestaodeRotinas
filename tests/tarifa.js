function ok(c,m){console.log((c?'OK  ':'FAIL')+' '+m); if(!c)process.exitCode=1}
session=USERS[0];
// === confere contra a fatura CAESB 06/2026 (venc. 21/07/2026), 519 m³ ===
const d=detalheAgua(519);
ok(d.linhas.length===5,'5 faixas aplicadas');
const esperado=[[4,8.67,34.68],[3,10.84,32.52],[3,13.98,41.94],[30,17.34,520.20],[479,20.46,9800.34]];
d.linhas.forEach((l,i)=>{
  const [q,p,sub]=esperado[i];
  ok(l.qtd===q&&l.preco===p&&Math.abs(l.subtotal-sub)<0.01,
     `faixa ${i+1}: ${l.qtd} m³ x ${l.preco} = ${l.subtotal} (fatura: ${q} x ${p} = ${sub})`);
});
ok(Math.abs(d.total-10429.68)<0.01,'tarifa variável de água = R$ 10.429,68 (obtido '+d.total+')');
const c=contaAgua('c1',519);
ok(Math.abs(c.varEsg-10429.68)<0.01,'esgoto 100% = R$ 10.429,68 (obtido '+c.varEsg+')');
ok(Math.abs(c.fixAgua-29.83)<0.01,'tarifa fixa água R$ 29,83');
ok(Math.abs(c.fixEsg-29.83)<0.01,'tarifa fixa esgoto R$ 29,83');
ok(Math.abs(c.total-20919.02)<0.01,'TOTAL = R$ 20.919,02 igual à fatura (obtido '+c.total+')');
ok(Math.abs(c.medio-40.31)<0.02,'preço médio R$ 40,31/m³ (obtido '+c.medio+')');
// consumos menores
ok(Math.abs(detalheAgua(4).total-34.68)<0.01,'4 m³ = R$ 34,68 (só 1ª faixa)');
ok(Math.abs(detalheAgua(10).total-109.14)<0.01,'10 m³ = R$ 109,14 (3 faixas)');
ok(detalheAgua(0).total===0,'consumo zero = R$ 0 de variável');
// progressividade
let prog=true, ant=0;
for(let v=1;v<=600;v+=7){ const t=detalheAgua(v).total; if(t<ant) prog=false; ant=t; }
ok(prog,'conta é sempre crescente com o consumo');
// projeção usa o motor novo
const pj=projecaoConta('agua','c1','2026-08');
ok(Math.abs(pj.valor-contaAgua('c1',Math.round(pj.projConsumo)).total)<1,'projeção usa a tabela de faixas');
console.log('  agosto: '+pj.consumo+' m³ -> '+brl(pj.valor));
console.log('  set (proj): '+projecaoConta('agua','c1','2026-09').projConsumo.toFixed(0)+' m³ -> '+brl(projecaoConta('agua','c1','2026-09').valor));
const card=cardProjecao('agua','c1');
ok(card.includes('faixas CAESB')&&!card.includes('undefined')&&!card.includes('NaN'),'card mostra a composição sem erros');
