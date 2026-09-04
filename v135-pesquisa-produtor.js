(function(){
  'use strict';

  const S={id:null,tab:'resumo',statement:null,loading:false};
  const E=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const N=v=>Number(v||0);
  const money=v=>N(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const num=v=>N(v).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const date=v=>{const s=String(v||'').slice(0,10),m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:(s||'-')};
  const norm=v=>String(v||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const today=()=>new Date().toISOString().slice(0,10);
  const turn=x=>norm(x?.turno||x?.periodo||'M').startsWith('m')?'Manhã':'Tarde';
  const phone=v=>{let x=String(v||'').replace(/\D/g,'');if(x.length===10||x.length===11)x='55'+x;return x};
  const byDate=(a,b)=>String(b.data||b.business_date||b.created_at||'').localeCompare(String(a.data||a.business_date||a.created_at||''));
  const milkRate=()=>{try{return N(VALOR_LITRO)||2.30}catch(_){return 2.30}};
  const monthName=ym=>{const [y,m]=String(ym||'').split('-'),names=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];return y&&m?`${names[Number(m)-1]||m} de ${y}`:(ym||'-')};

  function permitted(permission){
    try{return typeof v4TemPermissao==='function'?v4TemPermissao(permission):true}catch(_){return true}
  }
  function admin(){
    try{return typeof v4IsAdmin==='function'&&v4IsAdmin()}catch(_){return false}
  }
  function paid(entry){
    return pagamentos.some(pg=>{
      if(Array.isArray(pg.entryIds))return pg.entryIds.some(id=>String(id)===String(entry.id));
      if(String(pg.prodId)!==String(entry.prodId)||!['1','2'].includes(String(pg.quinzena)))return false;
      const ym=String(pg.mes||''),ini=ym+(String(pg.quinzena)==='1'?'-01':'-16'),fim=ym+(String(pg.quinzena)==='1'?'-15':'-31');
      return String(entry.data||'')>=ini&&String(entry.data||'')<=fim;
    });
  }
  function debitBalance(d){
    if(String(d.situacaoPagamento||'').toLowerCase()==='liquidado'||pagamentos.some(pg=>!Array.isArray(pg.debitApplications)&&Array.isArray(pg.debitIds)&&pg.debitIds.some(id=>String(id)===String(d.id))))return 0;
    const paidValue=(pagamentosDebitos||[]).filter(x=>String(x.debitoId)===String(d.id)).reduce((s,x)=>s+N(x.valor),0);
    return Math.max(0,N(d.valor)-paidValue);
  }
  function periodLabel(q){return q===1?'1ª quinzena':'2ª quinzena'}
  function orderStatus(v){return ({pendente:'Pendente',separado:'Separado',parcial:'Liberado parcialmente',liberado:'Liberado',cancelado:'Cancelado'})[v]||v||'-'}
  function orderClass(v){return ['liberado'].includes(v)?'ok':['cancelado'].includes(v)?'bad':['separado'].includes(v)?'info':'warn'}
  function paymentName(v){return ({leite:'Descontar do leite',pix:'PIX',dinheiro:'Dinheiro',cartao:'Cartão',fiado:'Boleto / Fiado',doacao:'Doação'})[String(v||'').toLowerCase()]||v||'-'}

  function financialSnapshot(d){
    const q=d?.quinzena||{},gross=N(q.valor_bruto),calculated=N(q.descontos),open=(d?.debits||[]).reduce((s,x)=>s+debitBalance(x),0),pg=q.pagamento||null;
    const applied=q.pago&&pg?N(pg.totalDebitos):Math.min(gross,calculated),eligible=q.pago&&pg?applied:calculated,net=q.pago&&pg?N(pg.valorPago):Math.max(0,gross-applied);
    const includedRemaining=q.pago?Math.max(0,N(pg?.saldoDebitosApos)||0):Math.max(0,calculated-applied);
    const otherOpen=Math.max(0,open-calculated),base=Math.max(open,calculated),carry=q.pago?open:Math.max(0,base-applied);
    return {gross,eligible,open,applied,net,includedRemaining,otherOpen,carry};
  }

  function isoOffset(iso,days){const d=new Date(String(iso||today())+'T12:00:00');d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)}
  function previousPeriod(q){
    const ym=String(q?.mes||today().slice(0,7)),n=N(q?.numero),[y,m]=ym.split('-').map(Number);
    if(n===2)return {ini:`${ym}-01`,fim:`${ym}-15`};
    const prev=new Date(y,m-2,1),py=prev.getFullYear(),pm=String(prev.getMonth()+1).padStart(2,'0'),last=new Date(y,m-1,0).getDate();
    return {ini:`${py}-${pm}-16`,fim:`${py}-${pm}-${String(last).padStart(2,'0')}`};
  }
  function milkMetrics(d){
    const q=d?.quinzena||{},milk=d?.milk||[],ym=String(q.mes||today().slice(0,7)),nominalStart=ym+(N(q.numero)===1?'-01':'-16'),nominalEnd=String(q.fim||ym+'-31');
    const current=milk.filter(x=>String(x.data||'')>=nominalStart&&String(x.data||'')<=nominalEnd),morning=current.filter(x=>turn(x)==='Manhã').reduce((s,x)=>s+N(x.qtd),0),afternoon=current.filter(x=>turn(x)==='Tarde').reduce((s,x)=>s+N(x.qtd),0),liters=current.reduce((s,x)=>s+N(x.qtd),0),days=new Set(current.map(x=>x.data)).size;
    const start10=isoOffset(today(),-9),last10=milk.filter(x=>String(x.data||'')>=start10&&String(x.data||'')<=today()).reduce((s,x)=>s+N(x.qtd),0),prev=previousPeriod(q),previous=milk.filter(x=>String(x.data||'')>=prev.ini&&String(x.data||'')<=prev.fim).reduce((s,x)=>s+N(x.qtd),0),variation=previous?((liters-previous)/previous)*100:null,quantities=current.map(x=>N(x.qtd)).filter(x=>x>0);
    return {current,morning,afternoon,liters,days,average:days?liters/days:0,average10:last10/10,previous,variation,max:quantities.length?Math.max(...quantities):0,min:quantities.length?Math.min(...quantities):0,prev};
  }

  function localStatement(id){
    const producer=produtores.find(p=>String(p.id)===String(id));
    if(!producer)return null;
    const milk=lancamentos.filter(x=>String(x.prodId)===String(id)).map(x=>({...x,situacaoPagamento:paid(x)?'Liquidada':'Pendente'})).sort(byDate);
    const ds=debitos.filter(x=>String(x.prodId)===String(id)).sort(byDate);
    const ps=pagamentos.filter(x=>String(x.prodId)===String(id)).sort((a,b)=>String(b.dataPagamento||'').localeCompare(String(a.dataPagamento||'')));
    const day=Number(today().slice(8,10)),q=day<=15?1:2,ym=today().slice(0,7),ini=ym+(q===1?'-01':'-16'),fim=ym+(q===1?'-15':'-31');
    const pending=milk.filter(x=>x.situacaoPagamento!=='Liquidada'&&String(x.data||'')<=today());
    const liters=pending.reduce((s,x)=>s+N(x.qtd),0),debt=ds.reduce((s,x)=>s+debitBalance(x),0),gross=liters*milkRate();
    return {ok:true,producer,milk,debits:ds,payments:ps,pdv_sales:[],inventory:[],inventory_orders:[],source:'local',totals:{milk_liters:milk.reduce((s,x)=>s+N(x.qtd),0),milk_entries:milk.length,pdv_value:0,pdv_sales:0,inventory_value:0,inventory_items:0,orders:0},quinzena:{numero:q,mes:ym,inicio:pending.length?pending.reduce((a,x)=>String(x.data)<a?String(x.data):a,String(pending[0].data)):ini,fim,valor_litro:milkRate(),litros:liters,litros_saldo_anterior:pending.filter(x=>String(x.data)<ini).reduce((s,x)=>s+N(x.qtd),0),litros_periodo_atual:pending.filter(x=>String(x.data)>=ini).reduce((s,x)=>s+N(x.qtd),0),valor_bruto:gross,descontos:debt,valor_liquido:Math.max(0,gross-debt),pago:false,pagamento:null}};
  }

  async function getStatement(id){
    const fallback=localStatement(id);
    try{
      const headers=typeof v4Headers==='function'?v4Headers():{};
      const r=await fetch('/api/producers/'+encodeURIComponent(id)+'/statement',{headers,cache:'no-store'});
      const j=await r.json();
      if(!r.ok)throw new Error(j.error||'Não foi possível carregar o extrato.');
      j.payments=pagamentos.filter(x=>String(x.prodId)===String(id)).sort((a,b)=>String(b.dataPagamento||'').localeCompare(String(a.dataPagamento||'')));
      return j;
    }catch(e){
      if(fallback){fallback.warning=e.message;return fallback}
      throw e;
    }
  }

  function inject(){
    const section=document.getElementById('pesquisa');
    if(!section||document.getElementById('v135SearchApp'))return;
    section.innerHTML=`<div id="v135SearchApp" class="v135-app">
      <div class="v135-search-head">
        <div><h2>🔎 Ficha completa do produtor</h2><p>Pesquise por nome, apelido, código, localidade, tanqueiro ou WhatsApp.</p></div>
        <span class="v135-version">PESQUISA INTELIGENTE</span>
      </div>
      <div class="v135-searchbar">
        <div class="v135-searchinput"><span>🔎</span><input id="busca" autocomplete="off" placeholder="Digite qualquer dado do produtor..." oninput="renderPesquisa()"></div>
        <select id="v135SearchLocal" onchange="renderPesquisa()"><option value="">Todas as localidades</option></select>
        <button class="v135-btn light" type="button" onclick="v135ClearSearch()">Limpar</button>
      </div>
      <div id="resultadoPesquisa" class="v135-results"><div class="v135-empty"><b>Encontre o produtor em poucos segundos</b><span>Ao selecionar uma pessoa, você verá leite, pagamentos, débitos, Galpão e loja em uma só ficha.</span></div></div>
      <div id="v135Profile"></div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend',dialogs());
    injectStyle();
    fillLocalities();
  }

  function dialogs(){return `
    <dialog id="v135ProducerDialog" class="v135-dialog"><form id="v135ProducerForm" method="dialog" onsubmit="return v135SaveProducer(event)">
      <div class="v135-dialog-head"><div><h3>✏️ Editar produtor</h3><p>As alterações aparecem em toda a ficha.</p></div><button type="button" onclick="v135CloseDialog('v135ProducerDialog')">×</button></div>
      <div class="v135-formgrid">
        <label>Código do produtor<input id="v135PCode" maxlength="40" placeholder="Ex.: 00125"></label>
        <label>Nome completo<input id="v135PName" required></label>
        <label>Apelido<input id="v135PAlias" placeholder="Como é conhecido"></label>
        <label>Localidade<input id="v135PLocal" required></label>
        <label>Tanqueiro responsável<input id="v135PTanker"></label>
        <label>WhatsApp do tanqueiro<input id="v135PTankerPhone" inputmode="tel"></label>
        <label>Caminhão responsável<input id="v135PTruck"></label>
        <label>WhatsApp do produtor<input id="v135PPhone" inputmode="tel"></label>
        <label class="wide">Observações<textarea id="v135PNotes" rows="3" placeholder="Informações importantes sobre o produtor"></textarea></label>
      </div>
      <div class="v135-dialog-actions"><button type="button" class="v135-btn light" onclick="v135CloseDialog('v135ProducerDialog')">Cancelar</button><button class="v135-btn primary" type="submit">💾 Salvar alterações</button></div>
    </form></dialog>
    <dialog id="v135MilkDialog" class="v135-dialog"><form id="v135MilkForm" method="dialog" onsubmit="return v135SaveMilk(event)">
      <input id="v135MilkId" type="hidden"><input id="v135MilkMode" type="hidden">
      <div class="v135-dialog-head"><div><h3 id="v135MilkTitle">💧 Entrada de leite</h3><p id="v135MilkSubtitle"></p></div><button type="button" onclick="v135CloseDialog('v135MilkDialog')">×</button></div>
      <div id="v135MilkWarning"></div>
      <div class="v135-formgrid">
        <label>Data<input id="v135MilkDate" type="date" required></label>
        <label>Turno<select id="v135MilkTurn"><option value="M">Manhã</option><option value="T">Tarde</option></select></label>
        <label>Quantidade correta (litros)<input id="v135MilkQty" type="number" min="0.01" step="0.01" required></label>
        <label id="v135MilkReasonWrap">Motivo da correção<input id="v135MilkReason" maxlength="250" placeholder="Obrigatório ao editar"></label>
      </div>
      <div class="v135-dialog-actions"><button type="button" class="v135-btn light" onclick="v135CloseDialog('v135MilkDialog')">Cancelar</button><button id="v135MilkSave" class="v135-btn primary" type="submit">💾 Salvar</button></div>
    </form></dialog>
    <dialog id="v136DebtDialog" class="v135-dialog"><form method="dialog" onsubmit="return v136SaveDebt(event)">
      <div class="v135-dialog-head"><div><h3>🏷️ Novo débito do produtor</h3><p id="v136DebtSubtitle"></p></div><button type="button" onclick="v135CloseDialog('v136DebtDialog')">×</button></div>
      <div class="v135-formgrid"><label>Data<input id="v136DebtDate" type="date" required></label><label>Valor<input id="v136DebtValue" type="number" min="0.01" step="0.01" required></label><label class="wide">Descrição do débito<input id="v136DebtDescription" maxlength="250" placeholder="Ex.: Adiantamento ou compra manual" required></label></div>
      <div class="v135-dialog-actions"><button type="button" class="v135-btn light" onclick="v135CloseDialog('v136DebtDialog')">Cancelar</button><button class="v135-btn primary" type="submit">💾 Registrar débito</button></div>
    </form></dialog>
    <dialog id="v136PrintDialog" class="v135-dialog" style="max-width:520px"><div style="padding:20px"><div class="v135-dialog-head"><div><h3>🖨️ Imprimir / gerar comprovante</h3><p>Escolha o formato adequado para a impressora.</p></div><button type="button" onclick="v135CloseDialog('v136PrintDialog')">×</button></div><div class="v136-print-options"><button onclick="v136Print80()"><b>🧾 Cupom 80 mm</b><small>Resumo da quinzena, descontos e saldo</small></button><button onclick="v136PrintA4()"><b>📄 Relatório A4</b><small>Ficha completa com todos os históricos</small></button></div></div></dialog>
    <dialog id="v136CorrectionsDialog" class="v135-dialog"><div style="padding:20px"><div class="v135-dialog-head"><div><h3>🧭 Histórico de correções do leite</h3><p>Todas as alterações e retificações encontradas nesta ficha.</p></div><button type="button" onclick="v135CloseDialog('v136CorrectionsDialog')">×</button></div><div id="v136CorrectionsList" class="v135-list"></div></div></dialog>`}

  function injectStyle(){
    const st=document.createElement('style');st.id='v135Styles';st.textContent=`
    .v135-app{display:grid;gap:16px}.v135-search-head{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px 24px;background:linear-gradient(120deg,#082f63,#1559a0);color:#fff;border-radius:20px}.v135-search-head h2{margin:0 0 5px;font-size:25px}.v135-search-head p{margin:0;color:#dceaff}.v135-version{background:#fff2b8;color:#6c4a00;border-radius:99px;padding:8px 12px;font-size:11px;font-weight:900}.v135-searchbar{display:grid;grid-template-columns:minmax(260px,1fr) 260px auto;gap:10px;background:#fff;border:1px solid #dce5f0;border-radius:18px;padding:14px}.v135-searchinput{display:flex;gap:9px;align-items:center;border:2px solid #ccd9e8;border-radius:12px;padding:0 13px}.v135-searchinput:focus-within{border-color:#1a67bd;box-shadow:0 0 0 3px #dcecff}.v135-searchinput input,.v135-searchbar select{border:0!important;box-shadow:none!important;background:#fff;width:100%;min-height:46px}.v135-results{display:grid;gap:9px}.v135-result{display:grid;grid-template-columns:minmax(220px,1.5fr) 1fr 1fr auto;align-items:center;gap:12px;background:#fff;border:1px solid #dce5f0;border-radius:14px;padding:13px 15px;cursor:pointer;text-align:left;color:#173557}.v135-result:hover{border-color:#2c75bf;box-shadow:0 7px 18px #123f6a18}.v135-result b{display:block;color:#082f63}.v135-result small{display:block;color:#63758b;margin-top:3px}.v135-result .open{color:#0d59a5;font-weight:900}.v135-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:34px;background:#f7f9fc;border:1px dashed #c9d6e6;border-radius:17px;color:#65768a}.v135-empty b{font-size:18px;color:#173b65}.v135-profile{display:grid;gap:15px}.v135-profile-head{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;padding:20px;background:#fff;border:1px solid #dce5f0;border-radius:18px}.v135-ident{display:flex;gap:14px;align-items:center}.v135-avatar{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;background:#e5f1ff;color:#0c58a5;font-size:27px;font-weight:900}.v135-ident h2{margin:0;color:#082f63;font-size:24px}.v135-ident p{margin:5px 0 0;color:#63758b}.v135-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.v135-btn{border:0;border-radius:11px;padding:11px 14px;font-weight:850;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}.v135-btn.primary{background:#0f4d88;color:#fff}.v135-btn.success{background:#16833b;color:#fff}.v135-btn.whatsapp{background:#1ca95b;color:#fff}.v135-btn.light{background:#edf3f9;color:#17416d}.v135-btn:hover{filter:brightness(.97);transform:translateY(-1px)}.v135-tabs{display:flex;gap:7px;overflow:auto;padding:5px;background:#eaf0f7;border-radius:14px}.v135-tabs button{white-space:nowrap;border:0;background:transparent;color:#284b72;border-radius:10px;padding:11px 14px;font-weight:850;cursor:pointer}.v135-tabs button.active{background:#fff;color:#074f96;box-shadow:0 3px 9px #17395d18}.v135-panel{background:#fff;border:1px solid #dce5f0;border-radius:18px;padding:18px}.v135-kpis{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:11px}.v135-kpi{padding:15px;border:1px solid #dce6f1;background:#f8fbfe;border-radius:14px}.v135-kpi span{display:block;color:#66788d;font-size:12px;font-weight:800;text-transform:uppercase}.v135-kpi b{display:block;color:#072f61;font-size:23px;margin-top:6px}.v135-kpi small{color:#6d7f92}.v135-section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0 10px}.v135-section-title h3{margin:0;color:#0b3769}.v135-tablewrap{overflow:auto;border:1px solid #dce5f0;border-radius:14px}.v135-table{width:100%;border-collapse:collapse;min-width:760px}.v135-table th{background:#edf3f9;color:#173d68;font-size:12px;text-align:left;padding:11px}.v135-table td{padding:11px;border-top:1px solid #e4ebf3;color:#28425f;vertical-align:top}.v135-table small{display:block;color:#6d7c8c;margin-top:3px}.v135-pill{display:inline-flex;padding:5px 9px;border-radius:99px;font-size:11px;font-weight:900}.v135-pill.ok{background:#ddf6e6;color:#157235}.v135-pill.warn{background:#fff0dc;color:#a45100}.v135-pill.info{background:#dceeff;color:#0c5c9f}.v135-pill.bad{background:#ffe1e1;color:#ae2929}.v135-filter{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr)) auto;gap:9px;padding:12px;background:#f3f7fb;border-radius:14px;margin-bottom:12px}.v135-filter label,.v135-formgrid label{font-size:12px;font-weight:850;color:#315274}.v135-filter input,.v135-filter select,.v135-formgrid input,.v135-formgrid select,.v135-formgrid textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;border:1px solid #cbd8e6;border-radius:10px;padding:10px;background:#fff;color:#173557}.v135-note{padding:12px 14px;border-radius:12px;background:#eaf4ff;color:#24527d;margin:0 0 12px}.v135-note.warn{background:#fff4dd;color:#794d00}.v135-two{display:grid;grid-template-columns:1.15fr .85fr;gap:14px}.v135-list{display:grid;gap:8px}.v135-list-item{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:11px;border:1px solid #e1e8f0;border-radius:12px}.v135-list-item b{color:#153c68}.v135-list-item small{display:block;color:#68798c;margin-top:3px}.v135-dialog{border:0;border-radius:19px;padding:0;width:min(720px,calc(100vw - 24px));box-shadow:0 22px 70px #071a3260}.v135-dialog::backdrop{background:#071a327c}.v135-dialog form{padding:20px}.v135-dialog-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e0e7ef;padding-bottom:13px;margin-bottom:16px}.v135-dialog-head h3{margin:0;color:#0b3769;font-size:21px}.v135-dialog-head p{margin:4px 0 0;color:#6a7b8e}.v135-dialog-head button{border:0;background:#edf2f7;border-radius:50%;width:34px;height:34px;font-size:22px;cursor:pointer}.v135-formgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.v135-formgrid .wide{grid-column:1/-1}.v135-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.v135-correction{display:block;color:#7d5100;background:#fff3d6;border-radius:7px;padding:5px 7px;margin-top:5px}.v135-inline-total{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.v135-inline-total span{background:#eef5fb;border-radius:10px;padding:8px 11px;color:#244968;font-weight:800}.v135-offline{background:#fff2ce;color:#724900;padding:10px 13px;border-radius:11px}.v135-muted{color:#6b7d90}.v135-hidden{display:none!important}.v136-quick{display:flex;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #dce5f0;border-radius:15px;padding:11px}.v136-quick button{flex:1;min-width:160px}.v136-status{display:grid;gap:8px}.v136-status-item{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:11px;background:#eef6ff;color:#224c78}.v136-status-item.warn{background:#fff1db;color:#784a00}.v136-status-item.bad{background:#ffe7e7;color:#922424}.v136-status-item.ok{background:#e8f8ed;color:#176c35}.v136-status-item b{display:block}.v136-status-item small{display:block;margin-top:2px}.v136-finance{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.v136-finance .v135-kpi.carry{background:#fff1e5;border-color:#f1c9a7}.v136-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.v136-metric{border:1px solid #dce5ef;border-radius:12px;padding:12px;background:#fbfdff}.v136-metric small{display:block;color:#687b90;font-weight:800}.v136-metric b{display:block;color:#0a386b;font-size:18px;margin-top:4px}.v136-timeline{position:relative;padding-left:21px;display:grid;gap:8px}.v136-timeline:before{content:'';position:absolute;left:7px;top:8px;bottom:8px;border-left:2px solid #d6e2ee}.v136-event{position:relative;padding:10px 12px;background:#f8fafc;border:1px solid #e0e8f0;border-radius:11px}.v136-event:before{content:'';position:absolute;left:-20px;top:16px;width:10px;height:10px;border-radius:50%;background:#1a69b7;border:3px solid #fff}.v136-event small{display:block;color:#718197;margin-top:3px}.v136-print-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}.v136-print-options button{border:1px solid #cddaea;background:#f7faff;color:#143d6a;border-radius:14px;padding:20px;text-align:left;cursor:pointer}.v136-print-options b,.v136-print-options small{display:block}.v136-print-options b{font-size:17px}.v136-print-options small{margin-top:5px;color:#65798f}.v136-difference{font-size:12px;font-weight:900}.v136-difference.up{color:#15723a}.v136-difference.down{color:#ae3030}
    @media(max-width:1050px){.v135-kpis,.v136-finance,.v136-metrics{grid-template-columns:repeat(2,1fr)}.v135-two{grid-template-columns:1fr}.v135-filter{grid-template-columns:repeat(2,1fr)}.v135-result{grid-template-columns:1fr 1fr}.v135-result .open{display:none}}
    @media(max-width:700px){.v135-search-head,.v135-profile-head{flex-direction:column}.v135-searchbar{grid-template-columns:1fr}.v135-kpis,.v135-filter,.v135-formgrid,.v136-finance,.v136-metrics,.v136-print-options{grid-template-columns:1fr}.v135-formgrid .wide{grid-column:auto}.v135-result{grid-template-columns:1fr}.v135-actions{justify-content:flex-start}.v135-profile-head{padding:15px}.v135-panel{padding:12px}.v136-quick button{min-width:100%}}
    `;document.head.appendChild(st);
  }

  function fillLocalities(){
    const sel=document.getElementById('v135SearchLocal');if(!sel)return;
    const old=sel.value,locals=[...new Set(produtores.map(p=>String(p.local||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    sel.innerHTML='<option value="">Todas as localidades</option>'+locals.map(x=>`<option value="${E(x)}">${E(x)}</option>`).join('');sel.value=old;
  }

  window.renderPesquisa=function(){
    inject();fillLocalities();
    const out=document.getElementById('resultadoPesquisa'),input=document.getElementById('busca'),local=document.getElementById('v135SearchLocal')?.value||'';
    if(!out||!input)return;
    const q=norm(input.value),matches=produtores.filter(p=>{
      if(local&&norm(p.local)!==norm(local))return false;
      if(!q)return false;
      return norm([p.nome,p.apelido,p.codigo,p.local,p.tanqueiro,p.caminhao,p.whatsapp,p.whatsTanqueiro].join(' ')).includes(q);
    }).sort((a,b)=>String(a.nome).localeCompare(String(b.nome),'pt-BR')).slice(0,50);
    if(!q){out.innerHTML='<div class="v135-empty"><b>Digite para localizar um produtor</b><span>Você também pode pesquisar pelo WhatsApp, código ou localidade.</span></div>';return}
    if(!matches.length){out.innerHTML='<div class="v135-empty"><b>Nenhum produtor encontrado</b><span>Confira os dados digitados ou escolha outra localidade.</span></div>';return}
    out.innerHTML=matches.map(p=>`<button type="button" class="v135-result" onclick="v135OpenProducer('${E(p.id)}')"><span><b>${E(p.nome)}</b><small>${p.apelido?'Conhecido como '+E(p.apelido)+' • ':''}${p.codigo?'Código '+E(p.codigo):'Sem código cadastrado'}</small></span><span><b>📍 ${E(p.local||'-')}</b><small>Tanqueiro: ${E(p.tanqueiro||'-')}</small></span><span><b>📱 ${E(p.whatsapp||'-')}</b><small>Caminhão: ${E(p.caminhao||'-')}</small></span><span class="open">Abrir ficha →</span></button>`).join('');
  };

  window.v135ClearSearch=function(){const b=document.getElementById('busca'),l=document.getElementById('v135SearchLocal');if(b)b.value='';if(l)l.value='';S.id=null;S.statement=null;document.getElementById('v135Profile').innerHTML='';renderPesquisa();b?.focus()};
  window.v135OpenProducer=async function(id){
    S.id=String(id);S.loading=true;document.getElementById('resultadoPesquisa').innerHTML='';
    const box=document.getElementById('v135Profile');box.innerHTML='<div class="v135-empty"><b>Carregando ficha completa...</b><span>Reunindo leite, débitos, pagamentos, Galpão e loja.</span></div>';
    try{S.statement=await getStatement(id);renderProfile()}catch(e){box.innerHTML=`<div class="v135-empty"><b>Não foi possível abrir a ficha</b><span>${E(e.message)}</span></div>`}finally{S.loading=false}
  };

  function renderProfile(){
    const d=S.statement,p=d?.producer,box=document.getElementById('v135Profile');if(!p||!box)return;
    const initials=String(p.nome||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    const canProducer=permitted('produtores'),canEntry=permitted('entradas');
    box.innerHTML=`<div class="v135-profile">
      ${d.warning?`<div class="v135-offline">⚠️ A ficha local foi aberta, mas compras do Galpão/loja podem não aparecer agora: ${E(d.warning)}</div>`:''}
      <div class="v135-profile-head"><div class="v135-ident"><div class="v135-avatar">${E(initials)}</div><div><h2>${E(p.nome)}</h2><p>${p.codigo?'Código '+E(p.codigo)+' • ':''}${p.apelido?'Apelido: '+E(p.apelido)+' • ':''}📍 ${E(p.local||'Sem localidade')} • <span class="v135-pill ${statusProd(p.id)==='Ativo'?'ok':'warn'}">${E(statusProd(p.id))}</span></p></div></div>
        <div class="v135-actions">${canProducer?'<button class="v135-btn light" onclick="v135EditProducer()">✏️ Editar cadastro</button>':''}${canEntry?'<button class="v135-btn success" onclick="v135NewMilk()">💧 Nova entrada</button>':''}<button class="v135-btn light" onclick="v136PrintMenu()">🖨️ Imprimir / comprovante</button><button class="v135-btn whatsapp" onclick="v135WhatsProducer()">📲 Compartilhar resumo</button></div></div>
      <div class="v136-quick">${permitted('debitos')?'<button class="v135-btn light" onclick="v136NewDebt()">🏷️ Novo débito</button>':''}${permitted('estoque')?'<button class="v135-btn light" onclick="v136NewOrder()">📦 Novo pedido do Galpão</button>':''}${permitted('pagamentos')?'<button class="v135-btn light" onclick="v136OpenPayment()">💰 Abrir pagamento individual</button>':''}<button class="v135-btn light" onclick="v136ShowCorrections()">🧭 Ver correções do leite</button></div>
      <div class="v135-tabs">${[['resumo','📊 Resumo'],['leite','💧 Leite'],['pedidos','📦 Pedidos / Galpão'],['loja','🛒 Loja / PDV'],['debitos','🏷️ Débitos'],['pagamentos','💰 Pagamentos']].map(([id,label])=>`<button class="${S.tab===id?'active':''}" onclick="v135Tab('${id}')">${label}</button>`).join('')}</div>
      <div id="v135TabPanel" class="v135-panel">${tabHtml(d,S.tab)}</div>
    </div>`;
    if(S.tab==='leite')setDefaultMilkDates(false);
  }
  window.v135Tab=function(tab){S.tab=tab;renderProfile()};

  function tabHtml(d,tab){
    if(tab==='leite')return milkHtml(d);
    if(tab==='pedidos')return inventoryHtml(d);
    if(tab==='loja')return storeHtml(d);
    if(tab==='debitos')return debtsHtml(d);
    if(tab==='pagamentos')return paymentsHtml(d);
    return summaryHtml(d);
  }

  function summaryHtml(d){
    const p=d.producer,q=d.quinzena||{},milk=d.milk||[],pending=milk.filter(x=>String(x.situacaoPagamento)!=='Liquidada'),last=milk[0],f=financialSnapshot(d),m=milkMetrics(d),activeOrders=(d.inventory_orders||[]).filter(x=>['pendente','separado','parcial'].includes(String(x.status))),alerts=[];
    if(N(q.litros_saldo_anterior)>0)alerts.push({kind:'warn',icon:'⏳',title:`${num(q.litros_saldo_anterior)} L vieram de período anterior`,text:'Esse leite ainda não foi pago e entrou automaticamente no cálculo atual.'});
    if(f.eligible>f.gross)alerts.push({kind:'bad',icon:'⚠️',title:'Os descontos são maiores que o valor do leite',text:`O leite consegue abater ${money(f.applied)}. Restam ${money(f.includedRemaining)} dos descontos desta quinzena e o saldo total estimado em aberto será ${money(f.carry)}.`});
    else if(f.eligible>0)alerts.push({kind:'warn',icon:'🏷️',title:`${money(f.applied)} serão descontados nesta quinzena`,text:`Total de débitos registrado em aberto: ${money(f.open)}.`});
    if(activeOrders.length)alerts.push({kind:'info',icon:'📦',title:`${activeOrders.length} pedido(s) ativo(s) no Galpão`,text:'Existem mercadorias aguardando separação ou liberação.'});
    if(!phone(p.whatsapp))alerts.push({kind:'warn',icon:'📱',title:'WhatsApp não cadastrado',text:'Cadastre o número para compartilhar resumos e comprovantes.'});
    if(!alerts.length)alerts.push({kind:'ok',icon:'✅',title:'Situação regular',text:'Não foram encontrados avisos importantes para este produtor.'});
    return `<div class="v135-kpis">
      <div class="v135-kpi"><span>Leite acumulado no histórico</span><b>${num(d.totals?.milk_liters)} L</b><small>${d.totals?.milk_entries||0} entrada(s) registradas</small></div>
      <div class="v135-kpi"><span>Leite ainda não pago</span><b>${num(pending.reduce((s,x)=>s+N(x.qtd),0))} L</b><small>${pending.length} entrada(s) pendentes</small></div>
      <div class="v135-kpi"><span>Total de débitos em aberto</span><b>${money(f.open)}</b><small>${(d.debits||[]).filter(x=>debitBalance(x)>0).length} débito(s) com saldo</small></div>
      <div class="v135-kpi"><span>Última entrada</span><b>${last?num(last.qtd)+' L':'-'}</b><small>${last?date(last.data)+' • '+turn(last):'Nenhuma entrada'}</small></div>
    </div>
    <div class="v135-section-title"><h3>Situação atual</h3></div><div class="v136-status">${alerts.map(a=>`<div class="v136-status-item ${a.kind}"><span>${a.icon}</span><span><b>${E(a.title)}</b><small>${E(a.text)}</small></span></div>`).join('')}</div>
    <div class="v135-section-title"><h3>Quinzena atual e saldos anteriores</h3></div>
    <div class="v135-note ${q.pago?'':'warn'}"><b>${periodLabel(N(q.numero))} de ${E(monthName(q.mes))}</b> • período apresentado de ${date(q.inicio)} a ${date(q.fim)} • ${q.pago?'Pagamento já finalizado':'Pagamento ainda pendente'}</div>
    <div class="v136-finance">
      <div class="v135-kpi"><span>Leite pendente do período anterior</span><b>${num(q.litros_saldo_anterior)} L</b></div><div class="v135-kpi"><span>Leite desta quinzena</span><b>${num(q.litros_periodo_atual)} L</b></div><div class="v135-kpi"><span>Valor bruto do leite</span><b>${money(f.gross)}</b></div><div class="v135-kpi"><span>Débitos incluídos agora</span><b>${money(f.eligible)}</b><small>Aplicação possível: ${money(f.applied)}</small></div><div class="v135-kpi"><span>Líquido previsto</span><b>${money(f.net)}</b></div><div class="v135-kpi carry"><span>Saldo devedor para depois</span><b>${money(f.carry)}</b><small>${f.otherOpen?`${money(f.otherOpen)} não incluídos neste cálculo`:f.carry?'Será levado para o próximo pagamento':'Nenhum saldo restante'}</small></div>
    </div>
    <div class="v135-section-title"><h3>Indicadores do leite nesta quinzena</h3><span class="v136-difference ${m.variation===null?'':m.variation>=0?'up':'down'}">${m.variation===null?'Sem comparação anterior':`${m.variation>=0?'▲':'▼'} ${num(Math.abs(m.variation))}% comparado à quinzena anterior`}</span></div>
    <div class="v136-metrics"><div class="v136-metric"><small>Manhã</small><b>${num(m.morning)} L</b></div><div class="v136-metric"><small>Tarde</small><b>${num(m.afternoon)} L</b></div><div class="v136-metric"><small>Média dos últimos 10 dias</small><b>${num(m.average10)} L/dia</b></div><div class="v136-metric"><small>Média por dia com entrega</small><b>${num(m.average)} L</b></div><div class="v136-metric"><small>Dias com entrega</small><b>${m.days}</b></div><div class="v136-metric"><small>Maior entrada</small><b>${num(m.max)} L</b></div><div class="v136-metric"><small>Menor entrada</small><b>${num(m.min)} L</b></div><div class="v136-metric"><small>Quinzena anterior</small><b>${num(m.previous)} L</b></div></div>
    <div class="v135-two"><div><div class="v135-section-title"><h3>Dados do cadastro</h3></div><div class="v135-list">
      ${infoRow('Código',p.codigo||'-')}${infoRow('Apelido',p.apelido||'-')}${infoRow('Localidade',p.local||'-')}${infoRow('WhatsApp',p.whatsapp||'-')}${infoRow('Tanqueiro',p.tanqueiro||'-')}${infoRow('WhatsApp do tanqueiro',p.whatsTanqueiro||'-')}${infoRow('Caminhão',p.caminhao||'-')}${p.observacoes?infoRow('Observações',p.observacoes):''}
    </div></div><div><div class="v135-section-title"><h3>Movimentação comercial</h3></div><div class="v135-list">${infoRow('Pedidos do Galpão',String((d.inventory_orders||[]).length))}${infoRow('Pedidos ainda ativos',String(activeOrders.length))}${infoRow('Retiradas no Galpão',String(d.totals?.inventory_items||0))}${infoRow('Valor no Galpão',money(d.totals?.inventory_value))}${infoRow('Compras na loja',String(d.totals?.pdv_sales||0))}${infoRow('Valor na loja',money(d.totals?.pdv_value))}</div></div></div>
    <div class="v135-section-title"><h3>Linha do tempo do produtor</h3><small>Últimas movimentações registradas</small></div>${timelineHtml(d)}`;
  }
  function infoRow(a,b){return `<div class="v135-list-item"><span><b>${E(a)}</b></span><strong>${E(b)}</strong></div>`}
  function timelineHtml(d){
    const rows=[];
    (d.milk||[]).forEach(x=>rows.push({at:x.data,icon:'💧',title:`Entrada de ${num(x.qtd)} L — ${turn(x)}`,text:x.ajusteDe?`Ajuste referente a ${date(x.dataReferencia)}`:`${x.situacaoPagamento==='Liquidada'?'Leite liquidado':'Leite ainda pendente'}`}));
    (d.debits||[]).forEach(x=>rows.push({at:x.data,icon:'🏷️',title:`Débito de ${money(x.valor)}`,text:`${x.descricao||'Débito'} • saldo ${money(debitBalance(x))}`}));
    (d.inventory_orders||[]).forEach(x=>rows.push({at:x.created_at,icon:'📦',title:`Pedido #${String(x.id||'').slice(0,8).toUpperCase()} — ${orderStatus(x.status)}`,text:(x.items||[]).map(i=>`${i.product_name} ${num(i.quantity)} ${i.unit||'un'}`).join(' • ')}));
    (d.pdv_sales||[]).forEach(x=>rows.push({at:x.created_at||x.business_date,icon:'🛒',title:`Compra na loja — ${money(x.total)}`,text:(x.items||[]).map(i=>`${i.product_name} ${num(i.quantity)}`).join(' • ')}));
    (d.payments||[]).forEach(x=>rows.push({at:x.dataPagamento,icon:'💰',title:`Pagamento da ${x.quinzena}ª quinzena — ${money(x.valorPago)}`,text:`${num(x.litros)} L • descontos ${money(x.totalDebitos)}`}));
    rows.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
    return `<div class="v136-timeline">${rows.slice(0,12).map(x=>`<div class="v136-event"><b>${x.icon} ${E(x.title)}</b><small>${date(x.at)} • ${E(x.text||'-')}</small></div>`).join('')||'<div class="v135-empty">Nenhuma movimentação encontrada.</div>'}</div>`;
  }

  function milkHtml(d){
    const canEdit=permitted('edicao');
    return `<div class="v135-section-title"><h3>Relatório detalhado de leite</h3>${permitted('entradas')?'<button class="v135-btn success" onclick="v135NewMilk()">＋ Nova entrada</button>':''}</div>
      <div class="v135-filter"><label>Data inicial<input id="v135MilkStart" type="date" onchange="v135FilterMilk()"></label><label>Data final<input id="v135MilkEnd" type="date" onchange="v135FilterMilk()"></label><label>Turno<select id="v135MilkTurnFilter" onchange="v135FilterMilk()"><option value="">Manhã e tarde</option><option value="M">Manhã</option><option value="T">Tarde</option></select></label><label>Situação<select id="v135MilkStatus" onchange="v135FilterMilk()"><option value="">Todas</option><option value="Pendente">Pendente</option><option value="Liquidada">Liquidada / paga</option></select></label><div class="v135-actions"><button class="v135-btn light" onclick="v135ResetMilkFilter()">Este mês</button><button class="v135-btn light" onclick="v135AllMilk()">Todo o histórico</button></div></div>
      <div id="v135MilkTotals"></div><div class="v135-tablewrap"><table class="v135-table"><thead><tr><th>Data</th><th>Turno</th><th>Litros</th><th>Tipo</th><th>Situação</th><th>Histórico</th>${canEdit?'<th>Ação</th>':''}</tr></thead><tbody id="v135MilkRows"></tbody></table></div>`;
  }

  function filteredMilk(){
    const a=document.getElementById('v135MilkStart')?.value||'',b=document.getElementById('v135MilkEnd')?.value||'',t=document.getElementById('v135MilkTurnFilter')?.value||'',s=document.getElementById('v135MilkStatus')?.value||'';
    return (S.statement?.milk||[]).filter(x=>(!a||String(x.data)>=a)&&(!b||String(x.data)<=b)&&(!t||(t==='M'?turn(x)==='Manhã':turn(x)==='Tarde'))&&(!s||String(x.situacaoPagamento)===s)).sort(byDate);
  }
  function setDefaultMilkDates(set=true){
    const a=document.getElementById('v135MilkStart'),b=document.getElementById('v135MilkEnd');if(!a||!b)return;
    if(set||(!a.value&&!b.value)){const d=new Date(),first=new Date(d.getFullYear(),d.getMonth(),1);a.value=first.toLocaleDateString('en-CA');b.value=today()}
    v135FilterMilk();
  }
  window.v135FilterMilk=function(){
    const body=document.getElementById('v135MilkRows'),tot=document.getElementById('v135MilkTotals');if(!body||!tot)return;
    const rows=filteredMilk(),morning=rows.filter(x=>turn(x)==='Manhã').reduce((s,x)=>s+N(x.qtd),0),afternoon=rows.filter(x=>turn(x)==='Tarde').reduce((s,x)=>s+N(x.qtd),0),total=morning+afternoon,canEdit=permitted('edicao');
    tot.innerHTML=`<div class="v135-inline-total"><span>Total: ${num(total)} L</span><span>Manhã: ${num(morning)} L</span><span>Tarde: ${num(afternoon)} L</span><span>${rows.length} entrada(s)</span></div>`;
    body.innerHTML=rows.map(x=>{const settled=String(x.situacaoPagamento)==='Liquidada',cor=(x.retificacoes||[]).slice(-1)[0];return `<tr><td><b>${date(x.data)}</b>${x.dataReferencia?`<small>Referente a ${date(x.dataReferencia)}</small>`:''}</td><td>${turn(x)}</td><td><b>${num(x.qtd)} L</b></td><td>${x.ajusteDe?'<span class="v135-pill info">Ajuste</span>':'Entrada normal'}</td><td><span class="v135-pill ${settled?'ok':'warn'}">${settled?'LIQUIDADA':'PENDENTE'}</span></td><td>${x.motivo?E(x.motivo):'-'}${cor?`<span class="v135-correction">Retificação: ${num(cor.de)} L → ${num(cor.para)} L<br>${E(cor.motivo||'')}</span>`:''}</td>${canEdit?`<td><button class="v135-btn light" onclick="v135EditMilk('${E(x.id)}')">✏️ ${settled?'Corrigir':'Editar'}</button></td>`:''}</tr>`}).join('')||`<tr><td colspan="${canEdit?7:6}">Nenhuma entrada encontrada neste filtro.</td></tr>`;
  };
  window.v135ResetMilkFilter=function(){setDefaultMilkDates(true);const t=document.getElementById('v135MilkTurnFilter'),s=document.getElementById('v135MilkStatus');if(t)t.value='';if(s)s.value='';v135FilterMilk()};
  window.v135AllMilk=function(){const a=document.getElementById('v135MilkStart'),b=document.getElementById('v135MilkEnd'),t=document.getElementById('v135MilkTurnFilter'),s=document.getElementById('v135MilkStatus');if(a)a.value='';if(b)b.value='';if(t)t.value='';if(s)s.value='';v135FilterMilk()};

  function inventoryHtml(d){
    const orders=(d.inventory_orders||[]).slice().sort(byDate),moves=(d.inventory||[]).slice().sort(byDate);
    return `<div class="v135-section-title"><h3>Pedidos do Galpão</h3><button class="v135-btn primary" onclick="go('estoque')">Abrir Estoque / Galpão</button></div>
      <div class="v135-tablewrap"><table class="v135-table"><thead><tr><th>Pedido</th><th>Data</th><th>Produtos</th><th>Pagamento</th><th>Total</th><th>Status</th></tr></thead><tbody>${orders.map(o=>`<tr><td><b>#${E(String(o.id||'').slice(0,8).toUpperCase())}</b></td><td>${date(o.created_at)}</td><td>${(o.items||[]).map(i=>`${E(i.product_name)} — ${num(i.quantity)} ${E(i.unit||'un')}${N(i.released_quantity)>0?` <small>Liberado: ${num(i.released_quantity)}</small>`:''}`).join('<br>')||'-'}</td><td>${E(paymentName(o.payment_method))}</td><td><b>${money(o.total)}</b></td><td><span class="v135-pill ${orderClass(o.status)}">${E(orderStatus(o.status))}</span></td></tr>`).join('')||'<tr><td colspan="6">Nenhum pedido encontrado para este produtor.</td></tr>'}</tbody></table></div>
      <div class="v135-section-title"><h3>Produtos já retirados / liberados</h3><strong>${moves.length} movimentação(ões)</strong></div>
      <div class="v135-tablewrap"><table class="v135-table"><thead><tr><th>Data</th><th>Produto</th><th>Quantidade</th><th>Valor</th><th>Informação</th></tr></thead><tbody>${moves.map(x=>`<tr><td>${date(x.business_date||x.created_at)}</td><td><b>${E(x.product_name||'-')}</b></td><td>${num(x.quantity)} ${E(x.unit||'un')}</td><td>${money(N(x.quantity)*N(x.unit_price))}</td><td>${E(x.destination||'-')}</td></tr>`).join('')||'<tr><td colspan="5">Nenhuma retirada encontrada.</td></tr>'}</tbody></table></div>`;
  }

  function storeHtml(d){const sales=(d.pdv_sales||[]).slice().sort(byDate);return `<div class="v135-section-title"><h3>Compras na Loja / PDV</h3><strong>${sales.length} venda(s) • ${money(sales.reduce((s,x)=>s+N(x.total),0))}</strong></div><div class="v135-tablewrap"><table class="v135-table"><thead><tr><th>Data</th><th>Produtos</th><th>Pagamento</th><th>Atendente</th><th>Total</th></tr></thead><tbody>${sales.map(x=>`<tr><td>${date(x.business_date||x.created_at)}</td><td>${(x.items||[]).map(i=>`${E(i.product_name)} — ${num(i.quantity)} × ${money(i.unit_price)}`).join('<br>')||'-'}</td><td>${E(paymentName(x.payment_method))}</td><td>${E(x.username||'-')}</td><td><b>${money(x.total)}</b></td></tr>`).join('')||'<tr><td colspan="5">Nenhuma compra na loja encontrada.</td></tr>'}</tbody></table></div>`}

  function debtsHtml(d){const ds=(d.debits||[]).slice().sort(byDate),total=ds.reduce((s,x)=>s+N(x.valor),0),open=ds.reduce((s,x)=>s+debitBalance(x),0);return `<div class="v135-section-title"><h3>Débitos e descontos</h3><strong>Em aberto: ${money(open)}</strong></div><div class="v135-inline-total"><span>Total lançado: ${money(total)}</span><span>Total quitado: ${money(total-open)}</span><span>Saldo: ${money(open)}</span></div><div class="v135-tablewrap"><table class="v135-table"><thead><tr><th>Data</th><th>Origem</th><th>Descrição / produtos</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Situação</th></tr></thead><tbody>${ds.map(x=>{const bal=debitBalance(x),origin=x.origem==='galpao'?'Galpão':x.origem==='pdv'?'Loja / PDV':x.origem==='ajuste_leite'?'Ajuste de leite':'Manual';return `<tr><td>${date(x.data)}</td><td><span class="v135-pill info">${E(origin)}</span></td><td><b>${E(x.descricao||'-')}</b>${(x.itens||[]).map(i=>`<small>${E(i.produto)} — ${num(i.quantidade)} ${E(i.unidade||'un')} • ${money(i.subtotal)}</small>`).join('')}</td><td>${money(x.valor)}</td><td>${money(N(x.valor)-bal)}</td><td><b>${money(bal)}</b></td><td><span class="v135-pill ${bal<=0?'ok':'warn'}">${bal<=0?'QUITADO':'PENDENTE'}</span></td></tr>`}).join('')||'<tr><td colspan="7">Nenhum débito encontrado.</td></tr>'}</tbody></table></div>`}

  function paymentsHtml(d){const ps=(d.payments||[]).slice();return `<div class="v135-section-title"><h3>Histórico de pagamentos do leite</h3><strong>${ps.length} pagamento(s)</strong></div><div class="v135-tablewrap"><table class="v135-table"><thead><tr><th>Mês / quinzena</th><th>Pago até</th><th>Litros</th><th>Bruto</th><th>Débitos aplicados</th><th>Saldo devedor</th><th>Líquido</th><th>Data do pagamento</th></tr></thead><tbody>${ps.map(x=>`<tr><td><b>${E(monthName(x.mes))} • ${E(x.quinzena)}ª quinzena</b><small>${E(x.localidade||d.producer.local||'-')}</small></td><td>${date(x.corteData||'')}<small>${E(x.corteTurno||'Dia completo')}</small></td><td>${num(x.litros)} L</td><td>${money(x.valorBruto)}</td><td>${money(x.totalDebitos)}</td><td><b>${money(x.saldoDebitosApos)}</b></td><td><b>${money(x.valorPago)}</b></td><td>${date(x.dataPagamento)}</td></tr>`).join('')||'<tr><td colspan="8">Nenhum pagamento finalizado para este produtor.</td></tr>'}</tbody></table></div>`}

  window.v135EditProducer=function(){
    if(!permitted('produtores'))return alert('Você não possui permissão para editar produtores.');
    const p=S.statement?.producer;if(!p)return;
    v135PCode.value=p.codigo||'';v135PName.value=p.nome||'';v135PAlias.value=p.apelido||'';v135PLocal.value=p.local||'';v135PTanker.value=p.tanqueiro||'';v135PTankerPhone.value=p.whatsTanqueiro||'';v135PTruck.value=p.caminhao||'';v135PPhone.value=p.whatsapp||'';v135PNotes.value=p.observacoes||'';v135ProducerDialog.showModal();
  };
  window.v135SaveProducer=async function(ev){
    ev.preventDefault();const old=produtores.find(x=>String(x.id)===S.id);if(!old)return false;
    const updated={...old,codigo:v135PCode.value.trim(),nome:v135PName.value.trim(),apelido:v135PAlias.value.trim(),local:v135PLocal.value.trim(),tanqueiro:v135PTanker.value.trim(),whatsTanqueiro:v135PTankerPhone.value.trim(),caminhao:v135PTruck.value.trim(),whatsapp:v135PPhone.value.trim(),observacoes:v135PNotes.value.trim()};
    if(!updated.nome||!updated.local){alert('Informe o nome e a localidade.');return false}
    produtores=produtores.map(x=>String(x.id)===S.id?updated:x);v25Audit('PRODUTOR_EDITADO',{produtor:updated.nome,motivo:'Atualização pela ficha completa',antes:old,depois:updated});v135ProducerDialog.close();await persistAndReload('Cadastro atualizado com sucesso.');return false;
  };

  window.v135NewMilk=function(){
    if(!permitted('entradas'))return alert('Você não possui permissão para registrar entradas.');
    v135MilkId.value='';v135MilkMode.value='new';v135MilkTitle.textContent='💧 Nova entrada de leite';v135MilkSubtitle.textContent=S.statement?.producer?.nome||'';v135MilkDate.disabled=false;v135MilkTurn.disabled=false;v135MilkDate.value=today();v135MilkTurn.value='M';v135MilkQty.value='';v135MilkReason.value='';v135MilkReason.required=false;v135MilkReasonWrap.classList.add('v135-hidden');v135MilkWarning.innerHTML='<div class="v135-note">A nova entrada será criada como pendente e entrará no próximo pagamento compatível com o corte.</div>';v135MilkSave.textContent='💾 Registrar entrada';v135MilkDialog.showModal();
  };
  window.v135EditMilk=function(id){
    if(!permitted('edicao'))return alert('Você não possui permissão para editar entradas.');
    const x=lancamentos.find(a=>String(a.id)===String(id));if(!x)return alert('Entrada não encontrada.');const settled=paid(x);
    if(settled&&!admin())return alert('Esta entrada já foi paga. Somente o Administrador pode criar uma correção para a próxima quinzena.');
    v135MilkId.value=x.id;v135MilkMode.value=settled?'correct-paid':'edit';v135MilkTitle.textContent=settled?'🧾 Corrigir entrada já paga':'✏️ Editar entrada pendente';v135MilkSubtitle.textContent=`${S.statement?.producer?.nome||''} • ${date(x.data)} • ${turn(x)}`;v135MilkDate.value=String(x.data||'').slice(0,10);v135MilkTurn.value=turn(x)==='Manhã'?'M':'T';v135MilkQty.value=N(x.qtd);v135MilkReason.value='';v135MilkReason.required=true;v135MilkReasonWrap.classList.remove('v135-hidden');v135MilkDate.disabled=settled;v135MilkTurn.disabled=settled;v135MilkWarning.innerHTML=settled?'<div class="v135-note warn"><b>Pagamento já fechado:</b> o lançamento original será preservado. Se a quantidade aumentar, será criado leite adicional pendente. Se diminuir, será criado um débito de acerto para a próxima quinzena.</div>':'<div class="v135-note">Esta entrada ainda não foi paga. Data, turno e litros podem ser corrigidos diretamente, e o motivo ficará no histórico.</div>';v135MilkSave.textContent=settled?'✓ Criar correção pendente':'💾 Salvar correção';v135MilkDialog.showModal();
  };
  window.v135SaveMilk=async function(ev){
    ev.preventDefault();const mode=v135MilkMode.value,p=S.statement?.producer;if(!p)return false;const qty=N(v135MilkQty.value),reason=v135MilkReason.value.trim();
    if(!(qty>0)){alert('Informe uma quantidade maior que zero.');return false}
    if(mode==='new'){
      const t=v135MilkTurn.value||'M',entry={id:crypto.randomUUID(),data:v135MilkDate.value,prodId:p.id,qtd:qty,periodo:t,turno:t==='M'?'Manhã':'Tarde',situacaoPagamento:'Pendente',local:p.local,tanqueiro:p.tanqueiro,caminhao:p.caminhao};lancamentos.push(entry);v25Audit('LEITE_ENTRADA_REGISTRADA',{produtor:p.nome,litros:qty,data:entry.data,turno:entry.turno,origem:'ficha completa'});
    }else{
      const x=lancamentos.find(a=>String(a.id)===String(v135MilkId.value));if(!x)return false;if(!reason){alert('Informe o motivo da correção.');return false}const before={data:x.data,turno:turn(x),qtd:N(x.qtd)};
      if(mode==='edit'){
        const t=v135MilkTurn.value||'M';x.data=v135MilkDate.value;x.periodo=t;x.turno=t==='M'?'Manhã':'Tarde';x.qtd=qty;x.correcoes=[...(x.correcoes||[]),{em:new Date().toISOString(),motivo:reason,antes:before,depois:{data:x.data,turno:x.turno,qtd:qty}}];v25Audit('LEITE_ENTRADA_EDITADA',{produtor:p.nome,entradaId:x.id,motivo:reason,antes:before,depois:{data:x.data,turno:x.turno,qtd:qty}});
      }else{
        const difference=qty-N(x.qtd);if(Math.abs(difference)<0.000001){alert('A quantidade correta é igual à quantidade já paga. Nenhuma correção foi necessária.');return false}
        const rate=N(pagamentos.find(pg=>Array.isArray(pg.entryIds)&&pg.entryIds.some(i=>String(i)===String(x.id)))?.valorLitro)||milkRate(),stamp={em:new Date().toISOString(),motivo:reason,de:N(x.qtd),para:qty,efeito:difference>0?'acrescimo_leite':'debito_acerto'};x.retificacoes=[...(x.retificacoes||[]),stamp];
        if(difference>0){lancamentos.push({id:'aj_leite_'+crypto.randomUUID(),data:today(),prodId:p.id,qtd:difference,periodo:x.periodo||'M',turno:turn(x),situacaoPagamento:'Pendente',local:p.local,tanqueiro:p.tanqueiro,caminhao:p.caminhao,tipo:'ajuste',ajusteDe:x.id,dataReferencia:x.data,motivo:`Correção de entrada paga: ${reason}`})}
        else{debitos.push({id:'deb_aj_leite_'+crypto.randomUUID(),prodId:p.id,data:today(),descricao:`Acerto de leite pago (${date(x.data)}): ${num(Math.abs(difference))} L × ${money(rate)} — ${reason}`,valor:Math.abs(difference)*rate,origem:'ajuste_leite',entryId:x.id,litrosAjustados:Math.abs(difference),valorLitro:rate})}
        v25Audit('LEITE_ENTRADA_CORRIGIDA',{produtor:p.nome,entradaId:x.id,motivo:reason,antes:before,depois:{qtd:qty},efeito:difference>0?`Acréscimo pendente de ${num(difference)} L`:`Débito pendente de ${money(Math.abs(difference)*rate)}`});
      }
    }
    v135MilkDialog.close();await persistAndReload(mode==='new'?'Entrada registrada com sucesso.':'Correção salva e registrada no histórico.');return false;
  };

  async function persistAndReload(message){
    save();
    try{
      const headers=typeof v4Headers==='function'?v4Headers():{'Content-Type':'application/json'};
      headers['Content-Type']='application/json';
      const r=await fetch('/api/state',{method:'PUT',headers,body:JSON.stringify({data:{produtores,lancamentos,pagamentos,debitos,pagamentosDebitos}})});
      if(!r.ok)throw new Error('O servidor não confirmou a sincronização.');
      S.statement=await getStatement(S.id);renderProfile();alert('✅ '+message);
    }catch(e){S.statement=localStatement(S.id);renderProfile();alert('✅ Alteração salva neste aparelho.\n\n⚠️ '+e.message+' O sistema tentará sincronizar novamente automaticamente.')}
  }

  window.v135CloseDialog=id=>document.getElementById(id)?.close();
  window.v136NewDebt=function(){
    if(!permitted('debitos'))return alert('Você não possui permissão para registrar débitos.');
    const p=S.statement?.producer;if(!p)return;v136DebtSubtitle.textContent=p.nome;v136DebtDate.value=today();v136DebtValue.value='';v136DebtDescription.value='';v136DebtDialog.showModal();
  };
  window.v136SaveDebt=async function(ev){
    ev.preventDefault();const p=S.statement?.producer,value=N(v136DebtValue.value),description=v136DebtDescription.value.trim();if(!p)return false;if(!(value>0)||!description){alert('Informe a descrição e um valor maior que zero.');return false}
    debitos.push({id:'deb_manual_'+crypto.randomUUID(),prodId:p.id,data:v136DebtDate.value,descricao:description,valor:value,origem:'manual',situacaoPagamento:'Pendente'});v25Audit('DEBITO_CRIADO',{produtor:p.nome,descricao:description,valor:value,data:v136DebtDate.value,origem:'ficha completa'});v136DebtDialog.close();await persistAndReload('Débito registrado com sucesso.');return false;
  };
  window.v136NewOrder=function(){
    if(!permitted('estoque'))return alert('Você não possui permissão para criar pedidos no Galpão.');const p=S.statement?.producer;if(!p)return;
    if(typeof go==='function')go('estoque');setTimeout(()=>{if(typeof v136NovoPedidoProdutor==='function')v136NovoPedidoProdutor(p.id);else alert('Abra a opção Gerar pedido no Galpão e selecione o produtor.')},120);
  };
  window.v136OpenPayment=function(){
    if(!permitted('pagamentos'))return alert('Você não possui permissão para acessar pagamentos.');const p=S.statement?.producer,q=S.statement?.quinzena||{};if(!p)return;if(q.pago&&!confirm('A quinzena atual deste produtor já aparece como paga. Deseja abrir o histórico de pagamentos mesmo assim?'))return;
    if(typeof go==='function')go('pagamentos');setTimeout(()=>{const month=document.getElementById('pgMes'),quinzena=document.getElementById('pgQuinzena'),local=document.getElementById('v125Local'),cutDate=document.getElementById('v125CutDate'),cutTurn=document.getElementById('v125CutTurn');if(month)month.value=q.mes||today().slice(0,7);if(quinzena)quinzena.value=String(q.numero||1);if(local)local.value=p.local||'';if(cutDate)cutDate.value=today();if(cutTurn)cutTurn.value='T';if(typeof renderPagamentos==='function')renderPagamentos(false);document.getElementById('v125CutBox')?.scrollIntoView({behavior:'smooth',block:'start'});},120);
  };
  window.v136ShowCorrections=function(){
    const milk=S.statement?.milk||[],rows=[];milk.forEach(x=>{(x.correcoes||[]).forEach(c=>rows.push({at:c.em,data:x.data,title:`Entrada pendente alterada — ${date(x.data)}`,text:`${num(c.antes?.qtd)} L → ${num(c.depois?.qtd)} L • ${c.antes?.turno||'-'} → ${c.depois?.turno||'-'} • ${c.motivo||'-'}`}));(x.retificacoes||[]).forEach(c=>rows.push({at:c.em,data:x.data,title:`Entrada paga retificada — ${date(x.data)}`,text:`${num(c.de)} L → ${num(c.para)} L • ${c.efeito==='acrescimo_leite'?'acréscimo criado':'débito de acerto criado'} • ${c.motivo||'-'}`}));if(x.ajusteDe)rows.push({at:x.data,data:x.data,title:`Ajuste pendente de ${num(x.qtd)} L`,text:`Referente a ${date(x.dataReferencia)} • ${x.motivo||'-'}`} )});rows.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));v136CorrectionsList.innerHTML=rows.map(x=>`<div class="v135-list-item"><span><b>${E(x.title)}</b><small>${E(x.text)}</small></span><strong>${date(String(x.at||x.data).slice(0,10))}</strong></div>`).join('')||'<div class="v135-empty"><b>Nenhuma correção registrada</b><span>As alterações futuras aparecerão aqui com motivo e data.</span></div>';v136CorrectionsDialog.showModal();
  };
  window.v136PrintMenu=function(){if(!S.statement?.producer)return;v136PrintDialog.showModal()};
  window.v136PrintA4=function(){v136PrintDialog.close();v135PrintProducer()};
  window.v136Print80=function(){
    v136PrintDialog.close();const d=S.statement,p=d?.producer;if(!p)return;const q=d.quinzena||{},f=financialSnapshot(d),openDebts=(d.debits||[]).filter(x=>debitBalance(x)>0),w=window.open('','_blank','width=480,height=800');if(!w)return alert('O navegador bloqueou a janela de impressão.');
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Resumo ${E(p.nome)}</title><style>@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0 auto;font:12px Arial;color:#000}.center{text-align:center}.title{font-size:18px;font-weight:900}.sep{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;gap:8px;margin:5px 0}.big{font-size:17px;font-weight:900}.debt{font-size:10px;margin:5px 0}.foot{text-align:center;font-size:10px;margin-top:12px}</style></head><body><div class="center"><div class="title">VALE DA SERRA</div><div>Resumo do produtor</div></div><div class="sep"></div><b>${E(p.nome)}</b><div>${E(p.local||'-')}</div><div>${periodLabel(N(q.numero))} de ${E(monthName(q.mes))}</div><div>${date(q.inicio)} a ${date(q.fim)}</div><div class="sep"></div><div class="row"><span>Saldo anterior</span><b>${num(q.litros_saldo_anterior)} L</b></div><div class="row"><span>Leite da quinzena</span><b>${num(q.litros_periodo_atual)} L</b></div><div class="row"><span>Total de leite</span><b>${num(q.litros)} L</b></div><div class="row"><span>Valor bruto</span><b>${money(f.gross)}</b></div><div class="row"><span>Descontos incluídos</span><b>${money(f.eligible)}</b></div><div class="row big"><span>LÍQUIDO</span><b>${money(f.net)}</b></div>${f.carry?`<div class="row big"><span>SALDO DEVEDOR</span><b>${money(f.carry)}</b></div>`:''}<div class="sep"></div><b>Débitos em aberto</b>${openDebts.slice(0,10).map(x=>`<div class="debt">${date(x.data)} • ${E(x.descricao||'Débito')}<br>Saldo: ${money(debitBalance(x))}</div>`).join('')||'<div class="debt">Nenhum débito em aberto.</div>'}<div class="sep"></div><div class="foot">Emitido em ${new Date().toLocaleString('pt-BR')}<br>Vale da Serra Laticínios</div><script>window.onload=()=>setTimeout(()=>window.print(),180)<\/script></body></html>`);w.document.close();
  };
  window.v135WhatsProducer=function(){
    const d=S.statement,p=d?.producer;if(!p)return;const w=phone(p.whatsapp);if(!w)return alert('Cadastre o WhatsApp do produtor antes de compartilhar.');const q=d.quinzena||{},f=financialSnapshot(d),pending=(d.milk||[]).filter(x=>String(x.situacaoPagamento)!=='Liquidada').reduce((s,x)=>s+N(x.qtd),0),last=(d.milk||[])[0],active=(d.inventory_orders||[]).filter(x=>['pendente','separado','parcial'].includes(String(x.status))).length;
    const text=`Olá, ${p.nome}! Segue seu resumo na Vale da Serra.\n\nPeríodo: ${periodLabel(N(q.numero))} de ${monthName(q.mes)}\nÚltima entrega: ${last?`${date(last.data)} • ${turn(last)} • ${num(last.qtd)} L`:'sem entrada registrada'}\nLeite ainda não pago: ${num(pending)} L\nSaldo anterior: ${num(q.litros_saldo_anterior)} L\nLeite desta quinzena: ${num(q.litros_periodo_atual)} L\nValor bruto: ${money(f.gross)}\nDébitos incluídos: ${money(f.eligible)}\nLíquido previsto: ${money(f.net)}${f.carry?`\nSaldo devedor para o próximo pagamento: ${money(f.carry)}`:''}${active?`\nPedidos ativos no Galpão: ${active}`:''}\n\nEm caso de dúvida, fale com a Vale da Serra.`;
    window.open('https://wa.me/'+w+'?text='+encodeURIComponent(text),'_blank','noopener');
  };

  window.v135PrintProducer=function(){
    const d=S.statement,p=d?.producer;if(!p)return;const w=window.open('','_blank','width=1000,height=900');if(!w)return alert('O navegador bloqueou a janela de impressão.');const q=d.quinzena||{},f=financialSnapshot(d),ds=d.debits||[],ps=d.payments||[],orders=d.inventory_orders||[],sales=d.pdv_sales||[],moves=d.inventory||[];
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha - ${E(p.nome)}</title><style>@page{size:A4;margin:13mm}*{box-sizing:border-box}body{font:12px Arial;color:#183553;margin:0}h1,h2{color:#092f60;margin:0 0 8px}.head{border-bottom:3px solid #0d4d88;padding-bottom:12px;margin-bottom:14px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:14px}.box{border:1px solid #cfdbe8;border-radius:8px;padding:9px}.box b{display:block;font-size:15px;margin-top:3px}.carry{padding:9px;border-radius:8px;background:#fff1e5;color:#8b3e00;font-weight:800;margin:-5px 0 14px}table{width:100%;border-collapse:collapse;margin:7px 0 16px}th{background:#eaf1f8;text-align:left;padding:6px}td{border-bottom:1px solid #dce5ee;padding:6px;vertical-align:top}.total{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:14px}.foot{text-align:center;color:#677789;border-top:1px solid #ccd6e0;padding-top:9px;margin-top:18px}@media print{button{display:none}}</style></head><body><div class="head"><h1>VALE DA SERRA LATICÍNIOS</h1><div>Ficha completa do produtor • emitida em ${new Date().toLocaleString('pt-BR')}</div></div><h2>${E(p.nome)}</h2><div class="meta"><div class="box">Código<b>${E(p.codigo||'-')}</b></div><div class="box">Localidade<b>${E(p.local||'-')}</b></div><div class="box">WhatsApp<b>${E(p.whatsapp||'-')}</b></div><div class="box">Tanqueiro<b>${E(p.tanqueiro||'-')}</b></div><div class="box">Caminhão<b>${E(p.caminhao||'-')}</b></div><div class="box">Status<b>${E(statusProd(p.id))}</b></div></div><h2>${periodLabel(N(q.numero))} de ${E(monthName(q.mes))}</h2><div class="total"><div class="box">Litros<b>${num(q.litros)} L</b></div><div class="box">Bruto<b>${money(f.gross)}</b></div><div class="box">Descontos incluídos<b>${money(f.eligible)}</b></div><div class="box">Líquido<b>${money(f.net)}</b></div></div>${f.carry?`<div class="carry">Saldo devedor estimado que continuará em aberto: ${money(f.carry)}</div>`:''}${printTable('Entradas de leite',['Data','Turno','Litros','Situação'],(d.milk||[]).map(x=>[date(x.data),turn(x),num(x.qtd)+' L',x.situacaoPagamento]))}${printTable('Pedidos do Galpão',['Data','Pedido','Produtos','Status','Total'],orders.map(x=>[date(x.created_at),'#'+String(x.id).slice(0,8).toUpperCase(),(x.items||[]).map(i=>`${i.product_name} — ${num(i.quantity)} ${i.unit||'un'}`).join('; '),orderStatus(x.status),money(x.total)]))}${printTable('Retiradas do Galpão',['Data','Produto','Quantidade','Valor'],moves.map(x=>[date(x.business_date||x.created_at),x.product_name,num(x.quantity)+' '+(x.unit||'un'),money(N(x.quantity)*N(x.unit_price))]))}${printTable('Compras na Loja / PDV',['Data','Produtos','Pagamento','Total'],sales.map(x=>[date(x.business_date||x.created_at),(x.items||[]).map(i=>`${i.product_name} — ${num(i.quantity)}`).join('; '),paymentName(x.payment_method),money(x.total)]))}${printTable('Débitos',['Data','Descrição','Valor','Saldo'],ds.map(x=>[date(x.data),x.descricao,money(x.valor),money(debitBalance(x))]))}${printTable('Pagamentos do leite',['Período','Litros','Débitos aplicados','Saldo restante','Líquido','Data'],ps.map(x=>[`${monthName(x.mes)} • ${x.quinzena}ª quinzena`,num(x.litros)+' L',money(x.totalDebitos),money(x.saldoDebitosApos),money(x.valorPago),date(x.dataPagamento)]))}<div class="foot">Vale da Serra — ficha interna consolidada do produtor</div><script>window.onload=()=>setTimeout(()=>window.print(),180)<\/script></body></html>`);w.document.close();
  };
  function printTable(title,headers,rows){return `<h2>${E(title)}</h2><table><thead><tr>${headers.map(x=>`<th>${E(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${E(x)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${headers.length}">Nenhum registro.</td></tr>`}</tbody></table>`}

  function openSafeMilkEditor(id){
    const x=lancamentos.find(a=>String(a.id)===String(id));if(!x)return alert('Entrada não encontrada.');
    try{if(typeof fecharEdicaoRecebimentos==='function')fecharEdicaoRecebimentos()}catch(_){}
    S.id=String(x.prodId);S.tab='leite';S.statement=localStatement(S.id);if(typeof go==='function')go('pesquisa');renderProfile();v135EditMilk(id);
  }
  // Todas as telas antigas passam a usar a mesma edição segura da ficha completa.
  window.editarRecebimento=openSafeMilkEditor;
  window.editarRecebimentoVisual=openSafeMilkEditor;
  window.excluirLanc=function(id){
    const x=lancamentos.find(a=>String(a.id)===String(id));if(!x)return;
    if(paid(x))return alert('Esta entrada já está ligada a um pagamento. Desfaça o pagamento ou use Corrigir na ficha do produtor para manter o histórico correto.');
    const p=produtores.find(a=>String(a.id)===String(x.prodId));
    if(!confirm(`Excluir a entrada de ${p?.nome||'produtor'} em ${date(x.data)} (${num(x.qtd)} L)?`))return;
    lancamentos=lancamentos.filter(a=>String(a.id)!==String(id));v25Audit('LEITE_ENTRADA_EXCLUIDA',{produtor:p?.nome||'',litros:x.qtd,data:x.data,origem:'exclusão segura V135'});save();
  };

  const oldShow=window.showSection;
  if(typeof oldShow==='function')window.showSection=function(id,btn){const r=oldShow.apply(this,arguments);if(id==='pesquisa')setTimeout(()=>{inject();fillLocalities();document.getElementById('busca')?.focus()},0);return r};
  inject();
})();
