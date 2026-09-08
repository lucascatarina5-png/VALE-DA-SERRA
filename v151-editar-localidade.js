(function(){
  'use strict';

  const BATCH_KEY='vds_pdf_import_batches_v137';
  const E=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const norm=value=>String(value||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
  const clean=value=>String(value||'').trim().replace(/\s+/g,' ');
  const clone=value=>JSON.parse(JSON.stringify(value));
  const admin=()=>{try{return typeof v4IsAdmin!=='function'||v4IsAdmin()}catch(_){return false}};
  function batches(){try{const value=JSON.parse(localStorage.getItem(BATCH_KEY)||'[]');return Array.isArray(value)?value:[]}catch(_){return []}}
  function producer(id){return (Array.isArray(produtores)?produtores:[]).find(item=>String(item.id)===String(id))}
  function localityValues(){
    const values=[];
    (Array.isArray(produtores)?produtores:[]).forEach(item=>{values.push(item.local);if(Array.isArray(item.localidadesConhecidas))values.push(...item.localidadesConhecidas)});
    (Array.isArray(lancamentos)?lancamentos:[]).forEach(item=>values.push(item.local));
    (Array.isArray(pagamentos)?pagamentos:[]).forEach(item=>{values.push(item.localidade);values.push(item.localidadePrincipalPagamento);values.push(item.localidadeCadastroProdutor);if(Array.isArray(item.locaisEntrega))item.locaisEntrega.forEach(local=>values.push(local.local))});
    (Array.isArray(debitos)?debitos:[]).forEach(item=>values.push(item.localidade));
    batches().forEach(item=>{if(Array.isArray(item.localities))values.push(...item.localities);values.push(item.localidade);values.push(item.local)});
    const unique=new Map();values.map(clean).filter(Boolean).forEach(value=>{if(!unique.has(norm(value)))unique.set(norm(value),value)});return [...unique.values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  }
  function buildPreview(oldValue,newValue){
    const oldName=clean(oldValue),newName=clean(newValue),oldKey=norm(oldName),newKey=norm(newName),validOld=!!oldName&&localityValues().some(value=>norm(value)===oldKey),validNew=newName.length>=2&&newName.length<=80&&newName!==oldName;
    const producerRows=(Array.isArray(produtores)?produtores:[]).filter(item=>norm(item.local)===oldKey||(item.localidadesConhecidas||[]).some(value=>norm(value)===oldKey));
    const entryRows=(Array.isArray(lancamentos)?lancamentos:[]).filter(item=>norm(item.local||producer(item.prodId)?.local)===oldKey);
    const paymentRows=(Array.isArray(pagamentos)?pagamentos:[]).filter(item=>norm(item.localidade)===oldKey||norm(item.localidadePrincipalPagamento)===oldKey||norm(item.localidadeCadastroProdutor)===oldKey||(item.locaisEntrega||[]).some(local=>norm(local.local)===oldKey));
    const debtRows=(Array.isArray(debitos)?debitos:[]).filter(item=>norm(item.localidade||producer(item.prodId)?.local)===oldKey);
    const batchRows=batches().filter(item=>(item.localities||[]).some(value=>norm(value)===oldKey)||norm(item.localidade)===oldKey||norm(item.local)===oldKey);
    const targetExists=!!newName&&localityValues().some(value=>norm(value)===newKey&&norm(value)!==oldKey);
    return {valid:validOld&&validNew,validOld,validNew,oldName,newName,oldKey,newKey,targetExists,sameSpelling:newKey===oldKey,producerRows,entryRows,paymentRows,debtRows,batchRows,producers:producerRows.length,entries:entryRows.length,payments:paymentRows.length,debts:debtRows.length,imports:batchRows.length,total:producerRows.length+entryRows.length+paymentRows.length+debtRows.length+batchRows.length};
  }
  window.v151LocalityPreview=buildPreview;

  function dedupeKnown(values,primary){
    const unique=new Map();(Array.isArray(values)?values:[]).map(clean).filter(Boolean).forEach(value=>{if(!unique.has(norm(value)))unique.set(norm(value),value)});return [...unique.values()].filter(value=>norm(value)!==norm(primary));
  }
  function replaceValue(value,data){return norm(value)===data.oldKey?data.newName:value}
  function applyRename(data,importacoesPdf){
    produtores.forEach(item=>{item.local=replaceValue(item.local,data);item.localidadesConhecidas=dedupeKnown((item.localidadesConhecidas||[]).map(value=>replaceValue(value,data)),item.local);if(!item.localidadesConhecidas.length)delete item.localidadesConhecidas});
    lancamentos.forEach(item=>{if(norm(item.local||producer(item.prodId)?.local)===data.oldKey)item.local=data.newName});
    pagamentos.forEach(item=>{item.localidade=replaceValue(item.localidade,data);item.localidadePrincipalPagamento=replaceValue(item.localidadePrincipalPagamento,data);item.localidadeCadastroProdutor=replaceValue(item.localidadeCadastroProdutor,data);if(Array.isArray(item.locaisEntrega))item.locaisEntrega.forEach(local=>{local.local=replaceValue(local.local,data)})});
    debitos.forEach(item=>{if(item.localidade!==undefined)item.localidade=replaceValue(item.localidade,data)});
    importacoesPdf.forEach(item=>{if(Array.isArray(item.localities))item.localities=dedupeKnown(item.localities.map(value=>replaceValue(value,data)),'');if(item.localidade!==undefined)item.localidade=replaceValue(item.localidade,data);if(item.local!==undefined)item.local=replaceValue(item.local,data)});
    try{if(typeof V104!=='undefined'&&Array.isArray(V104.entradaRows))V104.entradaRows.forEach(item=>{item.localidade=replaceValue(item.localidade,data)})}catch(_){}
    return {producers:data.producers,entries:data.entries,payments:data.payments,debts:data.debts,imports:data.imports};
  }
  window.v151ApplyLocalityRename=applyRename;

  function currentPreview(){return buildPreview(document.getElementById('v151OldLocality')?.value,document.getElementById('v151NewLocality')?.value)}
  window.v151RenderLocalityPreview=function(){
    const data=currentPreview(),box=document.getElementById('v151LocalityPreview'),button=document.getElementById('v151RenameLocality'),check=document.getElementById('v151LocalityConfirm');if(!box||!button)return data;
    if(!data.validOld){box.innerHTML='<div class="v151-empty">Escolha a localidade que está com o nome errado.</div>';button.disabled=true;button.textContent='Escolha a localidade para continuar';return data}
    if(!data.validNew){box.innerHTML='<div class="v151-empty">Digite o nome correto da localidade. O nome deve ser diferente do atual.</div>';button.disabled=true;button.textContent='Digite o nome correto';return data}
    const mode=data.sameSpelling?'A grafia será padronizada em todos os registros.':data.targetExists?'A localidade correta já existe e os registros serão reunidos nela.':'A localidade será renomeada em todo o sistema.';
    box.innerHTML=`<div class="v151-change"><span><small>Nome atual</small><b>${E(data.oldName)}</b></span><i>→</i><span><small>Novo nome</small><b>${E(data.newName)}</b></span></div><div class="v151-counts"><span><small>Produtores</small><b>${data.producers}</b></span><span><small>Entradas de leite</small><b>${data.entries}</b></span><span><small>Pagamentos</small><b>${data.payments}</b></span><span><small>Débitos</small><b>${data.debts}</b></span><span><small>Importações PDF</small><b>${data.imports}</b></span></div><div class="v151-note"><b>${data.targetExists?'🔗 Mesclagem segura':'✅ Alteração completa'}</b><span>${E(mode)} Nenhum produtor, leite, pagamento ou débito será excluído.</span></div>`;
    button.textContent=`Salvar como ${data.newName}`;button.disabled=!check?.checked;return data;
  };

  async function syncState(importacoesPdf){
    const headers=typeof v4Headers==='function'?v4Headers():{};headers['Content-Type']='application/json';
    const response=await fetch('/api/state',{method:'PUT',headers,body:JSON.stringify({data:{produtores,lancamentos,pagamentos,debitos,pagamentosDebitos:typeof pagamentosDebitos==='undefined'?[]:pagamentosDebitos,importacoesPdf}}),cache:'no-store'});
    if(!response.ok){let message='O servidor não confirmou a alteração da localidade.';try{const json=await response.json();if(json.error)message=json.error}catch(_){}throw new Error(message)}
  }
  window.v151RenameLocality=async function(){
    if(!admin())return alert('Somente o Administrador pode editar localidades.');
    const data=currentPreview(),check=document.getElementById('v151LocalityConfirm'),button=document.getElementById('v151RenameLocality');
    if(!data.valid)return alert('Escolha a localidade atual e digite corretamente o novo nome.');
    if(!check?.checked)return alert('Marque a confirmação de segurança antes de salvar.');
    if(!confirm(`ALTERAR A LOCALIDADE EM TODO O SISTEMA?\n\nNome atual: ${data.oldName}\nNovo nome: ${data.newName}\n\nProdutores: ${data.producers}\nEntradas de leite: ${data.entries}\nPagamentos: ${data.payments}\nDébitos: ${data.debts}\nImportações PDF: ${data.imports}\n\nNenhum registro será excluído.${data.targetExists?'\nOs dados serão reunidos na localidade que já existe.':''}`))return;
    const old={produtores:clone(produtores),lancamentos:clone(lancamentos),pagamentos:clone(pagamentos),debitos:clone(debitos),batches:clone(batches())},nextBatches=clone(old.batches);if(button){button.disabled=true;button.textContent='Atualizando e confirmando no servidor...'}
    try{
      const result=applyRename(data,nextBatches);await syncState(nextBatches);localStorage.setItem(BATCH_KEY,JSON.stringify(nextBatches));if(typeof save==='function')save();
      let history=[];try{history=JSON.parse(localStorage.getItem('vds_locality_rename_history_v151')||'[]')}catch(_){}history.unshift({id:crypto.randomUUID(),executedAt:new Date().toISOString(),oldName:data.oldName,newName:data.newName,merged:data.targetExists,...result,user:(typeof V4!=='undefined'&&V4?.user?.username)||'Administrador'});localStorage.setItem('vds_locality_rename_history_v151',JSON.stringify(history.slice(0,30)));
      try{if(typeof v25Audit==='function')await v25Audit('LOCALIDADE_RENOMEADA',{localidadeAnterior:data.oldName,localidadeNova:data.newName,mesclada:data.targetExists,...result})}catch(_){}
      const oldSelect=document.getElementById('v151OldLocality'),newInput=document.getElementById('v151NewLocality');if(oldSelect)oldSelect.value='';if(newInput)newInput.value='';if(check)check.checked=false;upgrade();try{if(typeof renderPagamentos==='function')renderPagamentos(false)}catch(_){}try{if(typeof v144Refresh==='function')v144Refresh()}catch(_){}
      alert(`✅ LOCALIDADE ATUALIZADA.\n\n${data.oldName} → ${data.newName}\n\n${result.producers} produtor(es)\n${result.entries} entrada(s) de leite\n${result.payments} pagamento(s)\n${result.debts} débito(s)\n${result.imports} importação(ões) PDF\n\nNenhum registro foi excluído.`);
    }catch(error){produtores=old.produtores;lancamentos=old.lancamentos;pagamentos=old.pagamentos;debitos=old.debitos;localStorage.setItem(BATCH_KEY,JSON.stringify(old.batches));if(typeof save==='function')save();window.v151RenderLocalityPreview();alert('❌ O servidor não confirmou a alteração. O nome anterior foi mantido.\n\nMotivo: '+error.message)}
  };

  function editorHTML(){return `<section id="v151LocalityBox" class="v151-editor"><div class="v151-head"><div><b>✏️ Editar ou corrigir uma localidade</b><p>Troca o nome em todos os registros sem excluir nenhuma informação.</p></div><span>V151 • EDIÇÃO SEGURA</span></div><div class="v151-fields"><label>Localidade com nome errado<select id="v151OldLocality" onchange="v151RenderLocalityPreview()"><option value="">Escolha a localidade...</option></select></label><label>Nome correto<input id="v151NewLocality" list="v151LocalityNames" maxlength="80" placeholder="Ex.: Lagoa do Arroz" oninput="v151RenderLocalityPreview()"><datalist id="v151LocalityNames"></datalist></label><button type="button" onclick="v151RenderLocalityPreview()">🔎 Conferir alteração</button></div><div id="v151LocalityPreview"></div><label class="v151-confirm"><input id="v151LocalityConfirm" type="checkbox" onchange="v151RenderLocalityPreview()"><span>Conferi o nome atual, o nome correto e todos os registros que serão atualizados.</span></label><button id="v151RenameLocality" class="v151-save" type="button" onclick="v151RenameLocality()" disabled>Escolha a localidade para continuar</button></section>`}
  function upgrade(){
    const body=document.querySelector('#v149Maintenance .v149-maintenance-body');if(!body)return false;let box=document.getElementById('v151LocalityBox');if(!box){const anchor=document.getElementById('v150CarryBox');if(anchor)anchor.insertAdjacentHTML('afterend',editorHTML());else body.insertAdjacentHTML('afterbegin',editorHTML());box=document.getElementById('v151LocalityBox')}
    const select=document.getElementById('v151OldLocality'),input=document.getElementById('v151NewLocality'),wanted=select?.value||'',values=localityValues();if(select){select.innerHTML='<option value="">Escolha a localidade...</option>'+values.map(value=>`<option value="${E(value)}">${E(value)}</option>`).join('');select.value=values.find(value=>norm(value)===norm(wanted))||''}const list=document.getElementById('v151LocalityNames');if(list)list.innerHTML=values.filter(value=>norm(value)!==norm(select?.value)).map(value=>`<option value="${E(value)}"></option>`).join('');if(input&&input.value)input.value=clean(input.value);window.v151RenderLocalityPreview();return true;
  }
  window.v151EnsureLocalityEditor=upgrade;
  window.v151OpenLocalityEditor=function(encodedLocal){
    let locality='';try{locality=decodeURIComponent(String(encodedLocal||''))}catch(_){locality=String(encodedLocal||'')}
    if(typeof go==='function')go('configuracoes');else if(typeof showSection==='function')showSection('configuracoes');
    setTimeout(()=>{upgrade();const details=document.getElementById('v149Maintenance'),select=document.getElementById('v151OldLocality'),input=document.getElementById('v151NewLocality'),check=document.getElementById('v151LocalityConfirm');if(details)details.open=true;if(select)select.value=[...select.options].find(option=>norm(option.value)===norm(locality))?.value||locality;if(input)input.value='';if(check)check.checked=false;window.v151RenderLocalityPreview();document.getElementById('v151LocalityBox')?.scrollIntoView({behavior:'smooth',block:'start'});input?.focus()},320);
  };

  const style=document.createElement('style');style.id='v151-locality-style';style.textContent=`.v151-local-card{position:relative;min-width:0}.v151-local-card>.v139-local{width:100%;height:100%;padding-bottom:36px}.v151-local-card>.v139-local em{padding-right:66px}.v151-edit-locality{position:absolute;right:8px;bottom:7px!important;z-index:2!important;padding:5px 7px!important;border:1px solid #b9cce0!important;border-radius:7px!important;background:#f4f8fc!important;color:#205785!important;font-size:9px!important;font-weight:900!important}.v151-editor{margin:0 0 18px;padding:15px;border:2px solid #79a9d5;border-radius:13px;background:#f7fbff}.v151-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.v151-head b{font-size:17px;color:#164e82}.v151-head p{margin:5px 0 0;color:#59758f}.v151-head>span{flex:0 0 auto;padding:7px 9px;border-radius:999px;background:#dceeff;color:#145181;font-size:10px;font-weight:900}.v151-fields{display:grid;grid-template-columns:1.2fr 1.2fr auto;align-items:end;gap:10px;margin-top:13px}.v151-fields label{font-size:11px;font-weight:900;color:#42637f}.v151-fields select,.v151-fields input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #b9ccde;border-radius:8px;background:#fff}.v151-fields button{border:0;border-radius:8px;background:#174f86;color:#fff;padding:11px 13px;font-weight:900}.v151-change{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;margin-top:12px}.v151-change span{padding:11px;border:1px solid #cbdbea;border-radius:9px;background:#fff}.v151-change small,.v151-change b{display:block}.v151-change small{color:#6e8295;font-size:10px}.v151-change b{margin-top:4px;color:#154d80;font-size:16px}.v151-change i{font-size:21px;color:#2d6da6}.v151-counts{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin-top:9px}.v151-counts span{padding:10px;border:1px solid #d4e0eb;border-radius:9px;background:#fff}.v151-counts small,.v151-counts b{display:block}.v151-counts small{min-height:24px;color:#6a8094;font-size:9px}.v151-counts b{color:#164d7e;font-size:18px}.v151-note,.v151-empty{display:grid;gap:3px;margin-top:9px;padding:10px 12px;border-radius:8px}.v151-note{background:#e7f6ec;color:#17653a}.v151-empty{background:#edf3f8;color:#637a8f}.v151-confirm{display:flex!important;align-items:center;gap:9px;margin-top:11px;padding:10px;border:1px solid #c5d8e8;border-radius:9px;background:#fff;color:#385b79;font-weight:800}.v151-confirm input{width:20px;height:20px;accent-color:#176a9e}.v151-save{width:100%;margin-top:9px!important;border:0!important;border-radius:9px!important;background:#176a9e!important;color:#fff!important;padding:12px!important;font-size:14px!important;font-weight:900!important}.v151-save:disabled{background:#99a9b8!important}@media(max-width:800px){.v151-fields{grid-template-columns:1fr 1fr}.v151-fields button{grid-column:1/-1}.v151-counts{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.v151-head{display:grid}.v151-fields,.v151-change,.v151-counts{grid-template-columns:1fr}.v151-fields button{grid-column:auto}.v151-change i{text-align:center;transform:rotate(90deg)}}`;document.head.appendChild(style);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(upgrade,560);setTimeout(upgrade,1350)},{once:true});else{setTimeout(upgrade,560);setTimeout(upgrade,1350)}
})();
