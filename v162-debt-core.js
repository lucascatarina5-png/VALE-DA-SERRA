function preserve(current,next){
 const incoming=Array.isArray(next.debitos)?next.debitos:[];
 for(const d of current.debitos||[]){if(!d.serverSavedV162)continue;const i=incoming.findIndex(x=>String(x.id)===String(d.id));if(i<0)incoming.push(d);else for(const key of ['serverSavedV162','prodId','data','descricao','valor','origem','criadoEm','criadoPor'])incoming[i][key]=d[key];}
 next.debitos=incoming;return next;
}
function insert(state,body,user){
 const id=String(body.id||'');if(!/^[a-zA-Z0-9_-]{10,100}$/.test(id))throw Error('Identificador inválido.');
 const prodId=String(body.prodId||''),descricao=String(body.descricao||'').trim(),data=String(body.data||''),valor=Number(body.valor);
 if(!prodId||!descricao||descricao.length>2000||!/^\d{4}-\d{2}-\d{2}$/.test(data)||!Number.isFinite(Date.parse(data))||new Date(data).toISOString().slice(0,10)!==data||!Number.isFinite(valor)||valor<=0)throw Error('Informe produtor, data válida, descrição e valor maior que zero.');
 if(!(state.produtores||[]).some(p=>String(p.id)===prodId))throw Error('Produtor não encontrado no servidor. Atualize o cadastro e tente novamente.');
 if(!Array.isArray(state.debitos))state.debitos=[];
 const existing=state.debitos.find(d=>String(d.id)===id);
 if(existing){if(String(existing.prodId)!==prodId||existing.descricao!==descricao||Number(existing.valor)!==valor||existing.data!==data)throw Error('Este registro já existe com outros dados. Atualize a página.');return existing;}
 const debt={id,prodId,data,descricao,valor,origem:'manual',situacaoPagamento:'Pendente',serverSavedV162:true,criadoEm:new Date().toISOString(),criadoPor:user.username};state.debitos.push(debt);return debt;
}
module.exports={preserve,insert};
