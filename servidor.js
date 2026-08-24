const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não configurada.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

app.use(express.json({ limit: '20mb' }));

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt] = stored.split(':');
  const candidate = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
}
function token() { return crypto.randomBytes(32).toString('hex'); }

async function columnExists(table, column) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]
  );
  return r.rowCount > 0;
}

async function initDb() {
  // Mantém todos os dados principais do programa.
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // Tabela de usuários criada de forma tolerante a versões anteriores.
  await pool.query(`CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY,
    username TEXT,
    password_hash TEXT,
    name TEXT,
    role TEXT DEFAULT 'consulta',
    active BOOLEAN DEFAULT TRUE,
    permissions JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  // MIGRAÇÃO: adiciona somente colunas ausentes; não apaga a tabela nem os usuários existentes.
  const additions = [
    ['username', 'TEXT'],
    ['password_hash', 'TEXT'],
    ['name', 'TEXT'],
    ['role', "TEXT DEFAULT 'consulta'"],
    ['active', 'BOOLEAN DEFAULT TRUE'],
    ['permissions', "JSONB DEFAULT '[]'::jsonb"],
    ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()']
  ];
  for (const [col, type] of additions) {
    if (!(await columnExists('app_users', col))) {
      await pool.query(`ALTER TABLE app_users ADD COLUMN ${col} ${type}`);
      console.log(`Migração: app_users.${col} adicionada.`);
    }
  }

  // Evita o erro antigo de FK bigint/uuid/text: user_id fica TEXT e sem FK.
  await pool.query(`CREATE TABLE IF NOT EXISTS app_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS app_audit (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  // Se uma instalação antiga criou user_id em outro tipo, converte com segurança para TEXT.
  if (await columnExists('app_sessions', 'user_id')) {
    await pool.query(`ALTER TABLE app_sessions ALTER COLUMN user_id TYPE TEXT USING user_id::text`);
  }
  if (await columnExists('app_audit', 'user_id')) {
    await pool.query(`ALTER TABLE app_audit ALTER COLUMN user_id TYPE TEXT USING user_id::text`);
  }

  // Índice único somente para usernames preenchidos.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_unique
                    ON app_users (LOWER(username)) WHERE username IS NOT NULL`);

  // Cria admin apenas se ainda não existir usuário "admin".
  const admin = await pool.query(`SELECT id FROM app_users WHERE LOWER(username)='admin' LIMIT 1`);
  if (!admin.rowCount) {
    await pool.query(
      `INSERT INTO app_users(id,username,password_hash,name,role,active,permissions)
       VALUES($1,'admin',$2,'Administrador','administrador',TRUE,$3::jsonb)`,
      [crypto.randomUUID(), hashPassword(process.env.ADMIN_PASSWORD || 'Vale@2026'),
       JSON.stringify(['*'])]
    );
    console.log('Usuário admin criado.');
  }

  console.log('Banco atualizado sem apagar os dados existentes.');
}

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!t) return res.status(401).json({ok:false,error:'Sessão não informada'});
    const r = await pool.query(
      `SELECT s.user_id,u.username,u.name,u.role,u.active,u.permissions
       FROM app_sessions s
       LEFT JOIN app_users u ON u.id::text=s.user_id
       WHERE s.token=$1 AND s.expires_at>NOW() LIMIT 1`, [t]
    );
    if (!r.rowCount || r.rows[0].active === false)
      return res.status(401).json({ok:false,error:'Sessão inválida'});
    req.user = r.rows[0];
    req.token = t;
    next();
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
}
function adminOnly(req,res,next){
  if(req.user.role !== 'administrador')
    return res.status(403).json({ok:false,error:'Somente administrador'});
  next();
}
async function audit(user, action, details={}) {
  try {
    await pool.query(`INSERT INTO app_audit(user_id,username,action,details)
                      VALUES($1,$2,$3,$4::jsonb)`,
      [user?.user_id || null, user?.username || null, action, JSON.stringify(details)]);
  } catch(e) { console.error('Auditoria:', e.message); }
}

app.get('/api/health', async (_req,res)=>{
  try {
    const r=await pool.query('SELECT NOW() AS now');
    res.json({ok:true,db:true,now:r.rows[0].now});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.post('/api/login', async (req,res)=>{
  try {
    const username=String(req.body?.username||'').trim();
    const password=String(req.body?.password||'');
    const r=await pool.query(`SELECT * FROM app_users WHERE LOWER(username)=LOWER($1) LIMIT 1`,[username]);
    if(!r.rowCount || r.rows[0].active===false || !checkPassword(password,r.rows[0].password_hash))
      return res.status(401).json({ok:false,error:'Usuário ou senha incorretos'});
    const u=r.rows[0], t=token();
    await pool.query(`INSERT INTO app_sessions(token,user_id,expires_at)
                      VALUES($1,$2,NOW()+INTERVAL '12 hours')`,[t,String(u.id)]);
    await audit({user_id:String(u.id),username:u.username},'LOGIN');
    res.json({ok:true,token:t,user:{id:String(u.id),username:u.username,name:u.name,role:u.role,permissions:u.permissions}});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.post('/api/logout',auth,async(req,res)=>{
  await pool.query('DELETE FROM app_sessions WHERE token=$1',[req.token]);
  await audit(req.user,'LOGOUT');
  res.json({ok:true});
});

app.get('/api/users',auth,adminOnly,async(_req,res)=>{
  try {
    const r=await pool.query(`SELECT id::text,username,name,role,active,permissions,created_at,updated_at
                              FROM app_users ORDER BY username NULLS LAST`);
    res.json({ok:true,users:r.rows});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.post('/api/users',auth,adminOnly,async(req,res)=>{
  try {
    const {username,password,name,role='consulta',active=true,permissions=[]}=req.body||{};
    if(!username || !password) return res.status(400).json({ok:false,error:'Informe usuário e senha'});
    const id=crypto.randomUUID();
    await pool.query(`INSERT INTO app_users(id,username,password_hash,name,role,active,permissions)
                      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [id,String(username).trim(),hashPassword(password),name||username,role,!!active,JSON.stringify(permissions)]);
    await audit(req.user,'USUARIO_CRIADO',{username,role});
    res.json({ok:true,id});
  } catch(e){
    res.status(e.code==='23505'?409:500).json({ok:false,error:e.code==='23505'?'Usuário já existe':e.message});
  }
});

