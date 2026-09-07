(function(){
  'use strict';

  const N=value=>Number(value||0);
  const E=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const norm=value=>String(value||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const liters=value=>N(value).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const clone=value=>JSON.parse(JSON.stringify(value));
  const admin=()=>{try{return typeof v4IsAdmin!=='function'||v4IsAdmin()}catch(_){return false}};

  function dateKey(value){
    const text=String(value||'').trim(),iso=text.match(/^(\d{4})-(\d{2})-(\d{2})/),br=text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return iso?`${iso[1]}-${iso[2]}-${iso[3]}`:br?`${br[3]}-${br[2]}-${br[1]}`:text.slice(0,10);
  }
  function producer(id){return (Array.isArray(produtores)?produtores:[]).find(item=>String(item.id)===String(id))}
  function entryLocality(entry){return String(entry?.local||producer(entry?.prodId)?.local||'').trim()}
  function paymentPeriod(payment){
    const ym=String(payment?.mes||''),q=String(payment?.quinzena||'');
    if(!/^\d{4}-\d{2}$/.test(ym)||!['1','2'].includes(q))return null;
    return {start:ym+(q==='1'?'-01':'-16'),end:ym+(q==='1'?'-15':'-31')};
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
  function knownLocalities(){
    const values=[];
    (Array.isArray(produtores)?produtores:[]).forEach(item=>{values.push(item.local);if(Array.isArray(item.localidadesConhecidas))values.push(...item.localidadesConhecidas)});
    (Array.isArray(lancamentos)?lancamentos:[]).forEach(entry=>values.push(entryLocality(entry)));
    return [...new Set(values.map(value=>String(value||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  }
  function buildPreview(local,start,end){
    const locality=String(local||'').trim(),startDate=dateKey(start),endDate=dateKey(end),valid=!!locality&&/^\d{4}-\d{2}-\d{2}$/.test(startDate)&&/^\d{4}-\d{2}-\d{2}$/.test(endDate)&&startDate<=endDate;
    const rows=valid?(Array.isArray(lancamentos)?lancamentos:[]).filter(entry=>{const date=dateKey(entry.data);return norm(entryLocality(entry))===norm(locality)&&date>=startDate&&date<=endDate}):[];
    const paidRows=rows.filter(entryIsPaid),pendingRows=rows.filter(entry=>!entryIsPaid(entry));
    return {valid,local:locality,start:startDate,end:endDate,rows,paidRows,pendingRows,entries:rows.length,pending:pendingRows.length,paid:paidRows.length,liters:rows.reduce((sum,entry)=>sum+N(entry.qtd),0),pendingLiters:pendingRows.reduce((sum,entry)=>sum+N(entry.qtd),0),producers:new Set(rows.map(entry=>String(entry.prodId))).size,pendingProducers:new Set(pendingRows.map(entry=>String(entry.prodId))).size};
  }
  window.v148CleanupPreview=buildPreview;

  function previousMonth(){
    const now=new Date(),date=new Date(now.getFullYear(),now.getMonth()-1,1),ym=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`,last=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();
    return {start:ym+'-01',end:ym+'-'+String(last).padStart(2,'0')};
  }
  function selectedPreview(){return buildPreview(document.getElementById('v148Local')?.value,document.getElementById('v148Start')?.value,document.getElementById('v148End')?.value)}
  function renderHistory(){
    const box=document.getElementById('v148History');if(!box)return;let history=[];try{history=JSON.parse(localStorage.getItem('vds_leite_cleanup_history_v148')||'[]')}catch(_){}
    box.innerHTML=history.length?`<details><summary>Últimas limpezas realizadas (${history.length})</summary>${history.slice(0,8).map(item=>`<div><span><b>${E(item.local)}</b><small>${E(item.start.split('-').reverse().join('/'))} a ${E(item.end.split('-').reverse().join('/'))} • ${E(new Date(item.executedAt).toLocaleString('pt-BR'))}</small></span><strong>${item.entries} entrada(s) • ${liters(item.liters)} L</strong></div>`).join('')}</details>`:'';
  }
  window.v148RenderCleanupPreview=function(){
    const data=selectedPreview(),box=document.getElementById('v148Preview'),button=document.getElementById('v148Delete'),check=document.getElementById('v148Confirm');if(!box||!button)return data;
    if(!data.valid){box.innerHTML='<div class="v148-empty">Escolha uma localidade e informe corretamente a data inicial e a data final.</div>';button.disabled=true;return data}
    if(!data.entries){box.innerHTML=`<div class="v148-empty ok"><b>✅ Nenhuma entrada encontrada</b><span>Não existem registros de leite de ${E(data.local)} neste intervalo.</span></div>`;button.disabled=true;return data}
    box.innerHTML=`<div class="v148-preview-grid"><span><small>Entradas encontradas</small><b>${data.entries}</b></span><span><small>Produtores</small><b>${data.producers}</b></span><span><small>Litros encontrados</small><b>${liters(data.liters)} L</b></span><span class="delete"><small>Será excluído</small><b>${data.pending} entrada(s)</b><em>${liters(data.pendingLiters)} L</em></span></div>${data.paid?`<div class="v148-protected"><b>🔒 ${data.paid} entrada(s) já paga(s) estão protegidas</b><span>Elas não serão apagadas. Se também forem testes, primeiro desfaça o pagamento na tela Pagamentos e volte aqui.</span></div>`:''}<div class="v148-safe-note"><b>Serão mantidos:</b> todos os produtores, entradas de outras localidades, registros fora das datas, débitos, vendas, estoque, usuários e relatórios.</div>`;
    button.textContent=data.pending?`Excluir ${data.pending} entrada(s) • ${liters(data.pendingLiters)} L`:'Nenhuma entrada pendente para excluir';button.disabled=!data.pending||!check?.checked;return data;
  };
  window.v148ToggleDelete=function(){window.v148RenderCleanupPreview()};

  async function syncState(){
    let importacoesPdf=[];try{importacoesPdf=JSON.parse(localStorage.getItem('vds_pdf_import_batches_v137')||'[]')}catch(_){}
    const headers=typeof v4Headers==='function'?v4Headers():{};headers['Content-Type']='application/json';
    const response=await fetch('/api/state',{method:'PUT',headers,body:JSON.stringify({data:{produtores,lancamentos,pagamentos,debitos,pagamentosDebitos:typeof pagamentosDebitos==='undefined'?[]:pagamentosDebitos,importacoesPdf}}),cache:'no-store'});
    if(!response.ok){let message='O servidor não confirmou a limpeza.';try{const json=await response.json();if(json.error)message=json.error}catch(_){}throw new Error(message)}
  }
  window.v148DeleteMilkEntries=async function(){
    if(!admin())return alert('Somente o Administrador pode excluir entradas de teste.');
    const data=selectedPreview(),check=document.getElementById('v148Confirm'),button=document.getElementById('v148Delete');
    if(!data.valid)return alert('Escolha a localidade e informe corretamente as datas.');
    if(!data.pending)return alert(data.paid?'As entradas encontradas já estão pagas e foram protegidas. Desfaça o pagamento antes de excluí-las.':'Nenhuma entrada pendente foi encontrada neste filtro.');
    if(!check?.checked)return alert('Marque a confirmação de segurança antes de excluir.');
    if(!confirm(`EXCLUIR ENTRADAS DE TESTE DE ${data.local.toUpperCase()}?\n\nPeríodo: ${data.start.split('-').reverse().join('/')} a ${data.end.split('-').reverse().join('/')}\nEntradas pendentes: ${data.pending}\nProdutores: ${data.pendingProducers}\nLeite: ${liters(data.pendingLiters)} litros\n\nTodos os produtores e os dados das outras localidades serão mantidos.\n\nEsta exclusão não pode ser desfeita pela tela.`))return;
    const oldEntries=clone(lancamentos),ids=new Set(data.pendingRows.map(entry=>String(entry.id)));if(button){button.disabled=true;button.textContent='Excluindo e confirmando no servidor...'}
    try{
      lancamentos=lancamentos.filter(entry=>!ids.has(String(entry.id)));
      await syncState();
      if(typeof save==='function')save();
      let history=[];try{history=JSON.parse(localStorage.getItem('vds_leite_cleanup_history_v148')||'[]')}catch(_){}history.unshift({id:crypto.randomUUID(),executedAt:new Date().toISOString(),local:data.local,start:data.start,end:data.end,entries:data.pending,liters:data.pendingLiters,producers:data.pendingProducers,user:(typeof V4!=='undefined'&&V4?.user?.username)||'Administrador'});localStorage.setItem('vds_leite_cleanup_history_v148',JSON.stringify(history.slice(0,20)));
      try{if(typeof v25Audit==='function')await v25Audit('ENTRADAS_LEITE_PERIODO_EXCLUIDAS',{localidade:data.local,inicio:data.start,fim:data.end,entradas:data.pending,litros:data.pendingLiters,produtores:data.pendingProducers,modo:'limpeza-segura-v148'})}catch(_){}
      if(check)check.checked=false;window.v148RenderCleanupPreview();renderHistory();try{if(typeof renderPagamentos==='function')renderPagamentos(false)}catch(_){}try{if(typeof v144Refresh==='function')v144Refresh()}catch(_){}
      alert(`✅ LIMPEZA CONCLUÍDA.\n\nLocalidade: ${data.local}\nPeríodo: ${data.start.split('-').reverse().join('/')} a ${data.end.split('-').reverse().join('/')}\n${data.pending} entrada(s) excluída(s)\n${liters(data.pendingLiters)} litros retirados\n\nTodos os produtores e os dados das outras localidades foram mantidos.`);
    }catch(error){lancamentos=oldEntries;if(typeof save==='function')save();window.v148RenderCleanupPreview();alert('❌ A limpeza não foi confirmada pelo servidor. Nenhuma entrada foi apagada.\n\nMotivo: '+error.message)}
  };

  function maintenanceHTML(){return `<summary>🧹 Limpeza segura de entradas de leite</summary><div class="v148-maintenance-body"><div class="v148-title"><div><b>Excluir registros de testes por localidade e período</b><p>Use esta ferramenta antes de importar a nova quinzena. Confira a prévia com atenção.</p></div><span>V148 • SOMENTE ADMINISTRADOR</span></div><div class="v148-tools"><label>Localidade das entradas<select id="v148Local" onchange="v148RenderCleanupPreview()"><option value="">Escolha a localidade...</option></select></label><label>Data inicial<input id="v148Start" type="date" onchange="v148RenderCleanupPreview()"></label><label>Data final<input id="v148End" type="date" onchange="v148RenderCleanupPreview()"></label><button type="button" onclick="v148RenderCleanupPreview()">🔎 Conferir entradas</button></div><div id="v148Preview"></div><label class="v148-confirm"><input id="v148Confirm" type="checkbox" onchange="v148ToggleDelete()"><span>Conferi a localidade, as datas, a quantidade de entradas e os litros.</span></label><button id="v148Delete" class="v148-delete" type="button" onclick="v148DeleteMilkEntries()" disabled>Escolha os filtros para continuar</button><div id="v148History"></div></div>`}
  function upgrade(){
    const card=document.querySelector('#configuracoes .card');if(!card)return false;let box=document.getElementById('v139Maintenance')||document.getElementById('v148Maintenance');
    if(!box){box=document.createElement('details');box.id='v148Maintenance';card.appendChild(box)}
    if(box.dataset.v148!=='1'){box.dataset.v148='1';box.id='v148Maintenance';box.className='v139-maintenance v148-maintenance';box.innerHTML=maintenanceHTML();const period=previousMonth(),start=document.getElementById('v148Start'),end=document.getElementById('v148End');if(start)start.value=period.start;if(end)end.value=period.end}
    const select=document.getElementById('v148Local'),wanted=select?.value||'';if(select){const places=knownLocalities();select.innerHTML='<option value="">Escolha a localidade...</option>'+places.map(place=>`<option value="${E(place)}">${E(place)}</option>`).join('');select.value=places.find(place=>norm(place)===norm(wanted))||''}
    renderHistory();window.v148RenderCleanupPreview();return true;
  }
  window.v148EnsureMaintenance=upgrade;

  const style=document.createElement('style');style.id='v148-cleanup-style';style.textContent=`.v148-maintenance{margin-top:20px!important;border:2px solid #b9cfe6!important;border-radius:14px!important;padding:0!important;overflow:hidden;background:#fff!important}.v148-maintenance>summary{padding:15px 17px;cursor:pointer;font-size:16px;font-weight:900;color:#0d4178;background:#edf5fd}.v148-maintenance-body{margin:0!important;padding:16px!important;background:#fff!important;border-radius:0!important}.v148-title{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.v148-title>b,.v148-title div>b{font-size:17px;color:#123f6e}.v148-title p{margin:4px 0 0;color:#61768b}.v148-title>span{flex:0 0 auto;border-radius:999px;padding:7px 9px;background:#fff0cd;color:#805400;font-size:10px;font-weight:900}.v148-tools{display:grid;grid-template-columns:1.4fr 1fr 1fr auto;align-items:end;gap:10px;margin-top:15px;padding:13px;border-radius:11px;background:#f3f7fb}.v148-tools label{font-size:11px;font-weight:900;color:#48647f}.v148-tools select,.v148-tools input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #bdcedf;border-radius:8px;background:#fff}.v148-tools button{border:0;border-radius:8px;background:#15518d;color:#fff;padding:11px 13px;font-weight:900}.v148-preview-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.v148-preview-grid>span{padding:12px;border:1px solid #d8e3ee;border-radius:10px;background:#fff}.v148-preview-grid small,.v148-preview-grid b,.v148-preview-grid em{display:block}.v148-preview-grid small{color:#657a90;font-size:10px}.v148-preview-grid b{margin-top:5px;color:#123e6d;font-size:20px}.v148-preview-grid em{margin-top:3px;color:#6d7e90;font-style:normal}.v148-preview-grid .delete{border-color:#efb8b8;background:#fff4f4}.v148-preview-grid .delete b{color:#ad2929}.v148-protected,.v148-safe-note,.v148-empty{display:grid;gap:4px;margin-top:10px;padding:11px 13px;border-radius:9px}.v148-protected{background:#fff1d8;color:#805000}.v148-protected span,.v148-safe-note,.v148-empty span{font-size:11px}.v148-safe-note{background:#eaf7ef;color:#17683a}.v148-empty{background:#f3f6f9;color:#62758a}.v148-empty.ok{background:#eaf7ef;color:#17683a}.v148-confirm{display:flex!important;align-items:center;gap:9px;margin-top:12px;padding:11px;border:1px solid #e1c3c3;border-radius:9px;background:#fff7f7;color:#733838;font-weight:800}.v148-confirm input{width:20px;height:20px;accent-color:#b52626}.v148-delete{width:100%;margin-top:9px!important;border:0!important;border-radius:9px!important;background:#b52626!important;color:#fff!important;padding:12px!important;font-size:14px!important;font-weight:900!important}.v148-delete:disabled{background:#99a8b7!important;cursor:not-allowed!important}.v148-maintenance #v148History details{margin-top:12px;border-top:1px solid #dce5ee;padding-top:10px}.v148-maintenance #v148History summary{cursor:pointer;color:#385a7c;font-weight:800}.v148-maintenance #v148History details>div{display:flex;justify-content:space-between;gap:10px;padding:8px;border-bottom:1px solid #edf1f5}.v148-maintenance #v148History small{display:block;color:#748597;margin-top:3px}@media(max-width:900px){.v148-tools,.v148-preview-grid{grid-template-columns:1fr 1fr}.v148-tools button{grid-column:1/-1}}@media(max-width:560px){.v148-title{display:grid}.v148-tools,.v148-preview-grid{grid-template-columns:1fr}.v148-tools button{grid-column:auto}.v148-maintenance #v148History details>div{display:grid}}`;document.head.appendChild(style);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(upgrade,260);setTimeout(upgrade,900)},{once:true});else{setTimeout(upgrade,260);setTimeout(upgrade,900)}
})();
