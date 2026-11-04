import PDFDocument from 'pdfkit';
import {randomUUID} from 'node:crypto';
import {db,lerWorkspace} from './db.js';
const managers=new Set(['u1','u2']),users=new Set(['u1','u2','u4']);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const num=(v,max=1000000)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max)fail('Informe um número válido, maior ou igual a zero.');return v;};
const text=(v,n=240)=>{if(typeof v!=='string'||v.length>n)fail('Texto inválido ou muito longo.');return v.trim();};
export function cleaningDay(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function cleaningReminder(id,cycle,day=cleaningDay()){
 const due=day.slice(8)>='15';
 if(cycle?.status==='Pedido preparado')return null;
 if(cycle?.confirmedAt&&managers.has(id))return {title:'Estoque de limpeza conferido: preparar pedido',detail:'A contagem já está disponível. Revise as quantidades e gere o PDF para cotação.'};
 if(due&&!cycle?.confirmedAt)return {title:id==='u4'?'Conferir estoque de limpeza deste mês':'Pedido de limpeza: aguardando estoque',detail:id==='u4'?'Informe todas as quantidades e envie a contagem para Alef.':'Fernanda precisa confirmar a contagem antes da preparação do pedido.'};
 return null;
}
export async function initializeCleaning(){await db.execute('CREATE TABLE IF NOT EXISTS cleaning_record (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL)');}
const parse=r=>r?{...JSON.parse(r.data),version:Number(r.version)}:null;
async function read(client,id){return parse((await client.execute({sql:'SELECT * FROM cleaning_record WHERE id=?',args:[id]})).rows[0]);}
function project(value,id){if(!value)return null;const out=structuredClone(value);if(id==='u4'){delete out.company;delete out.supplier;out.items?.forEach(i=>{delete i.price;delete i.quantity;});}return out;}
function validateMonth(month){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))fail('Mês inválido.');return month;}
function history(value,id,name,action){value.history=[...(value.history||[]),{id:randomUUID(),at:new Date().toISOString(),actor:id,name,action}];}
async function response(id,month){
 const catalog=await read(db,'catalog'),cycle=await read(db,month);
 const months=(await db.execute("SELECT id FROM cleaning_record WHERE id<>'catalog' ORDER BY id DESC")).rows.map(r=>r.id);
 return {catalog:project(catalog,id),cycle:project(cycle,id),months,canManage:managers.has(id),day:cleaningDay(),reminder:cleaningReminder(id,cycle)};
}
export function installCleaning(app){
 const guard=(req,res,next)=>users.has(req.auth?.user_id)?next():res.status(req.auth?403:401).json({erro:'Acesso restrito aos responsáveis pelo estoque de limpeza.'});
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store');await fn(req,res)}catch(e){if(!res.headersSent)res.status(e.status||500).json({erro:e.status?e.message:'Não foi possível salvar. Tente novamente.'});}};
 app.get('/api/limpeza',guard,wrap(async(req,res)=>res.json(await response(req.auth.user_id,validateMonth(req.query.mes||cleaningDay().slice(0,7))))));
 app.post('/api/limpeza/catalogo',guard,wrap(async(req,res)=>{
  const id=req.auth.user_id;if(!managers.has(id))fail('Somente Maciel e Alef alteram materiais, preços e estoque ideal.',403);
  const b=req.body;if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)fail('Cadastre de 1 a 100 materiais.');
  const seen=new Set(),items=b.items.map(i=>{const key=text(i.id,80);if(!/^[a-zA-Z0-9_-]+$/.test(key)||seen.has(key))fail('Identificador de material inválido.');seen.add(key);const name=text(i.name);if(!name)fail('Informe o nome do material.');return {id:key,name,unit:text(i.unit,60),ideal:num(i.ideal),price:Math.round(num(i.price)*100)/100,dispensers:num(i.dispensers||0)};});
  const tx=await db.transaction('write');try{
   const old=await read(tx,'catalog');if((old?.version||0)!==b.version)fail('O cadastro foi alterado em outro aparelho. Recarregue antes de salvar.',409);
   const value={company:text(b.company||'',1200),supplier:text(b.supplier||'',240),items,history:old?.history||[]};history(value,id,id==='u1'?'Maciel':'Alef','Cadastro e preços atualizados');
   await tx.execute({sql:'INSERT INTO cleaning_record VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data',args:['catalog',(old?.version||0)+1,JSON.stringify(value)]});await tx.commit();
  }catch(e){await tx.rollback();throw e}finally{tx.close()}
  res.json(await response(id,cleaningDay().slice(0,7)));
 }));
 app.post('/api/limpeza/:month',guard,wrap(async(req,res)=>{
  const month=validateMonth(req.params.month),id=req.auth.user_id,b=req.body;
  const ws=await lerWorkspace('default');const name=ws?.snapshot?.CFG?.nomesUsuarios?.[id]||({u1:'Maciel',u2:'Alef',u4:'Fernanda'})[id];
  const tx=await db.transaction('write');try{
   let cycle=await read(tx,month),oldVersion=cycle?.version||0;
   if(b.version!==oldVersion)fail('Outra pessoa atualizou este mês. Recarregue para conferir os dados antes de salvar.',409);
   if(b.action==='abrir'){
    if(cycle)fail('Este mês já foi iniciado.',409);
    if(month!==cleaningDay().slice(0,7))fail('Inicie somente o mês atual.');
    const cat=await read(tx,'catalog');if(!cat?.items.length)fail('Maciel ou Alef precisa cadastrar os materiais primeiro.');
    cycle={month,company:cat.company,supplier:cat.supplier,status:'Contagem em andamento',items:cat.items.map(i=>({...i,stock:null,quantity:null})),history:[]};
   }else{
    if(!cycle)fail('Inicie a contagem do mês primeiro.');
    if(b.action==='reabrir'){
     if(!managers.has(id))fail('Somente Maciel e Alef podem reabrir um pedido.',403);
     if(cycle.status!=='Pedido preparado')fail('Este pedido ainda não foi finalizado.');cycle.status='Estoque conferido';delete cycle.preparedAt;delete cycle.preparedBy;
    }else{
     if(cycle.status==='Pedido preparado')fail('Pedido finalizado. Maciel ou Alef precisa reabrir antes de alterar.');
     if(!['estoque','confirmar','pedido','finalizar'].includes(b.action))fail('Ação inválida.');
     if(!Array.isArray(b.items)||b.items.length!==cycle.items.length||new Set(b.items.map(i=>i.id)).size!==cycle.items.length||b.items.some(i=>!cycle.items.some(j=>j.id===i.id)))fail('Envie todos os materiais deste mês.');
     const stockAction=['estoque','confirmar'].includes(b.action);
     if(!stockAction&&!managers.has(id))fail('Fernanda pode preencher somente o estoque.',403);
     if(!stockAction&&!cycle.confirmedAt)fail('Aguarde a confirmação de estoque de Fernanda.');
     for(const item of cycle.items){const sent=b.items.find(i=>i.id===item.id);const allowed=stockAction?['id','stock']:['id','quantity','price'];if(Object.keys(sent).some(k=>!allowed.includes(k)))fail('Campos não permitidos nesta etapa.',403);
      if(stockAction){item.stock=sent.stock===null?null:num(sent.stock);if(item.stock!==null&&!Number.isInteger(item.stock))fail('Use quantidades inteiras na unidade de compra.');item.quantity=null;}
      else{item.quantity=num(sent.quantity);if(!Number.isInteger(item.quantity))fail('Use quantidades inteiras na unidade de compra.');if(sent.price!==undefined)item.price=Math.round(num(sent.price)*100)/100;}
     }
     if(stockAction){delete cycle.confirmedAt;delete cycle.confirmedBy;cycle.status='Contagem em andamento';if(b.action==='confirmar'){if(cycle.items.some(i=>i.stock===null))fail('Preencha todos os estoques, inclusive os que estão zerados.');cycle.confirmedAt=new Date().toISOString();cycle.confirmedBy=name;cycle.status='Estoque conferido';}}
     if(b.action==='finalizar'){cycle.status='Pedido preparado';cycle.preparedAt=new Date().toISOString();cycle.preparedBy=name;}
    }
   }
   history(cycle,id,name,({abrir:'Mês iniciado',estoque:'Rascunho de estoque salvo',confirmar:'Estoque confirmado e liberado para Alef',pedido:'Pedido salvo',finalizar:'Pedido preparado para cotação',reabrir:'Pedido reaberto'})[b.action]);
   delete cycle.version;await tx.execute({sql:'INSERT INTO cleaning_record VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data',args:[month,oldVersion+1,JSON.stringify(cycle)]});await tx.commit();
  }catch(e){await tx.rollback();throw e}finally{tx.close()}
  res.json(await response(id,month));
 }));
 app.get('/api/limpeza/:month/pdf',guard,wrap(async(req,res)=>{
  if(!managers.has(req.auth.user_id))fail('Somente Maciel e Alef emitem pedidos.',403);
  const c=await read(db,validateMonth(req.params.month));if(c?.status!=='Pedido preparado')fail('Finalize e salve o pedido antes de gerar o PDF.');
  const prices=req.query.precos==='1',items=c.items.filter(i=>i.quantity>0);if(!items.length)fail('Este mês não possui itens para solicitar.');
  const doc=new PDFDocument({size:'A4',margin:44,bufferPages:true});res.type('application/pdf');res.set('Content-Disposition',`attachment; filename="cotacao-limpeza-${c.month}${prices?'-precos-referencia':''}.pdf"`);doc.pipe(res);
  doc.fontSize(20).fillColor('#153f4c').text('Solicitação de cotação');doc.moveDown(.3).fontSize(12).text('Materiais de limpeza · '+c.month.split('-').reverse().join('/'));doc.moveDown().fillColor('#172b3a').fontSize(10).text(c.company||'Condomínio');if(c.supplier)doc.moveDown(.4).text('Fornecedor: '+c.supplier);
  doc.moveDown().fontSize(9).text('Solicitamos proposta comercial para os itens abaixo. Informar prazo de entrega, frete, condições de pagamento e validade da proposta.');
  const header=()=>{const y=doc.y+12;doc.rect(44,y,507,24).fill('#153f4c');doc.fillColor('white').fontSize(9).text('Material / unidade de compra',52,y+7,{width:300});doc.text('Qtd.',368,y+7,{width:36});if(prices){doc.text('Unitário',412,y+7);doc.text('Total',487,y+7);}doc.y=y+32;doc.fillColor('#172b3a');};header();let total=0;
  for(const i of items){doc.fontSize(10);const h=Math.max(48,doc.heightOfString(i.name+'\n'+i.unit,{width:300})+18);if(doc.y+h>740){doc.addPage();header();}const y=doc.y;doc.fontSize(10).text(i.name,52,y,{width:300});doc.fontSize(9).fillColor('#526471').text(i.unit,52,doc.y+3,{width:300});doc.fillColor('#172b3a').text(String(i.quantity),368,y,{width:36});if(prices){const money=n=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});doc.text(money(i.price),408,y,{width:72});doc.text(money(i.price*i.quantity),480,y,{width:70});}total+=i.price*i.quantity;doc.moveTo(44,y+h).lineTo(551,y+h).strokeColor('#dce5e9').stroke();doc.y=y+h+10;}
  if(doc.y>660)doc.addPage();doc.x=44;doc.moveDown();if(prices)doc.fontSize(12).text('Total de referência: '+total.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));doc.moveDown().fontSize(9).text(prices?'Valores de referência; sujeitos à confirmação do fornecedor.':'Proposta sem preços de referência. Preencher os valores na cotação.');doc.moveDown().text('Estoque conferido por '+c.confirmedBy+' · Pedido preparado por '+c.preparedBy+'.');doc.text('Documento para cotação. Não constitui autorização de compra.');doc.end();
 }));
}
