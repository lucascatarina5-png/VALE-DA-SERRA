(function(){
  'use strict';
  const Bridge=window.V157MobileBridge,Core=window.V155TankCore;
  if(!Bridge)return console.error('V157: comunicação com o aplicativo não carregada.');
  const E=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const N=value=>{const n=Number(String(value??0).replace(',','.'));return Number.isFinite(n)?n:0};
  const norm=value=>String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
  const money=value=>N(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const liters=value=>N(value).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const today=()=>{const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};
  const brDate=value=>{const x=String(value||'').slice(0,10).split('-');return x.length===3?`${x[2]}/${x[1]}/${x[0]}`:'—'};
  const id=prefix=>`${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
  const state=()=>Bridge.getState();
  const producerRef=x=>x?.prodId??x?.produtorId??x?.producerId??x?.producer_id??'';
  const debitRef=x=>x?.debitoId??x?.debitId??x?.debito_id??x?.debit_id??'';
  const producerNameRef=x=>x?.produtor??x?.produtorNome??x?.producer_name??x?.nomeProdutor??'';
  const debitDate=x=>String(x?.data||x?.business_date||x?.created_at||'').slice(0,10);
  const debitValue=x=>N(x?.valor??x?.amount??x?.total);
  const entryQty=x=>N(x?.qtd??x?.litros??x?.volume);
  const producerById=pid=>state().produtores.find(p=>String(p.id)===String(pid));
  const entryTurn=x=>{const v=norm(x?.turno||x?.periodo||x?.turn);return v==='m'||v.includes('manha')?1:2};
  const entryLocality=x=>String(x?.local||x?.localidadeEntrega||x?.deliveryLocality||producerById(producerRef(x))?.local||'').trim();
  const financialLocality=x=>String(producerById(producerRef(x))?.local||entryLocality(x)).trim();
  const paymentLocality=x=>String(x?.localidadePrincipalPagamento||x?.localidadeCadastroProdutor||producerById(producerRef(x))?.local||x?.localidade||'').trim();
  const isAdmin=()=>{const u=Bridge.getUser()||{};return norm(u.role||u.perfil).includes('admin')||norm(u.username)==='admin'};
  const clone=value=>JSON.parse(JSON.stringify(value));
  async function reloadSharedState(){
    const result=await Bridge.api('/api/state');
    if(!result.data||typeof result.data!=='object')throw new Error('O servidor não retornou os dados do sistema.');
    Object.assign(state(),result.data);
    for(const key of ['produtores','lancamentos','pagamentos','debitos','pagamentosDebitos'])if(!Array.isArray(state()[key]))state()[key]=[];
    return state();
  }

  function showHome(){
    document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
    const home=document.getElementById('homeScreen');if(home)home.style.display='block';
    document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x.hasAttribute('data-home')));
    window.scrollTo(0,0);
  }
  function openScreen(screen){
    const home=document.getElementById('homeScreen');if(home)home.style.display='none';
    document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x===screen));
    document.querySelectorAll('.nav-btn').forEach(x=>x.classList.remove('active'));
    window.scrollTo(0,0);
  }
  function addTile(icon,title,description,handler){
    const grid=document.querySelector('.home-grid');if(!grid)return;
    const button=document.createElement('button');button.type='button';button.className='home-tile v157-module-tile';
    button.innerHTML=`<span class="tile-ico">${icon}</span><span class="tile-title">${E(title)}</span><small>${description}</small>`;
    button.addEventListener('click',handler);grid.appendChild(button);
  }
  function pendingPdfs(local,cut){
    return (state().importacoesPdf||[]).filter(x=>x.status==='pendente'&&(!x.data||String(x.data)<=String(cut))&&(!(x.localities||[]).length||(x.localities||[]).some(v=>norm(v)===norm(local))));
  }

  // -------- PAGAMENTOS --------
  const P={screen:null,selected:new Set(),filter:'',busy:false};
  function entryPaid(entry){
    const situation=norm(entry?.situacaoPagamento||entry?.statusPagamento);
    if(entry?.pagamentoId||situation.includes('liquid')||situation==='pago')return true;
    return (state().pagamentos||[]).some(pg=>{
      if(Array.isArray(pg.entryIds))return pg.entryIds.some(x=>String(x)===String(entry.id));
      if(String(producerRef(pg))!==String(producerRef(entry)))return false;
      const ym=String(pg.mes||''),q=String(pg.quinzena||''),start=`${ym}-${q==='2'?'16':'01'}`,end=`${ym}-${q==='1'?'15':'31'}`;
      return ['1','2'].includes(q)&&String(entry.data||'')>=start&&String(entry.data||'')<=end;
    });
  }
  function debtPaidTotal(debt){
    const s=state(),did=String(debt.id),ledger=s.pagamentosDebitos||[];
    let total=ledger.filter(x=>String(debitRef(x))===did).reduce((sum,x)=>sum+N(x.valor??x.amount),0);
    (s.pagamentos||[]).forEach(pg=>{
      const apps=Array.isArray(pg.debitApplications)?pg.debitApplications:[];
      const app=apps.find(x=>String(debitRef(x))===did);
      const ledgerExists=ledger.some(x=>String(debitRef(x))===did&&String(x.pagamentoId??x.paymentId??'')===String(pg.id??''));
      if(app&&!ledgerExists)total+=N(app.amount??app.amountApplied??app.valor??(N(app.balanceBefore)-N(app.balanceAfter)));
      else if(!apps.length&&!ledgerExists&&Array.isArray(pg.debitIds)&&pg.debitIds.some(x=>String(x)===did))total+=debitValue(debt);
    });
    return total;
  }
  function debtBalance(debt){return Math.max(0,debitValue(debt)-debtPaidTotal(debt))}
  function debtBelongs(debt,p){
    const ref=producerRef(debt),name=producerNameRef(debt),owner=ref!==''?producerById(ref):null;
    return (ref!==''&&String(ref)===String(p.id))||((!ref||!owner)&&name&&norm(name)===norm(p.nome));
  }
  function paymentChoice(){return {ym:document.getElementById('v157PayMonth')?.value||today().slice(0,7),q:document.getElementById('v157PayFortnight')?.value||'1',local:document.getElementById('v157PayLocal')?.value||'',date:document.getElementById('v157PayCut')?.value||today(),turn:document.getElementById('v157PayTurn')?.value||'T'}}
  function beforeCut(entry,c){return String(entry.data||'')<c.date||(String(entry.data||'')===c.date&&entryTurn(entry)<=(c.turn==='M'?1:2))}
  function pendingEntries(p,c){return (state().lancamentos||[]).filter(x=>String(producerRef(x))===String(p.id)&&!entryPaid(x)&&beforeCut(x,c)&&norm(financialLocality(x))===norm(c.local))}
  function pendingDebts(p,c){
    return (state().debitos||[]).filter(d=>debtBelongs(d,p)&&!['cancelado','cancelada','excluido','excluida'].includes(norm(d.status||d.situacao))).filter(d=>{const dt=debitDate(d);return !dt||dt<=c.date}).filter(d=>debtBalance(d)>0).sort((a,b)=>debitDate(a).localeCompare(debitDate(b)));
  }
  function deliveryBreakdown(entries){
    const map=new Map();entries.forEach(x=>{const local=entryLocality(x)||'Não informada',key=norm(local),row=map.get(key)||{local,liters:0};row.liters+=entryQty(x);map.set(key,row)});return [...map.values()];
  }
  function paymentRow(p,c){
    const entries=pendingEntries(p,c),previous=entries.filter(x=>!String(x.data||'').startsWith(c.ym)).reduce((s,x)=>s+entryQty(x),0),current=entries.filter(x=>String(x.data||'').startsWith(c.ym)).reduce((s,x)=>s+entryQty(x),0),total=previous+current,gross=total*2.30,debits=pendingDebts(p,c),open=debits.reduce((s,x)=>s+debtBalance(x),0),applied=Math.min(gross,open),net=Math.max(0,gross-applied);
    return {p,entries,previous,current,total,gross,debits,open,applied,net,delivery:deliveryBreakdown(entries)};
  }
  function paymentRows(c=paymentChoice()){
    if(!c.local)return [];
    return (state().produtores||[]).map(p=>paymentRow(p,c)).filter(x=>x.total>0).sort((a,b)=>String(a.p.nome||'').localeCompare(String(b.p.nome||''),'pt-BR'));
  }
  function sumRows(rows){return rows.reduce((a,x)=>({people:a.people+1,liters:a.liters+x.total,gross:a.gross+x.gross,open:a.open+x.open,debt:a.debt+x.applied,net:a.net+x.net}),{people:0,liters:0,gross:0,open:0,debt:0,net:0})}
  function selectedRows(rows){return rows.filter(x=>P.selected.has(String(x.p.id)))}
  function knownLocalities(){
    const map=new Map();(state().produtores||[]).forEach(p=>{const v=String(p.local||'').trim();if(v&&!map.has(norm(v)))map.set(norm(v),v)});(state().lancamentos||[]).forEach(x=>{const v=financialLocality(x);if(v&&!map.has(norm(v)))map.set(norm(v),v)});return [...map.values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  }
  function suggestedCut(ym,q){
    const [y,m]=String(ym).split('-').map(Number),last=new Date(y,m,0).getDate(),end=q==='1'?15:last,now=today();
    if(now.startsWith(ym+'-')&&Number(now.slice(8,10))<=(q==='1'?15:last)&&Number(now.slice(8,10))>=(q==='1'?1:16))return now;
    return `${ym}-${String(end).padStart(2,'0')}`;
  }
  function syncLocalities(){
    const el=document.getElementById('v157PayLocal'),old=el.value,values=knownLocalities();el.innerHTML='<option value="">Escolha a localidade...</option>'+values.map(x=>`<option value="${E(x)}">${E(x)}</option>`).join('');
    el.value=values.find(x=>norm(x)===norm(old))||'';
  }
  function renderPayment(){
    syncLocalities();const c=paymentChoice(),rows=paymentRows(c),validIds=new Set(rows.map(x=>String(x.p.id)));
    P.selected=new Set([...P.selected].filter(x=>validIds.has(x)));const chosen=selectedRows(rows),total=sumRows(chosen),all=sumRows(rows),pdfs=c.local?pendingPdfs(c.local,c.date):[];
    const k=document.getElementById('v157PayKpis');k.innerHTML=`<div class="v157-kpi"><span>PRODUTORES</span><b>${total.people}</b></div><div class="v157-kpi"><span>LEITE INCLUÍDO</span><b>${liters(total.liters)} L</b></div><div class="v157-kpi"><span>VALOR BRUTO</span><b>${money(total.gross)}</b></div><div class="v157-kpi debt"><span>DÉBITOS APLICADOS</span><b>${money(total.debt)}</b></div><div class="v157-kpi net"><span>LÍQUIDO A PAGAR</span><b>${money(total.net)}</b></div>`;
    const notice=document.getElementById('v157PayNotice');
    if(!c.local)notice.innerHTML='<div class="v157-notice"><b>Escolha a localidade principal</b>O leite entregue em outro tanque continuará aparecendo no pagamento da localidade principal do produtor.</div>';
    else if(pdfs.length)notice.innerHTML=`<div class="v157-notice bad"><b>Pagamento protegido</b>${pdfs.length} relatório(s) PDF ainda aguardando conclusão nessa localidade.</div>`;
    else notice.innerHTML=`<div class="v157-notice ${rows.length?'good':''}"><b>${rows.length?`${rows.length} produtor(es) com leite pendente`:'Nenhum leite pendente até este corte'}</b>${rows.length?`${liters(all.liters)} L disponíveis para conferência. Os débitos antigos ainda em aberto também são incluídos.`:'Altere a data de corte ou escolha outra localidade.'}</div>`;
    const q=norm(P.filter),visible=rows.filter(x=>!q||norm(`${x.p.nome} ${x.p.codigo} ${x.p.local}`).includes(q));
    document.getElementById('v157PayList').innerHTML=visible.length?visible.map(row=>{
      const selected=P.selected.has(String(row.p.id)),places=row.delivery.map(x=>`${x.local}: ${liters(x.liters)} L`).join(' • '),debts=row.debits.slice(0,4).map(d=>`${d.descricao||d.description||'Débito'} (${money(debtBalance(d))})`).join(' • ');
      return `<label class="v157-person ${selected?'selected':''}"><input class="v157-check" type="checkbox" data-pay-producer="${E(row.p.id)}" ${selected?'checked':''}><span><span class="v157-person-head"><b>${E(row.p.nome||'Produtor')}</b><strong>${money(row.net)}</strong></span><small>Código ${E(row.p.codigo||'—')} • Principal: ${E(row.p.local||c.local)}<br>${E(places||'Local da entrega não informado')}<br>Saldo anterior ${liters(row.previous)} L • Período atual ${liters(row.current)} L</small><span class="v157-money-grid"><span>Leite<b>${liters(row.total)} L</b></span><span>Bruto<b>${money(row.gross)}</b></span><span class="debt">Débito aberto<b>${money(row.open)}</b></span></span>${row.open?`<span class="v157-debt-detail"><b>Desconto aplicado agora: ${money(row.applied)}</b><br>${E(debts)}${row.debits.length>4?` • +${row.debits.length-4} débito(s)`:''}</span>`:''}</span></label>`;
    }).join(''):'<div class="v157-empty">Nenhum produtor encontrado neste filtro.</div>';
    const bar=document.getElementById('v157PayBar');bar.innerHTML=`<span><small>${total.people} selecionado(s) • débitos ${money(total.debt)}</small><b>${money(total.net)} líquido</b></span><button class="v157-btn yellow" id="v157ReviewPay" ${!total.people||pdfs.length||P.busy?'disabled':''}>Revisar e pagar</button>`;
    document.getElementById('v157ReviewPay').addEventListener('click',finalizePayment);
  }
  async function refreshPayment(){
    const refresh=document.getElementById('v157PayRefresh');refresh.disabled=true;
    try{await reloadSharedState();syncLocalities();renderPayment()}catch(error){Bridge.toast('Não foi possível atualizar: '+error.message,true)}finally{refresh.disabled=false}
  }
  function createPaymentScreen(){
    const screen=document.createElement('section');screen.className='screen v157-screen';screen.id='screen-v157-payments';
    const now=today(),q=Number(now.slice(8,10))<=15?'1':'2';
    screen.innerHTML=`<header class="v157-top"><button type="button" data-v157-home>←</button><div><h1>💰 Pagamentos</h1><small>Fechamento seguro por localidade</small></div><button type="button" id="v157PayRefresh">↻</button></header><main class="v157-body"><section class="v157-card"><h2 class="v157-title">Período e corte <small>Manhã ou dia completo</small></h2><div class="v157-grid"><div class="v157-field"><label>Mês de referência</label><input id="v157PayMonth" type="month" value="${now.slice(0,7)}"></div><div class="v157-field"><label>Quinzena</label><select id="v157PayFortnight"><option value="1" ${q==='1'?'selected':''}>1ª quinzena</option><option value="2" ${q==='2'?'selected':''}>2ª quinzena</option></select></div><div class="v157-field full"><label>Localidade principal para pagamento</label><select id="v157PayLocal"><option value="">Escolha a localidade...</option></select></div><div class="v157-field"><label>Pago até a data</label><input id="v157PayCut" type="date" value="${suggestedCut(now.slice(0,7),q)}"></div><div class="v157-field"><label>Último turno pago</label><select id="v157PayTurn"><option value="M">Manhã</option><option value="T" selected>Tarde — dia completo</option></select></div></div></section><div id="v157PayNotice"></div><section id="v157PayKpis" class="v157-kpis"></section><section class="v157-card"><h2 class="v157-title">Produtores que entrarão</h2><div class="v157-toolbar"><input id="v157PaySearch" placeholder="Pesquisar nome ou código"><button id="v157PayAll" type="button">Marcar</button></div><div id="v157PayList" class="v157-list" style="margin-top:10px"></div></section><div id="v157PayBar" class="v157-sticky"></div></main>`;
    document.getElementById('app').appendChild(screen);P.screen=screen;
    screen.querySelector('[data-v157-home]').addEventListener('click',showHome);screen.querySelector('#v157PayRefresh').addEventListener('click',refreshPayment);
    screen.querySelector('#v157PayLocal').addEventListener('change',()=>{P.selected=new Set(paymentRows().map(x=>String(x.p.id)));renderPayment()});
    ['v157PayCut','v157PayTurn'].forEach(x=>screen.querySelector('#'+x).addEventListener('change',()=>{P.selected=new Set(paymentRows().map(r=>String(r.p.id)));renderPayment()}));
    ['v157PayMonth','v157PayFortnight'].forEach(x=>screen.querySelector('#'+x).addEventListener('change',()=>{const c=paymentChoice();document.getElementById('v157PayCut').value=suggestedCut(c.ym,c.q);P.selected=new Set(paymentRows().map(r=>String(r.p.id)));renderPayment()}));
    screen.querySelector('#v157PaySearch').addEventListener('input',e=>{P.filter=e.target.value;renderPayment();const input=document.getElementById('v157PaySearch');input.focus();input.setSelectionRange(input.value.length,input.value.length)});
    screen.querySelector('#v157PayAll').addEventListener('click',()=>{const rows=paymentRows();P.selected=P.selected.size===rows.length?new Set():new Set(rows.map(x=>String(x.p.id)));renderPayment()});
    screen.querySelector('#v157PayList').addEventListener('change',e=>{const pid=e.target.dataset.payProducer;if(!pid)return;e.target.checked?P.selected.add(String(pid)):P.selected.delete(String(pid));renderPayment()});
  }
  async function openPayments(){openScreen(P.screen);await refreshPayment();const rows=paymentRows();if(!P.selected.size)P.selected=new Set(rows.map(x=>String(x.p.id)));renderPayment()}
  async function finalizePayment(){
    if(P.busy)return;const originalChoice=paymentChoice(),wanted=[...P.selected];
    if(!originalChoice.local)return alert('Escolha uma localidade.');if(String(originalChoice.date).slice(0,7)!==originalChoice.ym)return alert('A data de corte precisa pertencer ao mês selecionado.');
    if(pendingPdfs(originalChoice.local,originalChoice.date).length)return alert('Conclua ou descarte os relatórios PDF pendentes antes do pagamento.');
    const before=clone({lancamentos:state().lancamentos,pagamentos:state().pagamentos,debitos:state().debitos,pagamentosDebitos:state().pagamentosDebitos});
    P.busy=true;renderPayment();
    try{
      await reloadSharedState();const c=originalChoice,rows=paymentRows(c).filter(x=>wanted.includes(String(x.p.id)));if(!rows.length)throw new Error('As entradas já foram pagas ou mudaram. Atualize a tela.');
      const totals=sumRows(rows);if(!confirm(`Finalizar o pagamento de ${rows.length} produtor(es)?\n\nLocalidade: ${c.local}\nPago até: ${brDate(c.date)} — ${c.turn==='M'?'Manhã':'Tarde / dia completo'}\nLeite: ${liters(totals.liters)} L\nDébitos aplicados: ${money(totals.debt)}\nLíquido: ${money(totals.net)}`))return;
      const s=state(),closureId=id('fechamento'),createdAt=new Date().toISOString(),operator=Bridge.getUser()?.username||Bridge.getUser()?.name||'Administrador';
      rows.forEach(row=>{
        let available=row.gross;const apps=[];row.debits.forEach(d=>{const balance=debtBalance(d),amount=Math.min(balance,available);if(amount<=0)return;apps.push({debitId:d.id,amount,balanceBefore:balance,balanceAfter:Math.max(0,balance-amount)});available-=amount});
        const applied=apps.reduce((sum,x)=>sum+x.amount,0),paymentId=id('pg_leite');
        apps.forEach(a=>s.pagamentosDebitos.push({id:id('pgdeb_leite'),debitoId:a.debitId,prodId:row.p.id,data:today(),valor:a.amount,origem:'pagamento_leite',pagamentoId:paymentId,fechamentoId:closureId}));
        const places=deliveryBreakdown(row.entries),outside=places.filter(x=>norm(x.local)!==norm(row.p.local));
        s.pagamentos.push({chave:`${row.p.id}|${c.ym}|${c.q}|${closureId}`,id:paymentId,prodId:row.p.id,mes:c.ym,quinzena:c.q,localidade:c.local,localidadePrincipalPagamento:c.local,localidadeCadastroProdutor:row.p.local||c.local,locaisEntrega:places,entregaForaLocalidadePrincipal:outside.length>0,litrosForaLocalidadePrincipal:outside.reduce((sum,x)=>sum+x.liters,0),corteData:c.date,corteTurno:c.turn==='M'?'Manhã':'Tarde',entryIds:row.entries.map(x=>x.id),debitIds:apps.map(x=>x.debitId),debitApplications:apps,debitoAbertoAntes:row.open,saldoDebitosApos:Math.max(0,row.open-applied),litros:row.total,litrosSaldoAnterior:row.previous,litrosQuinzenaAtual:row.current,valorLitro:2.30,valorBruto:row.gross,totalDebitos:applied,valorPago:Math.max(0,row.gross-applied),dataPagamento:today(),modeloPagamento:'fechamento-localidade-v157-mobile',fechamentoId:closureId,fechamentoCriadoEm:createdAt,fechamentoCriadoPor:operator});
        row.entries.forEach(x=>{x.situacaoPagamento='Liquidada';x.pagamentoId=paymentId;x.dataLiquidacao=today()});apps.forEach(a=>{const d=s.debitos.find(x=>String(x.id)===String(a.debitId));if(d){d.situacaoPagamento=a.balanceAfter<=0?'Liquidado':'Pendente';if(a.balanceAfter<=0)d.pagamentoId=paymentId}});
      });
      await Bridge.saveState();fetch('/api/audit/event',{method:'POST',headers:{Authorization:'Bearer '+(localStorage.getItem('vale_token')||sessionStorage.getItem('vale_token')||''),'Content-Type':'application/json'},body:JSON.stringify({action:'PAGAMENTO_QUINZENA_REGISTRADO_MOBILE',details:{localidade:c.local,quinzena:c.q,mes:c.ym,produtores:rows.length,litros:totals.liters,valor:totals.net,debitos:totals.debt}})}).catch(()=>{});
      P.selected.clear();alert(`✅ PAGAMENTO FINALIZADO\n\n${rows.length} produtor(es) receberam baixa.\nDébitos aplicados: ${money(totals.debt)}\nLíquido: ${money(totals.net)}`);await refreshPayment();
    }catch(error){
      for(const key of Object.keys(before)){state()[key].splice(0,state()[key].length,...before[key])}alert('❌ O pagamento não foi gravado.\n\n'+error.message);
    }finally{P.busy=false;renderPayment()}
  }

  // -------- CONFERÊNCIA DE TANQUES --------
  const T={screen:null,tanks:[],history:[],preview:null,selected:'',now:'',busy:false};
  const tankApi=(url,opt)=>Bridge.api(url,opt||{});
  function localNow(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),get=t=>parts.find(x=>x.type===t)?.value||'';return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`}
  function brMoment(value){const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`:'—'}
  function selectedTank(){return T.tanks.find(x=>String(x.id)===String(T.selected))}
  function tankStatus(value){return Core?.statusLabel(value)||({ok:'Conferido',atencao:'Atenção',critica:'Diferença crítica',cancelada:'Cancelada'}[value]||'Pendente')}
  function tankCalc(){
    if(!T.preview||!selectedTank()||!Core)return null;const t=selectedTank();return Core.calculateBalance({opening:T.preview.opening_balance_liters,registered:T.preview.registered_liters,transfersIn:document.getElementById('v157TankIn').value,collected:document.getElementById('v157TankCollected').value,ending:document.getElementById('v157TankEnding').value,transfersOut:document.getElementById('v157TankOut').value,discarded:document.getElementById('v157TankDiscard').value,warningLiters:t.warning_tolerance_liters,warningPercent:t.warning_tolerance_percent,criticalLiters:t.critical_tolerance_liters,criticalPercent:t.critical_tolerance_percent})
  }
  function renderTankBalance(){
    const box=document.getElementById('v157TankBalance'),formula=document.getElementById('v157TankFormula'),calc=tankCalc();if(!calc){box.innerHTML='';formula.textContent='Selecione um tanque para calcular.';return}
    const label=calc.difference>0?'Leite faltando':calc.difference<0?'Sobra de leite':'Sem diferença';box.innerHTML=`<div><small>Disponível</small><b>${liters(calc.available)} L</b></div><div><small>Total explicado</small><b>${liters(calc.accounted)} L</b></div><div class="result ${calc.status}"><small>${label}</small><b>${liters(calc.absolute)} L</b><span class="v157-chip ${calc.status}">${E(tankStatus(calc.status))}</span></div>`;formula.innerHTML=`(${liters(calc.opening)} inicial + ${liters(calc.registered)} registrado + ${liters(calc.transfersIn)} recebido) − (${liters(calc.collected)} retirado + ${liters(calc.ending)} final + ${liters(calc.transfersOut)} enviado + ${liters(calc.discarded)} descarte) = <b>${calc.difference>0?'+':''}${liters(calc.difference)} L</b>`;
  }
  function renderTankPreview(){
    const p=T.preview;if(!p){document.getElementById('v157TankEntries').innerHTML='<div class="v157-empty">Escolha um tanque para montar a conferência.</div>';renderTankBalance();return}
    document.getElementById('v157TankStart').value=p.start_local;document.getElementById('v157TankStart').readOnly=!!p.last;document.getElementById('v157TankOpening').value=p.opening_balance_liters;document.getElementById('v157TankRegistered').value=p.registered_liters;
    const cycleOk=Math.abs(N(p.cycle_hours)-48)<=2;document.getElementById('v157TankCycle').className='v157-cycle '+(cycleOk?'':'warn');document.getElementById('v157TankCycle').innerHTML=`<span><b>${cycleOk?'Ciclo de 2 dias':'Confira o intervalo'}</b>${brMoment(p.start_local)} até ${brMoment(p.end_local)}</span><strong>${liters(p.cycle_hours)} h</strong>`;
    document.getElementById('v157TankEntries').innerHTML=p.entries.length?p.entries.map(x=>`<div class="v157-entry"><span class="v157-entry-head"><b>${E(x.producer_name||'Produtor')}</b><strong>${liters(x.liters)} L</strong></span><small>${brDate(x.data)} ${E(x.hora||'')} • ${E(x.turno||'')}<br>Entregue em ${E(x.locality||p.tank.locality)}${x.pdf_file?` • PDF ${E(x.pdf_file)}`:''}</small></div>`).join(''):'<div class="v157-empty">Nenhuma entrada encontrada neste intervalo.</div>';
    const message=document.getElementById('v157TankMessage');message.innerHTML=p.pending_imports.length?`<div class="v157-notice bad"><b>Conferência bloqueada</b>${p.pending_imports.length} PDF(s) pendente(s) nesta localidade.</div>`:`<div class="v157-notice good"><b>${p.entries.length} entrada(s) incluída(s)</b>${liters(p.registered_liters)} L registrados no sistema.</div>`;renderTankBalance();
  }
  function renderTankHistory(){
    const rows=T.history.filter(x=>!T.selected||String(x.tank_id)===String(T.selected)).slice(0,25);document.getElementById('v157TankHistory').innerHTML=rows.length?rows.map(x=>`<div class="v157-history"><span class="v157-history-head"><b>${E(x.tank_name)} • ${E(x.locality)}</b><strong>${liters(Math.abs(N(x.difference_liters)))} L</strong></span><small>${brMoment(x.start_local)} até ${brMoment(x.end_local)}<br>Registrado ${liters(x.registered_liters)} L • Retirado ${liters(x.truck_collected_liters)} L • ${E(x.truck||'Sem placa')}</small><span class="v157-chip ${E(x.status)}">${E(tankStatus(x.status))}</span></div>`).join(''):'<div class="v157-empty">Nenhuma conferência registrada para este tanque.</div>';
  }
  function fillTankSelect(){const el=document.getElementById('v157TankSelect');el.innerHTML=T.tanks.length?T.tanks.map(t=>`<option value="${E(t.id)}" ${String(t.id)===String(T.selected)?'selected':''}>${E(t.name)} • ${E(t.locality)}</option>`).join(''):'<option value="">Nenhum tanque cadastrado</option>'}
  async function refreshTankPreview(){
    const tank=selectedTank();if(!tank)return;const end=document.getElementById('v157TankEnd').value||T.now||localNow(),start=document.getElementById('v157TankStart').value||Core.addHours(end,-48);
    document.getElementById('v157TankMessage').innerHTML='<div class="v157-notice">Calculando entradas do ciclo...</div>';
    try{const result=await tankApi(`/api/tank-conferences/preview?tank_id=${encodeURIComponent(tank.id)}&end_local=${encodeURIComponent(end)}&first_start_local=${encodeURIComponent(start)}`);T.preview=result.preview;renderTankPreview()}catch(error){T.preview=null;document.getElementById('v157TankMessage').innerHTML=`<div class="v157-notice bad"><b>Não foi possível montar a conferência</b>${E(error.message)}</div>`;renderTankPreview()}
  }
  async function selectTank(value){T.selected=String(value||'');fillTankSelect();const tank=selectedTank();if(!tank){T.preview=null;renderTankPreview();return}document.getElementById('v157TankEnd').value=T.now||localNow();document.getElementById('v157TankStart').value=tank.last_end_local||Core.addHours(document.getElementById('v157TankEnd').value,-48);['v157TankIn','v157TankCollected','v157TankEnding','v157TankOut','v157TankDiscard'].forEach(x=>document.getElementById(x).value='0');document.getElementById('v157TankNotes').value='';await refreshTankPreview();renderTankHistory()}
  async function loadTanks(){
    if(T.busy)return;T.busy=true;document.getElementById('v157TankMessage').innerHTML='<div class="v157-notice">Carregando tanques e conferências...</div>';
    try{const [tanks,history]=await Promise.all([tankApi('/api/milk-tanks'),tankApi('/api/tank-conferences?limit=300')]);T.tanks=tanks.tanks||[];T.history=history.conferences||[];T.now=tanks.now_local||localNow();if(!T.selected||!T.tanks.some(x=>String(x.id)===String(T.selected)))T.selected=T.tanks[0]?.id||'';fillTankSelect();document.getElementById('v157TankNew').style.display=isAdmin()?'':'none';renderTankHistory();if(T.selected)await selectTank(T.selected);else{T.preview=null;document.getElementById('v157TankMessage').innerHTML='<div class="v157-notice warn"><b>Nenhum tanque cadastrado</b>Use “Novo tanque” para começar.</div>';renderTankPreview()}}catch(error){document.getElementById('v157TankMessage').innerHTML=`<div class="v157-notice bad"><b>Erro ao carregar</b>${E(error.message)}</div>`}finally{T.busy=false}
  }
  function createTankScreen(){
    const screen=document.createElement('section');screen.className='screen v157-screen';screen.id='screen-v157-tanks';screen.innerHTML=`<header class="v157-top"><button type="button" data-v157-home>←</button><div><h1>⚖️ Conferência de Tanques</h1><small>Coletas e diferenças a cada 2 dias</small></div><button type="button" id="v157TankRefresh">↻</button></header><main class="v157-body"><div id="v157TankMessage"></div><section class="v157-card"><h2 class="v157-title">Tanque da coleta <button class="v157-btn" id="v157TankNew" type="button">+ Novo tanque</button></h2><div class="v157-field"><label>Tanque / localidade</label><select id="v157TankSelect"></select></div></section><section class="v157-card"><h2 class="v157-title">Período e responsável <small>Ciclo esperado: 48 horas</small></h2><div class="v157-grid"><div class="v157-field full"><label>Início do ciclo</label><input id="v157TankStart" type="datetime-local"></div><div class="v157-field full"><label>Data e hora da retirada</label><input id="v157TankEnd" type="datetime-local"></div><div class="v157-field full"><label>Caminhão / placa *</label><input id="v157TankTruck" placeholder="Ex.: QAB-1234"></div><div class="v157-field"><label>Motorista</label><input id="v157TankDriver" placeholder="Nome"></div><div class="v157-field"><label>Rota / documento</label><input id="v157TankRoute" placeholder="Rota ou comprovante"></div></div><div id="v157TankCycle" class="v157-cycle" style="margin-top:10px"></div></section><section class="v157-card"><h2 class="v157-title">Volumes da conferência</h2><div class="v157-grid"><div class="v157-field"><label>Saldo inicial (L)</label><input id="v157TankOpening" readonly value="0"></div><div class="v157-field"><label>Registrado (L)</label><input id="v157TankRegistered" readonly value="0"></div><div class="v157-field"><label>Transferido para cá</label><input id="v157TankIn" type="number" min="0" step="0.01" value="0"></div><div class="v157-field"><label>Retirado pelo caminhão *</label><input id="v157TankCollected" type="number" min="0" step="0.01" value="0"></div><div class="v157-field"><label>Saldo que ficou</label><input id="v157TankEnding" type="number" min="0" step="0.01" value="0"></div><div class="v157-field"><label>Transferido para outro</label><input id="v157TankOut" type="number" min="0" step="0.01" value="0"></div><div class="v157-field full"><label>Descarte / perda explicada</label><input id="v157TankDiscard" type="number" min="0" step="0.01" value="0"></div></div><div id="v157TankBalance" class="v157-balance" style="margin-top:11px"></div><div id="v157TankFormula" class="v157-formula" style="margin-top:9px"></div><div class="v157-field" style="margin-top:10px"><label>Observações / justificativa</label><textarea id="v157TankNotes" placeholder="Obrigatório quando houver diferença acima da tolerância"></textarea></div><button id="v157TankFinish" class="v157-btn green" type="button" style="width:100%;margin-top:10px">✓ Finalizar conferência</button></section><section class="v157-card"><h2 class="v157-title">Entradas incluídas</h2><div id="v157TankEntries"></div></section><section class="v157-card"><h2 class="v157-title">Histórico deste tanque</h2><div id="v157TankHistory"></div></section></main><div class="v157-modal" id="v157TankModal"><form class="v157-modal-panel" id="v157TankForm"><div class="v157-modal-head"><h2>Cadastrar tanque</h2><button type="button" data-close>×</button></div><div class="v157-grid one"><div class="v157-field"><label>Nome do tanque *</label><input id="v157NewTankName" required placeholder="Ex.: Tanque Catarina"></div><div class="v157-field"><label>Localidade *</label><input id="v157NewTankLocal" required placeholder="Ex.: CATARINA-CE"></div><div class="v157-field"><label>Capacidade em litros</label><input id="v157NewTankCapacity" type="number" min="0" value="0"></div><div class="v157-grid"><div class="v157-field"><label>Atenção (L)</label><input id="v157NewTankWarn" type="number" min="0" value="10"></div><div class="v157-field"><label>Atenção (%)</label><input id="v157NewTankWarnPct" type="number" min="0" step="0.1" value="0.5"></div><div class="v157-field"><label>Crítico (L)</label><input id="v157NewTankCritical" type="number" min="0" value="25"></div><div class="v157-field"><label>Crítico (%)</label><input id="v157NewTankCriticalPct" type="number" min="0" step="0.1" value="1"></div></div><button class="v157-btn green" type="submit">Salvar tanque</button></div></form></div>`;
    document.getElementById('app').appendChild(screen);T.screen=screen;screen.querySelector('[data-v157-home]').addEventListener('click',showHome);screen.querySelector('#v157TankRefresh').addEventListener('click',loadTanks);screen.querySelector('#v157TankSelect').addEventListener('change',e=>selectTank(e.target.value));screen.querySelector('#v157TankStart').addEventListener('change',refreshTankPreview);screen.querySelector('#v157TankEnd').addEventListener('change',refreshTankPreview);['v157TankIn','v157TankCollected','v157TankEnding','v157TankOut','v157TankDiscard'].forEach(x=>screen.querySelector('#'+x).addEventListener('input',renderTankBalance));screen.querySelector('#v157TankFinish').addEventListener('click',finishTank);screen.querySelector('#v157TankNew').addEventListener('click',()=>document.getElementById('v157TankModal').classList.add('on'));screen.querySelector('#v157TankModal [data-close]').addEventListener('click',()=>document.getElementById('v157TankModal').classList.remove('on'));screen.querySelector('#v157TankForm').addEventListener('submit',saveTank);
  }
  async function openTanks(){openScreen(T.screen);await loadTanks()}
  async function finishTank(){
    if(T.busy)return;const p=T.preview,t=selectedTank(),calc=tankCalc();if(!p||!t||!calc)return alert('Escolha um tanque e atualize a conferência.');const truck=document.getElementById('v157TankTruck').value.trim(),notes=document.getElementById('v157TankNotes').value.trim();if(!truck)return alert('Informe o caminhão ou a placa.');if(p.pending_imports.length)return alert('Conclua ou descarte os PDFs pendentes antes de fechar o tanque.');if(calc.status!=='ok'&&!notes)return alert('Explique a diferença no campo Observações.');if(!confirm(`Finalizar a conferência de ${t.name} / ${t.locality}?\n\nRegistrado: ${liters(p.registered_liters)} L\nRetirado: ${liters(document.getElementById('v157TankCollected').value)} L\n${calc.difference>0?'Faltando':calc.difference<0?'Sobra':'Diferença'}: ${liters(calc.absolute)} L`))return;
    T.busy=true;const button=document.getElementById('v157TankFinish'),label=button.textContent;button.disabled=true;button.textContent='Gravando...';try{const body={tank_id:t.id,expected_start_local:p.start_local,expected_entry_signature:p.entry_signature,first_start_local:document.getElementById('v157TankStart').value,end_local:document.getElementById('v157TankEnd').value,truck,driver:document.getElementById('v157TankDriver').value,route:document.getElementById('v157TankRoute').value,transfers_in_liters:N(document.getElementById('v157TankIn').value),truck_collected_liters:N(document.getElementById('v157TankCollected').value),ending_balance_liters:N(document.getElementById('v157TankEnding').value),transfers_out_liters:N(document.getElementById('v157TankOut').value),discarded_liters:N(document.getElementById('v157TankDiscard').value),notes};const result=await tankApi('/api/tank-conferences',{method:'POST',body:JSON.stringify(body)});alert(`✅ CONFERÊNCIA FINALIZADA\n\n${tankStatus(result.conference.status)}\nDiferença: ${liters(Math.abs(N(result.conference.difference_liters)))} L`);T.busy=false;await loadTanks()}catch(error){alert('❌ A conferência não foi gravada.\n\n'+error.message)}finally{T.busy=false;button.disabled=false;button.textContent=label}
  }
  async function saveTank(event){
    event.preventDefault();const button=event.submitter,label=button.textContent;button.disabled=true;button.textContent='Salvando...';try{const body={name:document.getElementById('v157NewTankName').value,locality:document.getElementById('v157NewTankLocal').value,capacity_liters:N(document.getElementById('v157NewTankCapacity').value),warning_tolerance_liters:N(document.getElementById('v157NewTankWarn').value),warning_tolerance_percent:N(document.getElementById('v157NewTankWarnPct').value),critical_tolerance_liters:N(document.getElementById('v157NewTankCritical').value),critical_tolerance_percent:N(document.getElementById('v157NewTankCriticalPct').value)};const result=await tankApi('/api/milk-tanks',{method:'POST',body:JSON.stringify(body)});T.selected=result.tank.id;document.getElementById('v157TankModal').classList.remove('on');event.target.reset();document.getElementById('v157NewTankWarn').value='10';document.getElementById('v157NewTankWarnPct').value='0.5';document.getElementById('v157NewTankCritical').value='25';document.getElementById('v157NewTankCriticalPct').value='1';await loadTanks();alert('✅ Tanque cadastrado.')}catch(error){alert('❌ '+error.message)}finally{button.disabled=false;button.textContent=label}
  }

  createPaymentScreen();createTankScreen();
  addTile('💰','Pagamentos','Conferir débitos<br>e finalizar a quinzena',openPayments);
  addTile('⚖️','Conferência de Tanques','Coletas, saldos<br>e diferenças',openTanks);
  window.V157Mobile={openPayments,openTanks,refreshPayment,loadTanks,debtBalance};
})();
