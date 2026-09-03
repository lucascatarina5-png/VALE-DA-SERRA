(function(){
  'use strict';
  const N=v=>Number(v||0);
  const norm=v=>String(v||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const turn=v=>{v=norm(v);return v==='m'||v.includes('manha')?1:2};
  const entryTurn=x=>turn(x.turno||x.periodo||'T');
  const selected=()=>({
    local:(document.getElementById('v125Local')?.value||document.getElementById('pgLocalidade')?.value||'').trim(),
    date:document.getElementById('v125CutDate')?.value||new Date().toISOString().slice(0,10),
    turn:document.getElementById('v125CutTurn')?.value||'T'
  });
  const beforeCut=(x,c)=>String(x.data||'')<c.date||(String(x.data||'')===c.date&&entryTurn(x)<=turn(c.turn));
  const fixedPeriod=pg=>{const ym=String(pg.mes||'');return {ini:ym+(String(pg.quinzena)==='1'?'-01':'-16'),fim:ym+(String(pg.quinzena)==='1'?'-15':'-31')}};
  function entryPaid(x){
    return pagamentos.some(pg=>{
      if(Array.isArray(pg.entryIds))return pg.entryIds.some(id=>String(id)===String(x.id));
      if(String(pg.prodId)!==String(x.prodId)||!['1','2'].includes(String(pg.quinzena)))return false;
      const p=fixedPeriod(pg);return String(x.data||'')>=p.ini&&String(x.data||'')<=p.fim;
    });
  }
  function debitPaid(x){
    return pagamentos.some(pg=>{
      if(Array.isArray(pg.debitIds))return pg.debitIds.some(id=>String(id)===String(x.id));
      if(String(pg.prodId)!==String(x.prodId)||!['1','2'].includes(String(pg.quinzena)))return false;
      const p=fixedPeriod(pg);return String(x.data||'')>=p.ini&&String(x.data||'')<=p.fim;
    });
  }
  function pendingEntries(prodId,c,local){return entradasProd(prodId).filter(x=>!entryPaid(x)&&beforeCut(x,c)&&(!local||norm(x.local||prodById(prodId)?.local)===norm(local)))}
  function pendingDebits(prodId,c){return debitosProd(prodId).filter(x=>!debitPaid(x)&&String(x.data||'')<=c.date&&saldoDebito(x.id)>0)}
  function splitLiters(arr,ym){return arr.reduce((a,x)=>{const q=N(x.qtd);if(String(x.data||'').startsWith(ym))a.current+=q;else a.previous+=q;return a},{previous:0,current:0})}
  function qKey(prodId,ym,q){return `${prodId}|${ym}|${q}`}
  async function syncNow(){
    const data={produtores,lancamentos,pagamentos,debitos,pagamentosDebitos:typeof pagamentosDebitos==='undefined'?[]:pagamentosDebitos};
    const token=localStorage.getItem('vale_token')||sessionStorage.getItem('vale_token')||'';
    const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;
    const response=await fetch('/api/state',{method:'PUT',headers,body:JSON.stringify({data}),cache:'no-store'});
    if(!response.ok)throw new Error('O servidor não confirmou a baixa do pagamento.');
  }
  function pay(prodId,quiet){
    const ym=pgMes.value||isoHoje().slice(0,7),q=pgQuinzena.value,c=selected();
    if(q==='mes'){if(!quiet)alert('Selecione uma quinzena.');return false}
    const p=prodById(prodId);if(!p)return false;
    const local=c.local||p.local||'';
    const entries=pendingEntries(prodId,c,local),debArr=pendingDebits(prodId,c);
    if(!entries.length&&!debArr.length){if(!quiet)alert('Este produtor não possui entradas ou débitos pendentes até o corte escolhido.');return false}
    const liters=entries.reduce((s,x)=>s+N(x.qtd),0),parts=splitLiters(entries,ym),gross=liters*VALOR_LITRO,debt=debArr.reduce((s,x)=>s+saldoDebito(x.id),0),net=Math.max(0,gross-debt);
    pagamentos=pagamentos.filter(x=>x.chave!==qKey(prodId,ym,q));
    const paymentId=crypto.randomUUID();
    pagamentos.push({chave:qKey(prodId,ym,q),id:paymentId,prodId,mes:ym,quinzena:q,localidade:local,corteData:c.date,corteTurno:c.turn==='M'?'Manhã':'Tarde',entryIds:entries.map(x=>x.id),debitIds:debArr.map(x=>x.id),litros,litrosSaldoAnterior:parts.previous,litrosQuinzenaAtual:parts.current,valorLitro:VALOR_LITRO,valorBruto:gross,totalDebitos:debt,valorPago:net,dataPagamento:isoHoje(),modeloPagamento:'corte-localidade-v127'});
    entries.forEach(x=>{x.situacaoPagamento='Liquidada';x.pagamentoId=paymentId;x.dataLiquidacao=isoHoje()});
    debArr.forEach(x=>{x.situacaoPagamento='Liquidado';x.pagamentoId=paymentId});
    v25Audit('PAGAMENTO_QUINZENA_REGISTRADO',{produtor:p.nome,localidade:local,quinzena:q,mes:ym,corteData:c.date,corteTurno:c.turn,litros,valor:net});
    return true;
  }
  window.marcarPago=async function(prodId){if(!pay(prodId,false))return;save();try{await syncNow();renderPagamentos(false)}catch(e){alert('❌ '+e.message)}};
  window.desfazerPagamento=function(prodId){
    const ym=pgMes.value||isoHoje().slice(0,7),q=pgQuinzena.value,pg=pagamentos.find(x=>x.chave===qKey(prodId,ym,q));
    if(!pg)return;
    if(!confirm(`Desfazer o pagamento de ${prodById(prodId)?.nome||'produtor'}? As entradas voltarão a ficar pendentes.`))return;
    (pg.entryIds||[]).forEach(id=>{const x=lancamentos.find(a=>String(a.id)===String(id));if(x){x.situacaoPagamento='Pendente';delete x.pagamentoId;delete x.dataLiquidacao}});
    (pg.debitIds||[]).forEach(id=>{const x=debitos.find(a=>String(a.id)===String(id));if(x){x.situacaoPagamento='Pendente';delete x.pagamentoId}});
    pagamentos=pagamentos.filter(x=>x.chave!==pg.chave);v25Audit('PAGAMENTO_QUINZENA_DESFEITO',{produtor:prodById(prodId)?.nome||'',quinzena:q,mes:ym,entryIds:pg.entryIds||[]});save();syncNow().catch(e=>alert('❌ '+e.message));
  };
  window.v125PayLocal=async function(){
    const c=selected();if(!c.local)return alert('Selecione uma localidade para fazer o pagamento em lote.');
    const ps=produtores.filter(p=>norm(p.local)===norm(c.local)&&pendingEntries(p.id,c,c.local).length);
    if(!ps.length)return alert('Não há entradas pendentes nessa localidade até o corte informado.');
    const liters=ps.reduce((s,p)=>s+pendingEntries(p.id,c,c.local).reduce((a,x)=>a+N(x.qtd),0),0);
    if(!confirm(`Confirmar pagamento de ${ps.length} produtor(es) de ${c.local}, até ${brDate(c.date)} - ${c.turn==='M'?'manhã':'tarde'}?\n\nTotal: ${fmt(liters)} litros.`))return;
    let count=0;ps.forEach(p=>{if(pay(p.id,true))count++});save();
    try{await syncNow();renderPagamentos(false);alert(`✅ Baixa confirmada no servidor.\n${count} pagamento(s) registrados e entradas marcadas como liquidadas.`)}catch(e){alert('❌ '+e.message+' Tente novamente antes de fechar a tela.')}
  };
  window.v129ClearAllMilk=async function(){
    if(!lancamentos.length&&!pagamentos.length)return alert('As entradas e os pagamentos já estão zerados. Você pode começar os novos lançamentos.');
    const liters=lancamentos.reduce((s,x)=>s+N(x.qtd),0),people=new Set(lancamentos.map(x=>String(x.prodId))).size;
    if(!confirm(`ZERAR OS TESTES E COMEÇAR NOVAMENTE?\n\nSerão excluídos:\n• ${lancamentos.length} entradas de leite\n• ${fmt(liters)} litros\n• registros de ${people} produtor(es)\n• ${pagamentos.length} pagamentos feitos nos testes\n\nSerão mantidos: produtores, débitos, vendas, estoque e usuários.`))return;
    lancamentos=[];
    pagamentos=[];
    save();
    try{await syncNow();renderPagamentos(false);alert('✅ Entradas e pagamentos de teste zerados no servidor.\n\nAgora você pode registrar as novas entradas de leite.')}catch(e){alert('❌ A limpeza foi feita neste aparelho, mas o servidor não confirmou: '+e.message)}
  };
  function inject(){
    const anchor=document.getElementById('pgFiltroInfo');if(!anchor||document.getElementById('v125CutBox'))return;
    const box=document.createElement('div');box.id='v125CutBox';box.className='v125-cut';box.innerHTML=`<div class="v125-title">💰 Efetuar pagamento da localidade</div><div class="v129-steps"><span><b>1</b> Escolha a localidade</span><span><b>2</b> Informe até quando foi pago</span><span><b>3</b> Confirme o pagamento</span></div><div class="v125-grid"><label>Localidade<select id="v125Local"></select></label><label>Pago até a data<input id="v125CutDate" type="date"></label><label>Último turno pago<select id="v125CutTurn"><option value="M">Manhã</option><option value="T" selected>Tarde / dia completo</option></select></label><button type="button" onclick="v125PayLocal()">✓ Confirmar pagamento</button></div><div id="v125Pending" class="v125-pending"></div><div id="v128AfterCut" class="v128-after"></div><details class="v128-clean"><summary>🧪 Zerar entradas e pagamentos usados nos testes</summary><div><button type="button" onclick="v129ClearAllMilk()">Zerar todos os testes e começar novamente</button></div><small>Mantém produtores, débitos, vendas, estoque e usuários. Exclui somente entradas de leite e pagamentos dos testes.</small></details>`;
    anchor.insertAdjacentElement('afterend',box);
    const loc=document.getElementById('v125Local'),vals=[...new Set(produtores.map(p=>p.local).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    loc.innerHTML='<option value="">Todas / pagamento individual</option>'+vals.map(x=>`<option>${String(x).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}</option>`).join('');
    document.getElementById('v125CutDate').value=isoHoje();
    ['pgLocalidade','pgNomeProdutor'].forEach(id=>{const el=document.getElementById(id);if(el?.parentElement)el.parentElement.style.display='none'});
    ['change','input'].forEach(ev=>box.addEventListener(ev,()=>renderPagamentos(false)));
  }
  const originalRender=window.renderPagamentos;
  window.renderPagamentos=function(manteraFoco=true){
    inject();if(!pgMes.value)pgMes.value=isoHoje().slice(0,7);
    const ym=pgMes.value,q=pgQuinzena.value,c=selected(),filterLocal=norm(document.getElementById('pgLocalidade')?.value),filterName=norm(document.getElementById('pgNomeProdutor')?.value),cutLocal=norm(c.local),rows=[];
    produtores.forEach(p=>{
      if(filterLocal&&!norm(p.local).includes(filterLocal)||filterName&&!norm(p.nome).includes(filterName)||cutLocal&&norm(p.local)!==cutLocal)return;
      const arr=pendingEntries(p.id,c,c.local),ds=pendingDebits(p.id,c),pendingParts=splitLiters(arr,ym),pg=q==='mes'?null:pagamentoDo(p.id,ym,q),parts=pg?{previous:N(pg.litrosSaldoAnterior),current:N(pg.litrosQuinzenaAtual)}:pendingParts,liters=pg?N(pg.litros):parts.previous+parts.current,debt=pg?N(pg.totalDebitos):ds.reduce((s,x)=>s+saldoDebito(x.id),0);
      if(liters||debt||pg)rows.push({p,arr,parts,liters,debt,gross:pg?N(pg.valorBruto):liters*VALOR_LITRO,net:pg?N(pg.valorPago):Math.max(0,liters*VALOR_LITRO-debt),pg});
    });
    rows.sort((a,b)=>(a.p.local||'').localeCompare(b.p.local||'','pt-BR')||a.p.nome.localeCompare(b.p.nome,'pt-BR'));
    pgLitros.textContent=fmt(rows.reduce((s,x)=>s+x.liters,0))+' L';pgTotal.textContent=moeda(rows.reduce((s,x)=>s+x.net,0));pgProdutores.textContent=rows.filter(x=>x.liters||x.debt).length;
    const allPending=lancamentos.filter(x=>!entryPaid(x)),oldPending=allPending.filter(x=>String(x.data||'')<ym+'-01'),oldL=oldPending.reduce((s,x)=>s+N(x.qtd),0),pend=document.getElementById('v125Pending');
    if(pend)pend.innerHTML=`<b>Pendências anteriores:</b> ${new Set(oldPending.map(x=>x.prodId)).size} produtor(es) • ${fmt(oldL)} L. Essas entradas serão incluídas automaticamente no próximo pagamento.`;
    const after=allPending.filter(x=>(!c.local||norm(x.local||prodById(x.prodId)?.local)===norm(c.local))&&!beforeCut(x,c)).sort((a,b)=>String(a.data).localeCompare(String(b.data))||entryTurn(a)-entryTurn(b));
    const afterBox=document.getElementById('v128AfterCut');if(afterBox){const afterL=after.reduce((s,x)=>s+N(x.qtd),0),people=new Set(after.map(x=>x.prodId)).size;afterBox.innerHTML=after.length?`<div class="v128-after-head"><b>⏳ Ficou pendente após o corte</b><strong>${people} produtor(es) • ${fmt(afterL)} L</strong></div>${after.slice(0,12).map(x=>`<div class="v128-after-row"><span><b>${prodById(x.prodId)?.nome||'Produtor'}</b><small>${brDate(x.data)} • ${entryTurn(x)===1?'Manhã':'Tarde'} • ${x.local||prodById(x.prodId)?.local||'-'}</small></span><strong>${fmt(x.qtd)} L</strong></div>`).join('')}${after.length>12?`<small>Mais ${after.length-12} entrada(s) pendente(s).</small>`:''}`:'<b>✅ Nenhuma entrega ficou pendente depois deste corte.</b>'}
    tbPag.innerHTML=rows.map(x=>`<tr><td><b>${x.p.nome}</b></td><td>${x.p.local||'-'}</td><td><b>${fmt(x.liters)} L</b><br><small>${x.parts.previous?`Saldo anterior: ${fmt(x.parts.previous)} L • `:''}Atual: ${fmt(x.parts.current)} L</small></td><td>${moeda(VALOR_LITRO)}</td><td><b>${moeda(x.net)}</b><br><small>Bruto ${moeda(x.gross)} • Débitos ${moeda(x.debt)}</small></td><td><span class="badge ${x.pg?'paid':'pending'}">${x.pg?'PAGO':'PENDENTE'}</span></td><td>${x.pg?brDate(x.pg.dataPagamento):'-'}</td><td>${q==='mes'?'-':x.pg?`<div class="v129-actions"><button class="btn secondary" onclick="imprimirCupom('${x.p.id}','80mm')">🧾 80mm</button><button class="btn secondary" onclick="imprimirCupom('${x.p.id}','a4')">📄 A4</button><button class="btn yellow" onclick="enviarWhatsApp('${x.p.id}')">📲 WhatsApp</button><button class="btn danger" onclick="desfazerPagamento('${x.p.id}')">Desfazer</button></div>`:`<button class="btn yellow" onclick="marcarPago('${x.p.id}')">Marcar Pago</button>`}</td></tr>`).join('')||'<tr><td colspan="8">Nenhum saldo para pagar até o corte informado.</td></tr>';
  };
  const style=document.createElement('style');style.textContent='.v125-cut{margin:14px 0;padding:16px;border:2px solid #f1c84b;border-radius:14px;background:#fffdf3}.v125-title{font-weight:900;color:#18324f;margin-bottom:10px;font-size:18px}.v129-steps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:13px}.v129-steps span{background:#edf4fc;border-radius:10px;padding:8px 10px;font-size:12px;color:#35516f}.v129-steps b{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:50%;background:#153d68;color:white;margin-right:4px}.v125-grid{display:grid;grid-template-columns:2fr 1fr 1.3fr auto;gap:10px;align-items:end}.v125-grid label{font-size:12px;font-weight:800;color:#53657a}.v125-grid input,.v125-grid select{display:block;width:100%;margin-top:5px;padding:11px;border:1px solid #ccd6e1;border-radius:9px;background:#fff}.v125-grid button{border:0;border-radius:10px;background:#153d68;color:#fff;font-weight:900;padding:12px 16px}.v125-pending{margin-top:11px;padding:10px;border-radius:9px;background:#eef5ff;color:#27496d;font-size:13px}.v128-after{margin-top:10px;padding:12px;border-radius:10px;background:#fff;color:#263b52;border:1px solid #e2c45d}.v128-after-head,.v128-after-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0}.v128-after-row{border-top:1px solid #edf0f3}.v128-after-row small{display:block;color:#718096;margin-top:3px}.v128-clean{margin-top:12px;border-top:1px dashed #d2b84f;padding-top:10px}.v128-clean summary{cursor:pointer;font-weight:800;color:#7a5800}.v128-clean div{display:flex;gap:8px;align-items:end;margin-top:10px}.v128-clean button{border:0;border-radius:8px;background:#a52b2b;color:#fff;padding:10px;font-weight:800}.v128-clean small{display:block;margin-top:6px;color:#756b50}.v129-actions{display:flex;gap:5px;flex-wrap:wrap}.v129-actions .btn{white-space:nowrap}@media(max-width:800px){.v125-grid{grid-template-columns:1fr}.v125-grid button{width:100%}.v128-after-head,.v128-after-row{align-items:flex-start}.v128-clean div{display:grid}.v128-clean button{width:100%}.v129-steps{display:grid}.v129-actions{display:grid;grid-template-columns:1fr 1fr}.v129-actions .btn{width:100%}}';document.head.appendChild(style);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{inject();setTimeout(()=>renderPagamentos(),100)},{once:true});else{inject();setTimeout(()=>renderPagamentos(),100)}
})();
