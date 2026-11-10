/* Physical adjacency is explicitly recorded; room numbers never prove adjacency. */
(function(root){
 'use strict';
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
 const floor=s=>{const v=norm(s?.andar).replace(/(?:andar|pavimento|pav\.?|[º°ª])/g,'').trim();return ['', '—','-','nao informado','n/d'].includes(v)?'':v;};
 const modes=s=>s?.semInteresse||s?.locModalidade==='Fechada'?[]:s?.locModalidade==='Venda'?['Venda']:s?.locModalidade==='Locação e Venda'?['Locação','Venda']:['Locação'];
 const compare=(a,b)=>String(a.numero||'').localeCompare(String(b.numero||''),'pt-BR',{numeric:true});
 function contactKey(s){const n=norm(s.locNome),t=String(s.locTel||'').replace(/\D/g,'');return [s.condoId||'c1',norm(s.locTipo),n,t,n||t?'':'unit:'+s.id].join('|');}
 const sameFloor=(a,b)=>!!floor(a)&&floor(a)===floor(b)&&(a.condoId||'c1')===(b.condoId||'c1');
 const linked=(a,b)=>sameFloor(a,b)&&a.locVizinhas?.includes(b.id)&&b.locVizinhas?.includes(a.id);
 const available=s=>modes(s).length>0&&!['Ocupada','Em obra'].includes(s.status);
 function contacts(rows){const map=new Map();for(const s of [...rows].sort(compare)){const key=contactKey(s);if(!map.has(key))map.set(key,{key,salas:[]});map.get(key).salas.push(s);}return [...map.values()].sort((a,b)=>norm(a.salas[0].locNome).localeCompare(norm(b.salas[0].locNome),'pt-BR')||compare(a.salas[0],b.salas[0]));}
 function groups(rows){
  const remaining=new Map([...rows].sort(compare).map(s=>[s.id,s])),out=[];
  while(remaining.size){const first=remaining.values().next().value;remaining.delete(first.id);const rooms=[first];let common=modes(first),changed=true;
   while(changed&&available(first)){changed=false;for(const s of remaining.values()){
    const overlap=common.filter(m=>modes(s).includes(m));
    if(available(s)&&contactKey(s)===contactKey(first)&&overlap.length&&rooms.some(r=>linked(r,s))){rooms.push(s);remaining.delete(s.id);common=overlap;changed=true;}
   }}
   out.push({salas:rooms.sort(compare),modalidades:common});
  }return out;
 }
 function connected(rows){if(rows.length<2)return true;const base=rows[0];if(!rows.every(s=>sameFloor(base,s)&&contactKey(base)===contactKey(s)&&available(s)))return false;let common=modes(base);for(const s of rows)common=common.filter(m=>modes(s).includes(m));if(!common.length)return false;const seen=new Set([base.id]);let added=true;while(added){added=false;for(const s of rows)if(!seen.has(s.id)&&rows.some(r=>seen.has(r.id)&&linked(r,s))){seen.add(s.id);added=true;}}return seen.size===rows.length;}
 function validateNeighbours(incoming,current=[]){
  const map=new Map(incoming.map(s=>[s.id,s])),old=new Map(current.map(s=>[s.id,s]));
  for(const s of incoming){const links=s.locVizinhas||[];
   if(!Array.isArray(links)||links.length>30||new Set(links).size!==links.length)throw Error('Informe uma lista válida de salas vizinhas.');
   for(const id of links){const target=map.get(id);if(typeof id!=='string'||id===s.id||!target||!sameFloor(s,target))throw Error('Salas vizinhas devem pertencer ao mesmo andar e condomínio.');if(!target.locVizinhas?.includes(s.id))throw Error('Confirme a vizinhança nos dois registros.');}
  }
 }
 root.GRCLeasing={norm,floor,modes,contactKey,sameFloor,linked,available,contacts,groups,connected,validateNeighbours};
})(globalThis);
