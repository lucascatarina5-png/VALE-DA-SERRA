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
  if (!stored) return false;
  const value=String(stored);
  // Compatibilidade com usuários criados por versões antigas que salvaram senha em texto.
  // Após um login válido, a rota /api/login converte automaticamente para hash PBKDF2.
  if (!value.includes(':')) return String(password) === value;
  const [salt] = value.split(':');
  const candidate = hashPassword(password, salt);
  const a=Buffer.from(candidate), b=Buffer.from(value);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
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


  await pool.query(`CREATE TABLE IF NOT EXISTS app_inventory_products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'kg',
    min_stock NUMERIC NOT NULL DEFAULT 0,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_inventory_movements (
    id BIGSERIAL PRIMARY KEY,
    product_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('entrada','saida')),
    quantity NUMERIC NOT NULL CHECK(quantity > 0),
    unit_price NUMERIC NOT NULL DEFAULT 0,
    producer_id TEXT,
    producer_name TEXT,
    destination TEXT,
    user_id TEXT,
    username TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);


  // V14 - Loja / PDV (migração aditiva: preserva todos os dados existentes)
  await pool.query(`CREATE TABLE IF NOT EXISTS app_store_products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT '', unit TEXT NOT NULL DEFAULT 'un',
    cost_price NUMERIC NOT NULL DEFAULT 0, sale_price NUMERIC NOT NULL DEFAULT 0,
    stock NUMERIC NOT NULL DEFAULT 0, min_stock NUMERIC NOT NULL DEFAULT 0,
    photo TEXT, variant TEXT DEFAULT '', package_value NUMERIC NOT NULL DEFAULT 0, package_unit TEXT DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE app_store_products ADD COLUMN IF NOT EXISTS variant TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE app_store_products ADD COLUMN IF NOT EXISTS package_value NUMERIC NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE app_store_products ADD COLUMN IF NOT EXISTS package_unit TEXT DEFAULT ''`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_store_sales (
    id TEXT PRIMARY KEY, total NUMERIC NOT NULL DEFAULT 0, payment_method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'concluida', user_id TEXT, username TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), cancelled_at TIMESTAMPTZ, cancelled_by TEXT
  )`);
  await pool.query(`ALTER TABLE app_store_sales ADD COLUMN IF NOT EXISTS customer_name TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE app_store_sales ADD COLUMN IF NOT EXISTS correction_reason TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE app_store_sales ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE app_store_sales ADD COLUMN IF NOT EXISTS corrected_by TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE app_store_sales ADD COLUMN IF NOT EXISTS cancel_reason TEXT DEFAULT ''`);

  await pool.query(`CREATE TABLE IF NOT EXISTS app_store_stock_movements (
    id BIGSERIAL PRIMARY KEY, product_id TEXT NOT NULL, product_name TEXT NOT NULL,
    movement_type TEXT NOT NULL, quantity_before NUMERIC NOT NULL, quantity_change NUMERIC NOT NULL,
    quantity_after NUMERIC NOT NULL, reason TEXT DEFAULT '', note TEXT DEFAULT '',
    user_id TEXT, username TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_store_sale_items (
    id BIGSERIAL PRIMARY KEY, sale_id TEXT NOT NULL, product_id TEXT NOT NULL,
    product_name TEXT NOT NULL, quantity NUMERIC NOT NULL, unit_price NUMERIC NOT NULL,
    cost_price NUMERIC NOT NULL DEFAULT 0, subtotal NUMERIC NOT NULL
  )`);

  // V20 - Abertura e fechamento de caixa
  await pool.query(`CREATE TABLE IF NOT EXISTS app_store_cash_sessions (
    id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'aberto', opening_amount NUMERIC NOT NULL DEFAULT 0,
    closing_counted NUMERIC, expected_cash NUMERIC, difference NUMERIC, opening_note TEXT DEFAULT '', closing_note TEXT DEFAULT '',
    opened_by_id TEXT, opened_by TEXT, opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_by_id TEXT, closed_by TEXT, closed_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_store_cash_movements (
    id BIGSERIAL PRIMARY KEY, session_id TEXT NOT NULL, movement_type TEXT NOT NULL, amount NUMERIC NOT NULL,
    reason TEXT DEFAULT '', note TEXT DEFAULT '', user_id TEXT, username TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE app_store_sales ADD COLUMN IF NOT EXISTS cash_session_id TEXT`);

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
    const u=r.rows[0];
    // Se veio de uma versão antiga com senha sem hash, atualiza de forma transparente.
    if(u.password_hash && !String(u.password_hash).includes(':')){
      await pool.query(`UPDATE app_users SET password_hash=$2,updated_at=NOW() WHERE id::text=$1`,
        [String(u.id),hashPassword(password)]);
    }
    const t=token();
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
    const verify=await pool.query(`SELECT password_hash FROM app_users WHERE id::text=$1 LIMIT 1`,[id]);
    if(!verify.rowCount || !checkPassword(password,verify.rows[0].password_hash))
      throw new Error('Falha ao validar a senha do novo usuário');
    await audit(req.user,'USUARIO_CRIADO',{username:String(username).trim(),role});
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


