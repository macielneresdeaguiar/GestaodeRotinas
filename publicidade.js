function ok(c,m){console.log((c?'OK  ':'FAIL')+' '+m); if(!c)process.exitCode=1}
session=USERS[0]; page='publicidade';
// view vazia renderiza com CTA e sem vazamento de ícones
render();
ok($('#content').innerHTML.includes('Novo Interessado'),'viewPublicidade renderiza com botão de cadastro');
ok(!/\+ic\('|\$\{ic\(/.test($('#content').innerHTML),'sem vazamento de ic() na view');
// elevadores padrão
ok(pubElevs('c1').length>=1,'elevadores padrão de c1');
// cadastro direto + view lista
anuncios.push({id:uid('pb'),condoId:'c1',elevador:'Elevador 1',empresa:'Agência Teste Ltda',
  doc:'12.345.678/0001-90',contato:'Maria Souza',telefone:'(61) 99999-0000',email:'maria@teste.com.br',
  status:'Ativo',inicio:'2026-09-01',fim:'2027-08-31',valorMensal:350,obs:'',
  criadoEm:nowStamp(),criadoPor:'Maciel',contratos:[]});
render();
ok($('#content').innerHTML.includes('Agência Teste'),'tabela lista a empresa');
ok($('#content').innerHTML.includes('R$ 350'),'valor mensal formatado na tabela');
ok($('#content').innerHTML.includes('Contratos Ativos'),'cartão de métricas presente');
// texto do contrato
const L=pubContratoLinhas(anuncios[0]);
const txt=L.map(x=>x.t).join('\n');
ok(txt.includes('CEDENTE')&&txt.includes('CESSIONÁRIO'),'partes presentes no contrato');
ok(txt.includes('Agência Teste Ltda'),'empresa no contrato');
ok(txt.includes('Elevador 1'),'elevador no contrato');
ok(txt.includes('CLÁUSULA 7'),'7 cláusulas geradas');
ok((txt.match(/_{4,}/g)||[]).length>=4,'linhas de assinatura (CEDENTE, CESSIONÁRIO, 2 testemunhas)');
ok(txt.includes('Brasília/DF,'),'data e foro de Brasília');
// PDF
const bytes=pdfGerar(L,'teste.pdf');
ok(bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46,'PDF começa com %PDF');
let latin=''; for(let i=0;i<bytes.length;i++) latin+=String.fromCharCode(bytes[i]);
ok(latin.includes('/WinAnsiEncoding'),'fontes com WinAnsiEncoding (acentos)');
ok(latin.includes('Página 1 de'),'rodapé de paginação');
const sx=latin.indexOf('startxref'), xrefPos=parseInt(latin.slice(sx+10),10);
ok(latin.slice(xrefPos,xrefPos+4)==='xref','startxref aponta para a tabela xref');
const ents=latin.slice(xrefPos).match(/\d{10} 00000 n /g)||[];
ok(ents.length>=5,'xref com entradas de objeto ('+ents.length+')');
ok(ents.every((e,i)=>latin.slice(parseInt(e,10)).startsWith((i+1)+' 0 obj')),'offsets do xref corretos');
ok(latin.includes(String.fromCharCode(0xE1))||latin.includes(String.fromCharCode(0xE3)),'acentos preservados em byte WinAnsi');
ok((latin.match(/\/Type \/Page[^s]/g)||[]).length>=1,'páginas presentes');
// snapshot / sync
const snap=JSON.parse(JSON.stringify(dbSnapshot()));
ok(Array.isArray(snap.anuncios)&&snap.anuncios.length===1,'anuncios incluído no snapshot');
const n=anuncios.length; anuncios=[]; aplicarSnapshot(snap);
ok(anuncios.length===n,'aplicarSnapshot restaura anuncios');
const old=JSON.parse(JSON.stringify(snap)); delete old.anuncios; aplicarSnapshot(old);
ok(Array.isArray(anuncios)&&anuncios.length===0,'snapshot antigo (sem anuncios) vira lista vazia');
// permissão: u3 (manutenção) não vê o módulo no menu
pickUser('u3'); session=USERS[2]; buildNav();
ok(!$('#nav').innerHTML.includes('Publicidade'),'perfil manutenção sem acesso à publicidade');
pickUser('u1'); session=USERS[0]; buildNav();
ok($('#nav').innerHTML.includes('Publicidade'),'perfil gestor vê publicidade no menu');
page='dashboard';