app.put('/api/users/:id',auth,adminOnly,async(req,res)=>{
  try {
    const {name,role,active,permissions,password}=req.body||{};
    await pool.query(`UPDATE app_users SET
      name=COALESCE($2,name), role=COALESCE($3,role), active=COALESCE($4,active),
      permissions=COALESCE($5::jsonb,permissions), updated_at=NOW()
      WHERE id::text=$1`,
      [req.params.id,name??null,role??null,typeof active==='boolean'?active:null,
       permissions?JSON.stringify(permissions):null]);
    if(password) await pool.query(`UPDATE app_users SET password_hash=$2,updated_at=NOW() WHERE id::text=$1`,
      [req.params.id,hashPassword(password)]);
    await audit(req.user,'USUARIO_ALTERADO',{id:req.params.id});
    res.json({ok:true});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.get('/api/audit',auth,adminOnly,async(_req,res)=>{
  try {
    const r=await pool.query(`SELECT * FROM app_audit ORDER BY created_at DESC LIMIT 500`);
    res.json({ok:true,logs:r.rows});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.get('/api/state', async (_req,res)=>{
  try {
    const r=await pool.query("SELECT data,updated_at FROM app_state WHERE id='vale-da-serra'");
    if(!r.rowCount) return res.json({ok:true,exists:false,data:null});
    res.json({ok:true,exists:true,data:r.rows[0].data,updatedAt:r.rows[0].updated_at});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.put('/api/state', async (req,res)=>{
  try {
    const data=req.body?.data;
    if(!data || typeof data!=='object') return res.status(400).json({ok:false,error:'Dados inválidos'});
    await pool.query(`INSERT INTO app_state(id,data,updated_at)
      VALUES('vale-da-serra',$1::jsonb,NOW())
      ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,
      [JSON.stringify(data)]);
    res.json({ok:true});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.use(express.static(__dirname));
app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'index.html')));

initDb()
  .then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Vale da Serra online na porta ${PORT}`)))
  .catch(err=>{ console.error('Falha ao iniciar banco:',err); process.exit(1); });