app.get('/api/inventory/products',auth,hasPermission('estoque'),async(req,res)=>{
  try{
    const r=await pool.query(`SELECT p.*,
      COALESCE(SUM(CASE WHEN m.type='entrada' THEN m.quantity ELSE -m.quantity END),0) AS balance
      FROM app_inventory_products p
      LEFT JOIN app_inventory_movements m ON m.product_id=p.id
      WHERE p.active=TRUE GROUP BY p.id ORDER BY p.name`);
    res.json({ok:true,products:r.rows});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/inventory/products',auth,hasPermission('estoque'),async(req,res)=>{
  const client=await pool.connect();
  try{
    const {name,unit='kg',min_stock=0,unit_price=0,initial_quantity=0}=req.body||{};
    if(!String(name||'').trim()) return res.status(400).json({ok:false,error:'Informe o produto'});
    const initial=Number(initial_quantity)||0;
    if(initial<0) return res.status(400).json({ok:false,error:'Quantidade inicial inválida'});
    const id=crypto.randomUUID(); await client.query('BEGIN');
    await client.query(`INSERT INTO app_inventory_products(id,name,unit,min_stock,unit_price) VALUES($1,$2,$3,$4,$5)`,[id,String(name).trim(),unit,Number(min_stock)||0,Number(unit_price)||0]);
    if(initial>0) await client.query(`INSERT INTO app_inventory_movements (product_id,type,quantity,unit_price,destination,user_id,username) VALUES($1,'entrada',$2,$3,$4,$5,$6)`,[id,initial,Number(unit_price)||0,'Estoque inicial no cadastro',req.user.user_id||null,req.user.username||null]);
    await client.query('COMMIT'); await audit(req.user,'ESTOQUE_PRODUTO_CRIADO',{id,name,initial_quantity:initial}); res.json({ok:true,id});
  }catch(e){try{await client.query('ROLLBACK')}catch(_){} res.status(500).json({ok:false,error:e.message});} finally{client.release();}
});

app.get('/api/inventory/movements',auth,hasPermission('estoque'),async(req,res)=>{
  try{
    const r=await pool.query(`SELECT m.*,p.name AS product_name,p.unit
      FROM app_inventory_movements m
      JOIN app_inventory_products p ON p.id=m.product_id
      ORDER BY m.created_at DESC LIMIT 1000`);
    res.json({ok:true,movements:r.rows});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/inventory/movements',auth,hasPermission('estoque'),async(req,res)=>{
  const client=await pool.connect();
  try{
    const {product_id,type,quantity,unit_price=0,producer_id,producer_name,destination}=req.body||{};
    const q=Number(quantity);
    if(!product_id || !['entrada','saida'].includes(type) || !(q>0))
      return res.status(400).json({ok:false,error:'Movimentação inválida'});
    await client.query('BEGIN');
    if(type==='saida'){
      const bal=await client.query(`SELECT COALESCE(SUM(CASE WHEN type='entrada' THEN quantity ELSE -quantity END),0) balance
        FROM app_inventory_movements WHERE product_id=$1`,[product_id]);
      if(Number(bal.rows[0].balance)<q){
        await client.query('ROLLBACK');
        return res.status(409).json({ok:false,error:'Estoque insuficiente para esta saída'});
      }
    }
    await client.query(`INSERT INTO app_inventory_movements
      (product_id,type,quantity,unit_price,producer_id,producer_name,destination,user_id,username)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [product_id,type,q,Number(unit_price)||0,producer_id||null,producer_name||null,destination||null,
       req.user.user_id||null,req.user.username||null]);
    await client.query('COMMIT');
    await audit(req.user,type==='entrada'?'ESTOQUE_ENTRADA':'ESTOQUE_SAIDA',
      {product_id,quantity:q,producer_id:producer_id||null,producer_name:producer_name||null,destination:destination||null});
    res.json({ok:true});
  }catch(e){
    try{await client.query('ROLLBACK')}catch(_){}
    res.status(500).json({ok:false,error:e.message});
  }finally{client.release();}
});


// V14 - API Loja / PDV
app.get('/api/store/products',auth,hasPermission('loja'),async(req,res)=>{try{
  const r=await pool.query(`SELECT * FROM app_store_products WHERE active=TRUE ORDER BY name`);
  res.json({ok:true,products:r.rows});
}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.post('/api/store/products',auth,hasPermission('loja'),async(req,res)=>{try{
  const b=req.body||{}, id=crypto.randomUUID(); if(!String(b.name||'').trim()) return res.status(400).json({ok:false,error:'Informe o nome do produto'});
  await pool.query(`INSERT INTO app_store_products(id,name,category,unit,cost_price,sale_price,stock,min_stock,photo,variant,package_value,package_unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
   [id,String(b.name).trim(),b.category||'',b.unit||'un',Number(b.cost_price)||0,Number(b.sale_price)||0,Number(b.stock)||0,Number(b.min_stock)||0,b.photo||null,b.variant||'',Number(b.package_value)||0,b.package_unit||'']);
  await audit(req.user,'LOJA_PRODUTO_CRIADO',{id,name:b.name,stock:Number(b.stock)||0}); res.json({ok:true,id});
}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.put('/api/store/products/:id',auth,hasPermission('loja'),async(req,res)=>{try{
 const b=req.body||{}; await pool.query(`UPDATE app_store_products SET name=$2,category=$3,unit=$4,cost_price=$5,sale_price=$6,min_stock=$7,photo=COALESCE($8,photo),variant=$9,package_value=$10,package_unit=$11,updated_at=NOW() WHERE id=$1`,
 [req.params.id,b.name,b.category||'',b.unit||'un',Number(b.cost_price)||0,Number(b.sale_price)||0,Number(b.min_stock)||0,b.photo||null,b.variant||'',Number(b.package_value)||0,b.package_unit||'']);
 await audit(req.user,'LOJA_PRODUTO_EDITADO',{id:req.params.id}); res.json({ok:true});
}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.delete('/api/store/products/:id',auth,hasPermission('loja'),async(req,res)=>{try{
 const r=await pool.query(`UPDATE app_store_products SET active=FALSE,updated_at=NOW() WHERE id=$1 AND active=TRUE RETURNING id,name`,[req.params.id]);
 if(!r.rowCount) return res.status(404).json({ok:false,error:'Produto não encontrado'});
 await audit(req.user,'LOJA_PRODUTO_EXCLUIDO',{id:req.params.id,name:r.rows[0].name}); res.json({ok:true});
}catch(e){res.status(500).json({ok:false,error:e.message})}});

app.post('/api/store/stock',auth,hasPermission('loja'),async(req,res)=>{const c=await pool.connect();try{
 const {product_id,quantity,mode='delta',reason='',note=''}=req.body||{}; const q=Number(quantity); if(!product_id||!Number.isFinite(q)) return res.status(400).json({ok:false,error:'Dados inválidos'});
 await c.query('BEGIN'); const pr=await c.query(`SELECT id,name,stock FROM app_store_products WHERE id=$1 AND active=TRUE FOR UPDATE`,[product_id]);
 if(!pr.rowCount) throw new Error('Produto não encontrado'); const before=Number(pr.rows[0].stock); let after,change,type;
 if(mode==='set'){if(q<0) throw new Error('O estoque não pode ser negativo'); after=q;change=after-before;type='contagem';}
 else {if(q===0) throw new Error('Informe uma quantidade diferente de zero');after=before+q;if(after<0) throw new Error('Estoque insuficiente');change=q;type=q>0?'entrada':'retirada';}
 await c.query(`UPDATE app_store_products SET stock=$2,updated_at=NOW() WHERE id=$1`,[product_id,after]);
 await c.query(`INSERT INTO app_store_stock_movements(product_id,product_name,movement_type,quantity_before,quantity_change,quantity_after,reason,note,user_id,username) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[product_id,pr.rows[0].name,type,before,change,after,String(reason||''),String(note||''),req.user.user_id||null,req.user.username||null]);
 await c.query('COMMIT'); await audit(req.user,'LOJA_AJUSTE_ESTOQUE',{product_id,mode,before,change,after,reason}); res.json({ok:true,stock:after});
}catch(e){try{await c.query('ROLLBACK')}catch(_){} res.status(400).json({ok:false,error:e.message})}finally{c.release()}});
app.get('/api/store/stock-history',auth,hasPermission('loja'),async(req,res)=>{try{const r=await pool.query(`SELECT * FROM app_store_stock_movements ORDER BY created_at DESC LIMIT 500`);res.json({ok:true,movements:r.rows})}catch(e){res.status(500).json({ok:false,error:e.message})}});

// V20 - Caixa do PDV
app.get('/api/store/cash/status',auth,hasPermission('loja'),async(req,res)=>{try{
 const r=await pool.query(`SELECT * FROM app_store_cash_sessions WHERE status='aberto' AND opened_by=$1 ORDER BY opened_at DESC LIMIT 1`,[req.user.username]);
 if(!r.rowCount)return res.json({ok:true,session:null}); const x=r.rows[0];
 const sales=await pool.query(`SELECT payment_method,COALESCE(SUM(total),0) total,COUNT(*) qtd FROM app_store_sales WHERE cash_session_id=$1 AND status<>'cancelada' GROUP BY payment_method`,[x.id]);
 const mov=await pool.query(`SELECT COALESCE(SUM(CASE WHEN movement_type='suprimento' THEN amount ELSE -amount END),0) net FROM app_store_cash_movements WHERE session_id=$1`,[x.id]);
 const cashSales=Number((sales.rows.find(a=>a.payment_method==='dinheiro')||{}).total||0); const expected=Number(x.opening_amount)+cashSales+Number(mov.rows[0].net||0);
 res.json({ok:true,session:{...x,expected_cash:expected,sales:sales.rows}});
}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.post('/api/store/cash/open',auth,hasPermission('loja'),async(req,res)=>{try{
 const ex=await pool.query(`SELECT id FROM app_store_cash_sessions WHERE status='aberto' AND opened_by=$1 LIMIT 1`,[req.user.username]); if(ex.rowCount)return res.status(400).json({ok:false,error:'Você já possui um caixa aberto.'});
 const amount=Number(req.body?.opening_amount||0); if(!(amount>=0))return res.status(400).json({ok:false,error:'Valor inicial inválido'}); const id=crypto.randomUUID();
 await pool.query(`INSERT INTO app_store_cash_sessions(id,opening_amount,opening_note,opened_by_id,opened_by) VALUES($1,$2,$3,$4,$5)`,[id,amount,String(req.body?.note||''),req.user.user_id||null,req.user.username]); await audit(req.user,'CAIXA_ABERTO',{id,opening_amount:amount}); res.json({ok:true,id});
}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post('/api/store/cash/movement',auth,hasPermission('loja'),async(req,res)=>{try{
 const {type,amount,reason,note}=req.body||{}; if(!['suprimento','sangria'].includes(type)||!(Number(amount)>0))return res.status(400).json({ok:false,error:'Movimentação inválida'});
 const r=await pool.query(`SELECT id FROM app_store_cash_sessions WHERE status='aberto' AND opened_by=$1 ORDER BY opened_at DESC LIMIT 1`,[req.user.username]); if(!r.rowCount)return res.status(400).json({ok:false,error:'Abra o caixa primeiro.'});
 await pool.query(`INSERT INTO app_store_cash_movements(session_id,movement_type,amount,reason,note,user_id,username) VALUES($1,$2,$3,$4,$5,$6,$7)`,[r.rows[0].id,type,Number(amount),String(reason||''),String(note||''),req.user.user_id||null,req.user.username]); await audit(req.user,'CAIXA_MOVIMENTO',{session_id:r.rows[0].id,type,amount:Number(amount)});res.json({ok:true});
}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post('/api/store/cash/close',auth,hasPermission('loja'),async(req,res)=>{const c=await pool.connect();try{
 await c.query('BEGIN'); const r=await c.query(`SELECT * FROM app_store_cash_sessions WHERE status='aberto' AND opened_by=$1 ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,[req.user.username]); if(!r.rowCount)throw new Error('Nenhum caixa aberto.'); const x=r.rows[0];
 const cs=await c.query(`SELECT COALESCE(SUM(total),0) total FROM app_store_sales WHERE cash_session_id=$1 AND status<>'cancelada' AND payment_method='dinheiro'`,[x.id]); const mv=await c.query(`SELECT COALESCE(SUM(CASE WHEN movement_type='suprimento' THEN amount ELSE -amount END),0) net FROM app_store_cash_movements WHERE session_id=$1`,[x.id]);
 const expected=Number(x.opening_amount)+Number(cs.rows[0].total)+Number(mv.rows[0].net); const counted=Number(req.body?.counted_amount); if(!(counted>=0))throw new Error('Informe o valor contado no caixa.'); const diff=counted-expected;
 await c.query(`UPDATE app_store_cash_sessions SET status='fechado',closing_counted=$2,expected_cash=$3,difference=$4,closing_note=$5,closed_by_id=$6,closed_by=$7,closed_at=NOW() WHERE id=$1`,[x.id,counted,expected,diff,String(req.body?.note||''),req.user.user_id||null,req.user.username]); await c.query('COMMIT'); await audit(req.user,'CAIXA_FECHADO',{id:x.id,expected,counted,difference:diff});res.json({ok:true,id:x.id,expected_cash:expected,counted_amount:counted,difference:diff});
}catch(e){try{await c.query('ROLLBACK')}catch(_){}res.status(400).json({ok:false,error:e.message})}finally{c.release()}});
app.get('/api/store/cash/history',auth,hasPermission('loja'),async(req,res)=>{try{const r=await pool.query(`SELECT * FROM app_store_cash_sessions ORDER BY opened_at DESC LIMIT 200`);res.json({ok:true,sessions:r.rows})}catch(e){res.status(500).json({ok:false,error:e.message})}});

app.post('/api/store/sales',auth,hasPermission('loja'),async(req,res)=>{
 const c=await pool.connect(); try{const {items,payment_method,customer_name}=req.body||{}; if(!Array.isArray(items)||!items.length) return res.status(400).json({ok:false,error:'Venda sem produtos'}); const sx=await c.query(`SELECT id FROM app_store_cash_sessions WHERE status='aberto' AND opened_by=$1 ORDER BY opened_at DESC LIMIT 1`,[req.user.username]); if(!sx.rowCount) return res.status(400).json({ok:false,error:'Abra o caixa antes de iniciar as vendas.'}); const cashSessionId=sx.rows[0].id;
  if(!['pix','dinheiro','cartao','fiado'].includes(payment_method)) return res.status(400).json({ok:false,error:'Forma de pagamento inválida'});
  await c.query('BEGIN'); const id=crypto.randomUUID(); let total=0;
  const prepared=[]; for(const it of items){const q=Number(it.quantity); if(!(q>0)) throw new Error('Quantidade inválida');
   const pr=await c.query(`SELECT * FROM app_store_products WHERE id=$1 AND active=TRUE FOR UPDATE`,[it.product_id]); if(!pr.rowCount) throw new Error('Produto não encontrado'); const p=pr.rows[0];
   if(Number(p.stock)<q) throw new Error(`Estoque insuficiente: ${p.name}`); const unitPrice=(it.unit_price!==undefined&&it.unit_price!==null&&it.unit_price!=='')?Number(it.unit_price):Number(p.sale_price); if(!(unitPrice>=0)) throw new Error('Valor de venda inválido'); const sub=q*unitPrice; total+=sub; prepared.push([p,q,sub,unitPrice]);}
  await c.query(`INSERT INTO app_store_sales(id,total,payment_method,user_id,username,customer_name,cash_session_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,total,payment_method,req.user.user_id||null,req.user.username||null,String(customer_name||'').trim(),cashSessionId]);
  for(const [p,q,sub,unitPrice] of prepared){await c.query(`UPDATE app_store_products SET stock=stock-$2,updated_at=NOW() WHERE id=$1`,[p.id,q]); await c.query(`INSERT INTO app_store_sale_items(sale_id,product_id,product_name,quantity,unit_price,cost_price,subtotal) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,p.id,p.name,q,unitPrice,p.cost_price,sub]);}
  await c.query('COMMIT'); await audit(req.user,'LOJA_VENDA',{id,total,payment_method,customer_name:String(customer_name||'').trim()}); res.json({ok:true,id,total});
 }catch(e){try{await c.query('ROLLBACK')}catch(_){} res.status(400).json({ok:false,error:e.message})}finally{c.release()}
});
app.get('/api/store/sales',auth,hasPermission('loja'),async(req,res)=>{try{
 const days=Math.max(1,Math.min(365,Number(req.query.days)||7)); const includeCancelled=req.user.role==='administrador' && String(req.query.audit||'')==='1';
 const r=await pool.query(`SELECT s.*,COALESCE(json_agg(json_build_object('product_id',i.product_id,'product_name',i.product_name,'quantity',i.quantity,'unit_price',i.unit_price,'subtotal',i.subtotal)) FILTER (WHERE i.id IS NOT NULL),'[]') items FROM app_store_sales s LEFT JOIN app_store_sale_items i ON i.sale_id=s.id WHERE s.created_at >= NOW()-($1::text||' days')::interval ${includeCancelled?'':"AND s.status<>'cancelada'"} GROUP BY s.id ORDER BY s.created_at DESC`,[days]); res.json({ok:true,sales:r.rows,is_admin:req.user.role==='administrador'});
}catch(e){res.status(500).json({ok:false,error:e.message})}});

// V21 - correção/cancelamento de vendas: exclusivo do administrador e sempre auditado
app.put('/api/store/sales/:id/admin-correct',auth,adminOnly,async(req,res)=>{const c=await pool.connect();try{
 const b=req.body||{}, reason=String(b.reason||'').trim(); if(!reason) throw new Error('Informe o motivo da correção.');
 if(!Array.isArray(b.items)||!b.items.length) throw new Error('A venda precisa ter pelo menos um produto.');
 if(!['pix','dinheiro','cartao','fiado'].includes(b.payment_method)) throw new Error('Forma de pagamento inválida.');
 await c.query('BEGIN'); const sr=await c.query(`SELECT * FROM app_store_sales WHERE id=$1 FOR UPDATE`,[req.params.id]);
 if(!sr.rowCount||sr.rows[0].status==='cancelada') throw new Error('Venda inválida ou cancelada.');
 const oldItems=(await c.query(`SELECT * FROM app_store_sale_items WHERE sale_id=$1 ORDER BY id`,[req.params.id])).rows;
 const before={sale:sr.rows[0],items:oldItems};
 for(const i of oldItems) await c.query(`UPDATE app_store_products SET stock=stock+$2,updated_at=NOW() WHERE id=$1`,[i.product_id,i.quantity]);
 let total=0, prepared=[];
 for(const it of b.items){const q=Number(it.quantity), up=Number(it.unit_price);if(!(q>0)||!(up>=0))throw new Error('Quantidade ou preço inválido.');
   const pr=await c.query(`SELECT * FROM app_store_products WHERE id=$1 AND active=TRUE FOR UPDATE`,[it.product_id]);if(!pr.rowCount)throw new Error('Produto não encontrado.');const x=pr.rows[0];if(Number(x.stock)<q)throw new Error(`Estoque insuficiente: ${x.name}`);prepared.push([x,q,up,q*up]);total+=q*up;}
 await c.query(`DELETE FROM app_store_sale_items WHERE sale_id=$1`,[req.params.id]);
 for(const [x,q,up,sub] of prepared){await c.query(`UPDATE app_store_products SET stock=stock-$2,updated_at=NOW() WHERE id=$1`,[x.id,q]);await c.query(`INSERT INTO app_store_sale_items(sale_id,product_id,product_name,quantity,unit_price,cost_price,subtotal) VALUES($1,$2,$3,$4,$5,$6,$7)`,[req.params.id,x.id,x.name,q,up,x.cost_price,sub]);}
 await c.query(`UPDATE app_store_sales SET total=$2,payment_method=$3,customer_name=$4,correction_reason=$5,corrected_at=NOW(),corrected_by=$6 WHERE id=$1`,[req.params.id,total,b.payment_method,String(b.customer_name||'').trim(),reason,req.user.username]);
 await c.query('COMMIT'); await audit(req.user,'LOJA_VENDA_CORRIGIDA',{id:req.params.id,reason,before,after:{total,payment_method:b.payment_method,customer_name:String(b.customer_name||'').trim(),items:b.items}});res.json({ok:true,total});
}catch(e){try{await c.query('ROLLBACK')}catch(_){}res.status(400).json({ok:false,error:e.message})}finally{c.release()}});

app.post('/api/store/sales/:id/cancel',auth,adminOnly,async(req,res)=>{const c=await pool.connect();try{
 const reason=String(req.body?.reason||'').trim();if(!reason)throw new Error('Informe o motivo do cancelamento.');
 await c.query('BEGIN'); const s=await c.query(`SELECT * FROM app_store_sales WHERE id=$1 FOR UPDATE`,[req.params.id]); if(!s.rowCount||s.rows[0].status==='cancelada') throw new Error('Venda inválida ou já cancelada'); const its=await c.query(`SELECT * FROM app_store_sale_items WHERE sale_id=$1`,[req.params.id]); for(const i of its.rows) await c.query(`UPDATE app_store_products SET stock=stock+$2,updated_at=NOW() WHERE id=$1`,[i.product_id,i.quantity]); await c.query(`UPDATE app_store_sales SET status='cancelada',cancelled_at=NOW(),cancelled_by=$2,cancel_reason=$3 WHERE id=$1`,[req.params.id,req.user.username,reason]); await c.query('COMMIT'); await audit(req.user,'LOJA_VENDA_CANCELADA',{id:req.params.id,reason,total:s.rows[0].total,payment_method:s.rows[0].payment_method}); res.json({ok:true});
}catch(e){try{await c.query('ROLLBACK')}catch(_){} res.status(400).json({ok:false,error:e.message})}finally{c.release()}});

// PWA: tipos corretos e atualização imediata do manifest/service worker
app.get('/manifest.webmanifest',(_req,res)=>{
  res.type('application/manifest+json');
  res.set('Cache-Control','no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname,'manifest.webmanifest'));
});
app.get('/sw.js',(_req,res)=>{
  res.type('application/javascript');
  res.set('Cache-Control','no-cache, no-store, must-revalidate');
  res.set('Service-Worker-Allowed','/');
  res.sendFile(path.join(__dirname,'sw.js'));
});
app.get(['/','/index.html'],(_req,res)=>{
  res.set('Cache-Control','no-cache');
  res.sendFile(path.join(__dirname,'index.html'));
});
app.get('/mobile.html',(_req,res)=>{
  res.set('Cache-Control','no-cache');
  res.sendFile(path.join(__dirname,'mobile.html'));
});
app.use(express.static(__dirname,{maxAge:'1h'}));
app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'index.html')));

initDb()
  .then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Vale da Serra online na porta ${PORT}`)))
  .catch(err=>{ console.error('Falha ao iniciar banco:',err); process.exit(1); });
