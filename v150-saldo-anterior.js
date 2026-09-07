(function(){
  'use strict';

  const N=value=>Number(value||0);
  const E=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const norm=value=>String(value||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const liters=value=>N(value).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const cash=value=>N(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const clone=value=>JSON.parse(JSON.stringify(value));
  const admin=()=>{try{return typeof v4IsAdmin!=='function'||v4IsAdmin()}catch(_){return false}};
  const rate=()=>{try{return N(VALOR_LITRO)||2.30}catch(_){return 2.30}};
  const today=()=>typeof isoHoje==='function'?isoHoje():new Date().toISOString().slice(0,10);

  function dateKey(value){
    const text=String(value||'').trim(),iso=text.match(/^(\d{4})-(\d{2})-(\d{2})/),br=text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return iso?`${iso[1]}-${iso[2]}-${iso[3]}`:br?`${br[3]}-${br[2]}-${br[1]}`:text.slice(0,10);
  }
  function producer(id){return (Array.isArray(produtores)?produtores:[]).find(item=>String(item.id)===String(id))}
  function entryLocality(entry){return String(entry?.local||producer(entry?.prodId)?.local||'').trim()}
  function paymentPeriod(payment){
    const ym=String(payment?.mes||''),q=String(payment?.quinzena||'');
    if(/^\d{4}-\d{2}$/.test(ym)&&['1','2'].includes(q))return {start:ym+(q==='1'?'-01':'-16'),end:ym+(q==='1'?'-15':'-31')};
    const date=dateKey(payment?.corteData||payment?.dataPagamento);return /^\d{4}-\d{2}-\d{2}$/.test(date)?{start:date,end:date}:null;
  }
  // Repete exatamente a regra usada em Pagamentos: só é saldo quando ainda não existe baixa válida.
  function isPaidInPayments(entry){
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
  function buildPreviousBalance(local,referenceMonth){
    const locality=String(local||'').trim(),month=String(referenceMonth||'').trim(),valid=!!locality&&/^\d{4}-\d{2}$/.test(month),monthStart=valid?month+'-01':'';
    const rows=valid?(Array.isArray(lancamentos)?lancamentos:[]).filter(entry=>{
      const date=dateKey(entry.data);
      return /^\d{4}-\d{2}-\d{2}$/.test(date)&&date<monthStart&&norm(entryLocality(entry))===norm(locality)&&!isPaidInPayments(entry);
    }):[];
    const sorted=rows.slice().sort((a,b)=>dateKey(a.data).localeCompare(dateKey(b.data)));
    return {valid,local:locality,month,monthStart,rows,rowIds:new Set(rows.map(item=>String(item.id))),entries:rows.length,liters:rows.reduce((sum,item)=>sum+N(item.qtd),0),producers:new Set(rows.map(item=>String(item.prodId))).size,gross:rows.reduce((sum,item)=>sum+N(item.qtd),0)*rate(),first:sorted.length?dateKey(sorted[0].data):'',last:sorted.length?dateKey(sorted[sorted.length-1].data):''};
  }
  window.v150PreviousBalancePreview=buildPreviousBalance;

  function selectedPreview(){return buildPreviousBalance(document.getElementById('v150CarryLocal')?.value,document.getElementById('v150CarryMonth')?.value)}
  function br(value){const parts=String(value||'').split('-');return parts.length===3?parts.reverse().join('/'):value||'-'}
  window.v150RenderPreviousBalance=function(){
    const data=selectedPreview(),box=document.getElementById('v150CarryPreview'),button=document.getElementById('v150CarryDelete'),check=document.getElementById('v150CarryConfirm');if(!box||!button)return data;
    if(!data.valid){box.innerHTML='<div class="v150-empty">Escolha a localidade e o mês da quinzena que você vai iniciar.</div>';button.disabled=true;button.textContent='Escolha a localidade para continuar';return data}
    if(!data.entries){box.innerHTML=`<div class="v150-ok"><b>✅ ${E(data.local)} não possui saldo anterior pendente</b><span>Não existe leite anterior a 01/${E(data.month.slice(5,7))}/${E(data.month.slice(0,4))} entrando nesta quinzena.</span></div>`;button.disabled=true;button.textContent='Nenhum saldo anterior para excluir';return data}
    box.innerHTML=`<div class="v150-result"><div><small>Produtores no saldo anterior</small><b>${data.producers}</b></div><div><small>Entradas antigas</small><b>${data.entries}</b></div><div><small>Leite que está vindo do mês passado</small><b>${liters(data.liters)} L</b></div><div><small>Valor bruto que aparece para pagar</small><b>${cash(data.gross)}</b></div></div><div class="v150-period"><b>Período encontrado:</b> ${br(data.first)} a ${br(data.last)}. <strong>Nenhuma entrada de ${E(data.month.slice(5,7))}/${E(data.month.slice(0,4))} será apagada.</strong></div>`;
    button.textContent=`Zerar saldo anterior de ${data.local} • ${liters(data.liters)} L`;button.disabled=!check?.checked;return data;
  };

  async function syncState(){
    let importacoesPdf=[];try{importacoesPdf=JSON.parse(localStorage.getItem('vds_pdf_import_batches_v137')||'[]')}catch(_){}
    const headers=typeof v4Headers==='function'?v4Headers():{};headers['Content-Type']='application/json';
    const response=await fetch('/api/state',{method:'PUT',headers,body:JSON.stringify({data:{produtores,lancamentos,pagamentos,debitos,pagamentosDebitos:typeof pagamentosDebitos==='undefined'?[]:pagamentosDebitos,importacoesPdf}}),cache:'no-store'});
    if(!response.ok){let message='O servidor não confirmou a exclusão do saldo anterior.';try{const json=await response.json();if(json.error)message=json.error}catch(_){}throw new Error(message)}
  }
  window.v150DeletePreviousBalance=async function(){
    if(!admin())return alert('Somente o Administrador pode zerar o saldo anterior.');
    const data=selectedPreview(),check=document.getElementById('v150CarryConfirm'),button=document.getElementById('v150CarryDelete');
    if(!data.valid)return alert('Escolha a localidade e o mês da quinzena atual.');
    if(!data.entries)return alert('Essa localidade não possui saldo anterior pendente.');
    if(!check?.checked)return alert('Marque a confirmação de segurança antes de excluir.');
    if(!confirm(`ZERAR O SALDO ANTERIOR DE ${data.local.toUpperCase()}?\n\nMês atual da quinzena: ${data.month.slice(5,7)}/${data.month.slice(0,4)}\nEntradas antigas: ${data.entries}\nProdutores: ${data.producers}\nLeite: ${liters(data.liters)} L\nValor bruto retirado dos pagamentos: ${cash(data.gross)}\nPeríodo antigo: ${br(data.first)} a ${br(data.last)}\n\nAs entradas do mês ${data.month.slice(5,7)}/${data.month.slice(0,4)} e todos os produtores serão mantidos.\n\nEsta exclusão não pode ser desfeita pela tela.`))return;
    const oldEntries=clone(lancamentos);if(button){button.disabled=true;button.textContent='Zerando e confirmando no servidor...'}
    try{
      lancamentos=lancamentos.filter(entry=>!data.rowIds.has(String(entry.id)));await syncState();if(typeof save==='function')save();
      let history=[];try{history=JSON.parse(localStorage.getItem('vds_previous_balance_cleanup_v150')||'[]')}catch(_){}history.unshift({id:crypto.randomUUID(),executedAt:new Date().toISOString(),local:data.local,referenceMonth:data.month,entries:data.entries,producers:data.producers,liters:data.liters,gross:data.gross,first:data.first,last:data.last,user:(typeof V4!=='undefined'&&V4?.user?.username)||'Administrador'});localStorage.setItem('vds_previous_balance_cleanup_v150',JSON.stringify(history.slice(0,20)));
      try{if(typeof v25Audit==='function')await v25Audit('ENTRADAS_LEITE_PERIODO_EXCLUIDAS',{localidade:data.local,mesReferencia:data.month,inicio:data.first,fim:data.last,entradas:data.entries,produtores:data.producers,litros:data.liters,valorBruto:data.gross,modo:'saldo-anterior-v150'})}catch(_){}
      if(check)check.checked=false;window.v150RenderPreviousBalance();try{if(typeof renderPagamentos==='function')renderPagamentos(false)}catch(_){}try{if(typeof v144Refresh==='function')v144Refresh()}catch(_){}
      alert(`✅ SALDO ANTERIOR ZERADO.\n\nLocalidade: ${data.local}\n${data.entries} entrada(s) antiga(s) excluída(s)\n${liters(data.liters)} L retirados do valor a pagar\n${cash(data.gross)} de valor bruto retirado\n\nAs entradas do mês ${data.month.slice(5,7)}/${data.month.slice(0,4)} e todos os produtores foram mantidos.`);
    }catch(error){lancamentos=oldEntries;if(typeof save==='function')save();window.v150RenderPreviousBalance();alert('❌ O servidor não confirmou a operação. O saldo anterior foi mantido.\n\nMotivo: '+error.message)}
  };

  window.v150OpenPreviousBalance=function(encodedLocal,monthValue){
    let locality='';try{locality=decodeURIComponent(String(encodedLocal||''))}catch(_){locality=String(encodedLocal||'')}
    if(typeof go==='function')go('configuracoes');else if(typeof showSection==='function')showSection('configuracoes');
    setTimeout(()=>{upgrade();const details=document.getElementById('v149Maintenance'),local=document.getElementById('v150CarryLocal'),month=document.getElementById('v150CarryMonth'),check=document.getElementById('v150CarryConfirm');if(details)details.open=true;if(local)local.value=[...local.options].find(option=>norm(option.value)===norm(locality))?.value||locality;if(month&&/^\d{4}-\d{2}$/.test(String(monthValue||'')))month.value=monthValue;if(check)check.checked=false;window.v150RenderPreviousBalance();document.getElementById('v150CarryBox')?.scrollIntoView({behavior:'smooth',block:'start'})},320);
  };

  function boxHTML(){return `<section id="v150CarryBox" class="v150-carry"><div class="v150-head"><div><b>🎯 Zerar valores antigos que aparecem na quinzena atual</b><p>Use quando o leite do mês passado era teste, mas aparece em Pagamentos como “Saldo anterior”.</p></div><span>V150 • CORREÇÃO DO SALDO</span></div><div class="v150-fields"><label>Localidade<select id="v150CarryLocal" onchange="v150RenderPreviousBalance()"><option value="">Escolha a localidade...</option></select></label><label>Mês da quinzena atual<input id="v150CarryMonth" type="month" onchange="v150RenderPreviousBalance()"></label><button type="button" onclick="v150RenderPreviousBalance()">🔎 Conferir saldo anterior</button></div><div id="v150CarryPreview"></div><label class="v150-confirm"><input id="v150CarryConfirm" type="checkbox" onchange="v150RenderPreviousBalance()"><span>Conferi a localidade, o mês, os litros e o valor que serão retirados.</span></label><button id="v150CarryDelete" class="v150-delete" type="button" onclick="v150DeletePreviousBalance()" disabled>Escolha a localidade para continuar</button></section>`}
  function upgrade(){
    const body=document.querySelector('#v149Maintenance .v149-maintenance-body');if(!body)return false;
    let box=document.getElementById('v150CarryBox');if(!box){body.insertAdjacentHTML('afterbegin',boxHTML());box=document.getElementById('v150CarryBox')}
    const select=document.getElementById('v150CarryLocal'),wanted=select?.value||'',places=knownLocalities();if(select){select.innerHTML='<option value="">Escolha a localidade...</option>'+places.map(place=>`<option value="${E(place)}">${E(place)}</option>`).join('');select.value=places.find(place=>norm(place)===norm(wanted))||''}
    const month=document.getElementById('v150CarryMonth');if(month&&!month.value)month.value=today().slice(0,7);window.v150RenderPreviousBalance();return true;
  }
  window.v150EnsurePreviousBalance=upgrade;

  const style=document.createElement('style');style.id='v150-carry-style';style.textContent=`.v150-open-carry{display:inline-flex!important;align-items:center!important;margin:9px 0 0!important;padding:8px 11px!important;border:1px solid #d79b13!important;border-radius:8px!important;background:#fff4cc!important;color:#744d00!important;font-weight:900!important}.v150-carry{margin-bottom:18px;padding:15px;border:2px solid #f0b429;border-radius:13px;background:#fffaf0}.v150-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.v150-head b{font-size:17px;color:#6d4600}.v150-head p{margin:5px 0 0;color:#795f32}.v150-head>span{flex:0 0 auto;padding:7px 9px;border-radius:999px;background:#ffd86b;color:#624000;font-size:10px;font-weight:900}.v150-fields{display:grid;grid-template-columns:1.4fr 1fr auto;align-items:end;gap:10px;margin-top:13px}.v150-fields label{font-size:11px;font-weight:900;color:#65502d}.v150-fields select,.v150-fields input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #d6b978;border-radius:8px;background:#fff}.v150-fields button{border:0;border-radius:8px;background:#174f86;color:#fff;padding:11px 13px;font-weight:900}.v150-result{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.v150-result>div{padding:12px;border:1px solid #ecd7a3;border-radius:10px;background:#fff}.v150-result small,.v150-result b{display:block}.v150-result small{min-height:27px;color:#715f3d;font-size:10px}.v150-result b{margin-top:5px;color:#9b3b1e;font-size:19px}.v150-period,.v150-ok,.v150-empty{margin-top:10px;padding:11px 13px;border-radius:9px}.v150-period{background:#fff0cb;color:#704b00}.v150-period strong{color:#126535}.v150-ok{display:grid;gap:4px;background:#e7f7ec;color:#176239}.v150-empty{background:#f4f6f8;color:#657689}.v150-confirm{display:flex!important;align-items:center;gap:9px;margin-top:11px;padding:10px;border:1px solid #e2cda0;border-radius:9px;background:#fff;color:#6d5122;font-weight:800}.v150-confirm input{width:20px;height:20px;accent-color:#b52626}.v150-delete{width:100%;margin-top:9px!important;border:0!important;border-radius:9px!important;background:#b52626!important;color:#fff!important;padding:12px!important;font-size:14px!important;font-weight:900!important}.v150-delete:disabled{background:#98a6b4!important}@media(max-width:800px){.v150-fields,.v150-result{grid-template-columns:1fr 1fr}.v150-fields button{grid-column:1/-1}}@media(max-width:520px){.v150-head{display:grid}.v150-fields,.v150-result{grid-template-columns:1fr}.v150-fields button{grid-column:auto}}`;document.head.appendChild(style);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(upgrade,420);setTimeout(upgrade,1150)},{once:true});else{setTimeout(upgrade,420);setTimeout(upgrade,1150)}
})();
