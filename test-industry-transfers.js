'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const Transfers=require('./industry-transfers');
let db,server,base,pool;
const users={admin:{user_id:'a',username:'admin',name:'Administrador',role:'administrador'},warehouse:{user_id:'w',username:'conferente',name:'Conferente',role:'usuario',permissions:['estoque']},viewer:{user_id:'v',role:'consulta',permissions:[]}};
async function request(path,body,user='warehouse',method=body?'POST':'GET'){
 const r=await fetch(base+'/api/industry-transfers'+path,{method,headers:{'Content-Type':'application/json',Authorization:user},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};
}
async function balance(){return Number((await pool.query("SELECT COALESCE(SUM(CASE WHEN type='entrada' THEN quantity ELSE -quantity END),0) balance FROM app_inventory_movements")).rows[0].balance)}
const send=(overrides={})=>({request_key:require('crypto').randomUUID(),sender:'Ana',carrier:'João',notes:'Lote 23',items:[{product_id:'cheese',sent:10.125}],...overrides});
const receive=(t,n,extra={})=>({revision:t.revision,receiver:'Maria',notes:n===10.125?'':'Peso conferido diferente do envio',items:[{product_id:'cheese',received:n}],...extra});
before(async()=>{
 db=new PGlite();pool={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}},connect:async()=>({...pool,release(){}})};
 // O esquema mínimo reproduz as tabelas já existentes do Galpão; as tabelas novas vêm da migração real.
 await db.exec(`CREATE TABLE app_inventory_products(id TEXT PRIMARY KEY,name TEXT,unit TEXT,active BOOLEAN);
 INSERT INTO app_inventory_products VALUES('cheese','Mussarela','kg',true),('inactive','Queijo','kg',false);
 CREATE TABLE app_inventory_movements(id BIGSERIAL PRIMARY KEY,product_id TEXT,type TEXT,quantity NUMERIC CHECK(quantity>0),destination TEXT,user_id TEXT,username TEXT);
 CREATE TABLE app_inventory_orders(id TEXT,status TEXT);
 CREATE TABLE app_inventory_order_items(product_id TEXT,order_id TEXT,quantity NUMERIC,released_quantity NUMERIC);
 CREATE TABLE app_audit(user_id TEXT,username TEXT,action TEXT,details JSONB);`);
 // pg.query aceita múltiplas instruções sem parâmetros. PGlite expõe esse caso em exec.
 const query=pool.query;pool.query=async(sql,args)=>!args&&sql.includes(';')?(await db.exec(sql)).at(-1):query(sql,args);
 await Transfers.init(pool);await Transfers.init(pool);
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>{req.user=users[req.headers.authorization];if(!req.user)return res.status(401).json({ok:false});next()};
 const permission=()=> (req,res,next)=>{if(req.user.role!=='administrador'&&!req.user.permissions.includes('estoque'))return res.status(403).json({ok:false});next()};
 const admin=(req,res,next)=>{if(req.user.role!=='administrador')return res.status(403).json({ok:false});next()};
 Transfers.register(app,{pool,auth,hasPermission:permission,adminOnly:admin});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await new Promise(r=>server.close(r));await db.close()});
