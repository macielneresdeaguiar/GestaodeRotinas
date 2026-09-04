global.window={addEventListener(){},innerWidth:1200};
const fields={};const els={};
const cls=()=>({add(){},remove(){},toggle(){},contains(){return false}});
function stub(sel){
  if(!els[sel]) els[sel]={classList:cls(),style:{},textContent:'',checked:false,focus(){},
    tagName:(sel==='#loginPass'||sel==='#loginUser')?'INPUT':'DIV',
    get value(){return fields[sel]!==undefined?fields[sel]:''},set value(v){fields[sel]=v},
    set innerHTML(v){this._h=v},get innerHTML(){return this._h||''}};
  return els[sel];
}
global.document={querySelector:stub,querySelectorAll:()=>[],createElement:()=>({click(){}}),addEventListener(){},body:{classList:cls()}};
global.URL={createObjectURL:()=>''};global.Blob=function(){};global.confirm=()=>true;global.prompt=()=>'m';
