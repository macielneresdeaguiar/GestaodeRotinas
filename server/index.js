import express from 'express';
import path from 'node:path';
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

/* ---------- senha única de acesso ao site (opcional) ----------
   Definida em SITE_TOKEN no Render. Protege apenas a API de dados;
   as senhas por perfil continuam sendo as do próprio app.        */
const TOKEN = process.env.SITE_TOKEN || '';
function autorizado(req) {
  if (!TOKEN) return true;
  const h = req.get('x-grc-token') || '';
  return h === TOKEN;
}
function exigeToken(req, res, next) {
  if (autorizado(req)) return next();
  res.status(401).json({ erro: 'nao_autorizado' });
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
    const dados = await lerFoto(String(req.params.id || ''));
    if (!dados) return res.status(404).json({ erro: 'foto não encontrada' });
    res.set('Cache-Control', 'public, max-age=31536000, immutable');  // nunca muda
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
    res.json({ ok: true, faltam: await fotosQueFaltam(ids.map(String)) });
  } catch (e) {
    console.error('[foto:faltam]', e);
    res.status(500).json({ erro: 'falha ao conferir as fotos' });
  }
});

/* Limpeza das fotos de servicos ja encerrados. Exige o token do site,
   porque e a unica chamada que apaga conteudo de verdade. O app so
   manda ids que ja sairam num backup -- a trava de verdade esta la. */
app.post('/api/fotos/apagar', exigeToken, async (req, res) => {
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
      protegido: !!TOKEN,
      fotos: await estatisticaFotos(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Baixa o estado atual
app.get('/api/dados', exigeToken, async (_req, res) => {
  try {
    const w = await lerWorkspace(WS);
    if (!w) return res.json({ vazio: true, versao: 0 });
    res.json({ vazio: false, versao: w.versao, atualizado: w.atualizado, autor: w.autor, snapshot: w.snapshot });
  } catch (e) {
    res.status(500).json({ erro: e.message });
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
  const { snapshot, versaoBase, autor, dispositivo } = req.body || {};
  if (!snapshotValido(snapshot)) {
    return res.status(400).json({ erro: 'snapshot_invalido' });
  }
  try {
    const r = await gravarWorkspace({ id: WS, snapshot, versaoBase, autor, dispositivo });
    if (!r.ok && r.conflito) return res.status(409).json(r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/historico', exigeToken, async (_req, res) => {
  try {
    res.json({ eventos: await historico(WS, 30) });
  } catch (e) {
    res.status(500).json({ erro: e.message });
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
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[grc] no ar na porta ${PORT}${TOKEN ? ' (protegido por token)' : ''}`);
    });
  })
  .catch((e) => {
    console.error('[grc] falha ao migrar o banco:', e);
    process.exit(1);
  });
