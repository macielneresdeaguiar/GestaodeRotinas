/* DOM-only mobile improvements: never changes operational records. */
(function(){
  let scheduled=false,preparing=false;
  const trail=[];let returning=false;
  const originalGo=window.go;
  window.go=function(next,filter){
    if(!returning&&session&&page&&page!==next){trail.push(page);if(trail.length>30)trail.shift();}
    const result=originalGo(next,filter);
    if(ehMobile())window.scrollTo({top:0,behavior:'instant'});
    return result;
  };
  window.mobileVoltar=function(){
    returning=true;
    try{window.go(trail.pop()||paginaInicial())}finally{returning=false}
  };
  function headers(table){
    const rows=Array.from(table.tHead?.rows||[]);
    if(!rows.length)return null;
    if(rows.length!==1||Array.from(rows[0].cells).some(c=>c.colSpan>1||c.rowSpan>1))return null;
    return Array.from(rows[0].cells).map(c=>c.textContent.trim()||(c.querySelector('input')?'Selecionar':'Ações'));
  }
  function labelTables(){
    document.querySelectorAll('#content table,#modalBody table,#drawerBody table').forEach(table=>{
      const labels=headers(table);
      const report=table.closest('.rel-doc,.rel-page,.relatorio,.rel-preview');
      if(!labels||report){
        table.dataset.mobileScroll='true';
        if(table.parentElement)table.parentElement.classList.add('mobile-scroll-wrap');
        return;
      }
      table.dataset.mobileCards='true';
      for(const body of table.tBodies)for(const row of body.rows){
        let column=0;
        for(const cell of row.cells){
          if(cell.colSpan===1){if(!cell.dataset.l)cell.dataset.l=labels[column]||'Detalhes';}
          else cell.dataset.mobileFull='true';
          column+=cell.colSpan;
        }
      }
    });
  }
  function controls(){
    document.querySelectorAll('#content input,#content select,#modalBody input,#modalBody select,#drawerBody input').forEach(el=>{
      if(el.getAttribute('aria-label')||el.labels?.length||el.type==='hidden')return;
      const label=el.closest('td')?.dataset.l||el.getAttribute('placeholder')||el.getAttribute('title');
      if(label)el.setAttribute('aria-label',label);
    });
    document.querySelectorAll('#content button,#modal button,#drawer button').forEach(button=>{
      if(button.textContent.trim()||button.getAttribute('aria-label'))return;
      const action=button.getAttribute('onclick')||'';
      const label=button.title||(/del|exclu|apagar/i.test(action)?'Excluir registro':/edit|FormSala|formItem|formApont/i.test(action)?'Editar cadastro':'Abrir opções');
      button.setAttribute('aria-label',label);
    });
  }
  function ungroup(details){
    for(const node of Array.from(details.children)){
      if(node.tagName==='SUMMARY')continue;
      if(node._mobileAnchor?.isConnected){node._mobileAnchor.replaceWith(node);delete node._mobileAnchor;}
      else details.before(node);
    }
    details.remove();
  }
  function group(nodes,className,label){
    if(!nodes.length)return;
    const details=document.createElement('details');details.className=className;
    const summary=document.createElement('summary');summary.textContent=label;details.append(summary);
    nodes[0].before(details);
    for(const node of nodes){const anchor=document.createComment('mobile-position');node.before(anchor);node._mobileAnchor=anchor;details.append(node);}
  }
  function compact(){
    if(!ehMobile()){
      document.querySelectorAll('.mobile-tools,.mobile-charts').forEach(ungroup);
      return;
    }
    document.querySelectorAll('#content .toolbar').forEach(bar=>{
      if(bar.querySelector('.mobile-tools'))return;
      const tools=Array.from(bar.children).filter(el=>el.tagName==='BUTTON'&&/Exportar|PDF|Importar|Restaurar relação|Imprimir|Baixar imagem/i.test(el.textContent));
      group(tools,'mobile-tools no-print','Ferramentas e exportação');
    });
    if(page==='ocupacao'&&!document.querySelector('#content .mobile-charts')){
      const nodes=Array.from(new Set(Array.from(document.querySelectorAll('#content .pz-wrap,#content .og-wrap')).map(n=>n.closest('.card')).filter(Boolean)));
      group(nodes,'mobile-charts','Ver gráficos de ocupação');
    }
  }
  function top(){
    const header=document.querySelector('.topbar');if(!header)return;
    let back=document.querySelector('#mobileBack');
    if(!back){back=document.createElement('button');back.id='mobileBack';back.className='iconbtn mobile-back';back.type='button';
      back.title='Voltar';back.setAttribute('aria-label','Voltar');back.innerHTML=ic('chevL');back.onclick=window.mobileVoltar;header.prepend(back);}
    const home=!session||page===paginaInicial();back.classList.toggle('hidden',home);header.classList.toggle('mobile-at-home',home);
    const title=document.querySelector('#pageTitle');
    if(title){
      if(!title.dataset.fullTitle||title.textContent!==title.dataset.shortTitle)title.dataset.fullTitle=title.textContent;
      const names={dashboard:'Início',hoje:'Meu dia',rotina:'Minha rotina',ocupacao:'Ocupação',locacao:'Salas disponíveis',
        'tarefas-adm':'Tarefas administrativas','tarefas-gestor':'Tarefas do gestor',leituras:'Água e energia',
        apontamentos:'Serviços',manutobrig:'Manutenções',vendascustas:'Vendas e custas',publicidade:'Publicidade',
        analises:'Projetos',unidades:'Unidades',unidsind:'Unidades do síndico','brigada-inicio':'Iniciar check-list',
        'brigada-ronda':'Ronda diária',brigada:'Check-list por andar',config:'Configurações'};
      const desired=ehMobile()?(names[page]||title.dataset.fullTitle):title.dataset.fullTitle;
      if(title.textContent!==desired)title.textContent=desired;
      title.dataset.shortTitle=desired;title.title=title.dataset.fullTitle;
    }
    if(ehMobile())document.documentElement.style.setProperty('--mobile-top-height',Math.ceil(header.getBoundingClientRect().height||96)+'px');
  }
  function keyboard(){
    const viewport=window.visualViewport;
    if(viewport)document.documentElement.style.setProperty('--mobile-visual-height',Math.round(viewport.height)+'px');
    const editing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'');
    document.body.classList.toggle('mobile-keyboard',!!(ehMobile()&&viewport&&editing&&window.innerHeight-viewport.height>140));
  }
  window.mobilePrepararPagina=function(){
    if(preparing)return;preparing=true;
    try{labelTables();controls();compact();top();keyboard()}finally{preparing=false}
  };
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;window.mobilePrepararPagina()});}
  const observer=new MutationObserver(schedule);
  ['content','modalBody','drawerBody'].forEach(id=>{const node=document.getElementById(id);if(node)observer.observe(node,{childList:true,subtree:true});});
  window.addEventListener('resize',schedule);window.addEventListener('focusin',keyboard);window.addEventListener('focusout',keyboard);
  window.visualViewport?.addEventListener('resize',keyboard);
  if(window.ResizeObserver){const header=document.querySelector('.topbar');if(header)new ResizeObserver(top).observe(header);}
  schedule();
})();
