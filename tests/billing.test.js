import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../public/billing-model.js';
const B=globalThis.GRCBilling;
function fixture(){return {CFG:{vcRelatorios:{cadastros:{c1:{portas:{ad:{tipo:'CUSTA',unidade:'501',nome:'Titular de teste'},sale:{tipo:'VENDA',vendaId:'vv'}}}}}},vcUnidades:[],vcCiclos:[{id:'w',condoId:'c1',servico:'agua',competencia:'10/2026',valorFatura:100,consumoFatura:3,inicio:'2026-09-16',fim:'2026-10-16',linhas:[{unidadeId:'m',unidade:'LOJA M01',nome:'Loja de teste',tipo:'CUSTA',anterior:100.123,atual:101.234},{unidadeId:'u',unidade:'Quiosque',nome:'Empresa de teste',tipo:'VENDA',anterior:10,atual:12}]},{id:'e',condoId:'c1',servico:'energia',competencia:'10/2026',taxaFixa:.88,linhas:[{unidadeId:'q',unidade:'Quiosque',nome:'Empresa de teste',tipo:'VENDA',anterior:20,atual:30}]}],vcVendas:[{id:'vv',condoId:'c1',ativo:true,origem:'fixo',valor:200,unidade:'Venda de teste',motivo:'Publicidade',dia:31},{id:'agua',condoId:'c1',origem:'agua',unidadeId:'u',unidade:'Quiosque',motivo:'CONSUMO',dia:15},{id:'energia',condoId:'c1',origem:'energia',unidadeId:'q',unidade:'Quiosque',motivo:'ENERGIA',dia:15},{id:'variavel',condoId:'c1',origem:'variavel',unidade:'Repasse de teste',motivo:'REPASSE',periodoMeses:1,valores:{'11/2026':0}}],anuncios:[{id:'ad',condoId:'c1',status:'Ativo',empresa:'Publicidade de teste',valorMensal:200},{id:'sale',condoId:'c1',status:'Ativo',empresa:'Venda de teste',valorMensal:200}]};}
export {fixture};
test('billing preserves meter precision, rounds each charge to cents, distinguishes blank, invalid, and zero',()=>{
 assert.equal(B.consumption({anterior:100.123,atual:101.234}),1.111);assert.equal(B.charge({valorFatura:100,consumoFatura:3},{anterior:100.123,atual:101.234}),37.03);
 for(const row of [{anterior:null,atual:10},{anterior:'',atual:10},{anterior:20,atual:10},{anterior:10,atual:''},{anterior:NaN,atual:10}])assert.equal(B.consumption(row),null);
 assert.equal(B.consumption({anterior:0,atual:0}),0);assert.equal(B.charge({}, {anterior:0,atual:1}),null);
});
test('billing uses the exact previous competence and never falls back to a future or stale reading',()=>{
 const s=fixture(),m=B.build(s,'11/2026','c1');assert.equal(m.agua.id,'w');assert.equal(m.sales.find(v=>v.id==='agua').valor,66.67);assert.equal(m.sales.find(v=>v.id==='agua').motivo,'CONSUMO 09/2026');assert.equal(m.sales.find(v=>v.id==='vv').venc,'2026-11-30');assert.equal(m.sales.find(v=>v.id==='variavel').valor,0);assert.equal(m.sales.find(v=>v.id==='variavel').motivo,'REPASSE 01/10/2026 A 31/10/2026');
 const missing=B.build(s,'12/2026','c1');assert.equal(missing.agua,null);assert.equal(missing.sales.find(v=>v.id==='agua').valor,null);assert.equal(missing.canExport('adm'),false);assert.equal(missing.canExport('sgq'),false);
 s.CFG.vcRelatorios.meses={c1:{'12/2026':{aguaId:'w',energiaId:'e'}}};const selected=B.build(s,'12/2026','c1');assert.equal(selected.agua.id,'w');assert.equal(selected.sales.find(v=>v.id==='agua').valor,66.67);
});
test('SGQ derives water and advertising, synchronizes prices, and avoids double counting a linked ADM sale',()=>{
 const s=fixture(),m=B.build(s,'11/2026','c1');assert.equal(m.sgq.length,2);assert.equal(m.totals.sgq,237.03);assert.equal(m.sales.filter(v=>v.id==='vv').length,1);assert.equal(m.sales.filter(v=>v.origem==='publicidade').length,1);assert.equal(m.canExport('sgq'),true);assert.equal(m.canExport('adm'),true);
 s.anuncios[0].valorMensal=250;const raised=B.build(s,'11/2026','c1');assert.equal(raised.totals.sgq,287.03);assert.equal(raised.sales.find(v=>v.id==='ad').valor,250);
 s.CFG.vcRelatorios.cadastros.c1.lojas={m:{incluir:false}};const excluded=B.build(s,'11/2026','c1');assert.equal(excluded.sgq.length,1);assert.ok(excluded.sales.some(v=>v.id==='m'),'Excluir da SGQ não retira uma cobrança do relatório ADM');
});
test('unknown advertising, missing readings, and cross-condominium cycle selection block affected exports',()=>{
 const s=fixture();delete s.CFG.vcRelatorios.cadastros.c1.portas.ad;assert.equal(B.build(s,'11/2026','c1').canExport('sgq'),false);
 s.CFG.vcRelatorios.cadastros.c1.portas.ad={tipo:'CUSTA',unidade:'501',nome:'Titular'};s.vcCiclos[0].linhas[0].atual=null;assert.equal(B.build(s,'11/2026','c1').canExport('sgq'),false);
 s.CFG.vcRelatorios.meses={c1:{'11/2026':{aguaId:'foreign'}}};s.vcCiclos.push({...s.vcCiclos[0],id:'foreign',condoId:'c2'});assert.equal(B.build(s,'11/2026','c1').agua,null);
});

