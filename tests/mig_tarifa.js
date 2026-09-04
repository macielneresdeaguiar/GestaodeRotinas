function ok(c,m){console.log((c?'OK  ':'FAIL')+' '+m); if(!c)process.exitCode=1}
CFG.tarifaCaesb=false; CFG.tarifas={c1:{agua:12.50,esgoto:0.80,energia:0.92,fixaAgua:35,fixaEnergia:25}};
ok(migrarTarifaCaesb()===true,'migra base antiga (tarifa única)');
const t=tarifaDe('c1');
ok(t.porFaixa===true,'passa a usar faixas');
ok(t.esgoto===1.00,'esgoto vira 100%');
ok(t.fixaAgua===29.83,'tarifa fixa da fatura');
ok(t.energia===0.92,'tarifa de energia preservada');
ok(Math.abs(contaAgua('c1',519).total-20919.02)<0.01,'após migrar, 519 m³ = R$ 20.919,02');
ok(migrarTarifaCaesb()===false,'idempotente');
