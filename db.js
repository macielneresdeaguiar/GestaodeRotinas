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
  ], 'write');
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
export async function gravarWorkspace({ id = 'default', snapshot, versaoBase, autor, dispositivo }) {
  const atual = await lerWorkspace(id);
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
  await db.execute({
    sql: `UPDATE workspace SET snapshot = ?, versao = ?, atualizado = ?, autor = ? WHERE id = ? AND versao = ?`,
    args: [texto, nova, agora, autor || null, id, atual.versao],
  });
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
