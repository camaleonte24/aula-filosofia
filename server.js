const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const CLASS_CODE = (process.env.CLASS_CODE || '').trim(); // se impostato, serve per registrarsi
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Patrizia Romano';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '5680';
const MAX_FILE_MB = 8;
const IS_PROD = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('Manca DATABASE_URL (stringa di connessione Postgres). Vedi README.md');
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
});

// ---------- Database ----------
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      username_lower TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BYTEA NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '',
      file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      pinned BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Crea l'account admin della prof solo se non esiste (non sovrascrive mai la password cambiata dopo)
  const lower = ADMIN_USERNAME.toLowerCase();
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE username_lower = $1', [lower]);
  if (!rowCount) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await pool.query(
      "INSERT INTO users (username, username_lower, password_hash, role) VALUES ($1, $2, $3, 'admin')",
      [ADMIN_USERNAME, lower, hash]
    );
    console.log(`Account admin creato: ${ADMIN_USERNAME}`);
  }
}

// ---------- Utilità ----------
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token) {
  const parts = [
    `sid=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 30}`,
  ];
  if (IS_PROD) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

async function auth(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie).sid;
    if (!token) return res.status(401).json({ error: 'Non hai effettuato l\'accesso.' });
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
      [token]
    );
    if (!rows.length) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Sessione scaduta, rifai l\'accesso.' });
    }
    req.user = rows[0];
    req.token = token;
    next();
  } catch (e) {
    next(e);
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo l\'amministratore può farlo.' });
  next();
}

// Limite semplice ai tentativi di login (in memoria)
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.reset < now) return false;
  return rec.count >= 10;
}
function noteAttempt(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.reset < now) attempts.set(key, { count: 1, reset: now + 10 * 60 * 1000 });
  else rec.count++;
}

function cleanUsername(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

// ---------- Account ----------
app.post('/api/register', wrap(async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || '');
  const code = String(req.body.code || '').trim();

  if (CLASS_CODE && code !== CLASS_CODE) {
    return res.status(403).json({ error: 'Codice classe errato.' });
  }
  if (!/^[\p{L}\p{N} ._-]{3,30}$/u.test(username)) {
    return res.status(400).json({ error: 'Il nome utente deve avere 3-30 caratteri (lettere, numeri, spazi, . _ -).' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri.' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      "INSERT INTO users (username, username_lower, password_hash) VALUES ($1, $2, $3) RETURNING id, username, role",
      [username, username.toLowerCase(), hash]
    );
    setSessionCookie(res, await createSession(rows[0].id));
    res.json({ user: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Nome utente già in uso.' });
    throw e;
  }
}));

app.post('/api/login', wrap(async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || '');
  const key = `${req.ip}|${username.toLowerCase()}`;
  if (tooManyAttempts(key)) {
    return res.status(429).json({ error: 'Troppi tentativi. Riprova tra qualche minuto.' });
  }
  const { rows } = await pool.query(
    'SELECT id, username, role, password_hash FROM users WHERE username_lower = $1',
    [username.toLowerCase()]
  );
  const ok = rows.length && (await bcrypt.compare(password, rows[0].password_hash));
  if (!ok) {
    noteAttempt(key);
    return res.status(401).json({ error: 'Nome utente o password errati.' });
  }
  attempts.delete(key);
  setSessionCookie(res, await createSession(rows[0].id));
  res.json({ user: { id: rows[0].id, username: rows[0].username, role: rows[0].role } });
}));

app.post('/api/logout', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE token = $1', [req.token]);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.post('/api/password', auth, wrap(async (req, res) => {
  const oldPw = String(req.body.oldPassword || '');
  const newPw = String(req.body.newPassword || '');
  if (newPw.length < 4) return res.status(400).json({ error: 'La nuova password deve avere almeno 4 caratteri.' });
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(oldPw, rows[0].password_hash))) {
    return res.status(401).json({ error: 'La password attuale non è corretta.' });
  }
  const hash = await bcrypt.hash(newPw, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ ok: true });
}));

// ---------- Messaggi ----------
const MSG_SELECT = `
  SELECT m.id, m.text, m.pinned, m.created_at,
         u.id AS user_id, u.username, u.role,
         f.id AS file_id, f.name AS file_name, f.mime AS file_mime, f.size AS file_size
  FROM messages m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN files f ON f.id = m.file_id`;

app.get('/api/messages', auth, wrap(async (req, res) => {
  const recent = await pool.query(`${MSG_SELECT} ORDER BY m.id DESC LIMIT 300`);
  const pinned = await pool.query(`${MSG_SELECT} WHERE m.pinned ORDER BY m.id DESC`);
  res.json({ messages: recent.rows.reverse(), pinned: pinned.rows });
}));

app.post('/api/messages', auth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `File troppo grande (massimo ${MAX_FILE_MB} MB).`
        : 'Errore nel caricamento del file.';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}, wrap(async (req, res) => {
  const text = String((req.body && req.body.text) || '').trim().slice(0, 4000);
  if (!text && !req.file) return res.status(400).json({ error: 'Scrivi qualcosa o allega un file.' });

  let fileId = null;
  if (req.file) {
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200);
    const { rows } = await pool.query(
      'INSERT INTO files (name, mime, size, data, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer, req.user.id]
    );
    fileId = rows[0].id;
  }
  await pool.query('INSERT INTO messages (user_id, text, file_id) VALUES ($1, $2, $3)', [req.user.id, text, fileId]);
  res.json({ ok: true });
}));

app.delete('/api/messages/:id', auth, adminOnly, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM messages WHERE id = $1 RETURNING file_id', [req.params.id]);
  if (rows.length && rows[0].file_id) await pool.query('DELETE FROM files WHERE id = $1', [rows[0].file_id]);
  res.json({ ok: true });
}));

app.post('/api/messages/:id/pin', auth, adminOnly, wrap(async (req, res) => {
  await pool.query('UPDATE messages SET pinned = $1 WHERE id = $2', [!!req.body.pinned, req.params.id]);
  res.json({ ok: true });
}));

// ---------- File ----------
const INLINE_OK = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

app.get('/api/files/:id', auth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT name, mime, size, data FROM files WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'File non trovato.' });
  const f = rows[0];
  const inline = req.query.inline === '1' && INLINE_OK.has(f.mime);
  res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`
  );
  res.setHeader('Content-Length', f.data.length);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.end(f.data);
}));

// ---------- Admin: utenti ----------
app.get('/api/users', auth, adminOnly, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.role, u.created_at,
            (SELECT count(*) FROM messages m WHERE m.user_id = u.id)::int AS messages
     FROM users u ORDER BY u.role DESC, u.username_lower`
  );
  res.json({ users: rows });
}));

app.delete('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'Non puoi rimuovere te stessa.' });
  const target = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
  if (!target.rows.length) return res.status(404).json({ error: 'Utente non trovato.' });
  if (target.rows[0].role === 'admin') return res.status(400).json({ error: 'Non puoi rimuovere un altro amministratore.' });
  await pool.query('DELETE FROM users WHERE id = $1', [id]); // cancella anche sessioni, messaggi e file (CASCADE)
  res.json({ ok: true });
}));

// ---------- Errori ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Errore del server. Riprova.' });
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`Server avviato sulla porta ${PORT}`)))
  .catch((e) => {
    console.error('Errore di avvio:', e);
    process.exit(1);
  });
