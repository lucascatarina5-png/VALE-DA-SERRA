(function(){
'use strict';const form=document.getElementById('formDeb');if(!form)return;
let busy=false,pending=null,generation=0;const draftKey='v162_debito_pendente_'+(localStorage.getItem('vale_user')||'usuario');
const status=document.createElement('p');status.setAttribute('role','status');form.appendChild(status);
const field=id=>document.getElementById(id);
function persistLocal(){localStorage.setItem(KDEB,JSON.stringify(debitos));renderAll(secaoAtivaAtual());}
function headers(){return {...v4Headers(),'Content-Type':'application/json'}}
async function request(url,opt){const r=await fetch(url,{cache:'no-store',...opt});let j;try{j=await r.json()}catch(_){throw Error('O servidor não confirmou o registro.')}if(!r.ok||j.ok!==true)throw Error(j.error||'Falha ao salvar no servidor.');return j;}
function restoreDraft(){try{pending=JSON.parse(localStorage.getItem(draftKey)||'null');if(pending){field('dData').value=pending.data;field('dProd').value=pending.prodId;field('dDesc').value=pending.descricao;field('dValor').value=pending.valor;status.textContent='Há um registro aguardando confirmação. Confira os dados e clique em Registrar débito.'}}catch(_) {pending=null}}
restoreDraft();
form.addEventListener('submit',async event=>{event.preventDefault();event.stopImmediatePropagation();if(busy)return;
 const p=prodById(field('dProd').value),data=field('dData').value,descricao=field('dDesc').value.trim(),valor=Number(field('dValor').value);
 if(!p||!data||!descricao||!Number.isFinite(valor)||valor<=0){status.textContent='Informe produtor, data, descrição e valor maior que zero.';return}
 const draft={prodId:String(p.id),data,descricao,valor};
 if(!pending||['prodId','data','descricao','valor'].some(k=>pending[k]!==draft[k]))pending={id:crypto.randomUUID(),...draft};
 try{localStorage.setItem(draftKey,JSON.stringify(pending))}catch(_){status.textContent='Não foi possível guardar o registro neste navegador. Libere espaço e tente novamente.';return}
 const button=form.querySelector('[type=submit]');generation++;busy=true;button.disabled=true;status.textContent='Salvando no servidor…';
 try{const j=await request('/api/debts',{method:'POST',headers:headers(),body:JSON.stringify(pending)});if(!j.debt||j.debt.id!==pending.id)throw Error('Confirmação inválida. Tente novamente.');
 const index=debitos.findIndex(d=>String(d.id)===String(j.debt.id));if(index<0)debitos.push(j.debt);else debitos[index]=j.debt;
 pending=null;localStorage.removeItem(draftKey);form.reset();field('dData').value=isoHoje();
 try{persistLocal()}catch(_){status.textContent='Débito salvo no servidor. Atualize a página para consultar.';return}
 status.textContent='Débito salvo no servidor para '+p.nome+'. Disponível na pesquisa e no pagamento.';
 }catch(e){status.textContent='Registro ainda não confirmado: '+e.message+' Os campos foram mantidos para tentar novamente.'}finally{busy=false;button.disabled=false}
},true);
// A consulta lê o estado confirmado, inclusive quando a quantidade de registros é igual.
async function refresh(){if(busy)return;const version=generation;try{const j=await request('/api/debts',{headers:headers()});if(busy||version!==generation||!Array.isArray(j.debitos))return;debitos=j.debitos;persistLocal();if(pending)restoreDraft()}catch(e){console.warn('Consulta de débitos:',e.message)}}
refresh();window.addEventListener('focus',refresh);
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue=''}});
})();
