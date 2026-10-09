import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error('[db] TURSO_DATABASE_URL não definida.');
}

export const db = createClient({ url: url || 'file:local.db', authToken });

/* ------------------------------------------------------------------
   Modelo de dados
   - workspace: 1 linha por instalação (aqui só usamos 'default').
     Guarda o snapshot JSON inteiro do app + versão para controle de
     concorrência otimista (evita um celular sobrescrever o outro).
   - evento: trilha de auditoria de cada gravação, para conseguir
     reconstruir/depurar quem mudou o quê e quando.
------------------------------------------------------------------ */
export async function migrate() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS workspace (
       id          TEXT PRIMARY KEY,
       snapshot    TEXT NOT NULL,
       versao      INTEGER NOT NULL DEFAULT 1,
       atualizado  TEXT NOT NULL,
       autor       TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS evento (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       workspace   TEXT NOT NULL,
       versao      INTEGER NOT NULL,
       autor       TEXT,
       dispositivo TEXT,
       bytes       INTEGER,
       criado      TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_evento_ws ON evento(workspace, id DESC)`,
    // Fotos ficam FORA do snapshot: cada uma sobe uma única vez. Antes elas
    // viajavam juntas a cada sincronização, o que tornava o envio inviável
    // (100 fotos = 36 MB por sincronização) e travava o navegador.
    `CREATE TABLE IF NOT EXISTS foto (
       id      TEXT PRIMARY KEY,
       dados   TEXT NOT NULL,
       bytes   INTEGER,
       criado  TEXT NOT NULL
     )`,
  ], 'write');
}

/** Grava uma foto. Idempotente: reenviar a mesma foto não custa nada. */
export async function gravarFoto(id, dados) {
  const r = await db.execute({
    sql: `INSERT INTO foto (id, dados, bytes, criado)
          VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    args: [id, dados, dados.length, new Date().toISOString()],
  });
  return { id, novo: r.rowsAffected > 0 };
}

export async function lerFoto(id) {
  const r = await db.execute({ sql: 'SELECT dados FROM foto WHERE id = ?', args: [id] });
  return r.rows.length ? String(r.rows[0].dados) : null;
}

/** Dos ids pedidos, quais o servidor AINDA NÃO tem. */
export async function fotosQueFaltam(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const existentes = new Set();
  const lote = 300;
  for (let i = 0; i < ids.length; i += lote) {
    const parte = ids.slice(i, i + lote);
    const marc = parte.map(() => '?').join(',');
    const r = await db.execute({
      sql: `SELECT id FROM foto WHERE id IN (${marc})`, args: parte });
    r.rows.forEach((x) => existentes.add(String(x.id)));
  }
  return ids.filter((x) => !existentes.has(x));
}

/** Apaga fotos de servicos ja encerrados, depois que elas ja sairam num
    backup. E a unica rota que remove conteudo: por isso devolve a conta
    do que saiu, para o app poder mostrar e registrar na auditoria. */
export async function apagarFotos(ids) {
  if (!Array.isArray(ids) || !ids.length) return { apagadas: 0, bytes: 0 };
  let apagadas = 0, bytes = 0;
  const lote = 200;
  for (let i = 0; i < ids.length; i += lote) {
    const parte = ids.slice(i, i + lote).map(String);
    const marc = parte.map(() => '?').join(',');
    const med = await db.execute({
      sql: `SELECT COUNT(*) n, COALESCE(SUM(bytes),0) b FROM foto WHERE id IN (${marc})`,
      args: parte,
    });
    const r = await db.execute({
      sql: `DELETE FROM foto WHERE id IN (${marc})`, args: parte });
    apagadas += Number(r.rowsAffected || med.rows[0].n || 0);
    bytes += Number(med.rows[0].b || 0);
  }
  return { apagadas, bytes };
}

export async function estatisticaFotos() {
  const r = await db.execute('SELECT COUNT(*) n, COALESCE(SUM(bytes),0) b FROM foto');
  return { quantidade: Number(r.rows[0].n || 0), bytes: Number(r.rows[0].b || 0) };
}

