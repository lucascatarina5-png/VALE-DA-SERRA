(function(){
  'use strict';

  const N=value=>Number(value||0);
  const E=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const norm=value=>String(value||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const liters=value=>N(value).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const cash=value=>N(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const clone=value=>JSON.parse(JSON.stringify(value));
  const admin=()=>{try{return typeof v4IsAdmin!=='function'||v4IsAdmin()}catch(_){return false}};

  function dateKey(value){
    const text=String(value||'').trim(),iso=text.match(/^(\d{4})-(\d{2})-(\d{2})/),br=text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return iso?`${iso[1]}-${iso[2]}-${iso[3]}`:br?`${br[3]}-${br[2]}-${br[1]}`:text.slice(0,10);
  }
  function producer(id){return (Array.isArray(produtores)?produtores:[]).find(item=>String(item.id)===String(id))}
  function entryLocality(entry){return String(entry?.local||producer(entry?.prodId)?.local||'').trim()}
  function paymentLocality(payment){return String(payment?.localidade||producer(payment?.prodId)?.local||'').trim()}
  function debtLocality(debt){return String(debt?.localidade||producer(debt?.prodId)?.local||'').trim()}
  function paymentPeriod(payment){
    const ym=String(payment?.mes||''),q=String(payment?.quinzena||'');
    if(/^\d{4}-\d{2}$/.test(ym)&&['1','2'].includes(q))return {start:ym+(q==='1'?'-01':'-16'),end:ym+(q==='1'?'-15':'-31')};
    const date=dateKey(payment?.corteData||payment?.dataPagamento);return /^\d{4}-\d{2}-\d{2}$/.test(date)?{start:date,end:date}:null;
  }
  function entryIsPaid(entry){
    const status=norm(entry?.situacaoPagamento||'');
    if(entry?.pagamentoId||status.startsWith('liquid')||status.startsWith('pag'))return true;
    return (Array.isArray(pagamentos)?pagamentos:[]).some(payment=>{
      if(Array.isArray(payment.entryIds))return payment.entryIds.some(id=>String(id)===String(entry.id));
      const period=paymentPeriod(payment),date=dateKey(entry.data);
      return !!period&&String(payment.prodId)===String(entry.prodId)&&date>=period.start&&date<=period.end;
    });
  }
  function debtHasSettlement(debt){
    const id=String(debt.id),status=norm(debt.situacaoPagamento||'');
    if(status.startsWith('liquid')||debt.pagamentoId)return true;
    if((Array.isArray(pagamentosDebitos)?pagamentosDebitos:[]).some(item=>String(item.debitoId)===id&&N(item.valor)>0))return true;
    return (Array.isArray(pagamentos)?pagamentos:[]).some(payment=>(payment.debitIds||[]).some(debitId=>String(debitId)===id)||(payment.debitApplications||[]).some(item=>String(item.debitId)===id&&N(item.amount)>0));
  }
  function knownLocalities(){
    const values=[];
    (Array.isArray(produtores)?produtores:[]).forEach(item=>{values.push(item.local);if(Array.isArray(item.localidadesConhecidas))values.push(...item.localidadesConhecidas)});
    (Array.isArray(lancamentos)?lancamentos:[]).forEach(entry=>values.push(entryLocality(entry)));
    (Array.isArray(pagamentos)?pagamentos:[]).forEach(payment=>values.push(paymentLocality(payment)));
    return [...new Set(values.map(value=>String(value||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  }
  function buildPreview(local,start,end){
    const locality=String(local||'').trim(),startDate=dateKey(start),endDate=dateKey(end),valid=!!locality&&/^\d{4}-\d{2}-\d{2}$/.test(startDate)&&/^\d{4}-\d{2}-\d{2}$/.test(endDate)&&startDate<=endDate;
    const rows=valid?(Array.isArray(lancamentos)?lancamentos:[]).filter(entry=>{const date=dateKey(entry.data);return norm(entryLocality(entry))===norm(locality)&&date>=startDate&&date<=endDate}):[];
    const rowIds=new Set(rows.map(entry=>String(entry.id))),paidRows=rows.filter(entryIsPaid),pendingRows=rows.filter(entry=>!entryIsPaid(entry));
    const paymentRows=valid?(Array.isArray(pagamentos)?pagamentos:[]).filter(payment=>{
      if(Array.isArray(payment.entryIds)&&payment.entryIds.some(id=>rowIds.has(String(id))))return true;
      const period=paymentPeriod(payment);return norm(paymentLocality(payment))===norm(locality)&&!!period&&period.start<=endDate&&period.end>=startDate;
    }):[];
    const debtRows=valid?(Array.isArray(debitos)?debitos:[]).filter(debt=>{const date=dateKey(debt.data);return norm(debtLocality(debt))===norm(locality)&&date>=startDate&&date<=endDate}):[];
    const protectedDebtRows=debtRows.filter(debtHasSettlement),deletableDebtRows=debtRows.filter(debt=>!debtHasSettlement(debt));
    return {valid,local:locality,start:startDate,end:endDate,rows,rowIds,paidRows,pendingRows,paymentRows,debtRows,protectedDebtRows,deletableDebtRows,entries:rows.length,pending:pendingRows.length,paid:paidRows.length,liters:rows.reduce((sum,entry)=>sum+N(entry.qtd),0),pendingLiters:pendingRows.reduce((sum,entry)=>sum+N(entry.qtd),0),producers:new Set(rows.map(entry=>String(entry.prodId))).size,payments:paymentRows.length,paymentValue:paymentRows.reduce((sum,payment)=>sum+N(payment.valorPago),0),debts:debtRows.length,deletableDebts:deletableDebtRows.length,protectedDebts:protectedDebtRows.length,debtValue:deletableDebtRows.reduce((sum,debt)=>sum+N(debt.valor),0)};
  }
  window.v149CleanupPreview=buildPreview;

  function previousMonth(){
    const now=new Date(),date=new Date(now.getFullYear(),now.getMonth()-1,1),ym=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`,last=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();
    return {start:ym+'-01',end:ym+'-'+String(last).padStart(2,'0')};
  }
  function actions(){return {entries:!!document.getElementById('v149DoEntries')?.checked,payments:!!document.getElementById('v149DoPayments')?.checked,debts:!!document.getElementById('v149DoDebts')?.checked}}
  function selectedPreview(){return buildPreview(document.getElementById('v149Local')?.value,document.getElementById('v149Start')?.value,document.getElementById('v149End')?.value)}
  function selectionTotals(data,selected){
    const entries=selected.entries?(selected.payments?data.rows:data.pendingRows):[],payments=selected.payments?data.paymentRows:[],debts=selected.debts?data.deletableDebtRows:[];
    return {entries,payments,debts,count:entries.length+payments.length+debts.length,liters:entries.reduce((sum,item)=>sum+N(item.qtd),0),paymentValue:payments.reduce((sum,item)=>sum+N(item.valorPago),0),debtValue:debts.reduce((sum,item)=>sum+N(item.valor),0)};
  }
  function renderHistory(){
    const box=document.getElementById('v149History');if(!box)return;let history=[];try{history=JSON.parse(localStorage.getItem('vds_data_cleanup_history_v149')||'[]')}catch(_){}
    box.innerHTML=history.length?`<details><summary>Últimas limpezas realizadas (${history.length})</summary>${history.slice(0,8).map(item=>`<div><span><b>${E(item.local)}</b><small>${E(item.start.split('-').reverse().join('/'))} a ${E(item.end.split('-').reverse().join('/'))} • ${E(new Date(item.executedAt).toLocaleString('pt-BR'))}</small></span><strong>${item.entries} entrada(s) • ${item.payments} pagamento(s) • ${item.debts} débito(s)</strong></div>`).join('')}</details>`:'';
  }
  window.v149RenderCleanupPreview=function(){
    const data=selectedPreview(),selected=actions(),chosen=selectionTotals(data,selected),box=document.getElementById('v149Preview'),button=document.getElementById('v149Delete'),check=document.getElementById('v149Confirm');if(!box||!button)return data;
    if(!data.valid){box.innerHTML='<div class="v149-empty">Escolha uma localidade e informe corretamente a data inicial e a data final.</div>';button.disabled=true;return data}
    box.innerHTML=`<div class="v149-preview-grid"><span><small>Entradas de leite</small><b>${data.entries}</b><em>${liters(data.liters)} L</em></span><span><small>Pagamentos / baixas</small><b>${data.payments}</b><em>${cash(data.paymentValue)}</em></span><span><small>Débitos cadastrados</small><b>${data.debts}</b><em>${cash(data.debtRows.reduce((sum,item)=>sum+N(item.valor),0))}</em></span><span class="delete"><small>Itens selecionados</small><b>${chosen.count}</b><em>para excluir</em></span></div>${data.paid&&!selected.payments?`<div class="v149-protected"><b>🔒 ${data.paid} entrada(s) paga(s) estão protegidas</b><span>Marque “Pagamentos e baixas” para retirar também os pagamentos de teste ligados a elas.</span></div>`:''}${data.protectedDebts?`<div class="v149-protected"><b>🔒 ${data.protectedDebts} débito(s) com pagamento estão protegidos</b><span>Primeiro exclua a baixa/pagamento. Depois confira novamente para apagar o débito, caso ele também seja teste.</span></div>`:''}<div class="v149-safe-note"><b>Serão mantidos:</b> todos os produtores, dados de outras localidades, registros fora das datas, vendas, estoque, usuários e relatórios.</div>`;
    const labels=[];if(chosen.entries.length)labels.push(`${chosen.entries.length} entrada(s) / ${liters(chosen.liters)} L`);if(chosen.payments.length)labels.push(`${chosen.payments.length} pagamento(s)`);if(chosen.debts.length)labels.push(`${chosen.debts.length} débito(s)`);button.textContent=labels.length?'Excluir '+labels.join(' + '):'Nenhum registro selecionado para excluir';button.disabled=!chosen.count||!check?.checked;return data;
  };
  window.v149ToggleDelete=function(){window.v149RenderCleanupPreview()};

  function resetDebtStatus(debtIds){
    const ids=new Set([...debtIds].map(String));
    (Array.isArray(debitos)?debitos:[]).forEach(debt=>{if(!ids.has(String(debt.id)))return;const manual=(Array.isArray(pagamentosDebitos)?pagamentosDebitos:[]).filter(item=>String(item.debitoId)===String(debt.id)).reduce((sum,item)=>sum+N(item.valor),0),legacy=(Array.isArray(pagamentos)?pagamentos:[]).some(payment=>!Array.isArray(payment.debitApplications)&&(payment.debitIds||[]).some(id=>String(id)===String(debt.id))),balance=legacy?0:Math.max(0,N(debt.valor)-manual);debt.situacaoPagamento=balance<=0?'Liquidado':'Pendente';if(balance>0)delete debt.pagamentoId});
  }
  function applyCleanup(data,selected){
    const chosen=selectionTotals(data,selected),paymentIds=new Set(chosen.payments.map(payment=>String(payment.id||payment.chave||''))),closureIds=new Set(chosen.payments.map(payment=>String(payment.fechamentoId||'')).filter(Boolean)),entryIdsFromPayments=new Set(chosen.payments.flatMap(payment=>payment.entryIds||[]).map(String)),debtIdsFromPayments=new Set(chosen.payments.flatMap(payment=>[...(payment.debitIds||[]),...(payment.debitApplications||[]).map(item=>item.debitId)]).map(String)),entryIds=new Set(chosen.entries.map(entry=>String(entry.id))),debtIds=new Set(chosen.debts.map(debt=>String(debt.id)));
    if(chosen.payments.length){pagamentos=pagamentos.filter(payment=>!paymentIds.has(String(payment.id||payment.chave||'')));pagamentosDebitos=pagamentosDebitos.filter(item=>!paymentIds.has(String(item.pagamentoId||''))&&!closureIds.has(String(item.fechamentoId||'')));lancamentos.forEach(entry=>{if(entryIdsFromPayments.has(String(entry.id))&&!entryIds.has(String(entry.id))){entry.situacaoPagamento='Pendente';delete entry.pagamentoId;delete entry.dataLiquidacao}})}
    if(chosen.entries.length)lancamentos=lancamentos.filter(entry=>!entryIds.has(String(entry.id)));
    if(chosen.debts.length){debitos=debitos.filter(debt=>!debtIds.has(String(debt.id)));pagamentosDebitos=pagamentosDebitos.filter(item=>!debtIds.has(String(item.debitoId)))}
    resetDebtStatus(debtIdsFromPayments);
    return {entries:chosen.entries.length,liters:chosen.liters,payments:chosen.payments.length,paymentValue:chosen.paymentValue,debts:chosen.debts.length,debtValue:chosen.debtValue};
  }
  window.v149ApplyCleanupData=applyCleanup;

  async function syncState(){
    let importacoesPdf=[];try{importacoesPdf=JSON.parse(localStorage.getItem('vds_pdf_import_batches_v137')||'[]')}catch(_){}
    const headers=typeof v4Headers==='function'?v4Headers():{};headers['Content-Type']='application/json';
    const response=await fetch('/api/state',{method:'PUT',headers,body:JSON.stringify({data:{produtores,lancamentos,pagamentos,debitos,pagamentosDebitos:typeof pagamentosDebitos==='undefined'?[]:pagamentosDebitos,importacoesPdf}}),cache:'no-store'});
    if(!response.ok){let message='O servidor não confirmou a limpeza.';try{const json=await response.json();if(json.error)message=json.error}catch(_){}throw new Error(message)}
  }
  window.v149DeleteData=async function(){
    if(!admin())return alert('Somente o Administrador pode executar esta limpeza.');
    const data=selectedPreview(),selected=actions(),chosen=selectionTotals(data,selected),check=document.getElementById('v149Confirm'),button=document.getElementById('v149Delete');
    if(!data.valid)return alert('Escolha a localidade e informe corretamente as datas.');
    if(!chosen.count)return alert('Nenhum registro foi encontrado nas opções marcadas.');
    if(!check?.checked)return alert('Marque a confirmação de segurança antes de excluir.');
    const details=[chosen.entries.length?`Entradas de leite: ${chosen.entries.length} (${liters(chosen.liters)} L)`:null,chosen.payments.length?`Pagamentos/baixas: ${chosen.payments.length} (${cash(chosen.paymentValue)})`:null,chosen.debts.length?`Débitos: ${chosen.debts.length} (${cash(chosen.debtValue)})`:null].filter(Boolean).join('\n');
    if(!confirm(`EXCLUIR OS DADOS DE TESTE DE ${data.local.toUpperCase()}?\n\nPeríodo: ${data.start.split('-').reverse().join('/')} a ${data.end.split('-').reverse().join('/')}\n${details}\n\nProdutores e dados das outras localidades serão mantidos.\n\nEsta exclusão não pode ser desfeita pela tela.`))return;
    const old={lancamentos:clone(lancamentos),pagamentos:clone(pagamentos),debitos:clone(debitos),pagamentosDebitos:clone(typeof pagamentosDebitos==='undefined'?[]:pagamentosDebitos)};if(button){button.disabled=true;button.textContent='Excluindo e confirmando no servidor...'}
    try{
      const result=applyCleanup(data,selected);await syncState();if(typeof save==='function')save();
      let history=[];try{history=JSON.parse(localStorage.getItem('vds_data_cleanup_history_v149')||'[]')}catch(_){}history.unshift({id:crypto.randomUUID(),executedAt:new Date().toISOString(),local:data.local,start:data.start,end:data.end,...result,user:(typeof V4!=='undefined'&&V4?.user?.username)||'Administrador'});localStorage.setItem('vds_data_cleanup_history_v149',JSON.stringify(history.slice(0,20)));
      try{if(typeof v25Audit==='function')await v25Audit('ENTRADAS_LEITE_PERIODO_EXCLUIDAS',{localidade:data.local,inicio:data.start,fim:data.end,...result,modo:'limpeza-integrada-v149'})}catch(_){}
      if(check)check.checked=false;window.v149RenderCleanupPreview();renderHistory();try{if(typeof renderPagamentos==='function')renderPagamentos(false)}catch(_){}try{if(typeof v144Refresh==='function')v144Refresh()}catch(_){}try{if(typeof v133RenderMercadorias==='function')v133RenderMercadorias()}catch(_){}
      alert(`✅ LIMPEZA CONCLUÍDA.\n\nLocalidade: ${data.local}\nPeríodo: ${data.start.split('-').reverse().join('/')} a ${data.end.split('-').reverse().join('/')}\n\n${result.entries} entrada(s) excluída(s) • ${liters(result.liters)} L\n${result.payments} pagamento(s)/baixa(s) excluído(s)\n${result.debts} débito(s) excluído(s)\n\nProdutores e dados das outras localidades foram mantidos.`);
    }catch(error){lancamentos=old.lancamentos;pagamentos=old.pagamentos;debitos=old.debitos;pagamentosDebitos=old.pagamentosDebitos;if(typeof save==='function')save();window.v149RenderCleanupPreview();alert('❌ A limpeza não foi confirmada pelo servidor. Nenhum dado foi apagado.\n\nMotivo: '+error.message)}
  };

  function maintenanceHTML(){return `<summary>🧹 Limpeza segura de dados de testes</summary><div class="v149-maintenance-body"><div class="v149-title"><div><b>Excluir por localidade e período</b><p>Agora a limpeza também retira pagamentos/baixas e débitos de teste.</p></div><span>V149 • SOMENTE ADMINISTRADOR</span></div><div class="v149-tools"><label>Localidade<select id="v149Local" onchange="v149RenderCleanupPreview()"><option value="">Escolha a localidade...</option></select></label><label>Data inicial<input id="v149Start" type="date" onchange="v149RenderCleanupPreview()"></label><label>Data final<input id="v149End" type="date" onchange="v149RenderCleanupPreview()"></label><button type="button" onclick="v149RenderCleanupPreview()">🔎 Conferir dados</button></div><div class="v149-options"><b>O que deseja apagar?</b><label><input id="v149DoEntries" type="checkbox" checked onchange="v149RenderCleanupPreview()"><span>🥛 Entradas de leite</span></label><label><input id="v149DoPayments" type="checkbox" checked onchange="v149RenderCleanupPreview()"><span>💰 Pagamentos e baixas</span></label><label><input id="v149DoDebts" type="checkbox" onchange="v149RenderCleanupPreview()"><span>🏷️ Débitos dos produtores</span></label></div><div id="v149Preview"></div><label class="v149-confirm"><input id="v149Confirm" type="checkbox" onchange="v149ToggleDelete()"><span>Conferi a localidade, as datas e todos os totais acima.</span></label><button id="v149Delete" class="v149-delete" type="button" onclick="v149DeleteData()" disabled>Escolha os filtros para continuar</button><div id="v149History"></div></div>`}
  function upgrade(){
    const card=document.querySelector('#configuracoes .card');if(!card)return false;let box=document.getElementById('v139Maintenance')||document.getElementById('v148Maintenance')||document.getElementById('v149Maintenance');
    if(!box){box=document.createElement('details');card.appendChild(box)}
    if(box.dataset.v149!=='1'){box.dataset.v149='1';box.id='v149Maintenance';box.className='v139-maintenance v149-maintenance';box.innerHTML=maintenanceHTML();const period=previousMonth(),start=document.getElementById('v149Start'),end=document.getElementById('v149End');if(start)start.value=period.start;if(end)end.value=period.end}
    const select=document.getElementById('v149Local'),wanted=select?.value||'';if(select){const places=knownLocalities();select.innerHTML='<option value="">Escolha a localidade...</option>'+places.map(place=>`<option value="${E(place)}">${E(place)}</option>`).join('');select.value=places.find(place=>norm(place)===norm(wanted))||''}
    renderHistory();window.v149RenderCleanupPreview();return true;
  }
  window.v149EnsureMaintenance=upgrade;

  const style=document.createElement('style');style.id='v149-cleanup-style';style.textContent=`.v149-maintenance{margin-top:20px!important;border:2px solid #b9cfe6!important;border-radius:14px!important;padding:0!important;overflow:hidden;background:#fff!important}.v149-maintenance>summary{padding:15px 17px;cursor:pointer;font-size:16px;font-weight:900;color:#0d4178;background:#edf5fd}.v149-maintenance-body{margin:0!important;padding:16px!important;background:#fff!important;border-radius:0!important}.v149-title{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.v149-title div>b{font-size:17px;color:#123f6e}.v149-title p{margin:4px 0 0;color:#61768b}.v149-title>span{flex:0 0 auto;border-radius:999px;padding:7px 9px;background:#fff0cd;color:#805400;font-size:10px;font-weight:900}.v149-tools{display:grid;grid-template-columns:1.4fr 1fr 1fr auto;align-items:end;gap:10px;margin-top:15px;padding:13px;border-radius:11px;background:#f3f7fb}.v149-tools label{font-size:11px;font-weight:900;color:#48647f}.v149-tools select,.v149-tools input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #bdcedf;border-radius:8px;background:#fff}.v149-tools button{border:0;border-radius:8px;background:#15518d;color:#fff;padding:11px 13px;font-weight:900}.v149-options{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:10px}.v149-options>b{color:#314f6d}.v149-options label{display:flex;align-items:center;gap:6px;padding:9px 11px;border:1px solid #cbd9e6;border-radius:9px;background:#fff;font-weight:800;color:#244b72}.v149-options input{width:18px;height:18px;accent-color:#15518d}.v149-preview-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.v149-preview-grid>span{padding:12px;border:1px solid #d8e3ee;border-radius:10px;background:#fff}.v149-preview-grid small,.v149-preview-grid b,.v149-preview-grid em{display:block}.v149-preview-grid small{color:#657a90;font-size:10px}.v149-preview-grid b{margin-top:5px;color:#123e6d;font-size:20px}.v149-preview-grid em{margin-top:3px;color:#6d7e90;font-style:normal}.v149-preview-grid .delete{border-color:#efb8b8;background:#fff4f4}.v149-preview-grid .delete b{color:#ad2929}.v149-protected,.v149-safe-note,.v149-empty{display:grid;gap:4px;margin-top:10px;padding:11px 13px;border-radius:9px}.v149-protected{background:#fff1d8;color:#805000}.v149-protected span,.v149-safe-note,.v149-empty span{font-size:11px}.v149-safe-note{background:#eaf7ef;color:#17683a}.v149-empty{background:#f3f6f9;color:#62758a}.v149-confirm{display:flex!important;align-items:center;gap:9px;margin-top:12px;padding:11px;border:1px solid #e1c3c3;border-radius:9px;background:#fff7f7;color:#733838;font-weight:800}.v149-confirm input{width:20px;height:20px;accent-color:#b52626}.v149-delete{width:100%;margin-top:9px!important;border:0!important;border-radius:9px!important;background:#b52626!important;color:#fff!important;padding:12px!important;font-size:14px!important;font-weight:900!important}.v149-delete:disabled{background:#99a8b7!important;cursor:not-allowed!important}.v149-maintenance #v149History details{margin-top:12px;border-top:1px solid #dce5ee;padding-top:10px}.v149-maintenance #v149History summary{cursor:pointer;color:#385a7c;font-weight:800}.v149-maintenance #v149History details>div{display:flex;justify-content:space-between;gap:10px;padding:8px;border-bottom:1px solid #edf1f5}.v149-maintenance #v149History small{display:block;color:#748597;margin-top:3px}@media(max-width:900px){.v149-tools,.v149-preview-grid{grid-template-columns:1fr 1fr}.v149-tools button{grid-column:1/-1}}@media(max-width:560px){.v149-title{display:grid}.v149-tools,.v149-preview-grid{grid-template-columns:1fr}.v149-tools button{grid-column:auto}.v149-options{display:grid}.v149-maintenance #v149History details>div{display:grid}}`;document.head.appendChild(style);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(upgrade,260);setTimeout(upgrade,900)},{once:true});else{setTimeout(upgrade,260);setTimeout(upgrade,900)}
})();
