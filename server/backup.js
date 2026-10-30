/* Full private backup. Never served by express.static or committed with data. */
import { createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { db } from './db.js';
export const BACKUP_TABLES=['workspace','workspace_private','workspace_backup','evento','foto','foto_owner','auth_user','auth_session','auth_meta','auth_throttle'];
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function exportDatabase(client=db){
 const tx=await client.transaction('read');
 try{
  const tables=[];
  for(const name of BACKUP_TABLES){
   const schema=(await tx.execute({sql:"SELECT sql FROM sqlite_master WHERE type='table' AND name=?",args:[name]})).rows[0]?.sql;
   if(!schema)throw Error('Tabela ausente: '+name);
   const result=await tx.execute('SELECT * FROM "'+name+'"');
   tables.push({name,schema,columns:result.columns,rows:result.rows.map(r=>result.columns.map(c=>r[c]))});
  }
  await tx.commit();return {format:'grc-full-backup-v1',createdAt:new Date().toISOString(),checksum:hash(tables),tables};
 }catch(e){await tx.rollback();throw e}finally{tx.close()}
}
export async function restoreEmptyDatabase(backup,client){
 if(backup?.format!=='grc-full-backup-v1'||!Array.isArray(backup.tables)||hash(backup.tables)!==backup.checksum)throw Error('Backup inválido ou corrompido.');
 if(backup.tables.length!==BACKUP_TABLES.length||new Set(backup.tables.map(t=>t.name)).size!==BACKUP_TABLES.length||backup.tables.some(t=>!BACKUP_TABLES.includes(t.name)))throw Error('Conjunto de tabelas inválido.');
 const existing=await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
 if(existing.rows.length)throw Error('A restauração exige uma base separada e vazia.');
 const tx=await client.transaction('write');
 try{
  for(const table of backup.tables){
   if(!new RegExp('^CREATE TABLE(?: IF NOT EXISTS)? ["`\\[]?'+table.name+'["`\\]]?\\s*\\(','i').test(table.schema)||table.schema.includes(';'))throw Error('Estrutura inválida.');
   if(!table.columns.every(c=>/^[a-z_]+$/.test(c)))throw Error('Colunas inválidas.');
   await tx.execute(table.schema);
   for(const row of table.rows){
    if(!Array.isArray(row)||row.length!==table.columns.length)throw Error('Linha inválida.');
    await tx.execute({sql:'INSERT INTO "'+table.name+'"('+table.columns.map(c=>'"'+c+'"').join(',')+') VALUES('+row.map(()=>'?').join(',')+')',args:row});
   }
  }
  await tx.commit();return {ok:true,tables:backup.tables.length,rows:backup.tables.reduce((n,t)=>n+t.rows.length,0)};
 }catch(e){await tx.rollback();throw e}finally{tx.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [action,file]=process.argv.slice(2);
 try{
  if(action==='export'&&file){await writeFile(file,JSON.stringify(await exportDatabase()),{mode:0o600});console.log('Backup completo salvo. Contém dados privados e credenciais: mantenha-o fora do Git.');}
  else if(action==='restore-empty'&&file){console.log(await restoreEmptyDatabase(JSON.parse(await readFile(file,'utf8')),db));}
  else throw Error('Uso: node server/backup.js export ARQUIVO ou restore-empty ARQUIVO (somente base vazia).');
 }catch(e){console.error(e.message);process.exitCode=1}finally{db.close()}
}
