(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>Number(v).toLocaleString('pt-BR',{maximumFractionDigits:3});
  const date=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'}):'—';
  const label=s=>({pendente:'Aguardando recebimento',recebida:'Recebida',divergencia:'Recebida com divergência'}[s]||s);
  const token=()=>localStorage.getItem('vale_token')||sessionStorage.getItem('vale_token')||'';
  const admin=u=>u?.role==='administrador';
  const allowed=u=>admin(u)||(u?.permissions||[]).includes('estoque');
  let user=null,session='',loadingSession='',dialog,view,products=[],cart=[],draftKey='',lastPage=null,busy=false;
  async function api(url,opt={}) {
    const r=await fetch(url,{...opt,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token()}});
    const j=await r.json();if(!r.ok||j.ok===false)throw new Error(j.error||'Não foi possível concluir.');return j;
  }
  function error(e){const el=dialog.querySelector('[data-error]');if(el){el.textContent=e.message;el.scrollIntoView({block:'nearest'});}}
  function shell(title,html){view.innerHTML=`<header><div><small>VALE DA SERRA · INDÚSTRIA → GALPÃO</small><h2>${esc(title)}</h2></div><button type="button" data-action="close" aria-label="Fechar">×</button></header><p role="alert" data-error></p>${html}`;}
  function field(title,name,value='',extra=''){return `<label>${title}<input name="${name}" value="${esc(value)}" ${extra}></label>`;}
  function actions(){return '<div class="it-actions"><button type="button" data-action="list">← Transferências</button></div>';}
  function mount(){
    const style=document.createElement('style');style.textContent=`
.it-launch{background:#123f75!important;color:#fff!important;border:0!important;border-radius:10px!important;padding:12px 16px!important;font-weight:800!important;cursor:pointer}.it-launch:hover{background:#eebf36!important;color:#12345b!important}
.it-dialog{width:min(900px,calc(100% - 24px));max-height:90dvh;border:0;padding:0;border-radius:18px;background:#f4f7fb;color:#143253;box-shadow:0 24px 90px #0005;font-family:Arial,sans-serif}.it-dialog::backdrop{background:#071d35aa}.it-view{padding:24px}.it-view *{box-sizing:border-box}.it-view header{display:flex;justify-content:space-between;gap:12px;align-items:start}.it-view header small{font-size:10px;letter-spacing:1px;color:#5d7188}.it-view h2{font-size:25px;margin:7px 0 14px}.it-view h3{margin:0 0 10px}.it-view button{border:1px solid #c8d5e4;border-radius:9px;background:#fff;color:#164774;padding:11px 14px;font-weight:700;cursor:pointer}.it-view button:disabled{opacity:.5;cursor:wait}.it-view button.primary{background:#123f75;color:#fff;border-color:#123f75}.it-view header button{font-size:24px;padding:3px 11px}.it-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.it-card{padding:18px;background:white;border:1px solid #dce5ef;border-radius:12px;margin:12px 0}.it-card p{margin:8px 0;line-height:1.45}.it-status{display:inline-block;padding:6px 10px;border-radius:20px;background:#fff0bd;color:#795500;font-size:12px;font-weight:bold}.it-status.recebida{background:#e3f5e9;color:#166433}.it-status.divergencia{background:#ffe4df;color:#9e3020}.it-view label{display:block;font-weight:700;font-size:13px;margin:12px 0}.it-view input,.it-view select,.it-view textarea{display:block;width:100%;padding:12px;margin-top:6px;border:1px solid #bdccdd;border-radius:8px;background:#fff;color:#143253;font:inherit;font-weight:400}.it-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}.it-table{width:100%;border-collapse:collapse;font-size:13px}.it-table th,.it-table td{padding:11px 5px;text-align:right;border-bottom:1px solid #dce5ef;vertical-align:top}.it-table th:first-child,.it-table td:first-child{text-align:left}.it-table input{min-width:85px}.it-table small{display:block;color:#5e6f82;margin-top:4px}.it-scroll{overflow-x:auto}.it-view [data-error]{color:#a52320;font-weight:bold;white-space:pre-wrap}.it-view [data-error]:empty{display:none}.it-muted{color:#5c7085;font-size:13px;line-height:1.5}.it-warning{border-left:4px solid #edbd30;padding:12px;background:#fff7df;font-size:13px;line-height:1.5}.it-view summary{cursor:pointer;font-weight:700}.it-view .it-check{display:flex;align-items:center;gap:10px}.it-view .it-check input{width:20px;height:20px;margin:0}.it-view details p{font-size:13px}@media(max-width:600px){.it-view{padding:17px}.it-view h2{font-size:22px}.it-grid{grid-template-columns:1fr}.it-actions button{flex:1}.it-card{padding:13px}.it-table{font-size:12px}}
`;document.head.append(style);
    dialog=document.createElement('dialog');dialog.className='it-dialog';dialog.setAttribute('aria-label','Transferências da indústria');
    view=document.createElement('div');view.className='it-view';dialog.append(view);document.body.append(dialog);
    dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});
    dialog.addEventListener('click',async e=>{
      const b=e.target.closest('[data-action]');if(!b||busy)return;const a=b.dataset.action;
      try{
        if(a==='close'){dialog.close();return;}
        if(a==='list')await list();
        if(a==='more')await list(lastPage,true);
        if(a==='new')await newForm();
        if(a==='remove'){cart.splice(Number(b.dataset.index),1);renderCart();}
        if(a==='detail')await detail(b.dataset.id);
        if(a==='receive'||a==='correct')await receiveForm(b.dataset.id,a==='correct');
        if(a==='print')print(JSON.parse(b.dataset.transfer));
      }catch(err){error(err)}
    });
  }
  async function open(){
    if(!dialog)mount();dialog.showModal();shell('Carregando…','');
    try{const me=await api('/api/me');user=me.user;if(!allowed(user))throw new Error('Seu usuário não possui permissão para o Galpão.');await list();}catch(e){error(e)}
  }
  const status=t=>`<span class="it-status ${esc(t.status)}">${esc(label(t.status))}</span>`;
  const card=t=>`<article class="it-card"><div>${status(t)}</div><h3 style="margin-top:12px">Transferência #${esc(t.number)}</h3><p>${esc(date(t.created_at))} · ${t.items.length} produto(s)</p><p class="it-muted">Indústria: ${esc(t.sender)}<br>Transporte: ${esc(t.carrier)}${t.receiver?'<br>Conferido por: '+esc(t.receiver):''}</p><button data-action="detail" data-id="${esc(t.id)}">${t.status==='pendente'?'Conferir recebimento':'Ver comprovante'}</button></article>`;
  async function list(before=null,append=false){
    const j=await api('/api/industry-transfers'+(before?'?before='+encodeURIComponent(before):''));lastPage=j.next_before;
    if(!append)shell('Transferências da indústria',`<p class="it-muted">Registre a saída e confira na chegada. O estoque recebe somente a quantidade confirmada no galpão.</p><div class="it-actions"><button class="primary" data-action="new">＋ Registrar envio</button><button data-action="list">Atualizar</button></div><div data-list></div><div data-more></div>`);
    view.querySelector('[data-list]').insertAdjacentHTML('beforeend',j.transfers.map(card).join('')||(!append?'<div class="it-card">Nenhuma transferência registrada.</div>':''));
    view.querySelector('[data-more]').innerHTML=lastPage?'<button data-action="more">Carregar anteriores</button>':'';
  }
  async function newForm(){
    const j=await api('/api/inventory/products');products=(j.products||[]).filter(p=>p.active!==false);cart=[];draftKey=typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    shell('Registrar envio',`${actions()}<form data-new><div class="it-card"><div class="it-grid">${field('Responsável na indústria','sender','','required maxlength="1000"')}${field('Quem está transportando','carrier','','required maxlength="1000"')}</div><p class="it-muted">Selecione os produtos cadastrados no Estoque / Galpão. O administrador pode cadastrar mussarela, queijo e outros itens nessa tela de estoque.</p><label>Produto<select name="product"><option value="">Selecione</option>${products.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.unit)})</option>`).join('')}</select></label><div class="it-grid">${field('Quantidade enviada','quantity','','type="number" min="0.001" max="1000000" step="0.001" inputmode="decimal"')}<div class="it-actions"><button type="button" data-add>Adicionar produto</button></div></div><div data-cart></div><label>Observações<textarea name="notes" maxlength="1000"></textarea></label></div><p class="it-warning">Salvar o envio deixa a transferência aguardando conferência. A entrada no estoque acontece ao confirmar o recebimento.</p><button class="primary" type="submit">Salvar envio</button></form>`);
    const form=view.querySelector('form');
    form.querySelector('[data-add]').onclick=()=>{try{const p=products.find(p=>p.id===form.elements.product.value),q=Number(form.elements.quantity.value);if(!p||!Number.isFinite(q)||q<=0||q>1000000||Math.abs(q*1000-Math.round(q*1000))>0.00001)throw new Error('Selecione o produto e uma quantidade válida com até três casas decimais.');if(cart.some(i=>i.product_id===p.id))throw new Error('Produto já incluído. Remova para alterar a quantidade.');cart.push({product_id:p.id,name:p.name,unit:p.unit,sent:q});renderCart();form.elements.quantity.value='';view.querySelector('[data-error]').textContent='';}catch(e){error(e)}};
    form.onsubmit=e=>{e.preventDefault();if(!cart.length)return error(new Error('Adicione pelo menos um produto.'));save(form,()=>api('/api/industry-transfers',{method:'POST',body:JSON.stringify({request_key:draftKey,sender:form.elements.sender.value,carrier:form.elements.carrier.value,notes:form.elements.notes.value,items:cart})}));};
  }
  function renderCart(){view.querySelector('[data-cart]').innerHTML=cart.map((i,n)=>`<p>${esc(i.name)} · <b>${num(i.sent)} ${esc(i.unit)}</b> <button type="button" data-action="remove" data-index="${n}">Remover</button></p>`).join('');}
  function table(t){return `<div class="it-scroll"><table class="it-table"><thead><tr><th>Produto</th><th>Enviado</th><th>Recebido</th><th>Diferença</th></tr></thead><tbody>${t.items.map(i=>`<tr><td>${esc(i.name)}<small>${esc(i.unit)}</small></td><td>${num(i.sent)}</td><td>${i.received===null?'—':num(i.received)}</td><td>${i.difference===null?'—':num(i.difference)}</td></tr>`).join('')}</tbody></table></div>`;}
  function history(t){return `<details class="it-card"><summary>Histórico · ${t.history.length} registro(s)</summary>${t.history.map(h=>`<p><b>${esc({envio:'Envio',recebimento:'Recebimento',correcao:'Correção administrativa'}[h.action])}${h.revision?' · revisão '+esc(h.revision):''}</b><br>${esc(date(h.at))} · usuário: ${esc(h.actor.name||h.actor.username)}${h.receiver?'<br>Conferente: '+esc(h.receiver):''}${h.reason?'<br>Motivo: '+esc(h.reason):''}${h.notes?'<br>Observações: '+esc(h.notes):''}</p>${table({items:h.items})}`).join('')}</details>`;}
  async function detail(id){const j=await api('/api/industry-transfers/'+encodeURIComponent(id));showDetail(j.transfer);}
  function showDetail(t){
    shell('Transferência #'+t.number,`${actions()}<div class="it-card">${status(t)}<p>Envio: ${esc(date(t.created_at))}<br>Indústria: ${esc(t.sender)}<br>Transporte: ${esc(t.carrier)}</p>${t.notes?'<p>Observações do envio: '+esc(t.notes)+'</p>':''}${table(t)}${t.receiver?`<p><b>Conferido por ${esc(t.receiver)}</b><br>${esc(date(t.received_at))} · usuário ${esc(t.received_by)} · revisão ${t.revision}</p><p>${esc(t.receipt_notes)}</p>`:''}</div><div class="it-actions">${t.status==='pendente'?`<button class="primary" data-action="receive" data-id="${esc(t.id)}">Conferir e receber</button>`:''}<button data-action="print" data-transfer="${esc(JSON.stringify(t))}">Imprimir cupom 80 mm</button>${t.status!=='pendente'&&admin(user)?`<button data-action="correct" data-id="${esc(t.id)}">Correção administrativa</button>`:''}</div><p class="it-muted">Imprima o cupom e colha as assinaturas de quem entregou e de quem recebeu.</p>${history(t)}`);
  }
  async function receiveForm(id,correcting){
    const j=await api('/api/industry-transfers/'+encodeURIComponent(id)),t=j.transfer;
    if((correcting&&t.status==='pendente')||(!correcting&&t.status!=='pendente'))return showDetail(t);
    shell((correcting?'Corrigir recebimento #':'Conferir recebimento #')+t.number,`${actions()}<form data-receive><p class="it-warning">${correcting?'A correção registra o motivo e ajusta o estoque pela diferença. As conferências anteriores permanecem no histórico.':'Digite o que realmente chegou, inclusive zero para produtos ausentes. Confira os produtos antes de confirmar.'}</p><div class="it-card"><p>Indústria: ${esc(t.sender)} · Transporte: ${esc(t.carrier)}</p><div class="it-scroll"><table class="it-table"><thead><tr><th>Produto</th><th>Enviado</th><th>Recebido</th><th>Diferença</th></tr></thead><tbody>${t.items.map((i,n)=>`<tr><td>${esc(i.name)}<small>${esc(i.unit)}</small></td><td>${num(i.sent)}</td><td><input aria-label="Recebido de ${esc(i.name)} em ${esc(i.unit)}" name="qty${n}" type="number" min="0" max="1000000" step="0.001" inputmode="decimal" required value="${correcting?esc(i.received):''}"></td><td data-diff="${n}">—</td></tr>`).join('')}</tbody></table></div>${field('Quem recebeu e conferiu','receiver',correcting?t.receiver:'','required maxlength="1000"')}<label>Observações / motivo das diferenças<textarea name="notes" maxlength="1000">${correcting?esc(t.receipt_notes):''}</textarea></label>${correcting?'<label>Motivo da correção<textarea name="reason" required minlength="5" maxlength="1000"></textarea></label>':''}<label class="it-check"><input name="confirmed" type="checkbox" required>Conferi os produtos e confirmo as quantidades acima.</label></div><button class="primary" type="submit">${correcting?'Salvar correção e ajustar estoque':'Confirmar recebimento e dar entrada no estoque'}</button></form>`);
    const form=view.querySelector('form');
    t.items.forEach((i,n)=>{const input=form.elements['qty'+n],out=form.querySelector(`[data-diff="${n}"]`);input.oninput=()=>{out.textContent=input.value===''?'—':num(Number(input.value)-i.sent)};input.oninput()});
    form.onsubmit=e=>{e.preventDefault();save(form,()=>api('/api/industry-transfers/'+encodeURIComponent(id)+(correcting?'/correct':'/receive'),{method:'POST',body:JSON.stringify({revision:t.revision,receiver:form.elements.receiver.value,notes:form.elements.notes.value,reason:form.elements.reason?.value,items:t.items.map((i,n)=>({product_id:i.product_id,received:form.elements['qty'+n].value}))})}));};
  }
  async function save(form,run){
    if(busy)return;busy=true;const controls=[...form.querySelectorAll('button,input,textarea,select')];controls.forEach(b=>b.disabled=true);
    try{const j=await run();showDetail(j.transfer);window.dispatchEvent(new CustomEvent('industry-transfer-updated'));if(typeof window.estoqueCarregar==='function')Promise.resolve(window.estoqueCarregar()).catch(console.error);document.getElementById('g118Reload')?.click();}catch(e){error(e);controls.forEach(b=>b.disabled=false)}finally{busy=false}
  }
  function print(t){
    const w=window.open('','_blank','width=420,height=780');if(!w)return error(new Error('Permita abrir a janela de impressão para emitir o cupom.'));
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Transferência ${esc(t.number)}</title><style>@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0 auto;font:12px Arial;color:#000}h1{font-size:18px;text-align:center;margin:12px 0 4px}h2{font-size:13px;text-align:center;margin:5px 0}p{line-height:1.45;overflow-wrap:anywhere}.it-scroll{overflow:visible}table{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed}th,td{text-align:right;padding:7px 2px;border-bottom:1px dashed #777;overflow-wrap:anywhere}th:first-child,td:first-child{text-align:left;width:37%}td small{display:block}.sign{margin:48px 0 8px;border-top:1px solid #000;text-align:center;padding-top:6px}.center{text-align:center}.screen{padding:12px}@media print{.screen{display:none}}</style></head><body><div class="screen"><button onclick="window.print()">Imprimir</button></div><h1>VALE DA SERRA</h1><h2>INDÚSTRIA → GALPÃO</h2><p class="center"><b>TRANSFERÊNCIA #${esc(t.number)}</b><br>${esc(label(t.status))}<br>Revisão ${t.revision}</p><p>Saída: ${esc(date(t.created_at))}<br>Indústria: ${esc(t.sender)}<br>Transportador: ${esc(t.carrier)}</p>${t.notes?'<p>Envio: '+esc(t.notes)+'</p>':''}${table(t)}<p>Diferença = recebido − enviado.<br>${t.received_at?'Conferência: '+esc(date(t.received_at))+'<br>Conferente: '+esc(t.receiver)+'<br>Usuário: '+esc(t.received_by):'<b>ENVIO AINDA NÃO CONFERIDO</b>'}</p>${t.receipt_notes?'<p>Observações: '+esc(t.receipt_notes)+'</p>':''}${t.history.at(-1)?.reason?'<p>Motivo da correção: '+esc(t.history.at(-1).reason)+'</p>':''}<div class="sign">Assinatura de quem entregou<br>${esc(t.carrier)}</div><div class="sign">Assinatura de quem recebeu e conferiu<br>${esc(t.receiver||'Nome: ____________________')}</div><p class="center">Controle interno de transferência<br>Não é documento fiscal.</p></body></html>`);w.document.close();w.focus();w.print();
  }
  async function syncEntry(){
    const t=token();
    if(!t){session='';user=null;document.querySelectorAll('.it-launch').forEach(e=>e.remove());return;}
    if(session!==t){if(loadingSession===t)return;loadingSession=t;try{user=(await api('/api/me')).user;session=t;}catch(_){return}finally{loadingSession=''}}
    if(!allowed(user))return;
    for(const host of document.querySelectorAll('#estoque .gal-head-actions,#screen-estoque .g118-top')){
      if(host.querySelector('.it-launch'))continue;
      const b=document.createElement('button');b.type='button';b.className='it-launch';b.textContent='Indústria → Galpão';b.onclick=open;host.append(b);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',syncEntry);else syncEntry();
  // As telas do galpão podem ser recriadas durante a navegação.
  let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;syncEntry()},250)}).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('storage',syncEntry);
})();