export async function lerWorkspace(id = 'default') {
  const r = await db.execute({
    sql: 'SELECT snapshot, versao, atualizado, autor FROM workspace WHERE id = ?',
    args: [id],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    snapshot: JSON.parse(row.snapshot),
    versao: Number(row.versao),
    atualizado: row.atualizado,
    autor: row.autor,
  };
}

/**
 * Grava com trava otimista.
 * Se `versaoBase` não bater com a versão atual, devolve conflito
 * em vez de sobrescrever o trabalho de outra pessoa.
 */
/* Rede de protecao contra aparelho com versao antiga do app.
   Quando uma colecao nova e criada (ex.: unidSind), o aparelho que ainda
   roda a versao velha do index.html devolve o snapshot SEM essa chave --
   o codigo dele nem sabe que ela existe. Isso apagou a carteira do sindico
   em producao. Aqui: se a chave sumiu do que chegou mas existe com conteudo
   no que esta gravado, mantemos a gravada. Nao mexe em chave enviada vazia
   de proposito; so na que foi OMITIDA. */
function preservarColecoes(novo, antigo) {
  if (!novo || !antigo || typeof novo !== 'object' || typeof antigo !== 'object') return novo;
  let mantidas = [];
  for (const k of Object.keys(antigo)) {
    if (k in novo) continue;
    const v = antigo[k];
    if (Array.isArray(v) ? v.length : (v && typeof v === 'object' && Object.keys(v).length)) {
      novo[k] = v;
      mantidas.push(k);
    }
  }
  if (mantidas.length) console.log('[grc] coleções preservadas (cliente antigo):', mantidas.join(', '));
  return novo;
}

export async function gravarWorkspace({ id = 'default', snapshot, versaoBase, autor, dispositivo }) {
  const atual = await lerWorkspace(id);
  if (atual && atual.snapshot) snapshot = preservarColecoes(snapshot, atual.snapshot);
  const texto = JSON.stringify(snapshot);
  const agora = new Date().toISOString();

  if (!atual) {
    await db.execute({
      sql: `INSERT INTO workspace (id, snapshot, versao, atualizado, autor) VALUES (?, ?, 1, ?, ?)`,
      args: [id, texto, agora, autor || null],
    });
    await registrarEvento({ workspace: id, versao: 1, autor, dispositivo, bytes: texto.length });
    return { ok: true, versao: 1, atualizado: agora };
  }

  if (versaoBase != null && Number(versaoBase) !== atual.versao) {
    return {
      ok: false,
      conflito: true,
      versao: atual.versao,
      atualizado: atual.atualizado,
      autor: atual.autor,
      snapshot: atual.snapshot,
    };
  }

  const nova = atual.versao + 1;
  const up = await db.execute({
    sql: `UPDATE workspace SET snapshot = ?, versao = ?, atualizado = ?, autor = ? WHERE id = ? AND versao = ?`,
    args: [texto, nova, agora, autor || null, id, atual.versao],
  });
  /* Dois aparelhos podem ler a mesma versão e gravar ao mesmo tempo. Quem chega
     depois não altera nenhuma linha (o WHERE não casa mais) e, sem esta conferência,
     recebia "ok" enquanto sua gravação se perdia — junto com o trabalho do usuário.
     Agora isso vira conflito e o app faz a junção dos dois lados. */
  if (up.rowsAffected === 0) {
    const novo = await lerWorkspace(id);
    return {
      ok: false,
      conflito: true,
      versao: novo ? novo.versao : atual.versao,
      atualizado: novo ? novo.atualizado : atual.atualizado,
      autor: novo ? novo.autor : atual.autor,
      snapshot: novo ? novo.snapshot : atual.snapshot,
    };
  }
  await registrarEvento({ workspace: id, versao: nova, autor, dispositivo, bytes: texto.length });
  return { ok: true, versao: nova, atualizado: agora };
}

async function registrarEvento({ workspace, versao, autor, dispositivo, bytes }) {
  try {
    await db.execute({
      sql: `INSERT INTO evento (workspace, versao, autor, dispositivo, bytes, criado)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [workspace, versao, autor || null, dispositivo || null, bytes || 0, new Date().toISOString()],
    });
  } catch (e) {
    console.warn('[db] falha ao registrar evento:', e.message);
  }
}

export async function historico(id = 'default', limite = 30) {
  const r = await db.execute({
    sql: `SELECT versao, autor, dispositivo, bytes, criado FROM evento
          WHERE workspace = ? ORDER BY id DESC LIMIT ?`,
    args: [id, limite],
  });
  return r.rows;
}
