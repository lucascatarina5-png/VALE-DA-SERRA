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
  const currentUser=()=>{try{return V4?.user?.username||V4?.user?.name||'Administrador'}catch(_){return 'Administrador'}};
  let current=null;

  function batches(){try{const x=JSON.parse(localStorage.getItem(BATCH_KEY)||'[]');return Array.isArray(x)?x:[]}catch(_){return []}}
  function saveBatches(rows){localStorage.setItem(BATCH_KEY,JSON.stringify(rows))}
  function producer(id){return (Array.isArray(produtores)?produtores:[]).find(x=>String(x.id)===String(id))}
  function producerCode(p){return String(p?.codigo||'').trim()}
  function producerCodes(p){return unique([producerCode(p),...(Array.isArray(p?.codigosAlternativos)?p.codigosAlternativos:[])]).map(x=>x.toUpperCase())}
  function producerByCode(code){const wanted=String(code||'').trim().toUpperCase();return wanted?(Array.isArray(produtores)?produtores:[]).find(p=>producerCodes(p).includes(wanted)):null}
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
    const code=String(row.codigo||'').trim().toUpperCase();
    return !!code&&!!p&&producerCodes(p).includes(code);
  }

  function manualCodeLink(row,p){
    const link=row?.v140CodeLink,code=String(row?.codigo||'').trim().toUpperCase();
    return !!link&&!!p&&String(link.prodId)===String(p.id)&&String(link.code||'').trim().toUpperCase()===code;
  }

  function producerLabel(p){return p?`${p.codigo?producerCode(p)+' • ':''}${p.nome||'Produtor sem nome'}`:''}
  function producerAliases(p){return unique([p?.apelido,...(Array.isArray(p?.aliases)?p.aliases:[])])}
  function producerSearchScore(p,query){
    const q=norm(query),raw=String(query||'').trim().toLocaleLowerCase('pt-BR');if(!q)return 1;
    const codes=producerCodes(p).map(x=>x.toLocaleLowerCase('pt-BR')),name=norm(p?.nome),aliases=producerAliases(p).map(norm),local=norm(p?.local),tanker=norm(p?.tanqueiro);
    if(codes.some(x=>x===raw))return 1000;if(codes.some(x=>x.startsWith(raw)))return 930;if(codes.some(x=>x.includes(raw)))return 880;
    if(name===q)return 850;if(name.startsWith(q))return 800;if(name.includes(q))return 730;
    if(aliases.some(x=>x===q))return 710;if(aliases.some(x=>x.startsWith(q)))return 680;if(aliases.some(x=>x.includes(q)))return 640;
    if(local.includes(q))return 420;if(tanker.includes(q))return 320;
    const words=q.split(' ').filter(Boolean);return words.length&&words.every(x=>name.includes(x))?600:0;
  }
  function searchProducers(query,row){
    const wantedLocal=norm(row?.localidade||document.getElementById('v104EntradaLocal')?.value||'');
    return (Array.isArray(produtores)?produtores:[]).map(p=>({p,score:producerSearchScore(p,query)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score+(wantedLocal&&norm(b.p.local)===wantedLocal?1:0)-(wantedLocal&&norm(a.p.local)===wantedLocal?1:0)||String(a.p.nome||'').localeCompare(String(b.p.nome||''),'pt-BR')).slice(0,8).map(x=>x.p);
  }
  function nextGeneratedCode(){
    const used=new Set((Array.isArray(produtores)?produtores:[]).map(p=>producerCode(p).toUpperCase()).filter(Boolean));let max=0;
    used.forEach(code=>{const m=code.match(/^VS-(\d{1,9})$/);if(m)max=Math.max(max,Number(m[1]))});
    let value='';do{max++;value=`VS-${String(max).padStart(5,'0')}`}while(used.has(value));return value;
  }
  function canManageProducers(){try{return typeof v4TemPermissao!=='function'||v4TemPermissao('produtores')}catch(_){return true}}

  function reportDateInfo(meta=V104?.entradaMeta||{}){
    const start=String(meta.dataInicio||meta.data||''),end=String(meta.dataFim||start),crosses=!!(start&&end&&start!==end),suggested=String(meta.dataSugerida||(crosses?end:start)||'');
    return {start,end,crosses,suggested,startTime:String(meta.inicio||''),endTime:String(meta.fim||'')};
  }
  function dateReason(){return String(document.getElementById('v142DateReason')?.value||'').trim()}
  function dateConfirmed(){return !!document.getElementById('v142DateConfirmed')?.checked}
  function defaultDateReason(data,info){return data===info.end?'Relatório aberto no dia anterior para registrar as coletas do dia seguinte.':'Coletas confirmadas na data inicial do relatório.'}
  function dateDecisionHtml(meta){
    const info=reportDateInfo(meta);if(!info.crosses)return '';
    const selected=document.getElementById('v104EntradaData')?.value||info.suggested,reason=defaultDateReason(selected,info);
    return `<div class="v142-date-card"><div class="v142-date-title"><span>🌙 Relatório atravessou dois dias</span><strong>CONFIRMAÇÃO OBRIGATÓRIA</strong></div><p>O MilkWork foi aberto em <b>${brDate(info.start)} às ${E(info.startTime||'--:--')}</b> e sincronizado/finalizado em <b>${brDate(info.end)} às ${E(info.endTime||'--:--')}</b>.</p><div class="v142-date-grid"><span><small>Data inicial do PDF</small><b>${brDate(info.start)}</b></span><span><small>Data final do PDF</small><b>${brDate(info.end)}</b></span><span><small>Data real selecionada</small><b id="v142SelectedDateLabel">${brDate(selected)}</b></span></div><label class="v142-reason">Justificativa da data real<input id="v142DateReason" maxlength="240" value="${E(reason)}" oninput="v137Review()"></label><label class="v142-confirm"><input id="v142DateConfirmed" type="checkbox" onchange="v137Review()"> Confirmo que todas as coletas deste lote pertencem a <b id="v142ConfirmDateLabel">${brDate(selected)}</b>.</label><small id="v142DateStatus">A confirmação ficará registrada no histórico da importação.</small></div>`;
  }
  function refreshDateDecision(){
    const info=reportDateInfo(),data=document.getElementById('v104EntradaData')?.value||'',selected=document.getElementById('v142SelectedDateLabel'),confirmLabel=document.getElementById('v142ConfirmDateLabel'),status=document.getElementById('v142DateStatus');
    if(selected)selected.textContent=brDate(data);if(confirmLabel)confirmLabel.textContent=brDate(data);if(status){const within=!!(data&&info.start&&info.end&&data>=info.start&&data<=info.end);status.className=within?'ok':'bad';status.textContent=within?'A data está dentro do período do PDF. Confirme a declaração acima.':'A data escolhida está fora do período informado pelo PDF.'}
  }
  window.v142HandleDateChange=function(){
    const info=reportDateInfo(),data=document.getElementById('v104EntradaData')?.value||'',reason=document.getElementById('v142DateReason'),check=document.getElementById('v142DateConfirmed');if(reason)reason.value=defaultDateReason(data,info);if(check)check.checked=false;refreshDateDecision();renderReview();
  };

  function review(){
    const rows=Array.isArray(V104?.entradaRows)?V104.entradaRows:[],meta=V104?.entradaMeta||{},issues=[],warnings=[],prepared=[];
    const data=document.getElementById('v104EntradaData')?.value||meta.data||'',dateInfo=reportDateInfo(meta),reason=dateReason(),confirmed=dateConfirmed(),dateAdjusted=!!(dateInfo.start&&data&&data!==dateInfo.start);
    if(!current)issues.push('Leia o arquivo PDF antes de confirmar.');
    if(!data)issues.push('A data do relatório não foi identificada.');
    if(dateInfo.start&&dateInfo.end&&dateInfo.end<dateInfo.start)issues.push('O período de datas do PDF está inválido. Confira o relatório antes de continuar.');
    else if(dateInfo.start&&dateInfo.end&&data&&(data<dateInfo.start||data>dateInfo.end))issues.push(`A data real escolhida (${brDate(data)}) está fora do período do PDF: ${brDate(dateInfo.start)} a ${brDate(dateInfo.end)}.`);
    else if(dateInfo.start&&!dateInfo.crosses&&data&&data!==dateInfo.start)issues.push(`Este relatório pertence somente a ${brDate(dateInfo.start)}. A data ${brDate(data)} não pode ser utilizada.`);
    if(dateInfo.crosses&&!reason)issues.push('Informe a justificativa da data real das coletas.');
    if(dateInfo.crosses&&!confirmed)issues.push(`Marque a confirmação de que as coletas pertencem a ${brDate(data)}.`);
    if(!rows.length)issues.push('Nenhuma coleta com SIM e volume maior que zero foi identificada.');
    let total=0,manual=0,manualCodes=0,unresolved=0,variations=0,localConflicts=0,duplicates=0;const batchEvents=new Map();
    rows.forEach((r,i)=>{
      const pid=document.getElementById('v137prod'+i)?.value||'',p=producer(pid),q=N(document.getElementById('v137qty'+i)?.value),turn=selectedTurn(r,i),local=selectedLocality(r,i);
      total+=q;
      if(!p){unresolved++;issues.push(`Linha ${i+1}: selecione o produtor correto.`)}
      if(!(q>0)){issues.push(`Linha ${i+1}: informe uma quantidade válida.`)}
      if(!turn){issues.push(`Linha ${i+1}: confirme Manhã ou Tarde.`)}
      if(!local){issues.push(`Linha ${i+1}: informe a localidade.`)}
      if(p){
        const pdfCode=String(r.codigo||'').trim();
        const codeOwner=producerByCode(pdfCode),manualConfirmed=manualCodeLink(r,p);
        if(pdfCode&&!exactCode(r,p)&&codeOwner&&String(codeOwner.id)!==String(p.id))issues.push(`Linha ${i+1}: o código ${pdfCode} já pertence a ${codeOwner.nome}. Selecione esse cadastro ou corrija o código.`);
        else if(pdfCode&&!exactCode(r,p)&&!manualConfirmed)issues.push(`Linha ${i+1}: confirme que o código ${pdfCode} do PDF pertence a ${p.nome}.`);
        else if(pdfCode&&!exactCode(r,p)&&manualConfirmed)manualCodes++;
        if(!pdfCode)manual++;
        if(local&&p.local&&norm(local)!==norm(p.local)&&!(p.localidadesConhecidas||[]).some(x=>norm(x)===norm(local)))localConflicts++;
        const avg=averageFor(p.id,turn,data);if(avg&&Math.abs(q-avg)/avg>=.5)variations++;
        const old=existingEvent(data,r,p);if(old.found){duplicates++;issues.push(`Linha ${i+1}: já existe uma coleta para este produtor em ${r.hora||'horário não informado'} (${liters(old.found.qtd)} L).`)}
        if(batchEvents.has(old.key)){duplicates++;issues.push(`Linhas ${batchEvents.get(old.key)+1} e ${i+1}: o mesmo produtor aparece duas vezes no mesmo horário.`)}else batchEvents.set(old.key,i);
        prepared.push({row:r,index:i,p,q,turn,local,eventKey:old.key,manualCodeLink:manualConfirmed&&!exactCode(r,p),pdfCode});
      }
    });
    const declared=N(meta.totalDeclarado);
    if(!(declared>0))issues.push('O total geral do relatório não foi identificado. A importação segura exige esse total.');
    else if(Math.abs(total-declared)>.009)issues.push(`O PDF informa ${liters(declared)} L, mas as linhas revisadas somam ${liters(total)} L.`);
    if(current&&batches().some(x=>x.status==='confirmado'&&x.hash===current.hash))issues.push('Este mesmo arquivo PDF já foi confirmado anteriormente.');
    if(manual)warnings.push(`${manual} produtor(es) foram escolhidos manualmente porque a linha não possuía código.`);
    if(manualCodes)warnings.push(`${manualCodes} código(s) diferente(s) foram confirmados manualmente e serão guardados no cadastro correto.`);
    if(dateInfo.crosses&&data>=dateInfo.start&&data<=dateInfo.end)warnings.push(`O MilkWork atravessou ${brDate(dateInfo.start)} a ${brDate(dateInfo.end)}. As entradas serão gravadas em ${brDate(data)} com a justificativa informada.`);
    if(variations)warnings.push(`${variations} entrada(s) variam 50% ou mais da média recente do mesmo turno.`);
    if(localConflicts)warnings.push(`${localConflicts} entrega(s) ocorreram fora da localidade principal. O leite será registrado e pago pela localidade desta entrega; o cadastro principal não será alterado.`);
    return {rows,meta,data,total,declared,prepared,issues:[...new Set(issues)],warnings,manual,manualCodes,unresolved,variations,localConflicts,duplicates,dateInfo,dateReason:reason,dateConfirmed:confirmed,dateAdjusted};
  }

  function producerFinder(row,index){
    const p=producer(row.prodId),suggested=producer(row.v137Suggestion),selected=p?producerLabel(p):'',manualConfirmed=manualCodeLink(row,p);
    return `<div class="v138-finder"><input id="v137prod${index}" type="hidden" value="${E(p?.id||'')}"><div class="v138-searchline"><input id="v138search${index}" class="v138-search" autocomplete="off" value="${E(selected)}" placeholder="Digite nome, apelido ou código..." onfocus="v138SearchProducer(${index})" oninput="v138SearchProducer(${index},true)" onkeydown="v138SearchKeydown(${index},event)"><button type="button" title="Limpar seleção" onclick="v138ClearProducer(${index})">×</button></div><div id="v138results${index}" class="v138-results"></div><div id="v138selected${index}" class="v138-selected">${manualConfirmed?`<span class="v140-linked">✓ Vínculo manual confirmado: <b>${E(row.codigo)} → ${E(producerLabel(p))}</b><small>Este código será guardado como alternativo ao finalizar o lote.</small></span>`:p?`<span>✓ Vinculado: <b>${E(producerLabel(p))}</b> • ${E(p.local||'Sem localidade')}</span>`:'<span class="empty">Nenhum produtor selecionado</span>'}</div><div class="v138-finder-actions"><button type="button" onclick="v138FocusSearch(${index})">🔍 Pesquisar</button><button type="button" class="new" onclick="v138OpenNewProducer(${index})">＋ Cadastrar novo</button></div>${suggested&&!row.v137Exact&&!manualConfirmed?`<small class="v137-suggestion">Possível nome semelhante: ${E(producerLabel(suggested))}. Pesquise e confirme; a sugestão não é aplicada sozinha.</small>`:''}</div>`;
  }

  function renderSafeRows(){
    const box=document.getElementById('v104EntradaResults');if(!box)return;
    const rows=Array.isArray(V104?.entradaRows)?V104.entradaRows:[],meta=V104?.entradaMeta||{};
    if(typeof v106RenderMeta==='function')v106RenderMeta();
    if(!rows.length){box.innerHTML='<div class="v137-empty"><b>Nenhuma coleta válida foi montada.</b><span>Confira o texto lido. Nenhum pagamento deve ser feito enquanto o relatório estiver pendente.</span></div>';renderReview();return}
    const total=rows.reduce((s,x)=>s+N(x.litros),0),exact=rows.filter(x=>x.v137Exact).length;
    box.innerHTML=`<div class="v137-headline"><div><b>🛡️ Conferência obrigatória V142</b><small>${rows.length} coleta(s) • ${liters(total)} L • ${exact} código(s) reconhecidos automaticamente</small></div><button type="button" onclick="v137ApplyLocality()">📍 Aplicar localidade a todos</button></div>
      ${dateDecisionHtml(meta)}
      <div class="v137-tablewrap"><table class="v104-table v137-table"><thead><tr><th>Linha</th><th>Hora / turno</th><th>Código e nome no PDF</th><th>Produtor que receberá o leite</th><th>Localidade</th><th>Litros</th><th>Verificação</th></tr></thead><tbody>${rows.map((r,i)=>{
        const p=producer(r.prodId),avg=p?averageFor(p.id,r.v137Turn,document.getElementById('v104EntradaData')?.value||meta.data):0,diff=avg?Math.round((N(r.litros)-avg)/avg*100):null;
        const manualConfirmed=manualCodeLink(r,p),verified=r.v137Exact||manualConfirmed;
        return `<tr id="v137row${i}" class="${verified?'v137-exact':'v137-manual'}"><td><b>${i+1}</b></td><td><b>${E(r.hora||'—')}</b><select id="v137turn${i}" onchange="v137Review()"><option value="">Confirmar...</option><option value="M" ${r.v137Turn==='M'?'selected':''}>Manhã</option><option value="T" ${r.v137Turn==='T'?'selected':''}>Tarde</option></select></td><td><b>${E(r.codigo||'Sem código')} • ${E(r.name||'')}</b><small>${E(r.raw||'')}</small></td><td>${producerFinder(r,i)}</td><td><input id="v137loc${i}" list="v107LocalidadesList" value="${E(r.localidade||'')}" onchange="v137Review()"></td><td><input id="v137qty${i}" type="number" min="0.01" step="0.01" value="${E(r.litros)}" oninput="v137Review()"></td><td id="v138verify${i}">${r.v137Exact?'<span class="v137-ok">✓ Código reconhecido</span>':manualConfirmed?'<span class="v137-ok">✓ Código diferente confirmado</span>':'<span class="v137-warn">⚠ Revisão manual</span>'}${diff!==null&&Math.abs(diff)>=50?`<small class="v137-variation">Variação de ${diff>0?'+':''}${diff}% da média</small>`:''}<small id="v141cross${i}"></small></td></tr>`;
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
    refreshCrossLocalities();
    refreshDateDecision();
  }

  function refreshCrossLocalities(){
    (Array.isArray(V104?.entradaRows)?V104.entradaRows:[]).forEach((row,index)=>{
      const pid=document.getElementById('v137prod'+index)?.value||row.prodId,p=producer(pid),local=selectedLocality(row,index),verify=document.getElementById('v138verify'+index);let note=document.getElementById('v141cross'+index);if(!note&&verify){verify.innerHTML+=`<small id="v141cross${index}"></small>`;note=document.getElementById('v141cross'+index)}if(!note)return;
      const cross=!!(p?.local&&local&&norm(p.local)!==norm(local));note.className=cross?'v141-cross-note':'';note.innerHTML=cross?`📍 Entrega em <b>${E(local)}</b>; cadastro principal: ${E(p.local)}. Pagamento ficará nesta localidade.`:'';
    });
  }

  function updatePendingFromReview(v){
    if(!current||current.confirmedDuplicate)return;
    const all=batches(),idx=all.findIndex(x=>x.id===current.id),row={...current,status:'pendente',data:v.data||'',dataEfetiva:v.data||'',dataInicioPdf:v.dateInfo?.start||'',dataFimPdf:v.dateInfo?.end||'',dataAjustada:!!v.dateAdjusted,justificativaData:v.dateReason||'',confirmacaoData:!!v.dateConfirmed,localities:unique(v.prepared.map(x=>x.local)),totalLido:v.total,totalDeclarado:v.declared,linhas:v.rows.length,problemas:v.issues.length,avisos:v.warnings.length,updatedAt:new Date().toISOString()};
    if(idx>=0)all[idx]=row;else all.push(row);saveBatches(all);
  }

  async function syncState(importacoesPdf){
    const headers=typeof v4Headers==='function'?v4Headers():{};headers['Content-Type']='application/json';
    const response=await fetch('/api/state',{method:'PUT',headers,body:JSON.stringify({data:{produtores,lancamentos,pagamentos,debitos,pagamentosDebitos,importacoesPdf}}),cache:'no-store'});
    if(!response.ok){let msg='O servidor não confirmou a importação.';try{const j=await response.json();if(j.error)msg=j.error}catch(_){}throw new Error(msg)}
  }

  function refreshProducerChoice(index,p){
    const row=V104?.entradaRows?.[index];if(!row||!p)return;
    row.prodId=p.id;row.v137Exact=exactCode(row,p);if(row.v137Exact)delete row.v140CodeLink;const manualConfirmed=manualCodeLink(row,p);row.status=row.v137Exact||manualConfirmed?'ok':'warn';
    const hidden=document.getElementById('v137prod'+index),input=document.getElementById('v138search'+index),selected=document.getElementById('v138selected'+index),verify=document.getElementById('v138verify'+index),tr=document.getElementById('v137row'+index);
    if(hidden)hidden.value=p.id;if(input)input.value=producerLabel(p);if(selected)selected.innerHTML=manualConfirmed?`<span class="v140-linked">✓ Vínculo manual confirmado: <b>${E(row.codigo)} → ${E(producerLabel(p))}</b><small>Este código será guardado como alternativo ao finalizar o lote.</small></span>`:`<span>✓ Vinculado: <b>${E(producerLabel(p))}</b> • ${E(p.local||'Sem localidade')}</span>`;
    if(verify)verify.innerHTML=row.v137Exact?'<span class="v137-ok">✓ Código reconhecido</span>':manualConfirmed?'<span class="v137-ok">✓ Código diferente confirmado</span>':'<span class="v137-warn">⚠ Confirme o código diferente</span>';
    if(tr){tr.classList.toggle('v137-exact',row.v137Exact||manualConfirmed);tr.classList.toggle('v137-manual',!row.v137Exact&&!manualConfirmed)}
    const results=document.getElementById('v138results'+index);if(results){results.innerHTML='';results.classList.remove('on')}renderReview();
  }

  window.v138SearchProducer=function(index,changed){
    const row=V104?.entradaRows?.[index],input=document.getElementById('v138search'+index),hidden=document.getElementById('v137prod'+index),box=document.getElementById('v138results'+index);if(!row||!input||!box)return;
    document.querySelectorAll('.v138-results.on').forEach(x=>{if(x!==box){x.classList.remove('on');x.innerHTML=''}});
    if(changed&&hidden){hidden.value='';row.prodId='';row.v137Exact=false;row.status='bad';delete row.v140CodeLink;const selected=document.getElementById('v138selected'+index),verify=document.getElementById('v138verify'+index),tr=document.getElementById('v137row'+index);if(selected)selected.innerHTML='<span class="empty">Selecione um resultado abaixo</span>';if(verify)verify.innerHTML='<span class="v137-warn">⚠ Revisão manual</span>';if(tr){tr.classList.remove('v137-exact');tr.classList.add('v137-manual')}renderReview()}
    let found=searchProducers(input.value,row);const selectedProducer=producer(hidden?.value);if(!found.length&&selectedProducer&&norm(input.value)===norm(producerLabel(selectedProducer)))found=[selectedProducer];box.dataset.first=found[0]?.id||'';box.innerHTML=found.map(p=>{const codeMatches=!row.codigo||exactCode(row,p);return `<button type="button" onmousedown="event.preventDefault()" onclick="v138SelectProducer(${index},'${E(p.id)}')"><span><b>${E(producerLabel(p))}</b><small>${p.apelido?`Apelido: ${E(p.apelido)} • `:''}📍 ${E(p.local||'Sem localidade')}</small></span><em class="${codeMatches?'ok':'warn'}">${codeMatches?'Código reconhecido':'Confirmar código diferente'}</em></button>`}).join('')||'<div class="v138-noresult"><b>Nenhum produtor encontrado.</b><span>Tente outro nome/código ou cadastre este produtor.</span></div>';box.classList.add('on');
  };
  window.v138SearchKeydown=function(index,event){if(event.key!=='Enter')return;event.preventDefault();const id=document.getElementById('v138results'+index)?.dataset.first;if(id)v138SelectProducer(index,id)};
  window.v138FocusSearch=function(index){const input=document.getElementById('v138search'+index);input?.focus();if(input)input.select();v138SearchProducer(index)};
  window.v138SelectProducer=function(index,id){
    const row=V104?.entradaRows?.[index],p=producer(id);if(!row||!p)return;
    const pdfCode=String(row.codigo||'').trim(),owner=producerByCode(pdfCode);
    if(pdfCode&&!exactCode(row,p)){
      if(owner&&String(owner.id)!==String(p.id))return alert(`O código ${pdfCode} já está vinculado a ${owner.nome}.\n\nPor segurança, ele não pode ser usado para outro produtor.`);
      if(!confirm(`CONFIRMAR PRODUTOR COM CÓDIGO DIFERENTE?\n\nNo PDF: ${pdfCode} • ${row.name||'Produtor'}\nNo cadastro: ${producerLabel(p)}\n\nConfirme somente se forem realmente a mesma pessoa. O código ${pdfCode} ficará salvo como código alternativo desse produtor para os próximos relatórios.`))return;
      row.v140CodeLink={prodId:p.id,code:pdfCode,confirmedAt:new Date().toISOString()};
    }
    refreshProducerChoice(index,p)
  };
  window.v138ClearProducer=function(index){const row=V104?.entradaRows?.[index],hidden=document.getElementById('v137prod'+index),input=document.getElementById('v138search'+index),selected=document.getElementById('v138selected'+index);if(row){row.prodId='';row.v137Exact=false;row.status='bad';delete row.v140CodeLink}if(hidden)hidden.value='';if(input){input.value='';input.focus()}if(selected)selected.innerHTML='<span class="empty">Nenhum produtor selecionado</span>';v138SearchProducer(index);renderReview()};

  window.v138OpenNewProducer=function(index){
    if(!canManageProducers())return alert('Você não possui permissão para cadastrar produtores. Peça ao Administrador para fazer o cadastro ou liberar essa permissão.');
    const row=V104?.entradaRows?.[index],meta=V104?.entradaMeta||{};if(!row)return;
    const pdfCode=String(row.codigo||'').trim(),code=pdfCode||nextGeneratedCode(),local=selectedLocality(row,index)||meta.localidade||document.getElementById('v104EntradaLocal')?.value||'';
    document.getElementById('v138ProducerRow').value=String(index);document.getElementById('v138ProducerCode').value=code;document.getElementById('v138ProducerCode').readOnly=!!pdfCode;document.getElementById('v138ProducerName').value=row.name||'';document.getElementById('v138ProducerAlias').value='';document.getElementById('v138ProducerLocal').value=local;document.getElementById('v138ProducerRoute').value=meta.rota||row.rota||'';document.getElementById('v138ProducerTanker').value=meta.responsavel||row.tanqueiro||'';document.getElementById('v138ProducerPhone').value='';document.getElementById('v138ProducerCodeNote').innerHTML=pdfCode?`🔒 O código <b>${E(pdfCode)}</b> veio do PDF e será preservado.`:`✨ O relatório não trouxe código. O sistema gerou <b>${E(code)}</b>, que poderá ser usado nas próximas entradas.`;
    const modal=document.getElementById('v138ProducerModal');modal.classList.add('on');modal.style.display='flex';setTimeout(()=>document.getElementById('v138ProducerName')?.focus(),30);
  };
  window.v138CloseNewProducer=function(){const modal=document.getElementById('v138ProducerModal');if(modal){modal.classList.remove('on');modal.style.display=''}};
  window.v138SaveNewProducer=async function(event){
    event?.preventDefault();if(!canManageProducers())return false;
    const index=Number(document.getElementById('v138ProducerRow').value),row=V104?.entradaRows?.[index];if(!row)return false;
    const code=document.getElementById('v138ProducerCode').value.trim(),name=document.getElementById('v138ProducerName').value.trim(),alias=document.getElementById('v138ProducerAlias').value.trim(),local=document.getElementById('v138ProducerLocal').value.trim(),route=document.getElementById('v138ProducerRoute').value.trim(),tanker=document.getElementById('v138ProducerTanker').value.trim(),whatsapp=document.getElementById('v138ProducerPhone').value.trim();
    if(!code||!name||!local){alert('Informe o código, o nome e a localidade do produtor.');return false}
    const byCode=producerByCode(code),byName=(produtores||[]).find(p=>norm(p.nome)===norm(name));
    if(byCode){if(confirm(`O código ${code} já pertence a ${byCode.nome}.\n\nDeseja vincular esta linha a esse cadastro?`)){v138CloseNewProducer();refreshProducerChoice(index,byCode)}return false}
    if(byName&&producerCode(byName))return alert(`Já existe um produtor com este nome:\n\n${producerLabel(byName)} • ${byName.local||'Sem localidade'}\n\nPesquise e selecione esse cadastro. Se o código estiver errado, corrija-o primeiro na ficha do produtor.`),false;
    const oldProducers=JSON.parse(JSON.stringify(produtores)),target=byName||{id:crypto.randomUUID()};let created=!byName;
    if(byName&&!confirm(`${name} já está cadastrado, mas ainda não possui código.\n\nDeseja vincular o código ${code} e completar os dados desse cadastro?`))return false;
    const similar=(produtores||[]).filter(p=>p!==byName&&norm(p.nome)!==norm(name)).map(p=>({p,score:typeof v104Similarity==='function'?v104Similarity(name,p.nome):0})).filter(x=>x.score>=.86).sort((a,b)=>b.score-a.score)[0];
    if(created&&similar&&!confirm(`Encontramos um nome parecido:\n\n${producerLabel(similar.p)} • ${similar.p.local||'Sem localidade'}\n\nDeseja realmente criar um produtor separado com o código ${code}?`))return false;
    Object.assign(target,{codigo:code,nome:name,apelido:alias||target.apelido||'',aliases:unique([...(Array.isArray(target.aliases)?target.aliases:[]),alias]),local:local||target.local||'',rota:route||target.rota||'',tanqueiro:tanker||target.tanqueiro||'',whatsapp:whatsapp||target.whatsapp||'',whatsTanqueiro:target.whatsTanqueiro||'',caminhao:target.caminhao||'',cidade:target.cidade||''});
    if(created)produtores.push(target);
    const button=document.getElementById('v138ProducerSave');if(button){button.disabled=true;button.textContent='Salvando no servidor...'}
    try{
      await syncState(batches());row.prodId=target.id;row.v137Exact=exactCode(row,target);row.status=row.v137Exact?'ok':'warn';save();v138CloseNewProducer();renderSafeRows();await v25Audit(created?'PRODUTOR_CRIADO':'PRODUTOR_EDITADO',{codigo:target.codigo,nome:target.nome,local:target.local,rota:target.rota,tanqueiro:target.tanqueiro,origem:'Cadastro rápido durante importação PDF'});setTimeout(()=>document.getElementById('v138search'+index)?.scrollIntoView({behavior:'smooth',block:'center'}),40);alert(created?`✅ ${target.nome} foi cadastrado e vinculado a esta entrada.\n\nCódigo: ${target.codigo}\nLocalidade: ${target.local}`:`✅ O cadastro de ${target.nome} foi completado e vinculado a esta entrada.`)
    }catch(e){produtores=oldProducers;save();alert('❌ O produtor não foi cadastrado.\n\nO servidor não confirmou a alteração e nenhum dado parcial foi mantido.\n\n'+e.message)}finally{if(button){button.disabled=false;button.textContent='💾 Cadastrar e vincular'}}return false;
  };

  window.v137Review=renderReview;
  window.v137ApplyLocality=function(){const value=(document.getElementById('v104EntradaLocal')?.value||'').trim();if(!value)return alert('Informe a localidade no campo superior.');(V104.entradaRows||[]).forEach((_,i)=>{const el=document.getElementById('v137loc'+i);if(el)el.value=value});renderReview()};

  window.v137ConfirmImport=async function(){
    const v=review();if(v.issues.length){v25Audit('IMPORTACAO_PDF_BLOQUEADA',{arquivo:current?.fileName||'',problemas:v.issues.length,totalPdf:v.declared,totalLido:v.total});alert('⛔ A importação está bloqueada.\n\n'+v.issues.map((x,i)=>`${i+1}. ${x}`).join('\n'));return}
    const summary=`CONFIRMAR O LOTE COMPLETO?\n\nArquivo: ${current.fileName}\nData real das coletas: ${brDate(v.data)}${v.dateInfo?.crosses?`\nPeríodo no MilkWork: ${brDate(v.dateInfo.start)} ${v.dateInfo.startTime||''} até ${brDate(v.dateInfo.end)} ${v.dateInfo.endTime||''}\nJustificativa: ${v.dateReason}`:''}\nEntradas: ${v.prepared.length}\nTotal: ${liters(v.total)} litros\n${v.warnings.length?'\nATENÇÃO:\n'+v.warnings.join('\n')+'\n':''}\nDepois da confirmação, qualquer correção ficará registrada no histórico.`;
    if(!confirm(summary))return;
    const oldProducers=JSON.parse(JSON.stringify(produtores)),oldEntries=lancamentos.slice(),oldBatches=batches();
    const batchId=current.id,entryIds=[];
    try{
      for(const x of v.prepared){
        const p=producer(x.p.id);if(!p)throw new Error('Um produtor deixou de existir durante a confirmação.');
        if(x.manualCodeLink&&x.pdfCode&&!exactCode(x.row,p)){
          const owner=producerByCode(x.pdfCode);if(owner&&String(owner.id)!==String(p.id))throw new Error(`O código ${x.pdfCode} passou a pertencer a ${owner.nome}. Revise o vínculo.`);
          if(!Array.isArray(p.codigosAlternativos))p.codigosAlternativos=[];
          if(!p.codigosAlternativos.some(code=>String(code).trim().toUpperCase()===String(x.pdfCode).trim().toUpperCase()))p.codigosAlternativos.push(String(x.pdfCode).trim());
        }
        if(x.local){
          if(!p.local)p.local=x.local;
          else if(norm(p.local)!==norm(x.local)){if(!Array.isArray(p.localidadesConhecidas))p.localidadesConhecidas=[];if(!p.localidadesConhecidas.some(y=>norm(y)===norm(x.local)))p.localidadesConhecidas.push(x.local)}
        }
        if(v.meta.rota&&!p.rota)p.rota=v.meta.rota;if(v.meta.responsavel&&!p.tanqueiro)p.tanqueiro=v.meta.responsavel;
        const id=crypto.randomUUID();entryIds.push(id);
        lancamentos.push({id,data:v.data,prodId:p.id,qtd:x.q,periodo:x.turn,turno:turnName(x.turn),situacaoPagamento:'Pendente',local:x.local,tanqueiro:v.meta.responsavel||p.tanqueiro||'',caminhao:p.caminhao||'',origem:'PDF_SEGURO',hora:x.row.hora||'',rota:v.meta.rota||p.rota||'',pdfHash:current.hash,pdfBatchId:batchId,pdfEventKey:x.eventKey,pdfFileName:current.fileName,pdfModelo:'RELATORIO_RECEBIMENTO_TANQUEIRO_V142',pdfDataInicio:v.dateInfo?.start||'',pdfDataFim:v.dateInfo?.end||'',pdfDataEfetiva:v.data,pdfDataAjustada:!!v.dateAdjusted,pdfDataJustificativa:v.dateReason||''});
      }
      const confirmed={...current,status:'confirmado',data:v.data,dataEfetiva:v.data,dataInicioPdf:v.dateInfo?.start||'',dataFimPdf:v.dateInfo?.end||'',dataAjustada:!!v.dateAdjusted,justificativaData:v.dateReason||'',dataConfirmadaPor:currentUser(),localities:unique(v.prepared.map(x=>x.local)),totalLido:v.total,totalDeclarado:v.declared,linhas:v.prepared.length,entryIds,problemas:0,avisos:v.warnings,confirmedAt:new Date().toISOString()};
      const next=oldBatches.filter(x=>x.id!==batchId);next.push(confirmed);
      await syncState(next);saveBatches(next);save();
      await v25Audit('IMPORTACAO_PDF_CONFIRMADA',{lote:batchId,arquivo:current.fileName,dataEfetiva:v.data,dataInicioPdf:v.dateInfo?.start||'',dataFimPdf:v.dateInfo?.end||'',dataAjustada:!!v.dateAdjusted,justificativaData:v.dateReason||'',confirmadaPor:currentUser(),entradas:entryIds.length,litros:v.total,localidades:confirmed.localities.join(', '),codigosAlternativosVinculados:v.manualCodes,hash:current.hash});
      current={...confirmed,confirmedDuplicate:true};v104Fechar('v104EntradaModal');
      alert(`✅ IMPORTAÇÃO SEGURA CONCLUÍDA\n\n${entryIds.length} entradas registradas em ${brDate(v.data)}\n${liters(v.total)} litros\nTodos os produtores foram identificados\nTotal do PDF conferido\nTurnos gravados como Manhã/Tarde${v.dateInfo?.crosses?'\nPeríodo do MilkWork e justificativa preservados no histórico':''}\nLote confirmado no servidor`);
    }catch(e){
      produtores=oldProducers;lancamentos=oldEntries;saveBatches(oldBatches);save();alert('❌ Nenhuma entrada foi registrada.\n\n'+e.message);
    }
  };

  function batchCard(x){
    const color=x.status==='confirmado'?'ok':x.status==='pendente'?'warn':'muted',status=x.status==='confirmado'?'CONFIRMADO':x.status==='pendente'?'PENDENTE DE CONFERÊNCIA':'CANCELADO / DESCARTADO';
    const sourceDates=x.dataInicioPdf&&x.dataFimPdf&&x.dataInicioPdf!==x.dataFimPdf?`<small>🌙 Período MilkWork: ${brDate(x.dataInicioPdf)} até ${brDate(x.dataFimPdf)} • data efetiva: <b>${brDate(x.dataEfetiva||x.data)}</b></small>${x.justificativaData?`<small>Justificativa: ${E(x.justificativaData)}</small>`:''}`:'';
    return `<div class="v137-batch ${color}"><div><b>${E(x.fileName||'Relatório PDF')}</b><small>${brDate(x.dataEfetiva||x.data)} • ${E((x.localities||[]).join(', ')||'Localidade não definida')} • ${x.linhas||0} entrada(s) • ${liters(x.totalLido)} L</small>${sourceDates}<small>Lote ${E(String(x.id||'').slice(-12))} • ${x.confirmedAt?'Confirmado em '+new Date(x.confirmedAt).toLocaleString('pt-BR'):'Aguardando conclusão'}</small></div><span class="v137-batch-status ${color}">${status}</span>${x.status==='confirmado'?`<button onclick="v137CancelBatch('${E(x.id)}')">Cancelar lote</button>`:x.status==='pendente'?`<button onclick="v137DiscardBatch('${E(x.id)}')">Descartar pendência</button>`:''}</div>`;
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
  // Integração pública usada pelo fechamento organizado da V139.
  window.v137CanPay=canPay;
  window.v137UpdatePaymentGuard=updatePaymentGuard;

  function migrateOldTurns(){
    let count=0;(Array.isArray(lancamentos)?lancamentos:[]).forEach(x=>{if(String(x.origem||'').toUpperCase().includes('PDF')&&!String(x.periodo||'').trim()&&!norm(x.turno).match(/manh|tard/)){const t=turnFromHour(x.hora);if(t){x.periodo=t;x.turno=turnName(t);count++}}});
    if(count){save();v25Audit('IMPORTACAO_PDF_MIGRACAO_TURNO',{entradas:count,regra:'Horário anterior a 12:00 = Manhã; demais = Tarde'})}
  }

  function inject(){
    if(document.getElementById('v137HistoryModal'))return;
    const actions=document.querySelector('#v104EntradaModal .v104-actions');if(actions)actions.insertAdjacentHTML('beforeend','<button type="button" class="v137-history-btn" onclick="v137OpenHistory()">🗂️ Histórico dos lotes</button>');
    document.body.insertAdjacentHTML('beforeend',`<div id="v137HistoryModal" class="v104-modal" aria-hidden="true"><div class="v104-box"><div class="v104-head"><div><h2>🛡️ Histórico das importações de leite</h2><p>Cada PDF é um lote único. Lotes pendentes impedem o pagamento daquela localidade.</p></div><button class="v104-x" onclick="v137CloseHistory()">×</button></div><div class="v104-body"><div id="v137HistoryRows"></div></div></div></div>
      <div id="v138ProducerModal" class="v104-modal" aria-hidden="true"><div class="v104-box v138-producer-box"><div class="v104-head"><div><h2>👤 Cadastrar produtor desta entrada</h2><p>Os dados do PDF já estão preenchidos. Confira antes de vincular.</p></div><button class="v104-x" type="button" onclick="v138CloseNewProducer()">×</button></div><form class="v104-body" onsubmit="return v138SaveNewProducer(event)"><input id="v138ProducerRow" type="hidden"><div id="v138ProducerCodeNote" class="v138-code-note"></div><div class="v138-formgrid"><label>Código do produtor<input id="v138ProducerCode" required maxlength="40"></label><label>Nome completo<input id="v138ProducerName" required maxlength="160"></label><label>Apelido / como é conhecido<input id="v138ProducerAlias" maxlength="100"></label><label>Localidade<input id="v138ProducerLocal" list="v107LocalidadesList" required maxlength="120"></label><label>Rota<input id="v138ProducerRoute" maxlength="80"></label><label>Tanqueiro responsável<input id="v138ProducerTanker" maxlength="160"></label><label>WhatsApp do produtor<input id="v138ProducerPhone" inputmode="tel" maxlength="30" placeholder="Ex.: (88) 99999-9999"></label></div><div class="v138-modal-actions"><button type="button" onclick="v138CloseNewProducer()">Cancelar</button><button id="v138ProducerSave" type="submit">💾 Cadastrar e vincular</button></div></form></div></div>`);
    const style=document.createElement('style');style.textContent=`.v137-history-btn{border:1px solid #b9cbe1;background:#fff;color:#124b86;border-radius:10px;padding:10px 14px;font-weight:800}.v137-headline{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:12px 0;padding:13px;border-radius:12px;background:#eaf3ff;color:#123e70}.v137-headline small,.v137-table small,.v137-batch small{display:block;margin-top:4px;color:#6a7d92}.v137-headline button{border:0;border-radius:9px;padding:9px;background:#154b83;color:#fff;font-weight:800}.v137-tablewrap{overflow:auto;border:1px solid #d8e2ee;border-radius:12px}.v137-tablewrap>.v137-table{min-width:1280px}.v137-table select,.v137-table input{min-width:120px;padding:8px;border:1px solid #c8d4e2;border-radius:8px}.v137-exact{background:#fbfffc}.v137-manual{background:#fffbf0}.v137-ok{color:#16813b;font-weight:900}.v137-warn{color:#a35d00;font-weight:900}.v137-suggestion,.v137-variation{color:#a35d00!important}.v138-finder{position:relative;min-width:330px}.v138-searchline{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:5px}.v138-searchline .v138-search{width:100%;min-width:0}.v138-searchline>button{border:1px solid #c8d4e2;border-radius:8px;background:#f3f6fa;color:#5e6e80;font-size:18px}.v138-results{display:none;position:static;margin-top:5px;background:#fff;border:1px solid #abc1db;border-radius:10px;box-shadow:0 8px 20px rgba(15,43,78,.15);max-height:250px;overflow:auto}.v138-results.on{display:block}.v138-results button{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;text-align:left;border:0;border-bottom:1px solid #e7edf4;background:#fff;padding:10px;color:#143b69}.v138-results button:hover{background:#eef6ff}.v138-results button small{font-size:10px}.v138-results em{font-size:9px;font-style:normal;font-weight:900;border-radius:999px;padding:4px 6px;white-space:nowrap}.v138-results em.ok{background:#e3f5e9;color:#147138}.v138-results em.warn{background:#fff0da;color:#9b5d00}.v138-noresult{display:grid;gap:3px;padding:13px;color:#7b5a26}.v138-selected{margin-top:5px;color:#176c37;font-size:10px}.v138-selected .empty{color:#a35d00}.v140-linked{display:block;background:#e5f7eb;border:1px solid #a5dbb5;border-radius:8px;padding:7px;color:#126b35}.v140-linked small{display:block;color:#4e775c;margin-top:3px}.v138-finder-actions{display:flex;gap:5px;margin-top:6px}.v138-finder-actions button{border:1px solid #b9cbe0;background:#fff;color:#194f88;border-radius:7px;padding:6px 8px;font-size:10px;font-weight:900}.v138-finder-actions button.new{background:#16894a;color:#fff;border-color:#16894a}.v137-review{margin-top:12px;border-radius:13px;padding:14px;border:1px solid}.v137-review.ok{background:#edf9f1;border-color:#91d5a7}.v137-review.bad{background:#fff2f2;border-color:#efaaaa}.v137-review-title{font-weight:900;margin-bottom:9px}.v137-checks{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.v137-checks span{padding:8px;border-radius:8px;background:#fff}.v137-checks .ok{color:#137638}.v137-checks .bad{color:#b52222}.v137-review ul{margin:10px 0 0;padding-left:20px;color:#9c1e1e}.v137-warnings{display:grid;gap:5px;margin-top:10px;color:#8c5600}.v137-empty{display:grid;gap:5px;text-align:center;padding:28px;color:#60758c}.v137-batch{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;border:1px solid #d6e0eb;border-left:6px solid;border-radius:12px;padding:13px;margin:9px 0}.v137-batch.ok{border-left-color:#16813b}.v137-batch.warn{border-left-color:#dc8700}.v137-batch.muted{border-left-color:#8795a5;opacity:.8}.v137-batch-status{font-size:11px;font-weight:900;border-radius:999px;padding:7px 9px}.v137-batch-status.ok{background:#e4f6e9;color:#137638}.v137-batch-status.warn{background:#fff1d9;color:#925700}.v137-batch-status.muted{background:#edf0f3;color:#5e6a77}.v137-batch button,.v137-payment-guard button{border:1px solid #cfdae5;background:#fff;border-radius:8px;padding:8px;font-weight:800;color:#913232}.v137-payment-guard{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center;margin-top:10px;padding:12px;border-radius:10px}.v137-payment-guard span{font-size:12px}.v137-payment-guard.ok{background:#eaf8ef;color:#176c37}.v137-payment-guard.bad{background:#fff0f0;color:#9b2222;border:1px solid #efbbbb}.v137-payment-guard button{grid-column:2;grid-row:1/3}.v138-producer-box{width:min(820px,100%)}.v138-code-note{background:#eaf4ff;color:#164c82;border-radius:10px;padding:11px;margin-bottom:12px}.v138-formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.v138-formgrid label{font-size:12px;font-weight:900;color:#294868}.v138-formgrid input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:11px;border:1px solid #c9d6e4;border-radius:9px}.v138-formgrid input[readonly]{background:#edf2f7;color:#586b80}.v138-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.v138-modal-actions button{border:1px solid #c8d4e1;border-radius:9px;padding:10px 14px;background:#fff;color:#23486f;font-weight:900}.v138-modal-actions button[type=submit]{border-color:#16894a;background:#16894a;color:#fff}@media(max-width:760px){.v137-headline{display:grid}.v137-checks{grid-template-columns:1fr}.v137-batch{grid-template-columns:1fr}.v137-payment-guard{grid-template-columns:1fr}.v137-payment-guard button{grid-column:auto;grid-row:auto}.v138-formgrid{grid-template-columns:1fr}}`;document.head.appendChild(style);
  }

  const originalRead=window.v104LerEntradaPDF;
  const originalRender=window.v104RenderEntryRows;
  if(typeof originalRead==='function')window.v104LerEntradaPDF=async function(){
    current=null;await originalRead.apply(this,arguments);
    const info=reportDateInfo(),dateInput=document.getElementById('v104EntradaData');if(info.crosses&&info.suggested&&dateInput)dateInput.value=info.suggested;
    const file=document.getElementById('v104EntradaFile')?.files?.[0],rows=Array.isArray(V104?.entradaRows)?V104.entradaRows:[];if(!file||!rows.length){renderSafeRows();return}
    try{
      const hash=await fileHash(file),id='pdf_'+hash.slice(0,24),confirmed=batches().find(x=>x.hash===hash&&x.status==='confirmado');
      current={id,hash,fileName:file.name,fileSize:file.size,fileModified:file.lastModified,createdAt:new Date().toISOString(),dataInicioPdf:info.start,dataFimPdf:info.end,dataSugerida:info.suggested,confirmedDuplicate:!!confirmed};
      rows.forEach(r=>{const original=producer(r.prodId),codeOwner=producerByCode(r.codigo),exactProducer=codeOwner||(exactCode(r,original)?original:null),exact=!!exactProducer;r.v137Exact=exact;r.v137Suggestion=exact?'':r.prodId;r.prodId=exact?exactProducer.id:'';r.status=exact?'ok':r.v137Suggestion?'warn':'bad';delete r.v140CodeLink;r.v137Turn=turnFromHour(r.hora)});
      renderSafeRows();
      const st=document.getElementById('v104EntradaStatus');if(st)st.textContent+=(confirmed?' ⛔ Este arquivo já foi confirmado anteriormente.':' 🛡️ Revise todos os campos; somente o lote completo poderá ser confirmado.');
    }catch(e){document.getElementById('v104EntradaStatus').textContent='Erro ao criar a identificação segura do arquivo: '+e.message;renderSafeRows()}
  };
  window.v104RenderEntryRows=renderSafeRows;

  const oldPayLocal=window.v125PayLocal;if(typeof oldPayLocal==='function')window.v125PayLocal=function(){const local=document.getElementById('v125Local')?.value||'',date=document.getElementById('v125CutDate')?.value||today();if(!canPay(local,date))return;return oldPayLocal.apply(this,arguments)};
  const oldPayOne=window.marcarPago;if(typeof oldPayOne==='function')window.marcarPago=function(prodId){const p=producer(prodId),date=document.getElementById('v125CutDate')?.value||today();if(!canPay(p?.local||'',date))return;return oldPayOne.apply(this,arguments)};
  const oldRenderPayments=window.renderPagamentos;if(typeof oldRenderPayments==='function')window.renderPagamentos=function(){const r=oldRenderPayments.apply(this,arguments);setTimeout(updatePaymentGuard,0);return r};

  const crossStyle=document.createElement('style');crossStyle.textContent=`.v141-cross-note{display:block!important;margin-top:6px!important;padding:6px!important;border-radius:7px;background:#fff0d5;color:#865100!important;line-height:1.35}`;document.head.appendChild(crossStyle);
  const dateStyle=document.createElement('style');dateStyle.textContent=`.v142-date-card{margin:0 0 12px;padding:14px;border:1px solid #efc35d;border-left:6px solid #e49a00;border-radius:12px;background:#fff9e9;color:#62430b}.v142-date-title{display:flex;justify-content:space-between;gap:10px;align-items:center}.v142-date-title span{font-size:16px;font-weight:900}.v142-date-title strong{padding:5px 8px;border-radius:999px;background:#8b5200;color:#fff;font-size:9px}.v142-date-card p{margin:9px 0;line-height:1.45}.v142-date-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.v142-date-grid span{padding:9px;border:1px solid #ead7a5;border-radius:8px;background:#fff}.v142-date-grid small,.v142-date-grid b{display:block}.v142-date-grid small{color:#806d45}.v142-date-grid b{margin-top:3px;color:#513500}.v142-reason{display:block;margin-top:10px;font-size:11px;font-weight:900}.v142-reason input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #d7b35f;border-radius:8px;background:#fff;color:#4f3a12}.v142-confirm{display:flex;align-items:flex-start;gap:8px;margin-top:10px;padding:10px;border-radius:8px;background:#fff;border:1px solid #dfc47f}.v142-confirm input{width:20px;height:20px;flex:0 0 20px;accent-color:#168148}.v142-date-card>small{display:block;margin-top:7px}.v142-date-card>small.ok{color:#176e36}.v142-date-card>small.bad{color:#b52222;font-weight:900}@media(max-width:700px){.v142-date-title,.v142-date-grid{display:grid;grid-template-columns:1fr}.v142-date-title strong{justify-self:start}}`;document.head.appendChild(dateStyle);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{inject();migrateOldTurns();setTimeout(updatePaymentGuard,120)},{once:true});else{inject();migrateOldTurns();setTimeout(updatePaymentGuard,120)}
})();
