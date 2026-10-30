import express from 'express';
import { initializeAuth, installAuth, publicSnapshot, sanitizeIncoming } from './auth.js';
import path from 'node:path';
import { db, isolatePrivate } from './db.js';
import { accessFor, scopedSnapshot, mergeScoped, attachmentRefs } from './access.js';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate, lerWorkspace, gravarWorkspace, historico,
         gravarFoto, lerFoto, fotosQueFaltam, estatisticaFotos,
         apagarFotos } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const WS = 'default';

// O snapshot com fotos em base64 pode passar de 1 MB.
app.use('/api/auth',express.json({limit:'8kb'}));
app.use(express.json({ limit: '60mb' }));   // fotos de ronda/check-list

/* ---------- compressao das respostas da API ----------
   O /api/dados devolve o snapshot inteiro, e todo aparelho aberto baixa
   esse snapshot cada vez que alguem salva qualquer coisa. Em texto puro
   sao ~150 KB por vez; em gzip caem para ~18 KB. Era essa a conta que
   estourou os 5 GB de banda do plano gratuito em uma semana.
   Abaixo de 1 KB nao compensa: o cabecalho custa mais que a economia. */
const MIN_GZIP = 1024;
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (!/\bgzip\b/.test(req.get('accept-encoding') || '')) return next();
  const jsonOriginal = res.json.bind(res);
  res.json = (corpo) => {
    let texto;
    try { texto = JSON.stringify(corpo) } catch { return jsonOriginal(corpo) }
    if (texto === undefined || Buffer.byteLength(texto) < MIN_GZIP) {
      return jsonOriginal(corpo);
    }
    let buf;
    try { buf = zlib.gzipSync(texto, { level: 6 }) } catch { return jsonOriginal(corpo) }
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', buf.length);
    res.type('application/json');
    return req.method === 'HEAD' ? res.end() : res.end(buf);
  };
  next();
});
app.disable('x-powered-by');

/* Sessão diária validada no servidor; sem bypass por SITE_TOKEN. */
installAuth(app);
async function viewFor(req){
  const ws=await lerWorkspace(WS);
  const access=accessFor(req.auth.user_id,ws?.snapshot);
  return {ws,access,view:scopedSnapshot(ws?.snapshot||{CFG:{}},access)};
}
async function outputSnapshot(snapshot,req){return publicSnapshot(scopedSnapshot(snapshot,accessFor(req.auth.user_id,snapshot)));}
async function canReadPhoto(id,req){
  const {view}=await viewFor(req);
  if(attachmentRefs(view).has(id))return true;
  const owner=(await db.execute({sql:'SELECT user_id FROM foto_owner WHERE id=?',args:[id]})).rows[0];
  return owner?.user_id===req.auth.user_id;
}
function autorizado(req) { return !!req.auth; }
function exigeToken(req,res,next) {
  if(req.auth) return next();
  res.status(401).json({erro:'sessao_expirada'});
}

/* ---------- fotos: sobem uma vez, separadas do snapshot ----------
   Mantê-las dentro do snapshot fazia cada sincronização carregar o acervo
   inteiro. Agora cada foto é enviada uma única vez e nunca mais trafega. */
app.put('/api/foto/:id', async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ erro: 'não autorizado' });
  try {
    const id = String(req.params.id || '');
    const dados = req.body && req.body.dados;
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return res.status(400).json({ erro: 'id inválido' });
    // imagem (foto de ronda/check-list) ou PDF (laudo de manutencao obrigatoria)
    const aceito = typeof dados === 'string' &&
      (dados.startsWith('data:image/') || dados.startsWith('data:application/pdf'));
    if (!aceito) return res.status(400).json({ erro: 'conteúdo inválido' });
    const {access}=await viewFor(req);
    if(!access.fullRead&&!['leituras','brigada','ronda','manutencao','manutobrig'].some(k=>access.perms[k]))return res.status(403).json({erro:'Sem acesso a anexos.'});
    if(await lerFoto(id)){
      if(!await canReadPhoto(id,req))return res.status(404).json({erro:'foto não encontrada'});
    }else await db.execute({sql:'INSERT OR IGNORE INTO foto_owner VALUES(?,?)',args:[id,req.auth.user_id]});
    const r = await gravarFoto(id, dados);
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[foto:gravar]', e);
    res.status(500).json({ erro: 'falha ao gravar a foto' });
  }
});

app.get('/api/foto/:id', async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ erro: 'não autorizado' });
  try {
    if(!await canReadPhoto(String(req.params.id||''),req))return res.status(404).json({erro:'foto não encontrada'});
    const dados = await lerFoto(String(req.params.id || ''));
    if (!dados) return res.status(404).json({ erro: 'foto não encontrada' });
    res.set('Cache-Control', 'no-store'); // anexos privados, inclusive após logout
    res.json({ ok: true, dados });
  } catch (e) {
    console.error('[foto:ler]', e);
    res.status(500).json({ erro: 'falha ao ler a foto' });
  }
});

