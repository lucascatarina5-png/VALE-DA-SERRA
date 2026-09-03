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
  function pay(prodId,quiet,closure=null){
    const ym=pgMes.value||isoHoje().slice(0,7),q=pgQuinzena.value,c=selected();
    if(q==='mes'){if(!quiet)alert('Selecione uma quinzena.');return false}
    const p=prodById(prodId);if(!p)return false;
    const local=c.local||p.local||'';
    const entries=pendingEntries(prodId,c,local),debArr=pendingDebits(prodId,c);
    if(!entries.length&&!debArr.length){if(!quiet)alert('Este produtor não possui entradas ou débitos pendentes até o corte escolhido.');return false}
    const liters=entries.reduce((s,x)=>s+N(x.qtd),0),parts=splitLiters(entries,ym),gross=liters*VALOR_LITRO,debt=debArr.reduce((s,x)=>s+saldoDebito(x.id),0),net=Math.max(0,gross-debt);
    pagamentos=pagamentos.filter(x=>x.chave!==qKey(prodId,ym,q));
    const paymentId=crypto.randomUUID();
    pagamentos.push({chave:qKey(prodId,ym,q),id:paymentId,prodId,mes:ym,quinzena:q,localidade:local,corteData:c.date,corteTurno:c.turn==='M'?'Manhã':'Tarde',entryIds:entries.map(x=>x.id),debitIds:debArr.map(x=>x.id),litros,litrosSaldoAnterior:parts.previous,litrosQuinzenaAtual:parts.current,valorLitro:VALOR_LITRO,valorBruto:gross,totalDebitos:debt,valorPago:net,dataPagamento:isoHoje(),modeloPagamento:'fechamento-localidade-v130',fechamentoId:closure?.id||paymentId,fechamentoCriadoEm:closure?.createdAt||new Date().toISOString()});
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
    const total=ps.reduce((s,p)=>{const es=pendingEntries(p.id,c,c.local),ds=pendingDebits(p.id,c);return s+Math.max(0,es.reduce((a,x)=>a+N(x.qtd),0)*VALOR_LITRO-ds.reduce((a,x)=>a+saldoDebito(x.id),0))},0);
    if(!confirm(`FINALIZAR A QUINZENA DE ${c.local.toUpperCase()}?\n\nPago até: ${brDate(c.date)} - ${c.turn==='M'?'MANHÃ':'TARDE / DIA COMPLETO'}\nProdutores: ${ps.length}\nLeite: ${fmt(liters)} litros\nTotal líquido: ${moeda(total)}\n\nDepois da confirmação, esses valores sairão do Total Pendente.`))return;
    const closure={id:crypto.randomUUID(),createdAt:new Date().toISOString()};let count=0;ps.forEach(p=>{if(pay(p.id,true,closure))count++});save();
    try{await syncNow();renderPagamentos(false);alert(`✅ QUINZENA DA LOCALIDADE FINALIZADA.\n\n${c.local}\n${count} produtor(es) pagos\n${fmt(liters)} litros\n${moeda(total)}\n\nAgora o painel mostra somente o que ainda está pendente.`)}catch(e){alert('❌ '+e.message+' Tente novamente antes de fechar a tela.')}
  };
  window.v131ClearAugustRange=async function(){
    const start='2026-08-01',end='2026-08-29';
    const dateKey=v=>{const s=String(v||'').trim(),iso=s.match(/^(\d{4})-(\d{2})-(\d{2})/),br=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);return iso?`${iso[1]}-${iso[2]}-${iso[3]}`:br?`${br[3]}-${br[2]}-${br[1]}`:s.slice(0,10)};
    const removed=lancamentos.filter(x=>{const d=dateKey(x.data);return d>=start&&d<=end});
    if(!removed.length)return alert('Não existem entradas de leite entre 01/08/2026 e 29/08/2026. Nenhum dado foi alterado.');
    const liters=removed.reduce((s,x)=>s+N(x.qtd),0),people=new Set(removed.map(x=>String(x.prodId))).size;
    if(!confirm(`EXCLUIR AS ENTRADAS DE LEITE DE 01/08/2026 A 29/08/2026?\n\nSerão excluídos:\n• ${removed.length} entradas de leite\n• ${fmt(liters)} litros\n• lançamentos de ${people} produtor(es)\n\nSerão mantidos:\n• todos os produtores\n• entradas anteriores a 01/08/2026\n• entradas a partir de 30/08/2026\n• débitos, vendas, estoque e usuários\n\nEsta ação não pode ser desfeita pela tela.`))return;

    const oldEntries=lancamentos,oldPayments=pagamentos,oldDebits=debitos;
    const removedIds=new Set(removed.map(x=>String(x.id))),entryById=new Map(oldEntries.map(x=>[String(x.id),x]));
    let removedPayments=0,adjustedPayments=0;
    const releasedDebitIds=new Set();
    const rebuild=(pg,ids)=>{
      const entries=ids.map(id=>entryById.get(String(id))).filter(Boolean),litersLeft=entries.reduce((s,x)=>s+N(x.qtd),0),parts=splitLiters(entries,String(pg.mes||'')),rate=N(pg.valorLitro)||VALOR_LITRO,gross=litersLeft*rate,debt=N(pg.totalDebitos);
      adjustedPayments++;
      return {...pg,entryIds:entries.map(x=>x.id),litros:litersLeft,litrosSaldoAnterior:parts.previous,litrosQuinzenaAtual:parts.current,valorLitro:rate,valorBruto:gross,valorPago:Math.max(0,gross-debt),modeloPagamento:pg.modeloPagamento||'pagamento-ajustado-limpeza-v131'};
    };
    const drop=pg=>{removedPayments++;(pg.debitIds||[]).forEach(id=>releasedDebitIds.add(String(id)));return null};
    pagamentos=oldPayments.map(pg=>{
      if(Array.isArray(pg.entryIds)){
        const remaining=pg.entryIds.filter(id=>!removedIds.has(String(id)));
        if(remaining.length===pg.entryIds.length)return pg;
        return remaining.length?rebuild(pg,remaining):drop(pg);
      }
      if(String(pg.mes)!=='2026-08'||!['1','2'].includes(String(pg.quinzena)))return pg;
      const period=fixedPeriod(pg),remaining=oldEntries.filter(x=>String(x.prodId)===String(pg.prodId)&&dateKey(x.data)>=period.ini&&dateKey(x.data)<=period.fim&&!removedIds.has(String(x.id))).map(x=>x.id);
      return remaining.length?rebuild(pg,remaining):drop(pg);
    }).filter(Boolean);
    lancamentos=oldEntries.filter(x=>!removedIds.has(String(x.id)));
    debitos=oldDebits.map(x=>releasedDebitIds.has(String(x.id))?({...x,situacaoPagamento:'Pendente',pagamentoId:undefined}):x);
    try{
      await syncNow();
      localStorage.setItem('vds_limpeza_agosto_2026_v131',JSON.stringify({executadoEm:new Date().toISOString(),inicio:start,fim:end,entradas:removed.length,litros:liters,produtores:people,pagamentosRemovidos:removedPayments,pagamentosAjustados:adjustedPayments}));
      save();
      v25Audit('ENTRADAS_LEITE_PERIODO_EXCLUIDAS',{inicio:start,fim:end,entradas:removed.length,litros:liters,produtores:people,pagamentosRemovidos:removedPayments,pagamentosAjustados:adjustedPayments});
      renderPagamentos(false);
      alert(`✅ LIMPEZA CONCLUÍDA E CONFIRMADA NO SERVIDOR.\n\n${removed.length} entradas excluídas\n${fmt(liters)} litros retirados\n${people} produtor(es) envolvidos\n${removedPayments} pagamento(s) de teste removido(s)\n${adjustedPayments} pagamento(s) recalculado(s)\n\nTodos os produtores e as entradas fora de 01/08/2026 a 29/08/2026 foram mantidos.`);
    }catch(e){
      lancamentos=oldEntries;pagamentos=oldPayments;debitos=oldDebits;renderPagamentos(false);
      alert('❌ O servidor não confirmou a limpeza. Nenhuma entrada foi removida deste aparelho.\n\nMotivo: '+e.message);
    }
  };
  window.v130UndoClosure=async function(id){
    const group=pagamentos.filter(pg=>String(pg.fechamentoId||'')===String(id));if(!group.length)return;
    if(!confirm(`Desfazer o fechamento de ${group[0].localidade||'localidade'}?\n\n${group.length} pagamento(s) voltarão para pendente.`))return;
    const entryIds=new Set(group.flatMap(pg=>pg.entryIds||[]).map(String)),debitIds=new Set(group.flatMap(pg=>pg.debitIds||[]).map(String));
    lancamentos.forEach(x=>{if(entryIds.has(String(x.id))){x.situacaoPagamento='Pendente';delete x.pagamentoId;delete x.dataLiquidacao}});
    debitos.forEach(x=>{if(debitIds.has(String(x.id))){x.situacaoPagamento='Pendente';delete x.pagamentoId}});
    pagamentos=pagamentos.filter(pg=>String(pg.fechamentoId||'')!==String(id));save();
    try{await syncNow();renderPagamentos(false);alert('Fechamento desfeito. Os valores voltaram para Total Pendente.')}catch(e){alert('❌ '+e.message)}
  };
  function inject(){
    const anchor=document.getElementById('pgFiltroInfo');if(!anchor||document.getElementById('v125CutBox'))return;
    const box=document.createElement('div');box.id='v125CutBox';box.className='v125-cut';box.innerHTML=`<div class="v125-title">💰 Finalizar quinzena de uma localidade</div><div class="v129-steps"><span><b>1</b> Escolha a localidade</span><span><b>2</b> Informe data e turno final pagos</span><span><b>3</b> Finalize a quinzena</span></div><div class="v125-grid"><label>Localidade<select id="v125Local"></select></label><label>Pago até a data<input id="v125CutDate" type="date"></label><label>Último turno pago<select id="v125CutTurn"><option value="M">Manhã — tarde ficará pendente</option><option value="T" selected>Tarde — dia completo</option></select></label><button type="button" onclick="v125PayLocal()">✓ Finalizar quinzena da localidade</button></div><div id="v125Pending" class="v125-pending"></div><div id="v128AfterCut" class="v128-after"></div><details class="v128-clean" open><summary>🧹 Limpar entradas de teste de agosto de 2026</summary><div><button type="button" onclick="v131ClearAugustRange()">Excluir entradas de 01/08/2026 a 29/08/2026</button></div><small>Mantém todos os produtores e as entradas fora desse intervalo. Pagamentos ligados às entradas excluídas serão removidos ou recalculados para não deixar totais incorretos.</small></details>`;
    anchor.insertAdjacentElement('afterend',box);
    const loc=document.getElementById('v125Local'),vals=[...new Set(produtores.map(p=>p.local).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    loc.innerHTML='<option value="">Todas / pagamento individual</option>'+vals.map(x=>`<option>${String(x).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}</option>`).join('');
    document.getElementById('v125CutDate').value=isoHoje();
    ['pgLocalidade','pgNomeProdutor'].forEach(id=>{const el=document.getElementById(id);if(el?.parentElement)el.parentElement.style.display='none'});
    const table=document.getElementById('tbPag')?.closest('.tablewrap');if(table&&!document.getElementById('v130Closed'))table.insertAdjacentHTML('afterend','<div id="v130Closed" class="v130-closed"></div>');
    const labels=document.querySelectorAll('#pagamentos .kpi .label');if(labels[0])labels[0].textContent='LITROS PENDENTES';if(labels[1])labels[1].textContent='TOTAL PENDENTE';if(labels[2])labels[2].textContent='PRODUTORES PENDENTES';
    ['change','input'].forEach(ev=>box.addEventListener(ev,()=>renderPagamentos(false)));
  }
  const originalRender=window.renderPagamentos;
  window.renderPagamentos=function(manteraFoco=true){
    inject();if(!pgMes.value)pgMes.value=isoHoje().slice(0,7);
    const ym=pgMes.value,q=pgQuinzena.value,c=selected(),cutLocal=norm(c.local),rows=[];
    produtores.forEach(p=>{
      if(cutLocal&&norm(p.local)!==cutLocal)return;
      const arr=pendingEntries(p.id,c,c.local),ds=pendingDebits(p.id,c),parts=splitLiters(arr,ym),liters=parts.previous+parts.current,debt=ds.reduce((s,x)=>s+saldoDebito(x.id),0);
      if(liters||debt)rows.push({p,arr,parts,liters,debt,gross:liters*VALOR_LITRO,net:Math.max(0,liters*VALOR_LITRO-debt)});
    });
    rows.sort((a,b)=>(a.p.local||'').localeCompare(b.p.local||'','pt-BR')||a.p.nome.localeCompare(b.p.nome,'pt-BR'));
    pgLitros.textContent=fmt(rows.reduce((s,x)=>s+x.liters,0))+' L';pgTotal.textContent=moeda(rows.reduce((s,x)=>s+x.net,0));pgProdutores.textContent=rows.filter(x=>x.liters||x.debt).length;
    const allPending=lancamentos.filter(x=>!entryPaid(x)),scopedPending=allPending.filter(x=>!c.local||norm(x.local||prodById(x.prodId)?.local)===cutLocal),oldPending=scopedPending.filter(x=>String(x.data||'')<ym+'-01'),oldL=oldPending.reduce((s,x)=>s+N(x.qtd),0),pend=document.getElementById('v125Pending');
    if(pend)pend.innerHTML=c.local?`<b>Saldo pendente de ${c.local} até o corte:</b> ${rows.length} produtor(es) • ${fmt(rows.reduce((s,x)=>s+x.liters,0))} L • ${moeda(rows.reduce((s,x)=>s+x.net,0))}${oldPending.length?`<br><small>Inclui saldo anterior: ${new Set(oldPending.map(x=>x.prodId)).size} produtor(es) • ${fmt(oldL)} L</small>`:''}`:'<b>Escolha uma localidade para conferir e finalizar a quinzena.</b>';
    const after=scopedPending.filter(x=>!beforeCut(x,c)).sort((a,b)=>String(a.data).localeCompare(String(b.data))||entryTurn(a)-entryTurn(b));
    const afterBox=document.getElementById('v128AfterCut');if(afterBox){const afterL=after.reduce((s,x)=>s+N(x.qtd),0),people=new Set(after.map(x=>x.prodId)).size;afterBox.innerHTML=after.length?`<div class="v128-after-head"><b>⏳ Ficou pendente após o corte</b><strong>${people} produtor(es) • ${fmt(afterL)} L</strong></div>${after.slice(0,12).map(x=>`<div class="v128-after-row"><span><b>${prodById(x.prodId)?.nome||'Produtor'}</b><small>${brDate(x.data)} • ${entryTurn(x)===1?'Manhã':'Tarde'} • ${x.local||prodById(x.prodId)?.local||'-'}</small></span><strong>${fmt(x.qtd)} L</strong></div>`).join('')}${after.length>12?`<small>Mais ${after.length-12} entrada(s) pendente(s).</small>`:''}`:'<b>✅ Nenhuma entrega ficou pendente depois deste corte.</b>'}
    tbPag.innerHTML=rows.map(x=>`<tr><td><b>${x.p.nome}</b></td><td>${x.p.local||'-'}</td><td><b>${fmt(x.liters)} L</b><br><small>${x.parts.previous?`Saldo anterior: ${fmt(x.parts.previous)} L • `:''}Atual: ${fmt(x.parts.current)} L</small></td><td>${moeda(VALOR_LITRO)}</td><td><b>${moeda(x.net)}</b><br><small>Bruto ${moeda(x.gross)} • Débitos ${moeda(x.debt)}</small></td><td><span class="badge pending">PENDENTE</span></td><td>-</td><td><button class="btn secondary" onclick="marcarPago('${x.p.id}')">Pagar somente este</button></td></tr>`).join('')||'<tr><td colspan="8">✅ Esta localidade não possui valores pendentes até o corte escolhido.</td></tr>';
    const paid=pagamentos.filter(pg=>(q==='mes'||String(pg.quinzena)===String(q))&&String(pg.mes)===String(ym)&&(!c.local||norm(pg.localidade||prodById(pg.prodId)?.local)===cutLocal)),groups=new Map();
    paid.forEach(pg=>{const key=pg.fechamentoId||`${pg.localidade||''}|${pg.mes}|${pg.quinzena}|${pg.corteData||pg.dataPagamento}|${pg.corteTurno||''}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(pg)});
    const closed=document.getElementById('v130Closed');if(closed)closed.innerHTML=`<div class="v130-title">✅ Quinzenas finalizadas${c.local?' — '+c.local:''}</div>${groups.size?[...groups.entries()].reverse().map(([id,g])=>{const first=g[0],lit=g.reduce((s,x)=>s+N(x.litros),0),gross=g.reduce((s,x)=>s+N(x.valorBruto),0),debt=g.reduce((s,x)=>s+N(x.totalDebitos),0),net=g.reduce((s,x)=>s+N(x.valorPago),0);return `<details class="v130-group"><summary><span><b>${first.localidade||'-'} • ${first.quinzena}ª quinzena</b><small>Pago até ${brDate(first.corteData||first.dataPagamento)} • ${first.corteTurno||'Dia completo'} • ${g.length} produtor(es)</small></span><strong>${moeda(net)}</strong></summary><div class="v130-summary"><span>${fmt(lit)} L</span><span>Bruto ${moeda(gross)}</span><span>Débitos ${moeda(debt)}</span><span>Líquido ${moeda(net)}</span></div>${g.map(pg=>`<div class="v130-person"><span><b>${prodById(pg.prodId)?.nome||'Produtor'}</b><small>${fmt(pg.litros)} L • ${moeda(pg.valorPago)}</small></span><div class="v129-actions"><button class="btn secondary" onclick="imprimirCupom('${pg.prodId}','80mm')">🧾 80mm</button><button class="btn secondary" onclick="imprimirCupom('${pg.prodId}','a4')">📄 A4</button><button class="btn yellow" onclick="enviarWhatsApp('${pg.prodId}')">📲 WhatsApp</button></div></div>`).join('')}${first.fechamentoId?`<button class="v130-undo" onclick="v130UndoClosure('${id}')">Desfazer fechamento completo</button>`:''}</details>`}).join(''):'<div class="v130-empty">Nenhuma quinzena finalizada para este filtro.</div>'}`;
  };
  const style=document.createElement('style');style.textContent='.v125-cut{margin:14px 0;padding:16px;border:2px solid #f1c84b;border-radius:14px;background:#fffdf3}.v125-title{font-weight:900;color:#18324f;margin-bottom:10px;font-size:18px}.v129-steps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:13px}.v129-steps span{background:#edf4fc;border-radius:10px;padding:8px 10px;font-size:12px;color:#35516f}.v129-steps b{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:50%;background:#153d68;color:white;margin-right:4px}.v125-grid{display:grid;grid-template-columns:2fr 1fr 1.3fr auto;gap:10px;align-items:end}.v125-grid label{font-size:12px;font-weight:800;color:#53657a}.v125-grid input,.v125-grid select{display:block;width:100%;margin-top:5px;padding:11px;border:1px solid #ccd6e1;border-radius:9px;background:#fff}.v125-grid button{border:0;border-radius:10px;background:#153d68;color:#fff;font-weight:900;padding:12px 16px}.v125-pending{margin-top:11px;padding:10px;border-radius:9px;background:#eef5ff;color:#27496d;font-size:13px}.v128-after{margin-top:10px;padding:12px;border-radius:10px;background:#fff;color:#263b52;border:1px solid #e2c45d}.v128-after-head,.v128-after-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0}.v128-after-row{border-top:1px solid #edf0f3}.v128-after-row small{display:block;color:#718096;margin-top:3px}.v128-clean{margin-top:12px;border-top:1px dashed #d2b84f;padding-top:10px}.v128-clean summary{cursor:pointer;font-weight:800;color:#7a5800}.v128-clean div{display:flex;gap:8px;align-items:end;margin-top:10px}.v128-clean button{border:0;border-radius:8px;background:#a52b2b;color:#fff;padding:10px;font-weight:800}.v128-clean small{display:block;margin-top:6px;color:#756b50}.v129-actions{display:flex;gap:5px;flex-wrap:wrap}.v129-actions .btn{white-space:nowrap}@media(max-width:800px){.v125-grid{grid-template-columns:1fr}.v125-grid button{width:100%}.v128-after-head,.v128-after-row{align-items:flex-start}.v128-clean div{display:grid}.v128-clean button{width:100%}.v129-steps{display:grid}.v129-actions{display:grid;grid-template-columns:1fr 1fr}.v129-actions .btn{width:100%}}';document.head.appendChild(style);
  const closedStyle=document.createElement('style');closedStyle.textContent='.v130-closed{margin-top:20px}.v130-title{font-size:18px;font-weight:900;color:#153d68;margin:12px 0}.v130-group{background:#fff;border:1px solid #b9ddc3;border-left:6px solid #199447;border-radius:13px;margin:10px 0;overflow:hidden}.v130-group>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px;cursor:pointer;background:#f2fbf5}.v130-group>summary span small{display:block;color:#5f7466;margin-top:4px}.v130-group>summary>strong{font-size:18px;color:#16733b}.v130-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px}.v130-summary span{background:#f5f7fa;padding:9px;border-radius:8px;font-weight:800}.v130-person{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;border-top:1px solid #e8ece9}.v130-person small{display:block;color:#6d7880;margin-top:3px}.v130-undo{margin:12px;border:1px solid #d99;background:#fff;color:#a22;border-radius:9px;padding:10px;font-weight:800}.v130-empty{padding:18px;background:#f5f7fa;border-radius:10px;color:#718096}@media(max-width:800px){.v130-summary{grid-template-columns:1fr 1fr}.v130-person{display:block}.v130-person .v129-actions{margin-top:8px}.v130-group>summary{align-items:flex-start}}';document.head.appendChild(closedStyle);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{inject();setTimeout(()=>renderPagamentos(),100)},{once:true});else{inject();setTimeout(()=>renderPagamentos(),100)}
})();
