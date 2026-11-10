/* Shared billing calculations. No customer records or template amounts belong here. */
(function(root){
 'use strict';
 const present=v=>v!==null&&v!==undefined&&v!==''&&!(typeof v==='string'&&!v.trim());
 const number=v=>present(v)&&Number.isFinite(Number(v))?Number(v):null;
 const money=v=>Math.round((v+Number.EPSILON)*100)/100;
 const monthKey=v=>/^\d{2}\/\d{4}$/.test(v)?v.slice(3)+'-'+v.slice(0,2):'';
 function shift(comp,n){const [m,y]=comp.split('/').map(Number),d=new Date(Date.UTC(y,m-1-n,1));return String(d.getUTCMonth()+1).padStart(2,'0')+'/'+d.getUTCFullYear();}
 function due(comp,day,offset=0){const c=shift(comp,-offset),[m,y]=c.split('/').map(Number);return `${y}-${String(m).padStart(2,'0')}-${String(Math.max(1,Math.min(Number(day)||1,new Date(Date.UTC(y,m,0)).getUTCDate()))).padStart(2,'0')}`;}
 function consumption(l){const a=number(l?.anterior),b=number(l?.atual);return a===null||b===null||a<0||b<a?null:Math.round((b-a)*1e9)/1e9;}
 function rate(c,cfg={}){if(!c)return null;const fixed=number(c.taxaFixa);if(fixed!==null&&fixed>0)return fixed;const v=number(c.valorFatura),q=number(c.consumoFatura);if(v>0&&q>0)return v/q;if(c.servico==='energia'){const t=number(cfg.vcTaxaEnergia);return t>0?t:0.88;}return null;}
 function charge(c,l,cfg){const q=consumption(l),t=rate(c,cfg);return q===null||t===null?null:money(q*t);}
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 const shop=v=>norm(v).match(/^(?:LOJA)?(M\d{1,2})$/)?.[1]?.replace(/^M(\d)$/,'M0$1')||null;
 const sum=rows=>money(rows.reduce((s,r)=>s+(r.valor??0),0));
 function build(s,comp,cid){
  if(!/^(0[1-9]|1[0-2])\/20\d{2}$/.test(comp))throw Error('Competência inválida.');
  const cfg=s.CFG||{},settings=cfg.vcRelatorios||{},options=settings.meses?.[cid]?.[comp]||{},catalog=settings.cadastros?.[cid]||{};
  const closed=options.fechamento;
  if(closed?.version===1&&closed.data?.comp===comp&&closed.data?.cid===cid){const f=JSON.parse(JSON.stringify(closed.data));return {...f,options,catalog,frozen:true,closedAt:closed.at,closedBy:closed.by,issues:[],canExport:()=>true};}
  const ciclos=(s.vcCiclos||[]).filter(c=>c.condoId===cid),issues=[],warnings=[];
  const pick=serv=>{const id=options[serv+'Id'];if(id==='nenhum')return null;return id?ciclos.find(c=>c.id===id&&c.servico===serv)||null:ciclos.find(c=>c.servico===serv&&c.competencia===shift(comp,1))||null;};
  const agua=pick('agua'),energia=pick('energia');
  const measured=c=>c?(c.linhas||[]).map(l=>({...l,consumo:consumption(l),taxa:rate(c,cfg),valor:charge(c,l,cfg)})):[];
  const water=measured(agua),energy=measured(energia);
  if(!agua)issues.push({kind:'todos',text:`Selecione o ciclo de água para ${comp}.`});
  for(const c of [agua,energia].filter(Boolean))if(monthKey(c.competencia)>monthKey(comp))issues.push({kind:'todos',text:`O ciclo ${c.competencia} é posterior ao faturamento.`});
  const sales=(s.vcVendas||[]).filter(v=>v.condoId===cid&&v.ativo!==false).sort((a,b)=>(a.ordem||0)-(b.ordem||0)).map(v=>{
   let valor=null,source='',motivo=v.motivo||'';
   if(v.origem==='fixo')valor=number(v.valor);
   else if(v.origem==='variavel')valor=number(v.valores?.[comp]);
   else {const c=v.origem==='agua'?agua:energia;const l=c?.linhas?.find(l=>l.unidadeId===v.unidadeId);valor=l?charge(c,l,cfg):null;source=c?.competencia||'';if(c)motivo+=' '+shift(c.competencia,1);}
   if(!['agua','energia'].includes(v.origem)){
    if(present(v.periodoMeses)){const per=shift(comp,Number(v.periodoMeses)),[m,y]=per.split('/').map(Number);motivo+=` 01/${per} A ${new Date(Date.UTC(y,m,0)).getUTCDate()}/${per}`;}
    else if(present(v.refMeses))motivo+=' '+shift(comp,Number(v.refMeses));
   }
   if(valor===null||valor<0){valor=null;issues.push({kind:'adm',id:v.id,text:`${v.unidade}: falta ${v.origem==='variavel'?'informar o valor do mês':v.origem==='fixo'?'o valor fixo':'a leitura ou tarifa de '+v.origem}.`});}
   return {id:v.id,unidade:v.unidade,cnpj:v.cnpj||'',motivo,venc:due(comp,v.dia,v.vencMeses),valor,tipo:v.tipo||'VENDA',origem:v.origem,source,item:v};
  });
  const sgq=[],linkedSales=new Set();
  for(const u of (s.vcUnidades||[]).filter(u=>u.condoId===cid&&u.servico==='agua'&&u.ativo!==false&&u.tipo==='CUSTA'&&shop(u.unidade)&&catalog.lojas?.[u.id]?.incluir!==false))if(!water.some(l=>l.unidadeId===u.id))issues.push({kind:'todos',text:`${u.unidade}: unidade cadastrada sem linha no ciclo de água selecionado.`});
  const activeAds=(s.anuncios||[]).filter(a=>a.condoId===cid&&a.status==='Ativo'&&!a.fila);
  for(const a of activeAds){
   const link=catalog.portas?.[a.id];
   if(!link||!['VENDA','CUSTA','NAO_COBRAR'].includes(link.tipo)){issues.push({kind:'todos',id:a.id,text:`Classifique a publicidade de ${a.empresa} para evitar omissão ou duplicidade.`});continue;}
   if(link.tipo==='NAO_COBRAR')continue;
   if(link.vendaId){if(linkedSales.has(link.vendaId))issues.push({kind:'todos',text:`${a.empresa}: lançamento ADM já vinculado a outra publicidade.`});linkedSales.add(link.vendaId);}
   if(a.fim&&a.fim<due(comp,1))warnings.push(`${a.empresa}: publicidade ativa com fim em ${a.fim.split('-').reverse().join('/')}. Confira a renovação.`);
   if(a.inicio&&a.inicio>due(comp,31))continue;
   if(link.tipo==='VENDA'){
    if(!(s.vcVendas||[]).some(v=>v.ativo!==false&&v.condoId===cid&&v.id===link.vendaId))issues.push({kind:'adm',text:`Vincule ${a.empresa} ao lançamento de venda correspondente.`});
    continue;
   }
   const valor=number(a.valorMensal);
   const row={id:a.id,unidade:link.unidade||a.sala||'',nome:link.nome||'',motivo:'MERCHANDISING',quantidade:1,unitario:valor,valor:valor===null?null:money(valor),origem:'publicidade',source:a.elevador||''};
   if(!row.unidade||!row.nome||valor===null||valor<0)issues.push({kind:'todos',id:a.id,text:`Complete unidade, proprietário/locatário e valor de ${a.empresa}.`});
   sgq.push(row);
   // A CUSTA linked explicitly to an existing entry is represented only once.
   const existing=sales.find(v=>v.id===link.vendaId);
   if(existing){existing.valor=row.valor;existing.tipo='CUSTA';}
   else sales.push({id:a.id,unidade:'SALA '+row.unidade,cnpj:'',motivo:`MERCHANDISING ${a.elevador||''}`.trim(),venc:due(comp,catalog.diaCustas||15),valor:row.valor,tipo:'CUSTA',origem:'publicidade',source:a.elevador||''});
  }
  for(const l of water.filter(l=>l.tipo==='CUSTA'&&shop(l.unidade))){
   if(catalog.lojas?.[l.unidadeId]?.incluir===false)continue;
   const row={id:l.unidadeId,unidade:shop(l.unidade),nome:l.nome,motivo:'CONSUMO DE AGUA',quantidade:1,unitario:l.valor,valor:l.valor,origem:'agua',source:agua.competencia};
   if(l.valor===null)issues.push({kind:'todos',id:l.unidadeId,text:`${l.unidade}: falta leitura válida ou tarifa da água.`});
   sgq.push(row);
   if(!sales.some(v=>v.origem==='agua'&&v.item?.unidadeId===l.unidadeId))sales.push({id:l.unidadeId,unidade:l.nome,cnpj:l.cnpj||'',motivo:`CONSUMO DE AGUA ${shift(agua.competencia,1)}`,venc:due(comp,catalog.diaCustas||15),valor:l.valor,tipo:'CUSTA',origem:'agua',source:agua.competencia});
  }
  return {comp,cid,options,catalog,agua,energia,tariffs:{agua:rate(agua,cfg),energia:rate(energia,cfg)},water,energy,sales,sgq,issues,warnings,totals:{adm:sum(sales),sgq:sum(sgq),water:sum(water),energy:sum(energy)},canExport:kind=>!issues.some(i=>i.kind==='todos'||i.kind===kind)};
 }
 root.GRCBilling={present,number,money,monthKey,shift,due,consumption,rate,charge,norm,shop,build};
})(globalThis);