test('quantidades rejeitam vazios, booleanos, negativos, infinito e mais de 3 casas',()=>{
 for(const v of ['',null,true,-1,Infinity,'NaN',0.0001,1000001])assert.throws(()=>Transfers.quantity(v,true));
 assert.equal(Transfers.quantity('0',true),0);assert.equal(Transfers.quantity('10.125'),10.125);
});
test('migração idempotente, autenticação e permissão para todas as operações',async()=>{
 assert.equal((await request('',undefined,'unknown')).status,401);
 for(const [path,body] of [['',undefined],['',send()],['/unknown/receive',{}],['/unknown/correct',{}]])assert.equal((await request(path,body,'viewer')).status,403);
});
test('envio não altera estoque; repetição não duplica transferência',async()=>{
 const b=await balance(),payload=send();const a=await request('',payload),again=await request('',payload);
 assert.equal(a.status,200);assert.equal(a.transfer.status,'pendente');assert.equal(a.transfer.id,again.transfer.id);assert.equal(await balance(),b);
 const list=await request('');assert.ok(list.transfers.some(t=>t.id===a.transfer.id));
});
test('produtos repetidos, inexistentes e inativos não são enviados',async()=>{
 for(const items of [[{product_id:'missing',sent:1}],[{product_id:'inactive',sent:1}],[{product_id:'cheese',sent:1},{product_id:'cheese',sent:1}]])assert.ok((await request('',send({items}))).status>=400);
});
test('conferência completa, motivo de divergência e proteção contra duplicação',async()=>{
 const {transfer:t}=await request('',send());const b=await balance();
 assert.equal((await request('/'+t.id+'/receive',receive(t,9,{notes:''}))).status,400);
 assert.equal((await request('/'+t.id+'/receive',receive(t,9,{items:[]}))).status,400);
 const received=await request('/'+t.id+'/receive',receive(t,9));assert.equal(received.transfer.status,'divergencia');assert.equal(received.transfer.items[0].difference,-1.125);assert.equal(await balance(),b+9);
 assert.equal((await request('/'+t.id+'/receive',receive(t,9))).status,409);assert.equal(await balance(),b+9);
 assert.equal(received.transfer.history.length,2);
});
test('zero recebido fica registrado, sem movimento; recebimento exato fica recebido',async()=>{
 const {transfer:t}=await request('',send());const b=await balance();const z=await request('/'+t.id+'/receive',receive(t,0));assert.equal(z.transfer.items[0].received,0);assert.equal(await balance(),b);
 const {transfer:u}=await request('',send());const exact=await request('/'+u.id+'/receive',receive(u,10.125));assert.equal(exact.transfer.status,'recebida');
});
test('correção exige administrador, motivo e revisão atual; ajusta só diferença',async()=>{
 const {transfer:t}=await request('',send());const {transfer:r}=await request('/'+t.id+'/receive',receive(t,9));const b=await balance();
 const payload=receive(r,8,{reason:'Nova pesagem conferida'});
 assert.equal((await request('/'+t.id+'/correct',payload)).status,403);
 assert.equal((await request('/'+t.id+'/correct',{...payload,reason:''},'admin')).status,400);
 const fixed=await request('/'+t.id+'/correct',payload,'admin');assert.equal(fixed.status,200);assert.equal(await balance(),b-1);assert.equal(fixed.transfer.history[1].items[0].received,9);assert.equal(fixed.transfer.history[2].items[0].received,8);
 assert.equal((await request('/'+t.id+'/correct',payload,'admin')).status,409);assert.equal(await balance(),b-1);
});
test('unidade alterada bloqueia recebimento; reserva bloqueia correção e preserva histórico',async()=>{
 const {transfer:t}=await request('',send());await pool.query("UPDATE app_inventory_products SET unit='un' WHERE id='cheese'");
 assert.equal((await request('/'+t.id+'/receive',receive(t,10.125))).status,409);await pool.query("UPDATE app_inventory_products SET unit='kg' WHERE id='cheese'");
 const {transfer:r}=await request('/'+t.id+'/receive',receive(t,10.125));const b=await balance();
 await pool.query("INSERT INTO app_inventory_orders VALUES('reserve','pendente')");await pool.query("INSERT INTO app_inventory_order_items VALUES('cheese','reserve',$1,0)",[b]);
 assert.equal((await request('/'+t.id+'/correct',receive(r,0,{reason:'Peso incorreto na entrada'}),'admin')).status,409);assert.equal(await balance(),b);
 const after=await request('/'+t.id);assert.equal(after.transfer.revision,1);
});
test('falha de auditoria reverte recebimento, estoque e histórico juntos',async()=>{
 const {transfer:t}=await request('',send());const b=await balance();await pool.query('ALTER TABLE app_audit ADD CONSTRAINT fail_audit CHECK(false) NOT VALID');
 const result=await request('/'+t.id+'/receive',receive(t,10.125));assert.equal(result.status,500);assert.equal(await balance(),b);
 const fresh=await request('/'+t.id);assert.equal(fresh.transfer.status,'pendente');assert.equal(fresh.transfer.history.length,1);
 await pool.query('ALTER TABLE app_audit DROP CONSTRAINT fail_audit');
});