test('closed monthly reports preserve original values through later advertising and meter changes',()=>{
 const s=fixture(),m=B.build(s,'11/2026','c1'),data={};for(const k of ['comp','cid','agua','energia','tariffs','water','energy','sales','sgq','totals','warnings'])data[k]=JSON.parse(JSON.stringify(m[k]));
 s.CFG.vcRelatorios.meses={c1:{'11/2026':{fechamento:{version:1,data,by:'Fixture',at:'2026-11-10T12:00:00Z'}}}};s.anuncios[0].valorMensal=900;s.vcCiclos[0].linhas[0].atual=900;
 const closed=B.build(s,'11/2026','c1');assert.equal(closed.frozen,true);assert.equal(closed.totals.sgq,237.03);assert.equal(closed.sgq[0].valor,200);assert.equal(closed.canExport('sgq'),true);
 delete s.CFG.vcRelatorios.meses.c1['11/2026'].fechamento;assert.notEqual(B.build(s,'11/2026','c1').totals.sgq,237.03);
});

test('September-to-October readings billed in November are due November 15 even if generated in October',()=>{
 const s=fixture();Object.assign(s.vcVendas[1],{dia:1,vencMeses:-1,refMeses:2});
 const m=B.build(s,'11/2026','c1'),water=m.sales.find(v=>v.id==='agua');assert.equal(m.agua.competencia,'10/2026');assert.equal(water.venc,'2026-11-15');assert.equal(water.motivo,'CONSUMO 09/2026');
});


test('SGQ respects the configured template order independently of advertising insertion order',()=>{
 const s=fixture();s.CFG.vcRelatorios.cadastros.c1.portas.ad.ordem=2;s.CFG.vcRelatorios.cadastros.c1.portas.other={tipo:'CUSTA',unidade:'601',nome:'Outro titular de teste',ordem:1};s.anuncios.push({id:'other',condoId:'c1',status:'Ativo',empresa:'Outro anúncio de teste',valorMensal:200});
 assert.deepEqual(B.build(s,'11/2026','c1').sgq.map(l=>l.unidade),['601','501','M01']);
});
