const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não configurada.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(express.json({ limit: '20mb' }));

const PERMISSOES = {
  administrador:['painel','novaEntrada','editarRecebimentos','importarpdf','produtores','pesquisa','pagamentos','fechamento','debitos','relatorios','alertaswhats','auditoria','backup','servidor','configuracoes'],
  tanqueiro:['painel','novaEntrada','editarRecebimentos','pesquisa'],
  financeiro:['painel','pesquisa','pagamentos','fechamento','debitos','relatorios'],
  galpao:['painel'],
  consulta:['painel','pesquisa','relatorios']
};

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, nome TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'consulta', ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_audit (
    id BIGSERIAL PRIMARY KEY, user_id UUID, username TEXT, acao TEXT NOT NULL, detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM app_users');
  if (r.rows[0].n === 0) {
    const hash = await bcrypt.hash('Vale@2026', 12);
    await pool.query(`INSERT INTO app_users(id,username,password_hash,nome,role,ativo) VALUES($1,'admin',$2,'Administrador','administrador',TRUE)`, [crypto.randomUUID(), hash]);
    console.log('Usuário inicial criado: admin');
  }
}
function hashToken(t){ return crypto.createHash('sha256').update(t).digest('hex'); }
async function audit(user, acao, detalhes={}) { try { await pool.query('INSERT INTO app_audit(user_id,username,acao,detalhes) VALUES($1,$2,$3,$4::jsonb)', [user?.id||null,user?.username||null,acao,JSON.stringify(detalhes)]); } catch(e){ console.error('Auditoria:',e.message); } }
async function auth(req,res,next){
  try{
    const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!raw) return res.status(401).json({ok:false,error:'Sessão não informada'});
    const r=await pool.query(`SELECT u.id,u.username,u.nome,u.role,u.ativo FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()`,[hashToken(raw)]);
    if(!r.rowCount || !r.rows[0].ativo) return res.status(401).json({ok:false,error:'Sessão inválida'});
    req.user=r.rows[0]; next();
  }catch(e){res.status(500).json({ok:false,error:e.message});}
}
function adminOnly(req,res,next){ if(req.user.role!=='administrador') return res.status(403).json({ok:false,error:'Acesso somente para administrador'}); next(); }

app.get('/api/health', async (_req,res)=>{ try{const r=await pool.query('SELECT NOW() AS now');res.json({ok:true,db:true,now:r.rows[0].now});}catch(e){res.status(500).json({ok:false,error:e.message});} });
app.post('/api/login', async (req,res)=>{
  try{
    const username=String(req.body?.username||'').trim(); const password=String(req.body?.password||'');
    const r=await pool.query('SELECT * FROM app_users WHERE lower(username)=lower($1)',[username]);
    if(!r.rowCount || !r.rows[0].ativo || !(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({ok:false,error:'Usuário ou senha incorretos'});
    const u=r.rows[0], token=crypto.randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '12 hours')`,[hashToken(token),u.id]);
    await audit(u,'LOGIN');
    res.json({ok:true,token,user:{id:u.id,username:u.username,nome:u.nome,role:u.role,permissoes:PERMISSOES[u.role]||[]}});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/logout',auth,async(req,res)=>{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');await pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[hashToken(raw)]);await audit(req.user,'LOGOUT');res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json({ok:true,user:{...req.user,permissoes:PERMISSOES[req.user.role]||[]}}));

app.get('/api/state',auth,async(req,res)=>{try{const r=await pool.query("SELECT data,updated_at FROM app_state WHERE id='vale-da-serra'");if(!r.rowCount)return res.json({ok:true,exists:false,data:null});res.json({ok:true,exists:true,data:r.rows[0].data,updatedAt:r.rows[0].updated_at});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.put('/api/state',auth,async(req,res)=>{try{const data=req.body?.data;if(!data||typeof data!=='object')return res.status(400).json({ok:false,error:'Dados inválidos'});await pool.query(`INSERT INTO app_state(id,data,updated_at) VALUES('vale-da-serra',$1::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,[JSON.stringify(data)]);await audit(req.user,'SINCRONIZOU_DADOS');res.json({ok:true});}catch(e){res.status(500).json({ok:false,error:e.message});}});

app.get('/api/users',auth,adminOnly,async(_req,res)=>{const r=await pool.query('SELECT id,username,nome,role,ativo,created_at,updated_at FROM app_users ORDER BY nome');res.json({ok:true,users:r.rows});});
app.post('/api/users',auth,adminOnly,async(req,res)=>{try{const {username,nome,role,password}=req.body||{};if(!username||!nome||!password)return res.status(400).json({ok:false,error:'Preencha usuário, nome e senha'});if(!PERMISSOES[role])return res.status(400).json({ok:false,error:'Perfil inválido'});const hash=await bcrypt.hash(String(password),12);const id=crypto.randomUUID();await pool.query('INSERT INTO app_users(id,username,password_hash,nome,role,ativo) VALUES($1,$2,$3,$4,$5,TRUE)',[id,String(username).trim(),hash,String(nome).trim(),role]);await audit(req.user,'CRIOU_USUARIO',{username,role});res.json({ok:true,id});}catch(e){res.status(e.code==='23505'?409:500).json({ok:false,error:e.code==='23505'?'Este usuário já existe':e.message});}});
app.put('/api/users/:id',auth,adminOnly,async(req,res)=>{try{const {username,nome,role,ativo,password}=req.body||{};if(!PERMISSOES[role])return res.status(400).json({ok:false,error:'Perfil inválido'});await pool.query('UPDATE app_users SET username=$1,nome=$2,role=$3,ativo=$4,updated_at=NOW() WHERE id=$5',[String(username).trim(),String(nome).trim(),role,ativo!==false,req.params.id]);if(password)await pool.query('UPDATE app_users SET password_hash=$1,updated_at=NOW() WHERE id=$2',[await bcrypt.hash(String(password),12),req.params.id]);await audit(req.user,'EDITOU_USUARIO',{id:req.params.id,username,role,ativo});res.json({ok:true});}catch(e){res.status(e.code==='23505'?409:500).json({ok:false,error:e.code==='23505'?'Este usuário já existe':e.message});}});
app.get('/api/audit',auth,adminOnly,async(req,res)=>{const r=await pool.query('SELECT id,username,acao,detalhes,created_at FROM app_audit ORDER BY id DESC LIMIT 300');res.json({ok:true,logs:r.rows});});

app.use(express.static(__dirname));
app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'index.html')));
initDb().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Vale da Serra online na porta ${PORT}`))).catch(err=>{console.error('Falha ao iniciar banco:',err);process.exit(1);});
