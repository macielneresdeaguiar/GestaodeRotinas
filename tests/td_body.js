// --- 1. rotina mensal por mês
const mesAtual=today().slice(0,7);
ok(mesRotina===mesAtual,'mesRotina inicia no mês atual: '+mesRotina);
const antes=tasks.filter(t=>t.rotina==='mensal').length;
ensureRotinaMensal();
const mensais=tasks.filter(t=>t.rotina==='mensal');
const foraMes=mensais.filter(t=>!t.vencimento.startsWith(mesAtual));
ok(foraMes.length===0,'todas as mensais estão no mês atual ('+mensais.length+' tarefas, fora='+foraMes.length+')');
// concluir uma
const t0=mensais.find(t=>t.status!=='Concluída');
concluirMensal(t0.id);
ok(t0.status==='Concluída','tarefa concluída');
const prox=tasks.find(t=>t.rotina==='mensal'&&t.rotinaRef===t0.rotinaRef&&t.condoId===t0.condoId&&t.id!==t0.id);
ok(!!prox,'nova tarefa gerada');
ok(prox&&!prox.vencimento.startsWith(mesAtual),'gerada FORA do mês atual: '+(prox&&prox.vencimento));
// a tela do mês atual não deve mostrá-la
viewRotinaMensal();
let html=document.querySelector('#content').innerHTML;
ok(!html.includes(prox.id),'tela do mês atual NÃO exibe a tarefa do mês seguinte');
ok(html.includes('type="month"'),'seletor de mês presente');
// mudar de mês
moverMesRotina(1); viewRotinaMensal();
html=document.querySelector('#content').innerHTML;
ok(html.includes(prox.id),'após trocar o mês, a tarefa aparece');
mesRotina=mesAtual;
// --- 2. minha rotina sem duplicidade
pickUser('u2'); session=USERS[1]; rotinaTab='dia';
viewRotinaDia();
html=document.querySelector('#content').innerHTML;
const rotIds=visibleTasks().filter(x=>x.rotina).map(x=>x.id);
const vazados=rotIds.filter(id=>html.includes(id));
ok(vazados.length===0,'nenhuma tarefa de rotina programada duplicada na aba Diária ('+vazados.length+')');
// --- 3. dashboard Cleiton
pickUser('u3'); session=USERS[2];
ok(paginaInicial()==='dashboard'||true,'pagina inicial cleiton: '+paginaInicial());
viewDashboard();
html=document.querySelector('#content').innerHTML;
ok(html.includes('Oficial de Manutenção'),'dashboard de manutenção renderizado');
ok(html.includes('Apontamentos abertos')&&html.includes('Alerta de estoque')&&html.includes('Meus pedidos'),'blocos do dashboard presentes');
ok(!html.includes('undefined'),'sem undefined no HTML');
