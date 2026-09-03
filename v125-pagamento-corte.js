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
  function pay(prodId,quiet){
    const ym=pgMes.value||isoHoje().slice(0,7),q=pgQuinzena.value,c=selected();
    if(q==='mes'){if(!quiet)alert('Selecione uma quinzena.');return false}
    const p=prodById(prodId);if(!p)return false;
    const local=c.local||p.local||'';
    const entries=pendingEntries(prodId,c,local),debArr=pendingDebits(prodId,c);
    if(!entries.length&&!debArr.length){if(!quiet)alert('Este produtor não possui entradas ou débitos pendentes até o corte escolhido.');return false}
    const liters=entries.reduce((s,x)=>s+N(x.qtd),0),parts=splitLiters(entries,ym),gross=liters*VALOR_LITRO,debt=debArr.reduce((s,x)=>s+saldoDebito(x.id),0),net=Math.max(0,gross-debt);
    pagamentos=pagamentos.filter(x=>x.chave!==qKey(prodId,ym,q));
    pagamentos.push({chave:qKey(prodId,ym,q),id:crypto.randomUUID(),prodId,mes:ym,quinzena:q,localidade:local,corteData:c.date,corteTurno:c.turn==='M'?'Manhã':'Tarde',entryIds:entries.map(x=>x.id),debitIds:debArr.map(x=>x.id),litros,litrosSaldoAnterior:parts.previous,litrosQuinzenaAtual:parts.current,valorLitro:VALOR_LITRO,valorBruto:gross,totalDebitos:debt,valorPago:net,dataPagamento:isoHoje(),modeloPagamento:'corte-localidade-v125'});
    v25Audit('PAGAMENTO_QUINZENA_REGISTRADO',{produtor:p.nome,localidade:local,quinzena:q,mes:ym,corteData:c.date,corteTurno:c.turn,litros,valor:net});
    return true;
  }
  window.marcarPago=function(prodId){if(pay(prodId,false))save()};
  window.desfazerPagamento=function(prodId){
    const ym=pgMes.value||isoHoje().slice(0,7),q=pgQuinzena.value,pg=pagamentos.find(x=>x.chave===qKey(prodId,ym,q));
    if(!pg)return;
    if(!confirm(`Desfazer o pagamento de ${prodById(prodId)?.nome||'produtor'}? As entradas voltarão a ficar pendentes.`))return;
    pagamentos=pagamentos.filter(x=>x.chave!==pg.chave);v25Audit('PAGAMENTO_QUINZENA_DESFEITO',{produtor:prodById(prodId)?.nome||'',quinzena:q,mes:ym,entryIds:pg.entryIds||[]});save();
  };
  window.v125PayLocal=function(){
    const c=selected();if(!c.local)return alert('Selecione uma localidade para fazer o pagamento em lote.');
    const ps=produtores.filter(p=>norm(p.local)===norm(c.local)&&pendingEntries(p.id,c,c.local).length);
    if(!ps.length)return alert('Não há entradas pendentes nessa localidade até o corte informado.');
    const liters=ps.reduce((s,p)=>s+pendingEntries(p.id,c,c.local).reduce((a,x)=>a+N(x.qtd),0),0);
    if(!confirm(`Confirmar pagamento de ${ps.length} produtor(es) de ${c.local}, até ${brDate(c.date)} - ${c.turn==='M'?'manhã':'tarde'}?\n\nTotal: ${fmt(liters)} litros.`))return;
    let count=0;ps.forEach(p=>{if(pay(p.id,true))count++});save();alert(`✅ ${count} pagamento(s) registrados. Cada entrada incluída foi marcada como liquidada.`)
  };
  function inject(){
    const anchor=document.getElementById('pgFiltroInfo');if(!anchor||document.getElementById('v125CutBox'))return;
    const box=document.createElement('div');box.id='v125CutBox';box.className='v125-cut';box.innerHTML=`<div class="v125-title">✂️ Corte inteligente por localidade</div><div class="v125-grid"><label>Localidade<select id="v125Local"></select></label><label>Pago até<input id="v125CutDate" type="date"></label><label>Turno limite<select id="v125CutTurn"><option value="M">Manhã</option><option value="T" selected>Tarde / dia completo</option></select></label><button type="button" onclick="v125PayLocal()">✓ Pagar localidade</button></div><div id="v125Pending" class="v125-pending"></div>`;
    anchor.insertAdjacentElement('afterend',box);
    const loc=document.getElementById('v125Local'),vals=[...new Set(produtores.map(p=>p.local).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    loc.innerHTML='<option value="">Todas / pagamento individual</option>'+vals.map(x=>`<option>${String(x).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}</option>`).join('');
    document.getElementById('v125CutDate').value=isoHoje();
    ['change','input'].forEach(ev=>box.addEventListener(ev,()=>renderPagamentos(false)));
  }
  const originalRender=window.renderPagamentos;
  window.renderPagamentos=function(manteraFoco=true){
    inject();if(!pgMes.value)pgMes.value=isoHoje().slice(0,7);
    const ym=pgMes.value,q=pgQuinzena.value,c=selected(),filterLocal=norm(document.getElementById('pgLocalidade')?.value),filterName=norm(document.getElementById('pgNomeProdutor')?.value),cutLocal=norm(c.local),rows=[];
    produtores.forEach(p=>{
      if(filterLocal&&!norm(p.local).includes(filterLocal)||filterName&&!norm(p.nome).includes(filterName)||cutLocal&&norm(p.local)!==cutLocal)return;
      const arr=pendingEntries(p.id,c,c.local),ds=pendingDebits(p.id,c),parts=splitLiters(arr,ym),liters=parts.previous+parts.current,debt=ds.reduce((s,x)=>s+saldoDebito(x.id),0),pg=q==='mes'?null:pagamentoDo(p.id,ym,q);
      if(liters||debt||pg)rows.push({p,arr,parts,liters,debt,gross:liters*VALOR_LITRO,net:Math.max(0,liters*VALOR_LITRO-debt),pg});
    });
    rows.sort((a,b)=>(a.p.local||'').localeCompare(b.p.local||'','pt-BR')||a.p.nome.localeCompare(b.p.nome,'pt-BR'));
    pgLitros.textContent=fmt(rows.reduce((s,x)=>s+x.liters,0))+' L';pgTotal.textContent=moeda(rows.reduce((s,x)=>s+x.net,0));pgProdutores.textContent=rows.filter(x=>x.liters||x.debt).length;
    const allPending=lancamentos.filter(x=>!entryPaid(x)),oldPending=allPending.filter(x=>String(x.data||'')<ym+'-01'),oldL=oldPending.reduce((s,x)=>s+N(x.qtd),0),pend=document.getElementById('v125Pending');
    if(pend)pend.innerHTML=`<b>Pendências anteriores:</b> ${new Set(oldPending.map(x=>x.prodId)).size} produtor(es) • ${fmt(oldL)} L. Essas entradas serão incluídas automaticamente no próximo pagamento.`;
    tbPag.innerHTML=rows.map(x=>`<tr><td><b>${x.p.nome}</b></td><td>${x.p.local||'-'}</td><td><b>${fmt(x.liters)} L</b><br><small>${x.parts.previous?`Saldo anterior: ${fmt(x.parts.previous)} L • `:''}Atual: ${fmt(x.parts.current)} L</small></td><td>${moeda(VALOR_LITRO)}</td><td><b>${moeda(x.net)}</b><br><small>Bruto ${moeda(x.gross)} • Débitos ${moeda(x.debt)}</small></td><td><span class="badge ${x.pg?'paid':'pending'}">${x.pg?'PAGO':'PENDENTE'}</span></td><td>${x.pg?brDate(x.pg.dataPagamento):'-'}</td><td>${q==='mes'?'-':x.pg?`<button class="btn danger" onclick="desfazerPagamento('${x.p.id}')">Desfazer</button>`:`<button class="btn yellow" onclick="marcarPago('${x.p.id}')">Marcar Pago</button>`}</td></tr>`).join('')||'<tr><td colspan="8">Nenhum saldo pendente para os filtros e o corte informados.</td></tr>';
  };
  const style=document.createElement('style');style.textContent='.v125-cut{margin:14px 0;padding:16px;border:2px solid #f1c84b;border-radius:14px;background:#fffdf3}.v125-title{font-weight:900;color:#18324f;margin-bottom:10px}.v125-grid{display:grid;grid-template-columns:2fr 1fr 1.3fr auto;gap:10px;align-items:end}.v125-grid label{font-size:12px;font-weight:800;color:#53657a}.v125-grid input,.v125-grid select{display:block;width:100%;margin-top:5px;padding:11px;border:1px solid #ccd6e1;border-radius:9px;background:#fff}.v125-grid button{border:0;border-radius:10px;background:#153d68;color:#fff;font-weight:900;padding:12px 16px}.v125-pending{margin-top:11px;padding:10px;border-radius:9px;background:#eef5ff;color:#27496d;font-size:13px}@media(max-width:800px){.v125-grid{grid-template-columns:1fr}.v125-grid button{width:100%}}';document.head.appendChild(style);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{inject();setTimeout(()=>renderPagamentos(),100)},{once:true});else{inject();setTimeout(()=>renderPagamentos(),100)}
})();
