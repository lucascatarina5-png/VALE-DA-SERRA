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

  // V4.2 - compatibilidade com instalações antigas de app_sessions.
  // CREATE TABLE IF NOT EXISTS não acrescenta colunas faltantes em tabela já existente,
  // então fazemos ALTER TABLE idempotente antes de usar token no login.
  await pool.query(`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS token TEXT`);
  await pool.query(`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS user_id TEXT`);
  await pool.query(`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
  await pool.query(`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
  await pool.query(`UPDATE app_sessions
                    SET token = md5(random()::text || clock_timestamp()::text)
                    WHERE token IS NULL OR token = ''`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS app_sessions_token_uidx
                    ON app_sessions(token) WHERE token IS NOT NULL`);
  console.log('Migração: app_sessions compatibilizada com token.');
  // V4.4 - compatibilidade com banco legado.
  // token_hash pode ser a PRIMARY KEY do banco antigo; não tentamos remover NOT NULL.
  // Mantemos a coluna e gravamos nela o mesmo token usado pela versão atual.
  await pool.query(`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS token_hash TEXT`);
  console.log('Migração: app_sessions compatível com token e token_hash legado.');


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

  // Compatibilidade com banco antigo:
  // versões anteriores possuíam a coluna "nome" obrigatória (NOT NULL).
  // O código novo usa "name". Mantemos "nome" e removemos apenas a obrigatoriedade,
  // sem apagar nenhum usuário ou dado já existente.
  if (await columnExists('app_users', 'nome')) {
    await pool.query(`ALTER TABLE app_users ALTER COLUMN nome DROP NOT NULL`);
    await pool.query(`UPDATE app_users
                      SET name = COALESCE(NULLIF(name,''), NULLIF(nome,''), username)
                      WHERE name IS NULL OR name=''`);
    console.log('Migração: coluna legada app_users.nome compatibilizada.');
  }

  // Compatibilidade completa com versões antigas da tabela app_users.
  // Descobre automaticamente colunas antigas marcadas NOT NULL (ex.: email)
  // que não fazem parte do esquema atual e remove SOMENTE essa obrigatoriedade.
  // Nenhuma coluna e nenhum registro é apagado.
  const currentUserColumns = new Set([
    'id','username','password_hash','name','role','active',
    'permissions','created_at','updated_at'
  ]);
  const legacyCols = await pool.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name='app_users'
       AND is_nullable='NO'
  `);
  for (const row of legacyCols.rows) {
    const col = row.column_name;
    if (!currentUserColumns.has(col) && col !== 'id') {
      const safeCol = '"' + String(col).replace(/"/g, '""') + '"';
      await pool.query(`ALTER TABLE app_users ALTER COLUMN ${safeCol} DROP NOT NULL`);
      console.log(`Migração: restrição NOT NULL legada removida de app_users.${col}.`);
    }
  }

  // Índice único somente para usernames preenchidos.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_unique
                    ON app_users (LOWER(username)) WHERE username IS NOT NULL`);

  // Cria admin apenas se ainda não existir usuário "admin".
  const admin = await pool.query(`SELECT id FROM app_users WHERE LOWER(username)='admin' LIMIT 1`);
  if (!admin.rowCount) {
    const adminId = crypto.randomUUID();
    const adminHash = hashPassword(process.env.ADMIN_PASSWORD || 'Vale@2026');
    if (await columnExists('app_users', 'nome')) {
      await pool.query(
        `INSERT INTO app_users(id,username,password_hash,name,nome,role,active,permissions)
         VALUES($1,'admin',$2,'Administrador','Administrador','administrador',TRUE,$3::jsonb)`,
        [adminId, adminHash, JSON.stringify(['*'])]
      );
    } else {
      await pool.query(
        `INSERT INTO app_users(id,username,password_hash,name,role,active,permissions)
         VALUES($1,'admin',$2,'Administrador','administrador',TRUE,$3::jsonb)`,
        [adminId, adminHash, JSON.stringify(['*'])]
      );
    }
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
async function optionalAuth(req,res,next){
  try {
    const h=req.headers.authorization||'', t=h.startsWith('Bearer ')?h.slice(7):'';
    if(!t) return next();
    const r=await pool.query(`SELECT s.user_id,u.username,u.name,u.role,u.active,u.permissions
      FROM app_sessions s LEFT JOIN app_users u ON u.id::text=s.user_id
      WHERE s.token=$1 AND s.expires_at>NOW() LIMIT 1`,[t]);
    if(r.rowCount) req.user=r.rows[0];
  } catch(e) {}
  next();
}

function adminOnly(req,res,next){
  if(req.user.role !== 'administrador')
    return res.status(403).json({ok:false,error:'Somente administrador'});
  next();
}
function hasPermission(permission){
  return function(req,res,next){
    if(req.user?.role === 'administrador') return next();
    const perms=Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    if(!perms.includes(permission))
      return res.status(403).json({ok:false,error:'Sem permissão para esta função'});
    next();
  };
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
    await pool.query(`INSERT INTO app_sessions(token,token_hash,user_id,expires_at)
                      VALUES($1,$1,$2,NOW()+INTERVAL '12 hours')`,[t,String(u.id)]);
    await audit({user_id:String(u.id),username:u.username},'LOGIN');
    res.json({ok:true,token:t,user:{id:String(u.id),username:u.username,name:u.name,role:u.role,permissions:u.permissions}});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.get('/api/me',auth,async(req,res)=>{
  res.json({ok:true,user:{id:req.user.user_id,username:req.user.username,name:req.user.name,role:req.user.role,permissions:req.user.permissions}});
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

app.put('/api/state', optionalAuth, async (req,res)=>{
  try {
    const data=req.body?.data;
    if(!data || typeof data!=='object') return res.status(400).json({ok:false,error:'Dados inválidos'});
    await pool.query(`INSERT INTO app_state(id,data,updated_at)
      VALUES('vale-da-serra',$1::jsonb,NOW())
      ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,
      [JSON.stringify(data)]);
    if(req.user) await audit(req.user,'DADOS_SISTEMA_ATUALIZADOS',{origem:'app_state'});
    res.json({ok:true});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.use(express.static(__dirname));
app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'index.html')));

initDb()
  .then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Vale da Serra online na porta ${PORT}`)))
  .catch(err=>{ console.error('Falha ao iniciar banco:',err); process.exit(1); });
