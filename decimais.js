function ok(c,m){console.log((c?'OK  ':'FAIL')+' '+m); if(!c)process.exitCode=1}
session=USERS[0]; leitTab='agua';
ok(fmtLeit(67645,'agua')==='67.645,00','exibe 67645 como "67.645,00" (obtido '+fmtLeit(67645,'agua')+')');
ok(fmtLeit(67645.37,'agua')==='67.645,37','exibe centésimos: '+fmtLeit(67645.37,'agua'));
ok(fmtLeit(30.5,'agua')==='30,50','consumo 30,5 -> "30,50"');
ok(fmtLeit(41500,'energia')==='41.500','energia segue sem casas: '+fmtLeit(41500,'energia'));
ok(arred2(67645.379)===67645.38,'arredonda para 2 casas');
ok(arred2(67668.12-67645.37)===22.75,'subtração sem lixo de ponto flutuante (obtido '+arred2(67668.12-67645.37)+')');
// salvar leitura com decimais
const antes=leituras.length;
const cid='c1';
leituras.push({id:'x1',tipo:'agua',condoId:cid,data:'2026-09-03',medidor:67668.12,fator:1,
  leitura:67668.12,anterior:67645,consumo:arred2(67668.12-67645),status:'Registrada',obs:'',anexo:'',responsavel:'Maciel',historico:[]});
const n=leituras.find(l=>l.id==='x1');
ok(n.consumo===23.12,'consumo com decimais = 23.12 (obtido '+n.consumo+')');
const g=graficoLeituras();
ok(!g.includes('NaN')&&!g.includes('undefined'),'gráfico aceita decimais');
condoFilter='c1';
const v=viewLeituras===undefined?'':'';
