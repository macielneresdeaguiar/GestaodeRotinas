// simula base antiga salva e valida a migração
console.log('\n=== TESTE DE MIGRAÇÃO (base antiga) ===');
prestadores=[
 {id:'old1',condoId:'c1',empresa:'MEP',servico:'Manutenção geral (Predial, Ar, SPK, CCTV, VRP)',dia:15,insumo:'Contratos MEP',exigeBook:true,exigeNf:true,concessionaria:false,ativo:true},
 {id:'old2',condoId:'c1',empresa:'Neoenergia / Tronica',servico:'Energia elétrica',dia:27,insumo:'Energia',exigeBook:false,exigeNf:false,concessionaria:true,ativo:true},
 {id:'old3',condoId:'c1',empresa:'Total Quality',servico:'Serviço de Portaria',dia:15,insumo:'Porteiros',exigeBook:true,exigeNf:true,concessionaria:false,ativo:true},
 {id:'keep',condoId:'c2',empresa:'ABL Prime',servico:'Gerenciamento predial',dia:15,insumo:'x',exigeBook:true,exigeNf:true,concessionaria:false,ativo:true}
];
notas=[{id:'n1',prestadorId:'old3',condoId:'c1',competencia:compAtual(),empresa:'Total Quality',
        servico:'Serviço de Portaria',dia:15,insumo:'Porteiros',book:true,nf:true,lanc:true,obs:'já lançada',historico:[]}];
migrarPrestadoresEB();
const eb2=prestadores.filter(p=>p.condoId==='c1');
function ok(c,m){console.log((c?'OK  ':'FAIL')+' '+m); if(!c)process.exitCode=1}
ok(eb2.length===19,'migrou para 19 linhas (obtido '+eb2.length+')');
ok(!eb2.some(p=>/Manutenção geral/.test(p.servico)),'linha agrupada da MEP removida');
ok(!eb2.some(p=>/Neoenergia \/ Tronica/.test(p.empresa)),'linha conjunta Neoenergia/Tronica removida');
ok(prestadores.some(p=>p.id==='keep'),'Taguá Life preservado');
const tq2=eb2.find(p=>p.servico==='Serviço de Portaria');
ok(tq2 && tq2.id==='old3','id preservado p/ linha equivalente (não órfã a NF lançada)');
const nfAntiga=notas.find(n=>n.id==='n1');
ok(!!nfAntiga && nfAntiga.lanc===true,'NF já lançada foi preservada');
ok(notas.filter(n=>n.condoId==='c1'&&n.competencia===compAtual()).length===19,'19 notas na competência após migração');
