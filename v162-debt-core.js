function preserve(current,next){
 const incoming=[],byId=new Map();
 for(const d of Array.isArray(next.debitos)?next.debitos:[]){const key=String(d.id||''),i=byId.get(key);if(!key||i===undefined){if(key)byId.set(key,incoming.length);incoming.push(d)}else if([d.status,d.situacao,d.situacaoPagamento].some(v=>/^(excluid[oa]|cancelad[oa])$/i.test(String(v||''))))incoming[i]=d;}

 for(const d of current.debitos||[]){const i=byId.get(String(d.id));
   if(i===undefined){byId.set(String(d.id),incoming.length);incoming.push(d);continue;}
   if(d.serverSavedV162)for(const key of ['serverSavedV162','prodId','data','descricao','valor','origem','criadoEm','criadoPor','alteradoEm','alteradoPor'])incoming[i][key]=d[key];
 }
 next.debitos=incoming;
 // A snapshot from another device must not orphan a saved producer debt.
 const active=d=>![d.status,d.situacao,d.situacaoPagamento].some(s=>/^(excluid[oa]|cancelad[oa])$/i.test(String(s||'')));
 const needed=new Set(incoming.filter(active).map(d=>String(d.prodId??d.produtorId??d.producer_id??'')));
 const producers=Array.isArray(next.produtores)?next.produtores:[],ids=new Set(producers.map(p=>String(p.id)));
 for(const p of current.produtores||[])if(needed.has(String(p.id))&&!ids.has(String(p.id))){producers.push(p);ids.add(String(p.id));}
 next.produtores=producers;return next;
}
function insert(state,body,user){
 const id=String(body.id||'');if(!/^[a-zA-Z0-9_-]{10,100}$/.test(id))throw Error('Identificador inválido.');
 const prodId=String(body.prodId||''),descricao=String(body.descricao||'').trim(),data=String(body.data||''),valor=Number(body.valor);
 if(!prodId||!descricao||descricao.length>2000||!/^\d{4}-\d{2}-\d{2}$/.test(data)||!Number.isFinite(Date.parse(data))||new Date(data).toISOString().slice(0,10)!==data||!Number.isFinite(valor)||valor<=0)throw Error('Informe produtor, data válida, descrição e valor maior que zero.');
 if(!(state.produtores||[]).some(p=>String(p.id)===prodId))throw Error('Produtor não encontrado no servidor. Atualize o cadastro e tente novamente.');
 if(!Array.isArray(state.debitos))state.debitos=[];
 const existing=state.debitos.find(d=>String(d.id)===id);
 if(existing){if([existing.status,existing.situacao,existing.situacaoPagamento].some(v=>/^(excluid[oa]|cancelad[oa])$/i.test(String(v||''))))throw Error('Este registro foi excluído. Atualize a página e confira o histórico antes de registrar outro.');if(String(existing.prodId)!==prodId||existing.descricao!==descricao||Number(existing.valor)!==valor||existing.data!==data)throw Error('Este registro já existe com outros dados. Atualize a página.');return existing;}
 const debt={id,prodId,data,descricao,valor,origem:'manual',situacaoPagamento:'Pendente',serverSavedV162:true,criadoEm:new Date().toISOString(),criadoPor:user.username};state.debitos.push(debt);return debt;
}
module.exports={preserve,insert};
