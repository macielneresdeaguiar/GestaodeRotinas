import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, lerWorkspace, gravarWorkspace, historico } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const WS = 'default';

// O snapshot com fotos em base64 pode passar de 1 MB.
app.use(express.json({ limit: '25mb' }));
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

app.get('/api/saude', async (_req, res) => {
  try {
    const w = await lerWorkspace(WS);
    res.json({
      ok: true,
      versao: w?.versao ?? 0,
      atualizado: w?.atualizado ?? null,
      protegido: !!TOKEN,
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

// Arquivos do app
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders(res, file) {
    // O HTML muda a cada deploy; não pode ficar em cache agressivo.
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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
