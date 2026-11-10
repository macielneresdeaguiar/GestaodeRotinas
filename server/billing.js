import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import '../public/billing-model.js';
import {lerWorkspace} from './db.js';
import {accessFor,scopedSnapshot} from './access.js';
const B=globalThis.GRCBilling;
const layouts=JSON.parse(fs.readFileSync(new URL('./billing-layouts.json',import.meta.url),'utf8'));
const xe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const months=['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
const title=c=>months[Number(c.slice(0,2))-1]+'/'+c.slice(3);
const date=v=>v?v.split('-').reverse().join('/'):'';
const money=v=>v===null?'PENDENTE':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const decimal=v=>v===null||v===undefined?'':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:6});
const excelDate=v=>(Date.parse(v+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;
// ZIP with store compression: exports have no macro, link or source-document metadata.
export function zipFiles(files){
 const crc=v=>{let c=0xffffffff;for(const b of v){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 let off=0;const locals=[],central=[];
 for(const [name,value] of Object.entries(files)){const n=Buffer.from(name),v=Buffer.isBuffer(value)?value:Buffer.from(value),sum=crc(v),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(sum,14);h.writeUInt32LE(v.length,18);h.writeUInt32LE(v.length,22);h.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(sum,16);c.writeUInt32LE(v.length,20);c.writeUInt32LE(v.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(off,42);locals.push(h,n,v);central.push(c,n);off+=h.length+n.length+v.length;}
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);return Buffer.concat([...locals,cd,end]);
}
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const mainNS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function cell(ref,v,s=0,formula){if(v===null||v===undefined||v==='')return `<c r="${ref}" s="${s}"/>`;return typeof v==='number'?`<c r="${ref}" s="${s}">${formula?`<f>${xe(formula)}</f>`:''}<v>${v}</v></c>`:`<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;}
function grid(meta){const cells=new Map(),heights={};return {meta,cells,heights,hidden:new Set(),merges:[],set(ref,value,style,formula){cells.set(ref,{value,style:style??meta.cells[ref]??0,formula});},row(r,values,styles,start=1){values.forEach((v,i)=>this.set(col(start+i)+r,v,styles?.[i]));}};}
function xmlSheet(g,area,drawing=true){
 const rows=new Map();for(const [ref,c]of g.cells){const r=Number(ref.match(/\d+$/)[0]);if(!rows.has(r))rows.set(r,[]);rows.get(r).push(cell(ref,c.value,c.style,c.formula));}
 const data=[...rows].sort((a,b)=>a[0]-b[0]).map(([r,cs])=>`<row r="${r}"${g.hidden.has(r)?' hidden="1"':''} ht="${g.heights[r]||g.meta.rows[r]?.ht||18}" customHeight="1">${cs.join('')}</row>`).join('');
 const cols=g.meta.cols.map(c=>`<col min="${c.min}" max="${c.max}" width="${c.width}" customWidth="1"/>`).join('');
 return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${mainNS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${area}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${data}</sheetData>${g.merges.length?`<mergeCells count="${g.merges.length}">${g.merges.map(r=>`<mergeCell ref="${r}"/>`).join('')}</mergeCells>`:''}<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>${drawing?'<drawing r:id="rId1"/>':''}</worksheet>`;
}
function picture(id,rId,colN,row,width,height){return `<xdr:oneCellAnchor><xdr:from><xdr:col>${colN}</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from><xdr:ext cx="${width*9525}" cy="${height*9525}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Logo ${id}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width*9525}" cy="${height*9525}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;}
const rels=body=>`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
function measuredRows(g,rows,start,energy=false,rateCell){
 rows.forEach((l,i)=>{const r=start+i;if(energy){g.row(r,[l.nome,l.unidade,l.anterior,l.atual,l.consumo,l.taxa,l.valor,l.tipo],[3,3,4,4,4,4,5,3]);g.set('F'+r,l.consumo,4,`ROUND(E${r}-D${r},9)`);g.set('G'+r,l.taxa,5,rateCell);g.set('H'+r,l.valor,5,`ROUND(F${r}*G${r},2)`);}else{g.row(r,[l.nome,'',l.unidade,l.anterior,l.atual,l.consumo,l.taxa,l.valor,l.tipo],[3,3,3,4,4,4,4,5,3]);g.merges.push(`B${r}:C${r}`);g.set('G'+r,l.consumo,4,`ROUND(F${r}-E${r},9)`);g.set('H'+r,l.taxa,5,rateCell);g.set('I'+r,l.valor,5,`ROUND(G${r}*H${r},2)`);}});
}
function reportStyles(kind){
 const name=kind==='sgq'?'Century Gothic':'Calibri',size=kind==='sgq'?14:11;
 const font=(sz,bold,color)=>`<font>${bold?'<b/>':''}<sz val="${sz}"/><color rgb="FF${color}"/><name val="${name}"/></font>`;
 const xf=(font,fill,border,num=0,align='left',wrap=true)=>`<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${align}" vertical="center"${wrap?' wrapText="1"':''}/></xf>`;
 return `<styleSheet xmlns="${mainNS}"><numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.00####"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/></numFmts><fonts count="5">${font(size,false,'171717')}${font(kind==='sgq'?18:12,true,'204E80')}${font(size,true,'FFFFFF')}${font(size,true,'171717')}${font(size,true,'FFFFFF')}</fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF858585"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF204E80"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDDDDD"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11">${xf(0,0,0)}${xf(1,0,0,0,'center')}${xf(2,2,1,0,'center')}${xf(0,0,1)}${xf(0,0,1,165,'right',false)}${xf(3,0,1,164,'right',false)}${xf(0,0,1,166,'center',false)}${xf(4,3,1,0,'right')}${xf(4,3,1,164,'right',false)}${xf(3,4,1)}${xf(0,0,1,0,'center')}</cellXfs></styleSheet>`;
}
export function billingXlsx(model,kind){
 const template=layouts[kind],grids=[],names=[],areas=[];
 if(kind==='sgq'){
  const g=grid(template.sheets[0]);g.set('C5',`CONDOMÍNIO E-BUSINESS ÁGUAS CLARAS\nCUSTAS / ${model.comp.replace('/','-')}`,1);g.merges.push('C5:E6');g.set('F5','REVISÃO: R00',1);g.set('G5','IDENTIFICAÇÃO: FA.PCS',1);g.heights[5]=35;g.set('B4','',7);g.merges.push('B4:G4');g.heights[4]=5;g.set('B7','',7);g.merges.push('B7:G7');g.heights[7]=5;
  g.row(9,['UNIDADE','PROPRIETÁRIO/LOCATÁRIO','TIPO DE CUSTAS','QUANTIDADE','VALOR UNITÁRIO','TOTAL'],[2,2,2,2,2,2]);g.heights[9]=32;
  const last=Math.max(28,9+model.sgq.length),total=last+1;
  for(let r=10;r<=last;r++){const v=model.sgq[r-10];g.row(r,v?[v.unidade,v.nome,v.motivo,v.quantidade,v.unitario,v.valor]:['','','','','',''],[10,10,10,10,4,5]);if(v)g.set('G'+r,v.valor,5,`ROUND(E${r}*F${r},2)`);else g.hidden.add(r);g.heights[r]=23;}
  g.merges.push(`B${total}:F${total}`);g.set('B'+total,'TOTAL',7);g.set('G'+total,model.totals.sgq,8,`SUM(G10:G${last})`);grids.push(g);names.push('CUSTAS '+model.comp.replace('/','.'));areas.push(`B1:H${total}`);
 }else{
  const g=grid(template.sheets[0]),count=Math.max(23,model.sales.length),total=6+count,offset=count-23;
  g.set('B2','VENDAS - FATURAMENTO '+title(model.comp),1);g.merges.push('B2:G2');g.heights[2]=48;
  g.row(4,['UNIDADE','CNPJ','MOTIVO','DATA DO VENCIMENTO','VALOR','TIPO'],[2,2,2,2,2,2]);g.heights[4]=32;
  model.sales.forEach((v,i)=>{const r=5+i;g.row(r,[v.unidade,v.cnpj,v.motivo,excelDate(v.venc),v.valor,v.tipo],[3,3,3,6,5,10]);g.heights[r]=32;});
  for(let r=5+model.sales.length;r<5+count;r++)g.row(r,['','','','','',''],[3,3,3,6,5,10]);
  g.set('E'+total,'TOTAL',7);g.set('F'+total,model.totals.adm,8,`SUM(F5:F${4+count})`);
  const base=33+offset,header=base+9,start=base+11;
  g.set('B'+base,'CONSUMO DE ÁGUA - FATURAMENTO '+title(model.comp),1);g.merges.push(`B${base}:J${base}`);g.heights[base]=32;
  g.set('D'+(base+2),'PERÍODO:',9);g.set('E'+(base+2),`${date(model.agua?.inicio)} A ${date(model.agua?.fim)}`,10);
  [['VALOR DA FATURA',model.agua?.valorFatura],['CONSUMO TOTAL DA FATURA',model.agua?.consumoFatura],['VALOR M³',model.tariffs.agua]].forEach(([label,val],i)=>{g.set('D'+(base+4+i),label,9);g.set('E'+(base+4+i),val,i===1?4:5);});
  if(!model.agua?.taxaFixa)g.set('E'+(base+6),model.tariffs.agua,5,`E${base+4}/E${base+5}`);
  g.row(header,['NOME UAU','','UNIDADE','MEDIÇÃO ANTERIOR (M³)','MEDIÇÃO ATUAL (M³)','CONSUMO (M³)','R$/m³','A PAGAR (R$)','TIPO'],Array(9).fill(2));g.merges.push(`B${header}:C${header+1}`);g.heights[header]=32;
  measuredRows(g,model.water,start,false,`$E$${base+6}`);const end=start+model.water.length+1;g.set('H'+end,'TOTAL',7);g.set('I'+end,model.totals.water,8,`SUM(I${start}:I${Math.max(start,end-2)})`);
  grids.push(g);names.push(months[Number(model.comp.slice(0,2))-1]+' - '+model.comp.slice(3));areas.push(`B1:J${end}`);
  const e=grid(template.sheets[1]);e.set('B1','CONSUMO DE ENERGIA - FATURAMENTO '+title(model.comp),1);e.merges.push('B1:I1');e.heights[1]=40;
  e.set('C3','PERÍODO:',9);e.set('D3',`${date(model.energia?.inicio)} A ${date(model.energia?.fim)}`,10);
  e.set('C5','VALOR DA FATURA',9);e.set('D5',model.energia?.valorFatura,5);e.set('C6','CONSUMO TOTAL DA FATURA',9);e.set('D6',model.energia?.consumoFatura,4);e.set('C7','VALOR kWh',9);e.set('D7',model.tariffs.energia,5);
  e.row(10,['NOME UAU','UNIDADE','MEDIÇÃO ANTERIOR (kWh)','MEDIÇÃO ATUAL (kWh)','CONSUMO (kWh)','R$/kWh','A PAGAR (R$)','TIPO'],Array(8).fill(2));e.heights[10]=38;
  // Only measured or billed meters belong to the energy report; unused meters remain in cadastro.
  const energy=model.energy.filter(l=>l.valor!==null||model.sales.some(v=>v.origem==='energia'&&v.item?.unidadeId===l.unidadeId));
  measuredRows(e,energy,12,true,'$D$7');const et=energy.length+13;e.set('G'+et,'TOTAL',7);e.set('H'+et,B.money(energy.reduce((s,l)=>s+(l.valor||0),0)),8,`SUM(H12:H${Math.max(12,et-2)})`);grids.push(e);names.push('ENERGIA QUIOSQUE');areas.push(`B1:I${et}`);
 }
 const files={},put=(n,v)=>files[n]=v;
 put('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${grids.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
 put('_rels/.rels',rels('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'));
 put('xl/workbook.xml',`<workbook xmlns="${mainNS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n,i)=>`<sheet name="${xe(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><definedNames>${areas.map((a,i)=>`<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${xe(names[i])}'!${a.replace(/([A-Z]+)(\d+)/g,'$$$1$$$2')}</definedName>`).join('')}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
 put('xl/_rels/workbook.xml.rels',rels(grids.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${grids.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`));
 put('xl/styles.xml',reportStyles(kind));grids.forEach((g,i)=>put(`xl/worksheets/sheet${i+1}.xml`,xmlSheet(g,areas[i],i===0)));
 put('xl/worksheets/_rels/sheet1.xml.rels',rels('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'));
 put('xl/drawings/drawing1.xml',`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${kind==='sgq'?picture(1,1,1,4,95,55)+picture(2,2,2,0,230,42):picture(1,2,6,1,140,40)}</xdr:wsDr>`);
 put('xl/drawings/_rels/drawing1.xml.rels',rels(Object.keys(template.images).map((n,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${n}"/>`).join('')));
 for(const [n,v]of Object.entries(template.images))put('xl/media/'+n,Buffer.from(v,'base64'));
 return zipFiles(files);
}

export function billingPdf(model,kind,stream){
 const doc=new PDFDocument({size:'A4',layout:'landscape',margin:28,info:{Title:(kind==='sgq'?'Custas SGQ':'Vendas e Custas')+' '+model.comp,Author:'Gestão de Rotinas'}});doc.registerFont('Billing',Buffer.from(layouts.fonts.regular,'base64'));doc.registerFont('BillingBold',Buffer.from(layouts.fonts.bold,'base64'));doc.pipe(stream);
 const W=doc.page.width-56,blue='#204e80',gray='#858585',left=28;let y=28;
 const txt=(text,x,yy,w,size=9,bold=false,align='left',color='#171717')=>{doc.font(bold?'BillingBold':'Billing').fontSize(size).fillColor(color).text(String(text??''),x,yy,{width:w,align,lineGap:1});};
 function header(label,sgq=false){
  if(sgq){doc.lineWidth(3).strokeColor(blue).moveTo(left,y).lineTo(left+W,y).stroke();y+=10;doc.image(Buffer.from(layouts.sgq.images['image1.png'],'base64'),left+8,y,{fit:[60,40]});doc.image(Buffer.from(layouts.sgq.images['image2.png'],'base64'),left+80,y+7,{fit:[115,30]});txt('CONDOMÍNIO E-BUSINESS ÁGUAS CLARAS',left+220,y,W-415,10,true,'center',blue);txt('CUSTAS / '+model.comp.replace('/','-'),left+220,y+18,W-415,18,true,'center',blue);txt('REVISÃO:\nR00',left+W-170,y+4,70,9,true,'center',blue);txt('IDENTIFICAÇÃO:\nFA.PCS',left+W-95,y+4,90,9,true,'center',blue);y+=52;doc.moveTo(left,y).lineTo(left+W,y).stroke();y+=14;}
  else{doc.lineWidth(0.8).strokeColor(blue).rect(left,y,W,45).stroke();txt(label,left+12,y+15,W-150,12,true,'center',blue);doc.image(Buffer.from(layouts.adm.images['image2.png'],'base64'),left+W-120,y+7,{fit:[105,32]});y+=60;}
 }
 function table(headers,rows,fractions,{totals=null,moneyColumns=[],numberColumns=[],font=9}={}){
  const widths=fractions.map(v=>v*W),drawHead=()=>{let x=left;headers.forEach((h,i)=>{doc.lineWidth(0.5).rect(x,y,widths[i],32).fillAndStroke(gray,'#222');txt(h,x+4,y+6,widths[i]-8,8,true,'center','#fff');x+=widths[i];});y+=32;};
  drawHead();
  for(const row of rows){let height=23;row.forEach((v,i)=>{doc.font('Billing').fontSize(font);height=Math.max(height,doc.heightOfString(String(v??''),{width:widths[i]-8})+12);});
   if(y+height>doc.page.height-47){doc.addPage();y=28;drawHead();}
   let x=left;row.forEach((v,i)=>{doc.strokeColor('#333').lineWidth(0.4).rect(x,y,widths[i],height).stroke();txt(v,x+4,y+6,widths[i]-8,font,moneyColumns.includes(i),moneyColumns.includes(i)||numberColumns.includes(i)?'right':'left');x+=widths[i];});y+=height;
  }
  if(totals!==null){if(y+27>doc.page.height-30){doc.addPage();y=28;}doc.rect(left,y,W,27).fill(blue);txt('TOTAL',left+8,y+8,W-130,10,true,'right','#fff');txt(money(totals),left+W-118,y+8,110,10,true,'right','#fff');y+=27;}
  y+=17;
 }
 function consumptionSection(c,rows,energy=false){
  const unit=energy?'kWh':'m³';
  txt(`${energy?'CONSUMO DE ENERGIA':'CONSUMO DE ÁGUA'} - FATURAMENTO ${title(model.comp)}`,left,y,W,12,true,'center',blue);y+=26;
  const summary=[['PERÍODO',`${date(c?.inicio)} A ${date(c?.fim)}`],['VALOR DA FATURA',c?.valorFatura?money(c.valorFatura):'Tarifa fixa'],['CONSUMO TOTAL DA FATURA',c?.consumoFatura?decimal(c.consumoFatura)+' '+unit:'-'],['VALOR '+unit,money(energy?model.tariffs.energia:model.tariffs.agua)]];
  for(const [label,val]of summary){doc.rect(left+W*.22,y,W*.35,19).fill('#ddd');txt(label,left+W*.22+5,y+5,W*.35-10,8,true);doc.strokeColor('#555').lineWidth(.4).rect(left+W*.57,y,W*.21,19).stroke();txt(val,left+W*.57+4,y+5,W*.21-8,8);y+=19;}y+=16;
  table(['NOME UAU','UNIDADE',`MEDIÇÃO ANTERIOR (${unit})`,`MEDIÇÃO ATUAL (${unit})`,`CONSUMO (${unit})`,'R$/'+unit,'A PAGAR (R$)','TIPO'],rows.map(l=>[l.nome,l.unidade,decimal(l.anterior),decimal(l.atual),decimal(l.consumo),decimal(l.taxa),money(l.valor),l.tipo]),[.25,.14,.12,.12,.10,.08,.11,.08],{totals:B.money(rows.reduce((s,l)=>s+(l.valor||0),0)),moneyColumns:[6],numberColumns:[2,3,4,5],font:8});
 }
 if(kind==='sgq'){
  header('',true);table(['UNIDADE','PROPRIETÁRIO/LOCATÁRIO','TIPO DE CUSTAS','QUANTIDADE','VALOR UNITÁRIO','TOTAL'],model.sgq.map(l=>[l.unidade,l.nome,l.motivo,l.quantidade,money(l.unitario),money(l.valor)]),[.09,.34,.21,.10,.13,.13],{totals:model.totals.sgq,moneyColumns:[4,5],numberColumns:[3]});
 }else{
  header('VENDAS - FATURAMENTO '+title(model.comp));table(['UNIDADE','CNPJ','MOTIVO','DATA DO VENCIMENTO','VALOR','TIPO'],model.sales.map(l=>[l.unidade,l.cnpj,l.motivo,date(l.venc),money(l.valor),l.tipo]),[.22,.15,.34,.12,.10,.07],{totals:model.totals.adm,moneyColumns:[4],font:8});
  if(y+290>doc.page.height-28){doc.addPage();y=28;}consumptionSection(model.agua,model.water);
  if(model.energia){doc.addPage();y=28;consumptionSection(model.energia,model.energy.filter(l=>l.valor!==null||model.sales.some(v=>v.origem==='energia'&&v.item?.unidadeId===l.unidadeId)),true);}
 }
 doc.end();return doc;
}

export function installBilling(app){
 app.post('/api/faturamento/exportar',async(req,res)=>{
  if(!req.auth)return res.status(401).json({erro:'Entre novamente para gerar o relatório.'});
  try{
   const ws=await lerWorkspace('default'),a=accessFor(req.auth.user_id,ws?.snapshot),b=req.body||{};
   if(!a.pages.includes('vendascustas')||!a.perms.condos.includes(b.condoId))return res.status(403).json({erro:'Sem acesso ao faturamento deste condomínio.'});
   if(!['adm','sgq'].includes(b.tipo)||!['xlsx','pdf'].includes(b.formato))return res.status(400).json({erro:'Relatório inválido.'});
   if(b.versao!==ws.versao)return res.status(409).json({erro:'Os dados mudaram. Sincronize e confira o mês antes de emitir.'});
   const model=B.build(scopedSnapshot(ws.snapshot,a),b.competencia,b.condoId);
   if(!model.canExport(b.tipo))return res.status(422).json({erro:'Resolva as pendências antes de emitir o relatório.',pendencias:model.issues.filter(i=>i.kind==='todos'||i.kind===b.tipo)});
   res.set('Cache-Control','no-store');res.set('Content-Disposition',`attachment; filename="${b.tipo==='sgq'?'Custas_SGQ':'Vendas_e_Custas_ADM'}_${model.comp.replace('/','-')}.${b.formato}"`);
   if(b.formato==='xlsx')return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(billingXlsx(model,b.tipo));
   res.type('application/pdf');const doc=billingPdf(model,b.tipo,res);doc.on('error',()=>res.destroy());
  }catch(e){if(!res.headersSent)res.status(e.message==='Competência inválida.'?400:500).json({erro:e.message==='Competência inválida.'?e.message:'Não foi possível gerar o relatório. Tente novamente.'});}
 });
}