/* Quais destas o servidor ainda não tem? Evita reenviar o que já subiu. */
app.post('/api/fotos/faltam', async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ erro: 'não autorizado' });
  try {
    const ids = (req.body && req.body.ids) || [];
    if(!Array.isArray(ids)||ids.length>1000)return res.status(400).json({erro:'ids_invalidos'});
    const missing=new Set(await fotosQueFaltam(ids.map(String))),faltam=[];
    for(const id of ids.map(String))if(missing.has(id)||!await canReadPhoto(id,req))faltam.push(id);
    res.json({ok:true,faltam});
  } catch (e) {
    console.error('[foto:faltam]', e);
    res.status(500).json({ erro: 'falha ao conferir as fotos' });
  }
});

/* Limpeza das fotos de servicos ja encerrados. Exige o token do site,
   porque e a unica chamada que apaga conteudo de verdade. O app so
   manda ids que ja sairam num backup -- a trava de verdade esta la. */
app.post('/api/fotos/apagar', exigeToken, async (req, res) => {
  if(req.auth.user_id!=='u1')return res.status(403).json({erro:'Somente o gestor pode remover anexos.'});
  const ids = (req.body && req.body.ids) || [];
  if (!Array.isArray(ids)) return res.status(400).json({ erro: 'ids_invalidos' });
  const limpos = ids.map(String).filter((x) => /^[A-Za-z0-9_-]{3,80}$/.test(x));
  if (!limpos.length) return res.json({ ok: true, apagadas: 0, bytes: 0 });
  try {
    const r = await apagarFotos(limpos);
    console.log('[foto:apagar]', r.apagadas, 'fotos,', r.bytes, 'bytes');
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[foto:apagar]', e);
    res.status(500).json({ erro: 'falha ao apagar as fotos' });
  }
});

