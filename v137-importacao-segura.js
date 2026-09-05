(function(){
  'use strict';

  const BATCH_KEY='vds_pdf_import_batches_v137';
  const E=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const N=v=>Number(v||0);
  const norm=v=>String(v||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
  const money=v=>N(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const liters=v=>N(v).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const today=()=>new Date().toISOString().slice(0,10);
  const brDate=v=>{const m=String(v||'').slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:(v||'-')};
  let current=null;

  function batches(){try{const x=JSON.parse(localStorage.getItem(BATCH_KEY)||'[]');return Array.isArray(x)?x:[]}catch(_){return []}}
  function saveBatches(rows){localStorage.setItem(BATCH_KEY,JSON.stringify(rows))}
  function producer(id){return (Array.isArray(produtores)?produtores:[]).find(x=>String(x.id)===String(id))}
  function producerCode(p){return String(p?.codigo||'').trim()}
  function turnFromHour(value){const m=String(value||'').match(/^(\d{1,2}):/);return m&&Number(m[1])<12?'M':m?'T':''}
  function turnName(v){return v==='M'?'Manhã':v==='T'?'Tarde':'Não definido'}
  function unique(values){return [...new Set(values.map(x=>String(x||'').trim()).filter(Boolean))]}
  function selectedLocality(row,index){return (document.getElementById('v137loc'+index)?.value||row.localidade||'').trim()}
  function selectedTurn(row,index){return document.getElementById('v137turn'+index)?.value||row.v137Turn||turnFromHour(row.hora)}
  function eventKey(data,hora,codeOrId){return ['RECEBIMENTO',String(data||''),String(hora||''),String(codeOrId||'')].join('|')}
  function entryPaid(x){return (Array.isArray(pagamentos)?pagamentos:[]).some(pg=>Array.isArray(pg.entryIds)&&pg.entryIds.some(id=>String(id)===String(x.id)))}

  async function fileHash(file){
    const buf=await file.arrayBuffer();
    if(globalThis.crypto?.subtle){
      const digest=await crypto.subtle.digest('SHA-256',buf);
      return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
    }
    let h=2166136261;for(const b of new Uint8Array(buf)){h^=b;h=Math.imul(h,16777619)}
    return `fnv-${(h>>>0).toString(16)}-${file.size}`;
  }

  function averageFor(prodId,turn,data){
    const rows=(Array.isArray(lancamentos)?lancamentos:[]).filter(x=>String(x.prodId)===String(prodId)&&String(x.data||'')<String(data||'')&&(String(x.periodo||'').toUpperCase()===turn||norm(x.turno).startsWith(turn==='M'?'manh':'tard'))).sort((a,b)=>String(b.data||'').localeCompare(String(a.data||''))).slice(0,10);
    return rows.length>=3?rows.reduce((s,x)=>s+N(x.qtd),0)/rows.length:0;
  }

  function existingEvent(data,row,p){
    const code=producerCode(p)||String(row.codigo||'').trim(),key=eventKey(data,row.hora,code||p?.id);
    const found=(Array.isArray(lancamentos)?lancamentos:[]).find(x=>{
      if(x.pdfEventKey===key)return true;
      if(!String(x.origem||'').toUpperCase().includes('PDF'))return false;
      const xp=producer(x.prodId),xcode=producerCode(xp)||String(x.prodId||'');
      return String(x.data||'')===String(data||'')&&String(x.hora||'')===String(row.hora||'')&&String(xcode)===String(code||p?.id);
    });
    return {key,found};
  }

  function exactCode(row,p){
    const code=String(row.codigo||'').trim();
    return !!code&&!!p&&producerCode(p)===code;
  }

  function review(){
    const rows=Array.isArray(V104?.entradaRows)?V104.entradaRows:[],meta=V104?.entradaMeta||{},issues=[],warnings=[],prepared=[];
    const data=document.getElementById('v104EntradaData')?.value||meta.data||'';
    if(!current)issues.push('Leia o arquivo PDF antes de confirmar.');
    if(!data)issues.push('A data do relatório não foi identificada.');
    if(meta.data&&data!==meta.data)issues.push(`A data escolhida (${brDate(data)}) é diferente da data impressa no PDF (${brDate(meta.data)}).`);
    if(!rows.length)issues.push('Nenhuma coleta com SIM e volume maior que zero foi identificada.');
    let total=0,manual=0,unresolved=0,variations=0,localConflicts=0,duplicates=0;const batchEvents=new Map();
    rows.forEach((r,i)=>{
      const pid=document.getElementById('v137prod'+i)?.value||'',p=producer(pid),q=N(document.getElementById('v137qty'+i)?.value),turn=selectedTurn(r,i),local=selectedLocality(r,i);
      total+=q;
      if(!p){unresolved++;issues.push(`Linha ${i+1}: selecione o produtor correto.`)}
      if(!(q>0)){issues.push(`Linha ${i+1}: informe uma quantidade válida.`)}
      if(!turn){issues.push(`Linha ${i+1}: confirme Manhã ou Tarde.`)}
      if(!local){issues.push(`Linha ${i+1}: informe a localidade.`)}
      if(p){
        const pdfCode=String(r.codigo||'').trim();
        if(pdfCode&&!exactCode(r,p))issues.push(`Linha ${i+1}: o código ${pdfCode} do PDF não pertence a ${p.nome}. Corrija o cadastro ou a seleção.`);
        if(!pdfCode)manual++;
        if(local&&p.local&&norm(local)!==norm(p.local)&&!(p.localidadesConhecidas||[]).some(x=>norm(x)===norm(local)))localConflicts++;
        const avg=averageFor(p.id,turn,data);if(avg&&Math.abs(q-avg)/avg>=.5)variations++;
        const old=existingEvent(data,r,p);if(old.found){duplicates++;issues.push(`Linha ${i+1}: já existe uma coleta para este produtor em ${r.hora||'horário não informado'} (${liters(old.found.qtd)} L).`)}
        if(batchEvents.has(old.key)){duplicates++;issues.push(`Linhas ${batchEvents.get(old.key)+1} e ${i+1}: o mesmo produtor aparece duas vezes no mesmo horário.`)}else batchEvents.set(old.key,i);
        prepared.push({row:r,index:i,p,q,turn,local,eventKey:old.key});
      }
    });
    const declared=N(meta.totalDeclarado);
    if(!(declared>0))issues.push('O total geral do relatório não foi identificado. A importação segura exige esse total.');
    else if(Math.abs(total-declared)>.009)issues.push(`O PDF informa ${liters(declared)} L, mas as linhas revisadas somam ${liters(total)} L.`);
    if(current&&batches().some(x=>x.status==='confirmado'&&x.hash===current.hash))issues.push('Este mesmo arquivo PDF já foi confirmado anteriormente.');
    if(manual)warnings.push(`${manual} produtor(es) foram escolhidos manualmente porque a linha não possuía código.`);
    if(variations)warnings.push(`${variations} entrada(s) variam 50% ou mais da média recente do mesmo turno.`);
    if(localConflicts)warnings.push(`${localConflicts} localidade(s) são diferentes do cadastro principal e serão guardadas como conhecidas.`);
    return {rows,meta,data,total,declared,prepared,issues:[...new Set(issues)],warnings,manual,unresolved,variations,localConflicts,duplicates};
  }

  function producerOptions(selected,suggested){
    const list=(Array.isArray(produtores)?produtores:[]).slice().sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
    return `<option value="">Selecione obrigatoriamente...</option>`+list.map(p=>`<option value="${E(p.id)}" ${String(p.id)===String(selected)?'selected':''}>${E((p.codigo?p.codigo+' • ':'')+p.nome)}</option>`).join('')+(suggested&&!list.some(p=>String(p.id)===String(suggested))?'':'');
  }

  function renderSafeRows(){
    const box=document.getElementById('v104EntradaResults');if(!box)return;
    const rows=Array.isArray(V104?.entradaRows)?V104.entradaRows:[],meta=V104?.entradaMeta||{};
    if(typeof v106RenderMeta==='function')v106RenderMeta();
    if(!rows.length){box.innerHTML='<div class="v137-empty"><b>Nenhuma coleta válida foi montada.</b><span>Confira o texto lido. Nenhum pagamento deve ser feito enquanto o relatório estiver pendente.</span></div>';renderReview();return}
    const total=rows.reduce((s,x)=>s+N(x.litros),0),exact=rows.filter(x=>x.v137Exact).length;
    box.innerHTML=`<div class="v137-headline"><div><b>🛡️ Conferência obrigatória V137</b><small>${rows.length} coleta(s) • ${liters(total)} L • ${exact} código(s) confirmados automaticamente</small></div><button type="button" onclick="v137ApplyLocality()">📍 Aplicar localidade a todos</button></div>
      <div class="v137-tablewrap"><table class="v104-table v137-table"><thead><tr><th>Linha</th><th>Hora / turno</th><th>Código e nome no PDF</th><th>Produtor que receberá o leite</th><th>Localidade</th><th>Litros</th><th>Verificação</th></tr></thead><tbody>${rows.map((r,i)=>{
        const p=producer(r.prodId),avg=p?averageFor(p.id,r.v137Turn,meta.data||document.getElementById('v104EntradaData')?.value):0,diff=avg?Math.round((N(r.litros)-avg)/avg*100):null;
        return `<tr id="v137row${i}" class="${r.v137Exact?'v137-exact':'v137-manual'}"><td><b>${i+1}</b></td><td><b>${E(r.hora||'—')}</b><select id="v137turn${i}" onchange="v137Review()"><option value="">Confirmar...</option><option value="M" ${r.v137Turn==='M'?'selected':''}>Manhã</option><option value="T" ${r.v137Turn==='T'?'selected':''}>Tarde</option></select></td><td><b>${E(r.codigo||'Sem código')} • ${E(r.name||'')}</b><small>${E(r.raw||'')}</small></td><td><select id="v137prod${i}" onchange="v137Review()">${producerOptions(r.prodId,r.v137Suggestion)}</select>${r.v137Suggestion&&!r.v137Exact?`<small class="v137-suggestion">Sugestão não aplicada: ${E(producer(r.v137Suggestion)?.nome||'')}</small>`:''}</td><td><input id="v137loc${i}" list="v107LocalidadesList" value="${E(r.localidade||'')}" onchange="v137Review()"></td><td><input id="v137qty${i}" type="number" min="0.01" step="0.01" value="${E(r.litros)}" oninput="v137Review()"></td><td>${r.v137Exact?'<span class="v137-ok">✓ Código exato</span>':'<span class="v137-warn">⚠ Revisão manual</span>'}${diff!==null&&Math.abs(diff)>=50?`<small class="v137-variation">Variação de ${diff>0?'+':''}${diff}% da média</small>`:''}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div id="v137ReviewPanel"></div>
      <button id="v137ConfirmBtn" class="v104-confirm" style="width:100%;margin-top:12px" onclick="v137ConfirmImport()">🔒 Confirmar lote completo e registrar entradas</button>`;
    renderReview();
  }

  function renderReview(){
    const panel=document.getElementById('v137ReviewPanel'),button=document.getElementById('v137ConfirmBtn');if(!panel)return;
    const v=review(),ok=!v.issues.length;
    panel.innerHTML=`<div class="v137-review ${ok?'ok':'bad'}"><div class="v137-review-title">${ok?'✅ RELATÓRIO PRONTO PARA CONFIRMAR':'⛔ CONFIRMAÇÃO BLOQUEADA'}</div><div class="v137-checks"><span class="${v.rows.length?'ok':'bad'}">${v.rows.length?'✓':'✕'} ${v.rows.length} linha(s) identificada(s)</span><span class="${v.unresolved?'bad':'ok'}">${v.unresolved?'✕':'✓'} ${v.unresolved||'Todos'} produtor(es) ${v.unresolved?'sem localizar':'localizados'}</span><span class="${v.declared>0&&Math.abs(v.total-v.declared)<.01?'ok':'bad'}">${v.declared>0&&Math.abs(v.total-v.declared)<.01?'✓':'✕'} Total PDF ${liters(v.declared)} L • sistema ${liters(v.total)} L</span><span class="${v.duplicates?'bad':'ok'}">${v.duplicates?'✕':'✓'} ${v.duplicates||'Nenhuma'} duplicidade${v.duplicates?' encontrada':' encontrada'}</span></div>${v.issues.length?`<ul>${v.issues.map(x=>`<li>${E(x)}</li>`).join('')}</ul>`:''}${v.warnings.length?`<div class="v137-warnings">${v.warnings.map(x=>`<span>⚠️ ${E(x)}</span>`).join('')}</div>`:''}</div>`;
    if(button){button.disabled=!ok;button.textContent=ok?'🔒 Confirmar lote completo e registrar entradas':`⛔ Corrija ${v.issues.length} problema(s) para confirmar`}
    updatePendingFromReview(v);
  }

  function updatePendingFromReview(v){
    if(!current||current.confirmedDuplicate)return;
    const all=batches(),idx=all.findIndex(x=>x.id===current.id),row={...current,status:'pendente',data:v.data||'',localities:unique(v.prepared.map(x=>x.local)),totalLido:v.total,totalDeclarado:v.declared,linhas:v.rows.length,problemas:v.issues.length,avisos:v.warnings.length,updatedAt:new Date().toISOString()};
    if(idx>=0)all[idx]=row;else all.push(row);saveBatches(all);
  }

  async function syncState(importacoesPdf){
    const headers=typeof v4Headers==='function'?v4Headers():{};headers['Content-Type']='application/json';
    const response=await fetch('/api/state',{method:'PUT',headers,body:JSON.stringify({data:{produtores,lancamentos,pagamentos,debitos,pagamentosDebitos,importacoesPdf}}),cache:'no-store'});
    if(!response.ok){let msg='O servidor não confirmou a importação.';try{const j=await response.json();if(j.error)msg=j.error}catch(_){}throw new Error(msg)}
  }

  window.v137Review=renderReview;
  window.v137ApplyLocality=function(){const value=(document.getElementById('v104EntradaLocal')?.value||'').trim();if(!value)return alert('Informe a localidade no campo superior.');(V104.entradaRows||[]).forEach((_,i)=>{const el=document.getElementById('v137loc'+i);if(el)el.value=value});renderReview()};

  window.v137ConfirmImport=async function(){
    const v=review();if(v.issues.length){v25Audit('IMPORTACAO_PDF_BLOQUEADA',{arquivo:current?.fileName||'',problemas:v.issues.length,totalPdf:v.declared,totalLido:v.total});alert('⛔ A importação está bloqueada.\n\n'+v.issues.map((x,i)=>`${i+1}. ${x}`).join('\n'));return}
    const summary=`CONFIRMAR O LOTE COMPLETO?\n\nArquivo: ${current.fileName}\nData: ${brDate(v.data)}\nEntradas: ${v.prepared.length}\nTotal: ${liters(v.total)} litros\n${v.warnings.length?'\nATENÇÃO:\n'+v.warnings.join('\n')+'\n':''}\nDepois da confirmação, qualquer correção ficará registrada no histórico.`;
    if(!confirm(summary))return;
    const oldProducers=JSON.parse(JSON.stringify(produtores)),oldEntries=lancamentos.slice(),oldBatches=batches();
    const batchId=current.id,entryIds=[];
    try{
      for(const x of v.prepared){
        const p=producer(x.p.id);if(!p)throw new Error('Um produtor deixou de existir durante a confirmação.');
        if(x.local){
          if(!p.local)p.local=x.local;
          else if(norm(p.local)!==norm(x.local)){if(!Array.isArray(p.localidadesConhecidas))p.localidadesConhecidas=[];if(!p.localidadesConhecidas.some(y=>norm(y)===norm(x.local)))p.localidadesConhecidas.push(x.local)}
        }
        if(v.meta.rota&&!p.rota)p.rota=v.meta.rota;if(v.meta.responsavel&&!p.tanqueiro)p.tanqueiro=v.meta.responsavel;
        const id=crypto.randomUUID();entryIds.push(id);
        lancamentos.push({id,data:v.data,prodId:p.id,qtd:x.q,periodo:x.turn,turno:turnName(x.turn),situacaoPagamento:'Pendente',local:x.local,tanqueiro:v.meta.responsavel||p.tanqueiro||'',caminhao:p.caminhao||'',origem:'PDF_SEGURO',hora:x.row.hora||'',rota:v.meta.rota||p.rota||'',pdfHash:current.hash,pdfBatchId:batchId,pdfEventKey:x.eventKey,pdfFileName:current.fileName,pdfModelo:'RELATORIO_RECEBIMENTO_TANQUEIRO_V137'});
      }
      const confirmed={...current,status:'confirmado',data:v.data,localities:unique(v.prepared.map(x=>x.local)),totalLido:v.total,totalDeclarado:v.declared,linhas:v.prepared.length,entryIds,problemas:0,avisos:v.warnings,confirmedAt:new Date().toISOString()};
      const next=oldBatches.filter(x=>x.id!==batchId);next.push(confirmed);
      await syncState(next);saveBatches(next);save();
      await v25Audit('IMPORTACAO_PDF_CONFIRMADA',{lote:batchId,arquivo:current.fileName,data:v.data,entradas:entryIds.length,litros:v.total,localidades:confirmed.localities.join(', '),hash:current.hash});
      current={...confirmed,confirmedDuplicate:true};v104Fechar('v104EntradaModal');
      alert(`✅ IMPORTAÇÃO SEGURA CONCLUÍDA\n\n${entryIds.length} entradas registradas\n${liters(v.total)} litros\nTodos os produtores foram identificados\nTotal do PDF conferido\nTurnos gravados como Manhã/Tarde\nLote confirmado no servidor`);
    }catch(e){
      produtores=oldProducers;lancamentos=oldEntries;saveBatches(oldBatches);save();alert('❌ Nenhuma entrada foi registrada.\n\n'+e.message);
    }
  };

  function batchCard(x){
    const color=x.status==='confirmado'?'ok':x.status==='pendente'?'warn':'muted',status=x.status==='confirmado'?'CONFIRMADO':x.status==='pendente'?'PENDENTE DE CONFERÊNCIA':'CANCELADO / DESCARTADO';
    return `<div class="v137-batch ${color}"><div><b>${E(x.fileName||'Relatório PDF')}</b><small>${brDate(x.data)} • ${E((x.localities||[]).join(', ')||'Localidade não definida')} • ${x.linhas||0} entrada(s) • ${liters(x.totalLido)} L</small><small>Lote ${E(String(x.id||'').slice(-12))} • ${x.confirmedAt?'Confirmado em '+new Date(x.confirmedAt).toLocaleString('pt-BR'):'Aguardando conclusão'}</small></div><span class="v137-batch-status ${color}">${status}</span>${x.status==='confirmado'?`<button onclick="v137CancelBatch('${E(x.id)}')">Cancelar lote</button>`:x.status==='pendente'?`<button onclick="v137DiscardBatch('${E(x.id)}')">Descartar pendência</button>`:''}</div>`;
  }

  window.v137OpenHistory=function(){const all=batches().slice().sort((a,b)=>String(b.confirmedAt||b.updatedAt||'').localeCompare(String(a.confirmedAt||a.updatedAt||'')));document.getElementById('v137HistoryRows').innerHTML=all.map(batchCard).join('')||'<div class="v137-empty"><b>Nenhuma importação registrada.</b><span>Os próximos relatórios aparecerão aqui.</span></div>';document.getElementById('v137HistoryModal').classList.add('on');document.getElementById('v137HistoryModal').style.display='flex'};
  window.v137CloseHistory=function(){const m=document.getElementById('v137HistoryModal');m.classList.remove('on');m.style.display=''};
  window.v137DiscardBatch=function(id){const all=batches(),x=all.find(b=>b.id===id);if(!x||x.status!=='pendente')return;if(!confirm(`Descartar a pendência do arquivo "${x.fileName}"?`))return;x.status='descartado';x.cancelledAt=new Date().toISOString();saveBatches(all);save();v137OpenHistory();updatePaymentGuard()};
  window.v137CancelBatch=async function(id){
    if(typeof v4IsAdmin==='function'&&!v4IsAdmin())return alert('Somente o Administrador pode cancelar uma importação confirmada.');
    const oldBatches=batches(),x=oldBatches.find(b=>b.id===id);if(!x||x.status!=='confirmado')return;
    const ids=new Set((x.entryIds||[]).map(String)),linked=lancamentos.filter(e=>ids.has(String(e.id))||String(e.pdfBatchId)===String(id));
    if(linked.some(entryPaid))return alert('Este lote possui leite que já entrou em um pagamento. Desfaça primeiro o pagamento da quinzena correspondente.');
    const reason=prompt('Informe o motivo obrigatório para cancelar este lote:','');if(!String(reason||'').trim())return alert('O cancelamento exige um motivo.');
    if(!confirm(`Cancelar o lote e retirar ${linked.length} entrada(s), totalizando ${liters(linked.reduce((s,e)=>s+N(e.qtd),0))} L?`))return;
    const oldEntries=lancamentos.slice(),next=JSON.parse(JSON.stringify(oldBatches)),target=next.find(b=>b.id===id);target.status='cancelado';target.cancelledAt=new Date().toISOString();target.cancelReason=String(reason).trim();
    try{lancamentos=lancamentos.filter(e=>!ids.has(String(e.id))&&String(e.pdfBatchId)!==String(id));await syncState(next);saveBatches(next);save();await v25Audit('IMPORTACAO_PDF_CANCELADA',{lote:id,arquivo:x.fileName,entradas:linked.length,litros:linked.reduce((s,e)=>s+N(e.qtd),0),motivo:String(reason).trim()});v137OpenHistory();updatePaymentGuard();alert('✅ Lote cancelado. As entradas foram retiradas e o histórico foi preservado.')}catch(e){lancamentos=oldEntries;saveBatches(oldBatches);save();alert('❌ O servidor não confirmou o cancelamento. Nenhuma entrada foi retirada.\n\n'+e.message)}
  };

  function paymentBlockers(local,cutDate){
    const normalizedLocal=norm(local),all=batches(),pending=all.filter(x=>x.status==='pendente'&&(!x.data||String(x.data)<=String(cutDate||today()))&&(!(x.localities||[]).length||(x.localities||[]).some(l=>norm(l)===normalizedLocal)));
    const missingTurn=(Array.isArray(lancamentos)?lancamentos:[]).filter(x=>String(x.origem||'').toUpperCase().includes('PDF')&&String(x.data||'')<=String(cutDate||today())&&(!normalizedLocal||norm(x.local||producer(x.prodId)?.local)===normalizedLocal)&&!String(x.periodo||'').trim()&&!norm(x.turno).match(/manh|tard/));
    return {pending,missingTurn};
  }

  function updatePaymentGuard(){
    const box=document.getElementById('v125CutBox');if(!box)return;
    let panel=document.getElementById('v137PaymentGuard');if(!panel){panel=document.createElement('div');panel.id='v137PaymentGuard';box.appendChild(panel)}
    const local=document.getElementById('v125Local')?.value||'',date=document.getElementById('v125CutDate')?.value||today(),b=paymentBlockers(local,date),blocked=b.pending.length||b.missingTurn.length;
    panel.className='v137-payment-guard '+(blocked?'bad':'ok');panel.innerHTML=blocked?`<b>⛔ Pagamento protegido pela conferência PDF</b><span>${b.pending.length?`${b.pending.length} relatório(s) aguardando conclusão. `:''}${b.missingTurn.length?`${b.missingTurn.length} entrada(s) de PDF sem turno definido.`:''}</span><button onclick="v137OpenHistory()">Ver importações</button>`:'<b>✅ Conferência PDF sem pendências conhecidas</b><span>Não existem relatórios abertos ou entradas PDF sem turno até este corte.</span>';
  }

  function canPay(local,date){const b=paymentBlockers(local,date);if(!b.pending.length&&!b.missingTurn.length)return true;alert(`⛔ PAGAMENTO BLOQUEADO\n\n${b.pending.length?`${b.pending.length} relatório(s) PDF ainda não foram concluídos.\n`:''}${b.missingTurn.length?`${b.missingTurn.length} entrada(s) importadas não possuem Manhã/Tarde.\n`:''}\nAbra o histórico de importações e resolva as pendências antes de pagar.`);updatePaymentGuard();return false}

  function migrateOldTurns(){
    let count=0;(Array.isArray(lancamentos)?lancamentos:[]).forEach(x=>{if(String(x.origem||'').toUpperCase().includes('PDF')&&!String(x.periodo||'').trim()&&!norm(x.turno).match(/manh|tard/)){const t=turnFromHour(x.hora);if(t){x.periodo=t;x.turno=turnName(t);count++}}});
    if(count){save();v25Audit('IMPORTACAO_PDF_MIGRACAO_TURNO',{entradas:count,regra:'Horário anterior a 12:00 = Manhã; demais = Tarde'})}
  }

  function inject(){
    if(document.getElementById('v137HistoryModal'))return;
    const actions=document.querySelector('#v104EntradaModal .v104-actions');if(actions)actions.insertAdjacentHTML('beforeend','<button type="button" class="v137-history-btn" onclick="v137OpenHistory()">🗂️ Histórico dos lotes</button>');
    document.body.insertAdjacentHTML('beforeend',`<div id="v137HistoryModal" class="v104-modal" aria-hidden="true"><div class="v104-box"><div class="v104-head"><div><h2>🛡️ Histórico das importações de leite</h2><p>Cada PDF é um lote único. Lotes pendentes impedem o pagamento daquela localidade.</p></div><button class="v104-x" onclick="v137CloseHistory()">×</button></div><div class="v104-body"><div id="v137HistoryRows"></div></div></div></div>`);
    const style=document.createElement('style');style.textContent=`.v137-history-btn{border:1px solid #b9cbe1;background:#fff;color:#124b86;border-radius:10px;padding:10px 14px;font-weight:800}.v137-headline{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:12px 0;padding:13px;border-radius:12px;background:#eaf3ff;color:#123e70}.v137-headline small,.v137-table small,.v137-batch small{display:block;margin-top:4px;color:#6a7d92}.v137-headline button{border:0;border-radius:9px;padding:9px;background:#154b83;color:#fff;font-weight:800}.v137-tablewrap{overflow:auto;border:1px solid #d8e2ee;border-radius:12px}.v137-table{min-width:1160px}.v137-table select,.v137-table input{min-width:120px;padding:8px;border:1px solid #c8d4e2;border-radius:8px}.v137-table td:nth-child(4) select{min-width:260px}.v137-exact{background:#fbfffc}.v137-manual{background:#fffbf0}.v137-ok{color:#16813b;font-weight:900}.v137-warn{color:#a35d00;font-weight:900}.v137-suggestion,.v137-variation{color:#a35d00!important}.v137-review{margin-top:12px;border-radius:13px;padding:14px;border:1px solid}.v137-review.ok{background:#edf9f1;border-color:#91d5a7}.v137-review.bad{background:#fff2f2;border-color:#efaaaa}.v137-review-title{font-weight:900;margin-bottom:9px}.v137-checks{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.v137-checks span{padding:8px;border-radius:8px;background:#fff}.v137-checks .ok{color:#137638}.v137-checks .bad{color:#b52222}.v137-review ul{margin:10px 0 0;padding-left:20px;color:#9c1e1e}.v137-warnings{display:grid;gap:5px;margin-top:10px;color:#8c5600}.v137-empty{display:grid;gap:5px;text-align:center;padding:28px;color:#60758c}.v137-batch{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;border:1px solid #d6e0eb;border-left:6px solid;border-radius:12px;padding:13px;margin:9px 0}.v137-batch.ok{border-left-color:#16813b}.v137-batch.warn{border-left-color:#dc8700}.v137-batch.muted{border-left-color:#8795a5;opacity:.8}.v137-batch-status{font-size:11px;font-weight:900;border-radius:999px;padding:7px 9px}.v137-batch-status.ok{background:#e4f6e9;color:#137638}.v137-batch-status.warn{background:#fff1d9;color:#925700}.v137-batch-status.muted{background:#edf0f3;color:#5e6a77}.v137-batch button,.v137-payment-guard button{border:1px solid #cfdae5;background:#fff;border-radius:8px;padding:8px;font-weight:800;color:#913232}.v137-payment-guard{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center;margin-top:10px;padding:12px;border-radius:10px}.v137-payment-guard span{font-size:12px}.v137-payment-guard.ok{background:#eaf8ef;color:#176c37}.v137-payment-guard.bad{background:#fff0f0;color:#9b2222;border:1px solid #efbbbb}.v137-payment-guard button{grid-column:2;grid-row:1/3}@media(max-width:760px){.v137-headline{display:grid}.v137-checks{grid-template-columns:1fr}.v137-batch{grid-template-columns:1fr}.v137-payment-guard{grid-template-columns:1fr}.v137-payment-guard button{grid-column:auto;grid-row:auto}}`;document.head.appendChild(style);
  }

  const originalRead=window.v104LerEntradaPDF;
  const originalRender=window.v104RenderEntryRows;
  if(typeof originalRead==='function')window.v104LerEntradaPDF=async function(){
    current=null;await originalRead.apply(this,arguments);
    const file=document.getElementById('v104EntradaFile')?.files?.[0],rows=Array.isArray(V104?.entradaRows)?V104.entradaRows:[];if(!file||!rows.length){renderSafeRows();return}
    try{
      const hash=await fileHash(file),id='pdf_'+hash.slice(0,24),confirmed=batches().find(x=>x.hash===hash&&x.status==='confirmado');
      current={id,hash,fileName:file.name,fileSize:file.size,fileModified:file.lastModified,createdAt:new Date().toISOString(),confirmedDuplicate:!!confirmed};
      rows.forEach(r=>{const p=producer(r.prodId),exact=exactCode(r,p)&&r.matchBy==='codigo';r.v137Exact=exact;r.v137Suggestion=exact?'':r.prodId;r.prodId=exact?r.prodId:'';r.status=exact?'ok':r.v137Suggestion?'warn':'bad';r.v137Turn=turnFromHour(r.hora)});
      renderSafeRows();
      const st=document.getElementById('v104EntradaStatus');if(st)st.textContent+=(confirmed?' ⛔ Este arquivo já foi confirmado anteriormente.':' 🛡️ Revise todos os campos; somente o lote completo poderá ser confirmado.');
    }catch(e){document.getElementById('v104EntradaStatus').textContent='Erro ao criar a identificação segura do arquivo: '+e.message;renderSafeRows()}
  };
  window.v104RenderEntryRows=renderSafeRows;

  const oldPayLocal=window.v125PayLocal;if(typeof oldPayLocal==='function')window.v125PayLocal=function(){const local=document.getElementById('v125Local')?.value||'',date=document.getElementById('v125CutDate')?.value||today();if(!canPay(local,date))return;return oldPayLocal.apply(this,arguments)};
  const oldPayOne=window.marcarPago;if(typeof oldPayOne==='function')window.marcarPago=function(prodId){const p=producer(prodId),date=document.getElementById('v125CutDate')?.value||today();if(!canPay(p?.local||'',date))return;return oldPayOne.apply(this,arguments)};
  const oldRenderPayments=window.renderPagamentos;if(typeof oldRenderPayments==='function')window.renderPagamentos=function(){const r=oldRenderPayments.apply(this,arguments);setTimeout(updatePaymentGuard,0);return r};

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{inject();migrateOldTurns();setTimeout(updatePaymentGuard,120)},{once:true});else{inject();migrateOldTurns();setTimeout(updatePaymentGuard,120)}
})();
