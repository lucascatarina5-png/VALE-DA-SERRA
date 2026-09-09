(function(){
  'use strict';
  const Core=window.V155TankCore;
  if(!Core)return console.error('V155TankCore não carregado.');
  const S={tanks:[],history:[],preview:null,selected:'',now:'',loading:false};
  const $=id=>document.getElementById(id);
  const E=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const N=value=>Core.number(value);
  const liters=value=>N(value).toLocaleString('pt-BR',{minimumFractionDigits:N(value)%1?2:0,maximumFractionDigits:2});
  const isAdmin=()=>typeof v4IsAdmin==='function'&&v4IsAdmin();
  const svgScale=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16M7 19V7h10v12M9 7V4h6v3M9.5 11h5M9.5 15h5"/><path d="M3 11c2-2 3-2 5 0s3 2 5 0 3-2 5 0 3 2 4 0"/></svg>`;
  const icon=path=>`<span class="icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></span>`;

  async function api(url,opt={}){
    const headers=typeof v4Headers==='function'?v4Headers():{'Content-Type':'application/json'};
    const response=await fetch(url,{cache:'no-store',...opt,headers:{...headers,...(opt.headers||{})}});
    let data={};try{data=await response.json()}catch(_){}
    if(!response.ok||data.ok===false)throw new Error(data.error||'Não foi possível concluir a operação.');
    return data;
  }
  function localNow(){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
    const get=t=>parts.find(x=>x.type===t)?.value||'';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  }
  function brMoment(value){
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m?`${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`:'—';
  }
  function statusChip(status){return `<span class="v155-chip ${E(status)}">${E(Core.statusLabel(status))}</span>`}
  function selectedTank(){return S.tanks.find(x=>String(x.id)===String(S.selected))||null}
  function parseList(value){if(Array.isArray(value))return value;try{return JSON.parse(value||'[]')}catch(_){return []}}

  function inject(){
    if($('conferenciaTanques'))return;
    try{if(typeof V32_SECTION_PERMISSIONS!=='undefined')V32_SECTION_PERMISSIONS.conferenciaTanques='relatorios'}catch(_){}
    const nav=document.querySelector('.sidebar .nav');
    if(nav){
      const button=document.createElement('button');
      button.type='button';button.className='v155-nav-button';button.dataset.permission='relatorios';
      button.setAttribute('onclick','v155Open(this)');
      button.innerHTML=`<span class="v155-side-icon">${svgScale}</span><span class="v155-side-copy"><b>Conferência de Tanques</b><small>Coletas a cada 2 dias</small></span><span class="v155-arrow">›</span>`;
      const reports=[...nav.querySelectorAll('button')].find(x=>x.textContent.trim()==='Relatórios');
      nav.insertBefore(button,reports||nav.lastElementChild);
    }
    const section=document.createElement('section');section.id='conferenciaTanques';section.className='section';
    section.innerHTML=`<div class="v155-page">
      <header class="v155-hero"><div><h2>Conferência de Tanques</h2><p>Controle cada retirada do caminhão em ciclos de 48 horas e identifique qualquer diferença de leite.</p></div><div class="v155-hero-actions"><button class="v155-btn" type="button" onclick="v155Load(true)">↻ Atualizar</button><button id="v155EditTankBtn" class="v155-btn" type="button" onclick="v155EditSelected()">Editar tanque</button><button id="v155NewTankBtn" class="v155-btn primary" type="button" onclick="v155OpenTank()">+ Cadastrar tanque</button></div></header>
      <div id="v155Kpis" class="v155-kpis"></div>
      <div id="v155TankStrip" class="v155-tank-strip"></div>
      <div id="v155Message"></div>
      <div class="v155-layout">
        <article class="v155-panel"><div class="v155-panel-head"><div><h3>Nova conferência da coleta</h3><p>O sistema soma todas as entradas feitas na localidade real deste tanque.</p></div><span class="v155-chip">Ciclo de 2 dias</span></div><div class="v155-panel-body">
          <div class="v155-fields">
            <div class="v155-field"><label>Tanque / localidade</label><select id="v155TankSelect"></select></div>
            <div class="v155-field"><label>Início do ciclo</label><input id="v155Start" type="datetime-local"></div>
            <div class="v155-field"><label>Data e hora da retirada</label><input id="v155End" type="datetime-local"></div>
            <div class="v155-field"><label>Caminhão / placa *</label><input id="v155Truck" maxlength="80" placeholder="Ex.: QAB-1234"></div>
            <div class="v155-field"><label>Motorista / responsável</label><input id="v155Driver" maxlength="100" placeholder="Nome do responsável"></div>
            <div class="v155-field"><label>Rota / documento</label><input id="v155Route" maxlength="100" placeholder="Rota ou nº do comprovante"></div>
          </div>
          <div id="v155Cycle" class="v155-cycle"><span>Escolha um tanque para montar o ciclo.</span></div>
          <div class="v155-fields">
            <div class="v155-field"><label>Saldo inicial automático (L)</label><input id="v155Opening" type="number" readonly value="0"></div>
            <div class="v155-field"><label>Leite registrado no sistema (L)</label><input id="v155Registered" type="number" readonly value="0"></div>
            <div class="v155-field"><label>Transferido para este tanque (L)</label><input id="v155TransferIn" type="number" min="0" step="0.01" value="0"></div>
            <div class="v155-field"><label>Retirado pelo caminhão (L) *</label><input id="v155Collected" type="number" min="0" step="0.01" value="0"></div>
            <div class="v155-field"><label>Leite que ficou no tanque (L)</label><input id="v155Ending" type="number" min="0" step="0.01" value="0"></div>
            <div class="v155-field"><label>Transferido para outro tanque (L)</label><input id="v155TransferOut" type="number" min="0" step="0.01" value="0"></div>
            <div class="v155-field"><label>Descarte registrado (L)</label><input id="v155Discarded" type="number" min="0" step="0.01" value="0"></div>
            <div class="v155-field wide"><label>Observações / justificativa da diferença</label><textarea id="v155Notes" maxlength="1000" placeholder="Obrigatório quando houver diferença acima da tolerância."></textarea></div>
          </div>
          <div id="v155Balance" class="v155-balance"></div><div id="v155Formula" class="v155-formula"></div><div id="v155Alerts"></div>
          <div class="v155-entry-head"><h4>Entradas incluídas neste ciclo</h4><span id="v155EntryCount" class="v155-chip">0 entradas</span></div><div id="v155Entries"></div>
          <div class="v155-submit"><small>A finalização grava os números, as entradas incluídas, o usuário responsável e a hora. O próximo ciclo começará exatamente no fim desta coleta.</small><button id="v155Finish" class="v155-btn blue" type="button" onclick="v155Finish()">Finalizar conferência</button></div>
        </div></article>
        <article class="v155-panel"><div class="v155-panel-head"><div><h3>Histórico das coletas</h3><p>Conferências, diferenças e relatórios.</p></div></div><div class="v155-panel-body"><div id="v155History" class="v155-history"></div></div></article>
      </div>
    </div>`;
    document.querySelector('.content')?.appendChild(section);
    document.body.insertAdjacentHTML('beforeend',`<dialog id="v155TankDialog" class="v155-dialog"><div class="v155-dialog-head"><h3 id="v155TankTitle">Cadastrar tanque</h3><button class="v155-dialog-close" type="button" onclick="v155CloseTank()">×</button></div><form id="v155TankForm" class="v155-dialog-body"><input id="v155TankId" type="hidden"><div class="v155-fields"><div class="v155-field"><label>Nome do tanque *</label><input id="v155TankName" maxlength="100" required placeholder="Ex.: Tanque principal"></div><div class="v155-field"><label>Localidade real *</label><input id="v155TankLocality" list="v155Localities" maxlength="120" required placeholder="Ex.: CATARINA-CE"><datalist id="v155Localities"></datalist></div><div class="v155-field"><label>Capacidade (L)</label><input id="v155TankCapacity" type="number" min="0" step="1" value="0"></div><div class="v155-field"><label>Atenção a partir de (L)</label><input id="v155WarnLiters" type="number" min="0" step="0.01" value="10"></div><div class="v155-field"><label>Atenção a partir de (%)</label><input id="v155WarnPercent" type="number" min="0" step="0.01" value="0.5"></div><div class="v155-field"><label>Crítico a partir de (L)</label><input id="v155CriticalLiters" type="number" min="0" step="0.01" value="25"></div><div class="v155-field"><label>Crítico a partir de (%)</label><input id="v155CriticalPercent" type="number" min="0" step="0.01" value="1"></div><div class="v155-field" id="v155ActiveWrap" style="display:none"><label>Situação</label><select id="v155TankActive"><option value="1">Ativo</option><option value="0">Inativo</option></select></div></div><div class="v155-dialog-actions"><button class="v155-btn" type="button" onclick="v155CloseTank()">Cancelar</button><button class="v155-btn blue" type="submit">Salvar tanque</button></div></form></dialog>`);
    $('v155TankSelect').addEventListener('change',e=>window.v155SelectTank(e.target.value));
    $('v155End').addEventListener('change',refreshPreview);
    $('v155Start').addEventListener('change',refreshPreview);
    ['v155TransferIn','v155Collected','v155Ending','v155TransferOut','v155Discarded'].forEach(id=>$(id).addEventListener('input',renderBalance));
    $('v155TankForm').addEventListener('submit',saveTank);
    if(typeof v4AplicarVisibilidade==='function')setTimeout(v4AplicarVisibilidade,0);
  }

  function renderKpis(){
    const now=S.now||localNow();
    const overdue=S.tanks.filter(t=>t.next_due_local&&t.next_due_local<now).length;
    const never=S.tanks.filter(t=>!t.last_end_local).length;
    const attention=S.tanks.filter(t=>['atencao','critica'].includes(t.last_status)).length;
    const ok=S.tanks.filter(t=>t.last_status==='ok').length;
    $('v155Kpis').innerHTML=`<div class="v155-kpi">${icon('M4 19h16M7 19V7h10v12M9 7V4h6v3')}<div><small>Tanques ativos</small><b>${S.tanks.length}</b></div></div><div class="v155-kpi ${overdue?'bad':'good'}">${icon('M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0')}<div><small>Coletas atrasadas</small><b>${overdue}</b></div></div><div class="v155-kpi ${attention?'warn':'good'}">${icon('M12 9v4M12 17h.01M10 3 2 19h20L14 3z')}<div><small>Com diferença</small><b>${attention}</b></div></div><div class="v155-kpi good">${icon('m5 12 4 4L19 6')}<div><small>Últimas conferidas</small><b>${ok}<small>${never} sem primeira conferência</small></b></div></div>`;
  }
  function tankTiming(t){
    if(!t.last_end_local)return {klass:'',label:'Aguardando 1ª conferência',detail:'Defina o primeiro ciclo de 48 horas'};
    const now=S.now||localNow(),hours=Core.hoursBetween(now,t.next_due_local);
    if(t.next_due_local<now)return {klass:'overdue',label:'Coleta atrasada',detail:`Prevista para ${brMoment(t.next_due_local)}`};
    if(hours<=12)return {klass:'due',label:'Coleta próxima',detail:`Prevista para ${brMoment(t.next_due_local)}`};
    return {klass:'',label:'Em dia',detail:`Próxima: ${brMoment(t.next_due_local)}`};
  }
  function renderTankStrip(){
    if(!S.tanks.length){$('v155TankStrip').innerHTML='<div class="v155-empty">Nenhum tanque cadastrado. O administrador deve cadastrar o primeiro tanque.</div>';return}
    $('v155TankStrip').innerHTML=S.tanks.map(t=>{const timing=tankTiming(t);return `<button type="button" class="v155-tank-card ${timing.klass} ${String(t.id)===String(S.selected)?'selected':''}" onclick="v155SelectTank('${E(t.id)}')"><b>${E(t.name)} • ${E(t.locality)}</b><small>${E(timing.detail)}</small>${t.last_status?statusChip(t.last_status):`<span class="v155-chip">${E(timing.label)}</span>`}</button>`}).join('');
  }
  function renderHistory(){
    const rows=S.selected?S.history.filter(x=>String(x.tank_id)===String(S.selected)):S.history;
    if(!rows.length){$('v155History').innerHTML='<div class="v155-empty">Ainda não existem conferências para este tanque.</div>';return}
    $('v155History').innerHTML=rows.map(c=>{
      const sign=N(c.difference_liters)>0?'Faltando':N(c.difference_liters)<0?'Sobra':'Diferença';
      return `<div class="v155-history-card"><div class="v155-history-top"><div><h4>${E(c.tank_name)} • ${E(c.locality)}</h4><small>${brMoment(c.start_local)} até ${brMoment(c.end_local)} • ${liters(c.cycle_hours)} h</small></div>${statusChip(c.status)}</div><div class="v155-history-values"><span>Registrado: <b>${liters(c.registered_liters)} L</b></span><span>Retirado: <b>${liters(c.truck_collected_liters)} L</b></span><span>Saldo final: <b>${liters(c.ending_balance_liters)} L</b></span><span>${sign}: <b>${liters(Math.abs(N(c.difference_liters)))} L</b></span></div><div class="v155-card-actions"><button class="v155-btn" type="button" onclick="v155Print('${E(c.id)}')">Imprimir relatório</button>${isAdmin()&&c.status!=='cancelada'?`<button class="v155-btn danger" type="button" onclick="v155Cancel('${E(c.id)}')">Cancelar</button>`:''}</div></div>`;
    }).join('');
  }
  function renderBalance(){
    const p=S.preview,t=selectedTank();
    if(!p||!t){$('v155Balance').innerHTML='';$('v155Formula').textContent='Selecione um tanque para calcular.';return null}
    const calc=Core.calculateBalance({opening:p.opening_balance_liters,registered:p.registered_liters,transfersIn:$('v155TransferIn').value,collected:$('v155Collected').value,ending:$('v155Ending').value,transfersOut:$('v155TransferOut').value,discarded:$('v155Discarded').value,warningLiters:t.warning_tolerance_liters,warningPercent:t.warning_tolerance_percent,criticalLiters:t.critical_tolerance_liters,criticalPercent:t.critical_tolerance_percent});
    const label=calc.difference>0?'Faltando':calc.difference<0?'Sobra':'Diferença';
    $('v155Balance').innerHTML=`<div><small>Disponível no ciclo</small><b>${liters(calc.available)} L</b></div><div><small>Total explicado</small><b>${liters(calc.accounted)} L</b></div><div><small>Limite de atenção</small><b>${liters(calc.warning)} L</b></div><div class="result ${calc.status}"><small>${label}</small><b>${liters(calc.absolute)} L</b>${statusChip(calc.status)}</div>`;
    $('v155Formula').innerHTML=`<b>Cálculo:</b> (${liters(calc.opening)} saldo inicial + ${liters(calc.registered)} registrado + ${liters(calc.transfersIn)} recebido) − (${liters(calc.collected)} retirado + ${liters(calc.ending)} saldo final + ${liters(calc.transfersOut)} enviado + ${liters(calc.discarded)} descarte) = <b>${calc.difference>0?'+':''}${liters(calc.difference)} L</b>`;
    const capacity=N(t.capacity_liters),capacityWarning=capacity>0&&calc.ending>capacity?`<div class="v155-alert bad"><b>Saldo acima da capacidade cadastrada</b>O tanque comporta ${liters(capacity)} L. Corrija o saldo final.</div>`:'';
    const statusWarning=calc.status==='ok'?'<div class="v155-alert good"><b>Volume dentro da tolerância</b>A conferência pode ser finalizada.</div>':`<div class="v155-alert ${calc.status==='critica'?'bad':''}"><b>${calc.status==='critica'?'Diferença crítica':'Diferença exige atenção'}</b>Revise os registros e informe uma justificativa nas observações.</div>`;
    $('v155Alerts').innerHTML=(p.pending_imports.length?`<div class="v155-alert bad"><b>Finalização bloqueada: ${p.pending_imports.length} PDF(s) pendente(s)</b>${p.pending_imports.map(x=>E(x.fileName)).join(', ')}. Conclua ou descarte esses relatórios antes da conferência.</div>`:'')+capacityWarning+statusWarning;
    $('v155Finish').disabled=!!p.pending_imports.length||!!capacityWarning;
    return calc;
  }
  function renderPreview(){
    const p=S.preview;if(!p)return;
    $('v155Start').value=p.start_local;$('v155Start').readOnly=!!p.last;
    $('v155Opening').value=p.opening_balance_liters;$('v155Registered').value=p.registered_liters;
    const cycleOk=Math.abs(N(p.cycle_hours)-48)<=2;
    $('v155Cycle').className='v155-cycle '+(cycleOk?'':'warn');
    $('v155Cycle').innerHTML=`<span><b>${cycleOk?'Ciclo correto':'Ciclo diferente de 48 horas'}:</b> ${brMoment(p.start_local)} até ${brMoment(p.end_local)}</span><strong>${liters(p.cycle_hours)} horas</strong>`;
    $('v155EntryCount').textContent=`${p.entries.length} entrada(s) • ${liters(p.registered_liters)} L`;
    $('v155Entries').innerHTML=p.entries.length?`<div class="v155-table-wrap"><table class="v155-table"><thead><tr><th>Data/hora</th><th>Produtor</th><th>Local de entrega</th><th>Litros</th><th>Origem</th></tr></thead><tbody>${p.entries.map(x=>`<tr><td><b>${E(x.data.split('-').reverse().join('/'))} ${E(x.hora)}</b><br><small>${E(x.turno||'')}</small></td><td><b>${E(x.producer_name)}</b>${x.producer_code?`<br><small>Código ${E(x.producer_code)}</small>`:''}</td><td>${E(x.locality)}</td><td><b>${liters(x.liters)} L</b></td><td>${E(x.origin||'Manual')}${x.pdf_file?`<br><small>${E(x.pdf_file)}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="v155-empty">Nenhuma entrada de leite foi encontrada nesta localidade e neste intervalo.</div>';
    renderBalance();
  }
  async function refreshPreview(){
    const id=$('v155TankSelect')?.value;if(!id)return;
    const end=$('v155End').value||S.now||localNow(),start=$('v155Start').value||Core.addHours(end,-48);
    try{
      const data=await api(`/api/tank-conferences/preview?tank_id=${encodeURIComponent(id)}&end_local=${encodeURIComponent(end)}&first_start_local=${encodeURIComponent(start)}`);
      S.preview=data.preview;renderPreview();
    }catch(e){S.preview=null;$('v155Message').innerHTML=`<div class="v155-alert bad"><b>Não foi possível montar a conferência</b>${E(e.message)}</div>`}
  }

  window.v155Open=async function(button){
    inject();
    if(typeof v4TemPermissao==='function'&&!v4TemPermissao('relatorios'))return alert('Você não possui permissão para acessar esta função.');
    showSection('conferenciaTanques',button||document.querySelector('.v155-nav-button'));
    await window.v155Load();
  };
  window.v155Load=async function(force){
    if(S.loading)return;S.loading=true;$('v155Message').innerHTML='<div class="v155-alert">Carregando tanques e conferências...</div>';
    try{
      const [tanks,history]=await Promise.all([api('/api/milk-tanks'),api('/api/tank-conferences?limit=300')]);
      S.tanks=tanks.tanks||[];S.history=history.conferences||[];S.now=tanks.now_local||localNow();
      if(!S.selected||!S.tanks.some(x=>String(x.id)===String(S.selected)))S.selected=S.tanks[0]?.id||'';
      $('v155NewTankBtn').style.display=isAdmin()?'':'none';$('v155EditTankBtn').style.display=isAdmin()&&S.selected?'':'none';
      $('v155End').value=S.now;fillTankOptions();renderKpis();renderTankStrip();renderHistory();fillLocalities();$('v155Message').innerHTML='';
      if(S.selected)await window.v155SelectTank(S.selected);else{S.preview=null;renderBalance();$('v155Entries').innerHTML='<div class="v155-empty">Cadastre um tanque para começar.</div>'}
    }catch(e){$('v155Message').innerHTML=`<div class="v155-alert bad"><b>Erro ao abrir a conferência</b>${E(e.message)}</div>`}
    finally{S.loading=false}
  };
  function fillTankOptions(){const el=$('v155TankSelect');el.innerHTML=S.tanks.length?S.tanks.map(t=>`<option value="${E(t.id)}" ${String(t.id)===String(S.selected)?'selected':''}>${E(t.name)} • ${E(t.locality)}</option>`).join(''):'<option value="">Nenhum tanque cadastrado</option>'}
  function fillLocalities(){
    const values=new Set(S.tanks.map(x=>x.locality).filter(Boolean));
    try{(produtores||[]).forEach(x=>x.local&&values.add(x.local));(lancamentos||[]).forEach(x=>x.local&&values.add(x.local))}catch(_){}
    $('v155Localities').innerHTML=[...values].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(x=>`<option value="${E(x)}"></option>`).join('');
  }
  window.v155SelectTank=async function(id){
    S.selected=String(id||'');$('v155TankSelect').value=S.selected;renderTankStrip();renderHistory();$('v155EditTankBtn').style.display=isAdmin()&&S.selected?'':'none';
    const tank=selectedTank();if(!tank)return;
    $('v155End').value=S.now||localNow();$('v155Start').value=tank.last_end_local||Core.addHours($('v155End').value,-48);$('v155Start').readOnly=!!tank.last_end_local;
    ['v155TransferIn','v155Collected','v155Ending','v155TransferOut','v155Discarded'].forEach(id=>$(id).value='0');$('v155Notes').value='';
    await refreshPreview();
  };
  window.v155Finish=async function(){
    const p=S.preview,t=selectedTank();if(!p||!t)return alert('Escolha um tanque e atualize a prévia.');
    const truck=$('v155Truck').value.trim();if(!truck)return alert('Informe o caminhão ou a placa responsável pela retirada.');
    const calc=renderBalance();if(!calc)return;
    if(calc.status!=='ok'&&!$('v155Notes').value.trim())return alert('Existe uma diferença acima da tolerância. Informe a justificativa nas observações.');
    const situation=calc.difference>0?`${liters(calc.absolute)} L faltando`:calc.difference<0?`${liters(calc.absolute)} L de sobra`:'sem diferença';
    if(!confirm(`Finalizar a conferência de ${t.name} / ${t.locality}?\n\nRegistrado: ${liters(p.registered_liters)} L\nRetirado: ${liters($('v155Collected').value)} L\nResultado: ${situation}\n\nO próximo ciclo começará em ${brMoment(p.end_local)}.`))return;
    const button=$('v155Finish'),label=button.textContent;button.disabled=true;button.textContent='Gravando conferência...';
    try{
      const body={tank_id:t.id,expected_start_local:p.start_local,expected_entry_signature:p.entry_signature,first_start_local:$('v155Start').value,end_local:$('v155End').value,truck,driver:$('v155Driver').value,route:$('v155Route').value,transfers_in_liters:N($('v155TransferIn').value),truck_collected_liters:N($('v155Collected').value),ending_balance_liters:N($('v155Ending').value),transfers_out_liters:N($('v155TransferOut').value),discarded_liters:N($('v155Discarded').value),notes:$('v155Notes').value};
      const result=await api('/api/tank-conferences',{method:'POST',body:JSON.stringify(body)});
      alert(`✅ CONFERÊNCIA FINALIZADA\n\n${Core.statusLabel(result.conference.status)}\nDiferença: ${liters(Math.abs(N(result.conference.difference_liters)))} L\nPróxima coleta prevista em 48 horas.`);
      await window.v155Load(true);
    }catch(e){alert('❌ A conferência não foi gravada.\n\n'+e.message)}finally{button.disabled=false;button.textContent=label}
  };

  window.v155OpenTank=function(id){
    if(!isAdmin())return alert('Somente o administrador pode cadastrar ou editar tanques.');
    const tank=S.tanks.find(x=>String(x.id)===String(id||''));
    $('v155TankTitle').textContent=tank?'Editar tanque':'Cadastrar tanque';$('v155TankId').value=tank?.id||'';$('v155TankName').value=tank?.name||'';$('v155TankLocality').value=tank?.locality||'';$('v155TankCapacity').value=N(tank?.capacity_liters);$('v155WarnLiters').value=tank?.warning_tolerance_liters??10;$('v155WarnPercent').value=tank?.warning_tolerance_percent??0.5;$('v155CriticalLiters').value=tank?.critical_tolerance_liters??25;$('v155CriticalPercent').value=tank?.critical_tolerance_percent??1;$('v155TankActive').value=tank?.active===false?'0':'1';$('v155ActiveWrap').style.display=tank?'grid':'none';
    $('v155TankDialog').showModal();
  };
  window.v155EditSelected=function(){if(S.selected)window.v155OpenTank(S.selected)};
  window.v155CloseTank=function(){$('v155TankDialog')?.close()};
  async function saveTank(event){
    event.preventDefault();const id=$('v155TankId').value,button=event.submitter,old=button.textContent;button.disabled=true;button.textContent='Salvando...';
    try{
      const body={name:$('v155TankName').value,locality:$('v155TankLocality').value,capacity_liters:N($('v155TankCapacity').value),warning_tolerance_liters:N($('v155WarnLiters').value),warning_tolerance_percent:N($('v155WarnPercent').value),critical_tolerance_liters:N($('v155CriticalLiters').value),critical_tolerance_percent:N($('v155CriticalPercent').value),active:$('v155TankActive').value!=='0'};
      const result=await api(id?`/api/milk-tanks/${encodeURIComponent(id)}`:'/api/milk-tanks',{method:id?'PUT':'POST',body:JSON.stringify(body)});S.selected=result.tank.id;window.v155CloseTank();await window.v155Load(true);alert('✅ Tanque salvo com segurança.');
    }catch(e){alert('❌ '+e.message)}finally{button.disabled=false;button.textContent=old}
  }
  window.v155Cancel=async function(id){
    if(!isAdmin())return;const reason=prompt('Informe o motivo do cancelamento desta conferência:','');if(reason===null)return;if(reason.trim().length<5)return alert('Informe um motivo mais completo.');
    if(!confirm('Cancelar esta conferência? O histórico será preservado e o próximo ciclo voltará a partir da conferência anterior.'))return;
    try{await api(`/api/tank-conferences/${encodeURIComponent(id)}/cancel`,{method:'POST',body:JSON.stringify({reason})});await window.v155Load(true);alert('✅ Conferência cancelada. O registro foi mantido no histórico.')}catch(e){alert('❌ '+e.message)}
  };
  window.v155Print=function(id){
    const c=S.history.find(x=>String(x.id)===String(id));if(!c)return alert('Conferência não encontrada.');
    const entries=parseList(c.entry_snapshot),difference=N(c.difference_liters),label=difference>0?'LEITE FALTANDO':difference<0?'SOBRA DE LEITE':'SEM DIFERENÇA';
    const win=window.open('','_blank','width=1100,height=900');if(!win)return alert('O navegador bloqueou a janela de impressão.');
    const rows=entries.map(x=>`<tr><td>${E(x.data?.split('-').reverse().join('/'))} ${E(x.hora)}</td><td>${E(x.producer_code||'—')}</td><td>${E(x.producer_name)}</td><td>${E(x.locality)}</td><td class="num">${liters(x.liters)} L</td></tr>`).join();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Conferência de Tanque</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:12px Arial;color:#112f50;margin:0}.brand{border-top:8px solid #ffc720;border-bottom:3px solid #0758aa;padding:14px 0;display:flex;justify-content:space-between;align-items:end}.brand h1{margin:0;font-size:25px;color:#073d78}.brand h1 span{color:#e6a800}.brand p{margin:4px 0 0}.status{padding:8px 12px;border-radius:20px;background:#e8f5ed;font-weight:bold}.meta,.totals{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:13px 0}.box{border:1px solid #cdd9e5;border-radius:8px;padding:9px}.box small{display:block;color:#60748b}.box b{display:block;margin-top:4px;font-size:14px}.result{background:#eef5fd;border:2px solid #0758aa}.result b{font-size:20px}table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#eaf1f8;text-align:left;padding:7px}td{border-bottom:1px solid #dce5ee;padding:7px}.num{text-align:right;font-weight:bold}.note{margin-top:12px;padding:10px;background:#f5f7fa;border-radius:8px}.sign{display:flex;gap:50px;margin-top:55px}.sign div{flex:1;border-top:1px solid #333;text-align:center;padding-top:6px}.foot{margin-top:17px;font-size:10px;color:#64758a;text-align:center}</style></head><body><div class="brand"><div><h1>VALE DA SERRA <span>Laticínios</span></h1><p>Relatório de Conferência de Tanque</p></div><span class="status">${E(Core.statusLabel(c.status))}</span></div><div class="meta"><div class="box"><small>Tanque / localidade</small><b>${E(c.tank_name)} • ${E(c.locality)}</b></div><div class="box"><small>Período conferido</small><b>${brMoment(c.start_local)} até ${brMoment(c.end_local)}</b></div><div class="box"><small>Caminhão / motorista</small><b>${E(c.truck||'—')} • ${E(c.driver||'—')}</b></div></div><div class="totals"><div class="box"><small>Saldo inicial</small><b>${liters(c.opening_balance_liters)} L</b></div><div class="box"><small>Entradas registradas</small><b>${liters(c.registered_liters)} L</b></div><div class="box"><small>Transferência recebida</small><b>${liters(c.transfers_in_liters)} L</b></div><div class="box"><small>Retirado pelo caminhão</small><b>${liters(c.truck_collected_liters)} L</b></div><div class="box"><small>Saldo que ficou</small><b>${liters(c.ending_balance_liters)} L</b></div><div class="box result"><small>${label}</small><b>${liters(Math.abs(difference))} L</b></div></div><b>Entradas incluídas (${entries.length})</b><table><thead><tr><th>Data/hora</th><th>Código</th><th>Produtor</th><th>Local de entrega</th><th class="num">Litros</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Nenhuma entrada no período.</td></tr>'}</tbody></table>${c.notes?`<div class="note"><b>Observações:</b> ${E(c.notes)}</div>`:''}<div class="sign"><div>Responsável pela conferência</div><div>Motorista / responsável pela coleta</div></div><div class="foot">Fechado por ${E(c.closed_by||'—')} • ${new Date(c.closed_at).toLocaleString('pt-BR')} • Código ${E(c.id)}</div><script>window.onload=()=>setTimeout(()=>window.print(),180)<\/script></body></html>`);win.document.close();
  };

  inject();
})();
