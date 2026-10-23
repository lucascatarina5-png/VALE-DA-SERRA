'use strict';
const crypto = require('crypto');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
function text(value, label, required = true) {
  if (typeof value !== 'string' || value.trim().length > 1000 || (required && !value.trim())) {
    if (!required && value == null) return '';
    throw fail(`Informe ${label} (até 1000 caracteres).`);
  }
  return value.trim();
}
function quantity(value, allowZero = false) {
  if (!['number','string'].includes(typeof value) || String(value).trim() === '') throw fail('Informe todas as quantidades conferidas.');
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 1000000 || Math.abs(n * 1000 - Math.round(n * 1000)) > 0.00001) throw fail('Quantidade inválida. Use até três casas decimais, entre 0 e 1.000.000.');
  return Math.round(n * 1000) / 1000;
}
function receivedItems(items, sent) {
  if (!Array.isArray(items) || items.length !== sent.length) throw fail('Confira todos os produtos da transferência.');
  const map = new Map(items.map(i => [String(i?.product_id || ''), i]));
  if (map.size !== sent.length) throw fail('Existem produtos repetidos na conferência.');
  return sent.map(i => {
    if (!map.has(i.product_id)) throw fail('Produto da conferência diferente do envio.');
    const received = quantity(map.get(i.product_id).received, true);
    return {...i, received, difference: Math.round((received - i.sent) * 1000) / 1000};
  });
}
async function init(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_industry_transfers (
    id TEXT PRIMARY KEY, number BIGSERIAL UNIQUE NOT NULL,
    request_key TEXT UNIQUE NOT NULL, created_by_id TEXT NOT NULL,
    sender TEXT NOT NULL, carrier TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','recebida','divergencia')),
    items JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    receiver TEXT, received_by_id TEXT, received_by TEXT, received_at TIMESTAMPTZ,
    receipt_notes TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
    history JSONB NOT NULL DEFAULT '[]'::jsonb
  ); CREATE INDEX IF NOT EXISTS app_industry_transfers_date ON app_industry_transfers(created_at DESC)`);
}
function register(app, {pool, auth, hasPermission, adminOnly}) {
  const base = '/api/industry-transfers';
  const access = [auth, hasPermission('estoque')];
  const actor = u => ({id: u.user_id, name: u.name || u.username, username: u.username});
  const transaction = handler => async (req, res) => {
    let c;
    try {
      c = await pool.connect(); await c.query('BEGIN');
      const result = await handler(c, req);
      await c.query('COMMIT'); res.json({ok:true, transfer:result});
    } catch (e) {
      if (c) await c.query('ROLLBACK').catch(()=>{});
      res.status(e.statusCode || 500).json({ok:false,error:e.statusCode ? e.message : 'Não foi possível salvar a transferência. Tente novamente.'});
      if (!e.statusCode) console.error('Transferência indústria:', e.message);
    } finally { if (c) c.release(); }
  };
  const audit = (c, u, action, details) => c.query(`INSERT INTO app_audit(user_id,username,action,details) VALUES($1,$2,$3,$4::jsonb)`, [u.user_id,u.username,action,JSON.stringify(details)]);
  app.get(base, ...access, async (req,res) => {
    try {
      const limit = Math.min(200,Math.max(1,parseInt(req.query.limit,10)||50));
      const before = /^\d+$/.test(String(req.query.before || '')) ? req.query.before : null;
      const r = await pool.query(`SELECT * FROM app_industry_transfers WHERE ($1::bigint IS NULL OR number<$1) ORDER BY number DESC LIMIT $2`,[before,limit]);
      res.json({ok:true,transfers:r.rows,next_before:r.rows.length===limit?r.rows.at(-1).number:null});
    } catch(e) { res.status(500).json({ok:false,error:'Falha ao consultar transferências.'}); }
  });
  app.get(base+'/:id', ...access, async (req,res) => {
    try {
      const r = await pool.query('SELECT * FROM app_industry_transfers WHERE id=$1',[req.params.id]);
      if (!r.rowCount) return res.status(404).json({ok:false,error:'Transferência não encontrada.'});
      res.json({ok:true,transfer:r.rows[0]});
    } catch(e) { res.status(500).json({ok:false,error:'Falha ao consultar transferência.'}); }
  });
  app.post(base, ...access, transaction(async (c,req) => {
    const b=req.body||{}, key=text(b.request_key,'a identificação do envio');
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw fail('Identificação inválida. Reabra o formulário.');
    // Serializa repetições da mesma requisição, inclusive em outra instância do servidor.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
    const existing=await c.query('SELECT * FROM app_industry_transfers WHERE request_key=$1',[key]);
    if (existing.rowCount) {
      if(existing.rows[0].created_by_id!==req.user.user_id) throw fail('Identificação de envio já utilizada.',409);
      return existing.rows[0];
    }
    const sender=text(b.sender,'o responsável na indústria'), carrier=text(b.carrier,'quem está transportando'), notes=text(b.notes,'as observações',false);
    if (!Array.isArray(b.items)||!b.items.length||b.items.length>100) throw fail('Inclua de 1 a 100 produtos.');
    if(new Set(b.items.map(i=>i.product_id)).size!==b.items.length) throw fail('O mesmo produto não pode aparecer duas vezes.');
    const items=[];
    for(const item of [...b.items].sort((a,b)=>String(a.product_id).localeCompare(String(b.product_id)))) {
      const r=await c.query('SELECT id,name,unit FROM app_inventory_products WHERE id=$1 AND active=TRUE FOR SHARE',[text(item.product_id,'o produto')]);
      if(!r.rowCount) throw fail('Produto não encontrado ou inativo. Atualize a lista.',409);
      items.push({product_id:r.rows[0].id,name:r.rows[0].name,unit:r.rows[0].unit,sent:quantity(item.sent),received:null,difference:null});
    }
    const who=actor(req.user), event={action:'envio',at:new Date().toISOString(),actor:who,sender,carrier,notes,items};
    const r=await c.query(`INSERT INTO app_industry_transfers(id,request_key,created_by_id,sender,carrier,notes,items,history)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) RETURNING *`,[crypto.randomUUID(),key,who.id,sender,carrier,notes,JSON.stringify(items),JSON.stringify([event])]);
    await audit(c,req.user,'INDUSTRIA_ENVIO',{id:r.rows[0].id,number:r.rows[0].number,items});
    return r.rows[0];
  }));
  const receive = correcting => transaction(async (c,req) => {
    const r=await c.query('SELECT * FROM app_industry_transfers WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!r.rowCount) throw fail('Transferência não encontrada.',404);
    const t=r.rows[0], b=req.body||{};
    if(Number(b.revision)!==t.revision || (correcting ? t.status==='pendente' : t.status!=='pendente')) throw fail('Esta transferência já foi alterada. Reabra e confira novamente.',409);
    const items=receivedItems(b.items,t.items), receiver=text(b.receiver,'quem recebeu e conferiu'), notes=text(b.notes,'as observações',false);
    const divergence=items.some(i=>i.difference!==0);
    if(divergence&&!notes) throw fail('Explique a diferença nas observações.');
    const reason=correcting?text(b.reason,'o motivo da correção'):'';
    if(correcting&&reason.length<5) throw fail('Descreva o motivo da correção (mínimo de 5 caracteres).');
    const movements=[];
    for(const i of [...items].sort((a,b)=>a.product_id.localeCompare(b.product_id))) {
      const p=await c.query('SELECT id,active,unit FROM app_inventory_products WHERE id=$1 FOR UPDATE',[i.product_id]);
      if(!p.rowCount||!p.rows[0].active) throw fail(`O produto ${i.name} está inativo. Peça ao administrador para regularizar o cadastro.`,409);
      if(p.rows[0].unit!==i.unit) throw fail(`A unidade de ${i.name} mudou após o envio. Regularize o cadastro antes de receber.`,409);
      const previous=correcting?Number(t.items.find(x=>x.product_id===i.product_id).received):0;
      const delta=Math.round((i.received-previous)*1000)/1000;
      if(delta<0) {
        const balance=await c.query(`SELECT COALESCE(SUM(CASE WHEN type='entrada' THEN quantity ELSE -quantity END),0) balance FROM app_inventory_movements WHERE product_id=$1`,[i.product_id]);
        const reserved=await c.query(`SELECT COALESCE(SUM(GREATEST(i.quantity-COALESCE(i.released_quantity,0),0)),0) reserved FROM app_inventory_order_items i JOIN app_inventory_orders o ON o.id=i.order_id WHERE i.product_id=$1 AND o.status IN ('pendente','separado','parcial')`,[i.product_id]);
        if(Number(balance.rows[0].balance)+delta<Number(reserved.rows[0].reserved)) throw fail(`A correção de ${i.name} deixaria o estoque abaixo do reservado ou negativo.`,409);
      }
      if(delta!==0) {
        const m=await c.query(`INSERT INTO app_inventory_movements(product_id,type,quantity,destination,user_id,username) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[i.product_id,delta>0?'entrada':'saida',Math.abs(delta),`${correcting?'CORREÇÃO':'RECEBIMENTO'} INDÚSTRIA • Transferência ${t.number} • Revisão ${t.revision+1}`,req.user.user_id,req.user.username]);
        movements.push(String(m.rows[0].id));
      }
    }
    const event={action:correcting?'correcao':'recebimento',revision:t.revision+1,at:new Date().toISOString(),actor:actor(req.user),receiver,notes,reason,items,movements};
    const history=[...t.history,event];
    const updated=await c.query(`UPDATE app_industry_transfers SET status=$2,items=$3::jsonb,receiver=$4,received_by_id=$5,received_by=$6,received_at=NOW(),receipt_notes=$7,revision=revision+1,history=$8::jsonb WHERE id=$1 RETURNING *`,[t.id,divergence?'divergencia':'recebida',JSON.stringify(items),receiver,req.user.user_id,req.user.username,notes,JSON.stringify(history)]);
    await audit(c,req.user,correcting?'INDUSTRIA_CORRECAO':'INDUSTRIA_RECEBIMENTO',{id:t.id,...event});
    return updated.rows[0];
  });
  app.post(base+'/:id/receive',...access,receive(false));
  app.post(base+'/:id/correct',...access,adminOnly,receive(true));
}
module.exports={init,register,quantity,receivedItems};
