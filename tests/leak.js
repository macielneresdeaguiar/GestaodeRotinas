function ok(c,m){console.log((c?'OK  ':'FAIL')+' '+m); if(!c)process.exitCode=1}
const LEAK=/\+ic\('|\$\{ic\(|\$\{[a-z]/i;
[['u1',0],['u2',1],['u3',2]].forEach(([u,i])=>{
  pickUser(u); session=USERS[i];
  const views=!USERS[i].perms.tipos.length
    ? ['dashboard','apontamentos','estoque','pedidos','config']
    : ['dashboard','hoje','rotina','tarefas','notas','cessoes','leituras','estoque','pedidos','relatorios','relmensal','config'];
  views.forEach(p=>{
    page=p;
    try{ render(); const h=document.querySelector('#content').innerHTML;
      const bad=h.match(/'\+ic\('[a-zA-Z]+'\)\+'|\$\{ic\(/g);
      ok(!bad,u+' / '+p+(bad?' VAZOU: '+bad.slice(0,2):''));
    }catch(e){ ok(false,u+' / '+p+' ERRO: '+e.message) }
  });
});