app.get('/api/saude', async (_req, res) => {
  try {
    const w = await lerWorkspace(WS);
    res.json({
      ok: true,
      versao: w?.versao ?? 0,
      atualizado: w?.atualizado ?? null,
      protegido: true,
      autenticacao: 'daily-2026-10-30',
      fotos: await estatisticaFotos(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Baixa o estado atual
app.get('/api/dados', exigeToken, async (req, res) => {
  try {
    const w = await lerWorkspace(WS);
    if (!w) return res.json({ vazio: true, versao: 0 });
    res.json({ vazio: false, versao: w.versao, atualizado: w.atualizado, autor: w.autor, snapshot: await outputSnapshot(w.snapshot,req) });
  } catch (e) {
    res.status(e.status||500).json({ erro: e.status?e.message:'Falha ao processar a solicitação.' });
  }
});

// Envia o estado (com trava otimista)
/* Um snapshot precisa ter a cara do app. Isso evita que uma chamada
   malformada (ou um teste) apague a base de produção.              */
const DB_VER = 2; // precisa acompanhar o DB_VER do app
function snapshotValido(s) {
  if (!s || typeof s !== 'object') return false;
  if (s.v !== undefined && s.v !== DB_VER) return false; // versão antiga

  const listas = ['tasks', 'leituras', 'estoque', 'prestadores', 'notas', 'apontamentos', 'pedidos'];
  if (!listas.some((k) => Array.isArray(s[k]))) return false;
  return !!s.CFG && typeof s.CFG === 'object';
}

app.post('/api/dados', exigeToken, async (req, res) => {
  let { snapshot, versaoBase, dispositivo } = req.body || {};
  if (!snapshotValido(snapshot)) {
    return res.status(400).json({ erro: 'snapshot_invalido' });
  }
  try {
    const atual=await lerWorkspace(WS);
    if(req.get('x-grc-scope')!=='scoped-2026-10-30'||req.get('x-grc-workflow')!=='monthly-review-v1')return res.status(426).json({erro:'Atualize o aplicativo para continuar.',atualizeApp:true});
    if(!Number.isSafeInteger(versaoBase)||versaoBase<0)return res.status(400).json({erro:'versao_base_obrigatoria'});
    if(atual&&versaoBase!==atual.versao)return res.status(409).json({ok:false,conflito:true,versao:atual.versao,atualizado:atual.atualizado,autor:atual.autor,snapshot:await outputSnapshot(atual.snapshot,req)});
    const access=accessFor(req.auth.user_id,atual?.snapshot);
    snapshot=mergeScoped(sanitizeIncoming(snapshot),atual?.snapshot||{v:2,CFG:{}},access);
    // Attachment IDs confer no authority: every referenced pre-existing file must already be in scope or owned by this account.
    const oldRefs=attachmentRefs(scopedSnapshot(atual?.snapshot||{CFG:{}},access));
    const newRefs=attachmentRefs(scopedSnapshot(snapshot,access));
    for(const id of newRefs)if(!oldRefs.has(id)&&await lerFoto(id)&&!await canReadPhoto(id,req))return res.status(403).json({erro:'Anexo fora da área desta conta.'});
    const names={u1:'Maciel',u2:'Alef',u3:'Cleiton',u4:'Fernanda',b1:'Anderson',b2:'Nilson',b3:'Suelen',b4:'Alana'};
    const autor=atual?.snapshot?.CFG?.nomesUsuarios?.[req.auth.user_id]||names[req.auth.user_id]||req.auth.user_id;
    const r = await gravarWorkspace({ id: WS, snapshot, versaoBase, autor, dispositivo });
    if (!r.ok && r.conflito) return res.status(409).json({...r,snapshot:await outputSnapshot(r.snapshot,req)});
    res.json(r);
  } catch (e) {
    res.status(e.status||500).json({ erro: e.status?e.message:'Falha ao processar a solicitação.' });
  }
});

app.get('/api/historico', exigeToken, async (req, res) => {
  if(!['u1','u2'].includes(req.auth.user_id))return res.status(403).json({erro:'Histórico restrito à administração.'});
  try {
    res.json({ eventos: await historico(WS, 30) });
  } catch (e) {
    res.status(e.status||500).json({ erro: e.status?e.message:'Falha ao processar a solicitação.' });
  }
});

/* ---------- compressao dos arquivos de texto ----------
   O index.html passa de 950 KB e era enviado cru: no celular em 4G isso
   custa segundos a cada abertura. Comprimido cai para cerca de 290 KB.
   Feito com o zlib do proprio Node, sem dependencia nova -- assim a
   publicacao continua sendo so os arquivos de sempre.
   O resultado fica em memoria e so e refeito quando o arquivo muda. */
const PUBLICO = path.join(__dirname, '..', 'public');
const COMPRIMIVEL = /\.(html|js|css|json|webmanifest|svg|map)$/i;
const cacheGz = new Map();   // caminho -> { mtime, tamanho, buf }

function pacoteGz(arquivo) {
  let st;
  try { st = fs.statSync(arquivo) } catch { return null }
  const guardado = cacheGz.get(arquivo);
  if (guardado && guardado.mtime === st.mtimeMs && guardado.tamanho === st.size) {
    return guardado;
  }
  let buf;
  try { buf = zlib.gzipSync(fs.readFileSync(arquivo), { level: 6 }) }
  catch { return null }
  /* A etiqueta nasce do arquivo (data da ultima alteracao + tamanho): muda
     sozinha a cada publicacao e so nela. Sem isso o 'no-cache' obrigava o
     navegador a baixar os 290 KB inteiros em TODA abertura do app, mesmo
     quando nada tinha mudado. Com ela a resposta vira um 304 de ~200 bytes. */
  const etag = '"' + st.size.toString(36) + '-' + Math.round(st.mtimeMs).toString(36) + '"';
  const pac = { mtime: st.mtimeMs, tamanho: st.size, buf, etag };
  cacheGz.set(arquivo, pac);
  return pac;
}
function gzipDoArquivo(arquivo) { const p = pacoteGz(arquivo); return p ? p.buf : null }

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/')) return next();
  if (!/\bgzip\b/.test(req.get('accept-encoding') || '')) return next();

  // "/" e qualquer caminho sem extensao resolvem para o index.html
  const semExt = req.path.endsWith('/') || !path.extname(req.path);
  const relativo = semExt ? 'index.html' : path.normalize(req.path);
  if (!semExt && !COMPRIMIVEL.test(req.path)) return next();

  // impede sair da pasta public por caminhos com ../
  const alvo = path.join(PUBLICO, relativo);
  if (!alvo.startsWith(PUBLICO)) return next();

  const pac = pacoteGz(alvo);
  if (!pac) return next();

  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('ETag', pac.etag);
  res.setHeader('Cache-Control', 'no-cache');
  if ((req.get('if-none-match') || '').split(/,\s*/).includes(pac.etag)) {
    return res.status(304).end();          // o aparelho ja tem esta versao
  }
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Length', pac.buf.length);
  res.type(path.extname(alvo) || '.html');
  return req.method === 'HEAD' ? res.end() : res.end(pac.buf);
});

// Arquivos do app
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders(res, file) {
    // O HTML muda a cada deploy; não pode ficar em cache agressivo.
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.get('*', (req, res) => {
  const indice = path.join(PUBLICO, 'index.html');
  if (/\bgzip\b/.test(req.get('accept-encoding') || '')) {
    const pacote = pacoteGz(indice);
    const buf = pacote && pacote.buf;
    if (buf) {
      res.setHeader('ETag', pacote.etag);
      res.setHeader('Vary', 'Accept-Encoding');
      if ((req.get('if-none-match') || '').split(/,\s*/).includes(pacote.etag)) {
        res.setHeader('Cache-Control', 'no-cache');
        return res.status(304).end();
      }
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', buf.length);
      res.setHeader('Cache-Control', 'no-cache');
      res.type('.html');
      return res.end(buf);
    }
  }
  res.sendFile(indice);
});

migrate()
  .then(initializeAuth)
  .then(isolatePrivate)
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[grc] no ar na porta ${PORT} (sessão diária protegida)`);
    });
  })
  .catch((e) => {
    console.error('[grc] falha ao migrar o banco:', e);
    process.exit(1);
  });
