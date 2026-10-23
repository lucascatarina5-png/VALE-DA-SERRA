'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const Transfers=require('./industry-transfers');
let db,server,base,pool;
const users={admin:{user_id:'a',username:'admin',name:'Administrador',role:'administrador'},store:{user_id:'w',username:'conferente',name:'Conferente',role:'usuario',permissions:['loja']},warehouse:{user_id:'g',username:'galpao',role:'usuario',permissions:['estoque']},viewer:{user_id:'v',role:'consulta',permissions:[]}};
async function request(path,body,user='store',method=body?'POST':'GET'){
 const r=await fetch(base+'/api/industry-transfers'+path,{method,headers:{'Content-Type':'application/json',Authorization:user},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};
}
async function balance(){return Number((await pool.query("SELECT stock FROM app_store_products WHERE id='cheese'")).rows[0].stock)}
const send=(overrides={})=>({request_key:require('crypto').randomUUID(),sender:'Ana',carrier:'João',notes:'Lote 23',items:[{product_id:'cheese',sent:10.125}],...overrides});
const receive=(t,n,extra={})=>({revision:t.revision,receiver:'Maria',notes:n===10.125?'':'Peso conferido diferente do envio',items:[{product_id:'cheese',received:n}],...extra});
before(async()=>{
 db=new PGlite();pool={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}},connect:async()=>({...pool,release(){}})};
 // O esquema mínimo reproduz as tabelas já existentes da Loja PDV; as tabelas novas vêm da migração real.
 await db.exec(`CREATE TABLE app_inventory_products(id TEXT PRIMARY KEY,name TEXT,unit TEXT,active BOOLEAN);
 INSERT INTO app_inventory_products VALUES('cheese','Milho do Galpão','kg',true);
 CREATE TABLE app_store_products(id TEXT PRIMARY KEY,name TEXT,unit TEXT,active BOOLEAN,stock NUMERIC DEFAULT 0,updated_at TIMESTAMPTZ DEFAULT NOW(),variant TEXT DEFAULT '',package_value NUMERIC DEFAULT 0,package_unit TEXT DEFAULT '');
 INSERT INTO app_store_products(id,name,unit,active) VALUES('cheese','Mussarela','kg',true),('inactive','Queijo','kg',false);
 CREATE TABLE app_store_stock_movements(id BIGSERIAL PRIMARY KEY,product_id TEXT,product_name TEXT,movement_type TEXT,quantity_before NUMERIC,quantity_change NUMERIC,quantity_after NUMERIC,reason TEXT,note TEXT,user_id TEXT,username TEXT);
 CREATE TABLE app_inventory_movements(id BIGSERIAL PRIMARY KEY,product_id TEXT,type TEXT,quantity NUMERIC CHECK(quantity>0),destination TEXT,user_id TEXT,username TEXT);
 CREATE TABLE app_inventory_orders(id TEXT,status TEXT);
 CREATE TABLE app_inventory_order_items(product_id TEXT,order_id TEXT,quantity NUMERIC,released_quantity NUMERIC);
 CREATE TABLE app_audit(user_id TEXT,username TEXT,action TEXT,details JSONB);`);
 // pg.query aceita múltiplas instruções sem parâmetros. PGlite expõe esse caso em exec.
 const query=pool.query;pool.query=async(sql,args)=>!args&&sql.includes(';')?(await db.exec(sql)).at(-1):query(sql,args);
 await Transfers.init(pool);await Transfers.init(pool);
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>{req.user=users[req.headers.authorization];if(!req.user)return res.status(401).json({ok:false});next()};
 const permission=permission=> (req,res,next)=>{if(req.user.role!=='administrador'&&!req.user.permissions.includes(permission))return res.status(403).json({ok:false});next()};
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
 for(const user of ['viewer','warehouse'])for(const [path,body] of [['',undefined],['',send()],['/unknown/receive',{}],['/unknown/correct',{}]])assert.equal((await request(path,body,user)).status,403);
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
test('unidade alterada bloqueia recebimento; estoque já vendido bloqueia redução',async()=>{
 const {transfer:t}=await request('',send());await pool.query("UPDATE app_store_products SET unit='un' WHERE id='cheese'");
 assert.equal((await request('/'+t.id+'/receive',receive(t,10.125))).status,409);await pool.query("UPDATE app_store_products SET unit='kg' WHERE id='cheese'");
 const {transfer:r}=await request('/'+t.id+'/receive',receive(t,10.125));
 await pool.query("UPDATE app_store_products SET stock=1 WHERE id='cheese'");const b=await balance();
 assert.equal((await request('/'+t.id+'/correct',receive(r,0,{reason:'Peso incorreto na entrada'}),'admin')).status,409);assert.equal(await balance(),b);
 const fresh=await request('/'+t.id);assert.equal(fresh.transfer.revision,1);
});
test('falha de auditoria reverte recebimento, estoque e histórico juntos',async()=>{
 const {transfer:t}=await request('',send());const b=await balance();await pool.query('ALTER TABLE app_audit ADD CONSTRAINT fail_audit CHECK(false) NOT VALID');
 const result=await request('/'+t.id+'/receive',receive(t,10.125));assert.equal(result.status,500);assert.equal(await balance(),b);
 const fresh=await request('/'+t.id);assert.equal(fresh.transfer.status,'pendente');assert.equal(fresh.transfer.history.length,1);
 await pool.query('ALTER TABLE app_audit DROP CONSTRAINT fail_audit');
});

test('envio e recebimento usam Loja PDV e preservam estoque e registros anteriores do Galpão',async()=>{
 const {transfer:t}=await request('',send());assert.equal(t.target_scope,'pdv');assert.equal(t.items[0].name,'Mussarela');
 await request('/'+t.id+'/receive',receive(t,10.125));
 assert.equal((await pool.query('SELECT COUNT(*)::int n FROM app_inventory_movements')).rows[0].n,0);
 assert.equal((await pool.query("SELECT name FROM app_inventory_products WHERE id='cheese'")).rows[0].name,'Milho do Galpão');
 const moves=await pool.query('SELECT * FROM app_store_stock_movements ORDER BY id DESC LIMIT 1');assert.equal(moves.rows[0].quantity_change,'10.125');
 await pool.query("INSERT INTO app_industry_transfers(id,request_key,created_by_id,sender,carrier,items) VALUES('legacy','legacy-key-123456','a','Ana','João','[]'::jsonb)");
 await Transfers.init(pool);
 assert.equal((await pool.query("SELECT target_scope FROM app_industry_transfers WHERE id='legacy'")).rows[0].target_scope,'galpao');
 assert.equal((await request('/legacy')).status,404);assert.equal((await request('/legacy/receive',receive({revision:0},1),'admin')).status,404);
 const list=await request('');assert.ok(!list.transfers.some(t=>t.id==='legacy'));
});

test('apresentação e peso da embalagem identificam a mussarela correta',async()=>{
 await pool.query("UPDATE app_store_products SET variant='Fatiada',package_value=670,package_unit='g' WHERE id='cheese'");
 const {transfer:t}=await request('',send());assert.equal(t.items[0].name,'Mussarela • Fatiada • 670 g');assert.equal(t.items[0].unit,'kg');
});

test('envio da foto com quatro produtos, FILHO e observações vazias é salvo integralmente',async()=>{
 const products=[['mus4','Queijo Mussarela 4Kg',36],['coalho1','Queijo de Coalho 1Kg',10],['req200','Requeijão Cremoso 200g',48],['nata500','Nata com Sal 500g',12]];
 for(const [id,name] of products)await pool.query("INSERT INTO app_store_products(id,name,unit,active,stock) VALUES($1,$2,'un',TRUE,0)",[id,name]);
 const body=send({sender:'FILHO',carrier:'FILHO',notes:'',items:products.map(([id,name,sent])=>({product_id:id,sent}))});
 const result=await request('',body);assert.equal(result.status,200);assert.equal(result.transfer.items.length,4);assert.equal(result.transfer.notes,'');assert.equal(result.transfer.status,'pendente');
 const replay=await request('',body);assert.equal(replay.transfer.id,result.transfer.id);
 for(const [id,name,sent] of products){const i=result.transfer.items.find(x=>x.product_id===id);assert.equal(i.sent,sent);assert.equal(i.received,null);assert.equal(Number((await pool.query('SELECT stock FROM app_store_products WHERE id=$1',[id])).rows[0].stock),0);}
});
