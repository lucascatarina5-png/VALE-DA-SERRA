(function(){
  'use strict';

  const S={report:null,editingId:'',busy:false};
  const N=v=>Number(v||0);
  const E=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const norm=v=>String(v||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const money=v=>N(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const qty=v=>N(v).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const date=v=>{const m=String(v||'').slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:(v||'-')};
  const month=v=>{const [y,m]=String(v||'').split('-'),names=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];return y&&m?`${names[N(m)-1]||m} de ${y}`:(v||'-')};
  const admin=()=>{try{return typeof v4IsAdmin!=='function'||v4IsAdmin()}catch(_){return false}};
  const clone=v=>JSON.parse(JSON.stringify(v));

  function applyBankPrivacy(){
    const visible=admin();
    document.querySelectorAll('.v152-bank-private').forEach(element=>{element.style.display=visible?'':'none'});
  }
  function installPrivacyHook(){
    const original=window.v4AplicarVisibilidade;
    if(typeof original==='function'&&!original.v152PrivacyHook){
      const wrapped=function(){const result=original.apply(this,arguments);setTimeout(applyBankPrivacy,0);return result};
      wrapped.v152PrivacyHook=true;
      window.v4AplicarVisibilidade=wrapped;
    }
    applyBankPrivacy();
  }
  window.v152ApplyBankPrivacy=applyBankPrivacy;

  function originOf(d){
    const value=norm([d?.origem,d?.descricao,d?.source].join(' '));
    if(value.includes('galpao')||value.includes('estoque'))return 'galpao';
    if(value.includes('pdv')||value.includes('loja'))return 'pdv';
    return 'outros';
  }
  function originLabel(v){return v==='pdv'?'Loja / PDV':v==='galpao'?'Galpão':'Outros'}
  function paymentLabel(v){return ({pix:'PIX',transferencia:'Transferência bancária',dinheiro:'Dinheiro'})[String(v||'').toLowerCase()]||'Não informada'}
  function accountType(v){return ({corrente:'Conta corrente',poupanca:'Poupança',pagamento:'Conta de pagamento'})[String(v||'').toLowerCase()]||String(v||'')}
  function pixType(v){return ({cpf:'CPF',cnpj:'CNPJ',telefone:'Telefone',email:'E-mail',aleatoria:'Aleatória'})[String(v||'').toLowerCase()]||String(v||'Chave')}
  function pixToken(v){return norm(v).replace(/[^a-z0-9@.+_-]/g,'')}
  function duplicatePixIds(p){
    const key=pixToken(p?.chavePix);if(!key)return [];
    return (Array.isArray(produtores)?produtores:[]).filter(x=>pixToken(x.chavePix)===key).map(x=>String(x.id));
  }
  function bankStatus(p){
    const method=String(p?.formaPagamento||'').toLowerCase(),missing=[];
    if(!method)missing.push('forma de pagamento');
    if(method==='pix'){
      if(!String(p.chavePix||'').trim())missing.push('chave PIX');
      if(!String(p.titularConta||'').trim())missing.push('titular');
      if(!String(p.documentoTitular||'').trim())missing.push('CPF/CNPJ do titular');
    }else if(method==='transferencia'){
      if(!String(p.banco||'').trim())missing.push('banco');
      if(!String(p.agencia||'').trim())missing.push('agência');
      if(!String(p.conta||'').trim())missing.push('conta');
      if(!String(p.tipoConta||'').trim())missing.push('tipo da conta');
      if(!String(p.titularConta||'').trim())missing.push('titular');
      if(!String(p.documentoTitular||'').trim())missing.push('CPF/CNPJ do titular');
    }
    const duplicates=method==='pix'&&p.chavePix?duplicatePixIds(p).filter(id=>id!==String(p.id)):[];
    if(duplicates.length)return {kind:'bad',label:'PIX DUPLICADO',detail:'A mesma chave está em mais de um produtor.',missing,duplicates};
    if(missing.length)return {kind:'bad',label:'DADOS PENDENTES',detail:'Falta: '+missing.join(', ')+'.',missing,duplicates:[]};
    if(method==='dinheiro')return {kind:'cash',label:'DINHEIRO',detail:'Não exige conta bancária.',missing:[],duplicates:[]};
    if(!p?.dadosBancariosConferidosEm)return {kind:'warn',label:'CONFERIR DADOS',detail:'Cadastro preenchido, mas ainda não marcado como conferido.',missing:[],duplicates:[]};
    return {kind:'ok',label:'DADOS CONFERIDOS',detail:'Conferidos em '+date(p.dadosBancariosConferidosEm)+'.',missing:[],duplicates:[]};
  }
  function bankText(p){
    const method=String(p?.formaPagamento||'').toLowerCase();
    if(method==='pix')return [`PIX ${pixType(p.tipoChavePix)}: ${p.chavePix||'-'}`,p.titularConta&&`Titular: ${p.titularConta}`,p.documentoTitular&&`CPF/CNPJ: ${p.documentoTitular}`].filter(Boolean).join(' • ');
    if(method==='transferencia')return [p.banco,p.agencia&&`Ag. ${p.agencia}`,p.conta&&`${accountType(p.tipoConta)||'Conta'} ${p.conta}`,p.titularConta&&`Titular: ${p.titularConta}`,p.documentoTitular&&`CPF/CNPJ: ${p.documentoTitular}`].filter(Boolean).join(' • ');
    if(method==='dinheiro')return 'Pagamento em dinheiro';
    return 'Dados ainda não cadastrados';
  }
  function enrichReport(raw){
    const rows=(raw.rows||[]).map(row=>{
      const applied={pdv:0,galpao:0,outros:0};
      const debts=(row.debtApplications||[]).filter(d=>N(d.balanceBefore)>0).map(d=>{const origin=originOf(d);applied[origin]+=N(d.amountApplied);return {...d,origin}});
      const bank=bankStatus(row.producer);
      const deliveryLocations=Array.isArray(row.deliveryLocations)&&row.deliveryLocations.length?row.deliveryLocations:[{local:row.mainLocal||raw.choice?.local||'Não informada',litros:row.liters,entradas:(row.entries||[]).length}],outsideLocations=deliveryLocations.filter(item=>norm(item.local)!==norm(row.mainLocal||raw.choice?.local)),outsideLiters=outsideLocations.reduce((sum,item)=>sum+N(item.litros),0);
      return {...row,deliveryLocations,outsideLocations,outsideLiters,crossLocality:outsideLocations.length>0,debts,applied,bank,bankText:bankText(row.producer),paymentLabel:paymentLabel(row.producer?.formaPagamento)};
    });
    const sources=rows.reduce((a,row)=>({pdv:a.pdv+row.applied.pdv,galpao:a.galpao+row.applied.galpao,outros:a.outros+row.applied.outros}),{pdv:0,galpao:0,outros:0});
    const bankSummary=rows.reduce((a,row)=>{a[row.bank.kind]=(a[row.bank.kind]||0)+1;return a},{ok:0,warn:0,bad:0,cash:0});
    const outsidePeople=rows.filter(row=>row.crossLocality).length,outsideLiters=rows.reduce((sum,row)=>sum+N(row.outsideLiters),0);
    return {...raw,rows,sources,bankSummary,outsidePeople,outsideLiters};
  }
  window.v152BuildReport=raw=>enrichReport(clone(raw));
  window.v152BankStatus=p=>bankStatus(clone(p));
  function currentReport(){
    if(typeof window.v139PrepaymentSnapshot!=='function')throw new Error('A prévia do pagamento ainda não foi carregada.');
    return enrichReport(window.v139PrepaymentSnapshot());
  }
  function qLabel(v){return String(v)==='1'?'1ª quinzena':String(v)==='2'?'2ª quinzena':'Mês inteiro'}
  function turnLabel(v){return String(v)==='M'?'Manhã':'Tarde — dia completo'}
  function debtDescription(d){
    const items=(d.itens||[]).map(i=>`${i.produto||i.product_name||'Produto'}: ${qty(i.quantidade||i.quantity)} ${i.unidade||i.unit||'un'} (${money(i.subtotal)})`).join('; ');
    return [d.descricao||'Débito',items].filter(Boolean).join(' — ');
  }
  function totalsCards(r){
    return `<div class="v152-kpis"><span>Produtores<b>${r.totals.people}</b></span><span>Leite incluído<b>${qty(r.totals.liters)} L</b></span><span>Valor bruto<b>${money(r.totals.gross)}</b></span><span>PDV<b>${money(r.sources.pdv)}</b></span><span>Galpão<b>${money(r.sources.galpao)}</b></span><span>Outros débitos<b>${money(r.sources.outros)}</b></span><span>Total de débitos<b>${money(r.totals.debt)}</b></span><span class="net">Líquido a pagar<b>${money(r.totals.net)}</b></span></div>`;
  }
  function deliveryText(row){return (row.deliveryLocations||[]).map(item=>`${item.local}: ${qty(item.litros)} L`).join(' • ')||'Não informado'}
  function mainRows(r,printing=false){
    return r.rows.map(row=>`<tr><td>${E(row.producer.codigo||'-')}</td><td><b>${E(row.producer.nome||'Produtor')}</b><small>Principal: ${E(row.mainLocal||r.choice.local||'-')}</small></td><td><b>${E(deliveryText(row))}</b>${row.crossLocality?`<small class="v153-report-outside">${qty(row.outsideLiters)} L recebidos fora da principal</small>`:'<small>Somente na principal</small>'}</td><td>${qty(row.parts.previous)} L</td><td>${qty(row.parts.current)} L</td><td><b>${qty(row.liters)} L</b></td><td>${money(row.gross)}</td><td>${money(row.applied.pdv)}</td><td>${money(row.applied.galpao)}</td><td>${money(row.applied.outros)}</td><td><b>${money(row.debtApplied)}</b>${row.carry?`<small>Saldo posterior: ${money(row.carry)}</small>`:''}</td><td><b class="v152-net">${money(row.net)}</b></td><td><b>${E(row.paymentLabel)}</b><small>${E(row.bankText)}</small></td><td><span class="v152-status ${row.bank.kind}">${E(row.bank.label)}</span><small>${E(row.bank.detail)}</small>${printing?'':`<button type="button" class="v152-edit-bank" onclick="v152OpenBankEditor('${E(row.producer.id)}')">✏️ Editar</button>`}</td></tr>`).join('');
  }
  function debtRows(r){
    const rows=r.rows.flatMap(row=>row.debts.map(d=>({producer:row.producer,debt:d})));
    return rows.map(({producer,debt:d})=>`<tr><td>${E(producer.codigo||'-')} • ${E(producer.nome||'Produtor')}</td><td>${date(d.data)}</td><td>${E(originLabel(d.origin))}</td><td>${E(debtDescription(d))}</td><td>${money(d.balanceBefore)}</td><td><b>${money(d.amountApplied)}</b></td><td>${money(d.balanceAfter)}</td></tr>`).join('')||'<tr><td colspan="7">Nenhum débito será aplicado neste pagamento.</td></tr>';
  }
  function renderReport(){
    let r;try{r=currentReport()}catch(error){alert(error.message);return}
    S.report=r;const box=document.getElementById('v152ReportContent');if(!box)return;
    const pending=r.bankSummary.bad+r.bankSummary.warn;
    box.innerHTML=`<div class="v152-report-warning"><b>RELATÓRIO PARA CONFERÊNCIA — NÃO É COMPROVANTE E NÃO DÁ BAIXA</b><span>Os valores abaixo são a mesma prévia que será usada ao finalizar o pagamento.</span></div><div class="v152-context"><span>Localidade principal<b>${E(r.choice.local)}</b></span><span>Período<b>${E(qLabel(r.choice.q))} de ${E(month(r.choice.ym))}</b></span><span>Corte<b>${date(r.choice.date)} • ${E(turnLabel(r.choice.turn))}</b></span><span>Emitido por<b>${E(r.operator||'Administrador')}</b></span></div>${totalsCards(r)}${r.outsidePeople?`<div class="v153-location-alert"><b>📍 ${r.outsidePeople} produtor(es) com ${qty(r.outsideLiters)} L recebidos em outros tanques</b><span>Esses litros aparecem somente nesta localidade principal. A coluna “Onde entregou” mantém a informação real, sem duplicar o pagamento.</span></div>`:''}<div class="v152-bank-alert ${pending?'warn':'ok'}"><b>${pending?`⚠️ ${pending} produtor(es) precisam de conferência bancária`:'✅ Todos os dados de pagamento estão conferidos'}</b><span>${r.bankSummary.bad?`${r.bankSummary.bad} com dados incompletos ou duplicados. `:''}${r.bankSummary.warn?`${r.bankSummary.warn} preenchidos, aguardando conferência. `:''}${r.bankSummary.cash?`${r.bankSummary.cash} pagamento(s) em dinheiro.`:''}</span></div><h3>Relação dos produtores e depósitos</h3><div class="v152-tablewrap"><table class="v152-table"><thead><tr><th>Código</th><th>Produtor</th><th>Onde entregou</th><th>Saldo anterior</th><th>Período atual</th><th>Total leite</th><th>Bruto</th><th>PDV</th><th>Galpão</th><th>Outros</th><th>Débitos</th><th>Líquido</th><th>Pagamento / conta</th><th>Conferência</th></tr></thead><tbody>${mainRows(r)}</tbody></table></div><h3>Detalhamento dos débitos que entrarão no pagamento</h3><div class="v152-tablewrap"><table class="v152-table debts"><thead><tr><th>Produtor</th><th>Data</th><th>Origem</th><th>Descrição / produtos</th><th>Saldo antes</th><th>Aplicado agora</th><th>Saldo depois</th></tr></thead><tbody>${debtRows(r)}</tbody></table></div>`;
  }

  window.v152OpenPrepaymentReport=function(){
    if(!admin())return alert('Somente o Administrador pode abrir o relatório com dados bancários.');
    let r;try{r=currentReport()}catch(error){return alert(error.message)}
    if(!r.choice.local)return alert('Escolha a localidade antes de gerar o relatório.');
    if(!r.rows.length)return alert('Selecione pelo menos um produtor com leite pendente.');
    const modal=document.getElementById('v152ReportModal');if(!modal)return;modal.classList.add('on');modal.style.display='flex';renderReport();
  };
  window.v152CloseReport=function(){const m=document.getElementById('v152ReportModal');if(m){m.classList.remove('on');m.style.display='none'}};
  window.v152RefreshReport=renderReport;

  window.v152PrintPrepaymentReportLegacy=function(){
    let r;try{r=currentReport()}catch(error){return alert(error.message)}
    if(!r.rows.length)return alert('Nenhum produtor selecionado para imprimir.');
    const logo=new URL('logo-source.jpg',location.href).href,w=window.open('','_blank','width=1280,height=900');if(!w)return alert('O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.');
    const pending=r.bankSummary.bad+r.bankSummary.warn;
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pré-pagamento - ${E(r.choice.local)} - ${E(qLabel(r.choice.q))}</title><style>@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{margin:0;font:9px Arial,sans-serif;color:#15375c}.head{display:grid;grid-template-columns:76px 1fr auto;align-items:center;gap:12px;padding-bottom:8px;border-bottom:4px solid #f0b400}.head img{width:70px;height:70px;object-fit:contain}.head h1{margin:0;color:#07376b;font-size:21px}.head p{margin:3px 0;color:#5b7087}.draft{border:2px solid #c98a00;border-radius:8px;padding:7px 10px;color:#8a5600;text-align:center;font-weight:bold}.context{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:8px 0}.context span,.v152-kpis span{border:1px solid #cdd9e6;border-radius:6px;padding:6px;color:#5c7086}.context b,.v152-kpis b{display:block;color:#123e70;margin-top:3px}.v152-kpis{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin:7px 0}.v152-kpis .net{background:#e5f6eb}.v152-kpis .net b{color:#13743a}.alert{padding:6px 8px;border-radius:6px;margin:6px 0;background:${pending?'#fff1db':'#e7f7ec'};color:${pending?'#7c4d00':'#176b38'}}h2{font-size:13px;margin:10px 0 5px;color:#0a3b70}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#0c4b85;color:#fff;text-align:left;padding:4px}td{border:1px solid #d8e1eb;padding:4px;vertical-align:top;overflow-wrap:anywhere}td small{display:block;color:#5f7287;margin-top:2px}.main th:nth-child(1){width:4%}.main th:nth-child(2){width:13%}.main th:nth-child(n+3):nth-child(-n+11){width:5.4%}.main th:nth-child(12){width:17%}.main th:nth-child(13){width:9%}.netvalue{color:#11723a}.status{display:block;font-size:7px;font-weight:bold;padding:3px;border-radius:10px;text-align:center}.status.ok{background:#dcf5e4;color:#126d36}.status.warn{background:#fff0d1;color:#875100}.status.bad{background:#ffe1e1;color:#a91f1f}.status.cash{background:#e6eef8;color:#285175}.debts th:nth-child(1){width:18%}.debts th:nth-child(2){width:7%}.debts th:nth-child(3){width:8%}.debts th:nth-child(4){width:39%}.signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;margin-top:26px}.signatures span{border-top:1px solid #52677c;padding-top:4px;text-align:center}.foot{margin-top:8px;text-align:center;color:#65788b}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><div class="head"><img src="${E(logo)}"><div><h1>VALE DA SERRA LATICÍNIOS</h1><p>Relatório interno de conferência pré-pagamento</p></div><div class="draft">NÃO É COMPROVANTE<br>NÃO DÁ BAIXA</div></div><div class="context"><span>Localidade<b>${E(r.choice.local)}</b></span><span>Período<b>${E(qLabel(r.choice.q))} de ${E(month(r.choice.ym))}</b></span><span>Data e turno de corte<b>${date(r.choice.date)} • ${E(turnLabel(r.choice.turn))}</b></span><span>Emitido por<b>${E(r.operator||'Administrador')}</b></span></div>${totalsCards(r)}<div class="alert"><b>${pending?`ATENÇÃO: ${pending} produtor(es) ainda precisam de conferência dos dados de pagamento.`:'Dados de pagamento conferidos para todos os produtores selecionados.'}</b></div><h2>Produtores, valores e dados para depósito</h2><table class="main"><thead><tr><th>Cód.</th><th>Produtor</th><th>Anterior</th><th>Atual</th><th>Leite</th><th>Bruto</th><th>PDV</th><th>Galpão</th><th>Outros</th><th>Débitos</th><th>Líquido</th><th>Pagamento / dados bancários</th><th>Conferência</th></tr></thead><tbody>${mainRows(r,true).replaceAll('v152-net','netvalue').replaceAll('v152-status','status')}</tbody></table><h2>Detalhamento dos débitos aplicados</h2><table class="debts"><thead><tr><th>Produtor</th><th>Data</th><th>Origem</th><th>Descrição / produtos</th><th>Saldo antes</th><th>Aplicado</th><th>Saldo depois</th></tr></thead><tbody>${debtRows(r)}</tbody></table><div class="signatures"><span>Conferido por</span><span>Autorizado por</span><span>Data</span></div><div class="foot">Emitido em ${E(new Date().toLocaleString('pt-BR',{timeZone:'America/Fortaleza'}))} • Vale da Serra Laticínios • V152</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);w.document.close();
  };

  window.v152PrintPrepaymentReport=function(){
    let r;try{r=currentReport()}catch(error){return alert(error.message)}
    if(!r.rows.length)return alert('Nenhum produtor selecionado para imprimir.');
    const logo=new URL('logo-source.jpg',location.href).href,w=window.open('','_blank','width=1280,height=900');if(!w)return alert('O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.');
    const pending=r.bankSummary.bad+r.bankSummary.warn,locationNotice=r.outsidePeople?`<div class="location"><b>📍 ${r.outsidePeople} produtor(es) • ${qty(r.outsideLiters)} L recebidos fora da localidade principal.</b><br>Esses litros permanecem somente neste pagamento; a tabela identifica onde cada entrega ocorreu.</div>`:'';
    const styles=`@page{size:A4 landscape;margin:7mm}*{box-sizing:border-box}body{margin:0;font:8.3px Arial,sans-serif;color:#15375c}.head{display:grid;grid-template-columns:65px 1fr auto;align-items:center;gap:10px;padding-bottom:7px;border-bottom:4px solid #f0b400}.head img{width:60px;height:60px;object-fit:contain}.head h1{margin:0;color:#07376b;font-size:20px}.head p{margin:3px 0;color:#5b7087}.draft{border:2px solid #c98a00;border-radius:7px;padding:6px 9px;color:#8a5600;text-align:center;font-weight:bold}.context{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:7px 0}.context span,.v152-kpis span{border:1px solid #cdd9e6;border-radius:5px;padding:5px;color:#5c7086}.context b,.v152-kpis b{display:block;color:#123e70;margin-top:2px}.v152-kpis{display:grid;grid-template-columns:repeat(8,1fr);gap:3px;margin:6px 0}.v152-kpis .net{background:#e5f6eb}.v152-kpis .net b{color:#13743a}.alert,.location{padding:5px 7px;border-radius:6px;margin:5px 0}.alert{background:${pending?'#fff1db':'#e7f7ec'};color:${pending?'#7c4d00':'#176b38'}}.location{background:#eaf3fd;color:#22517f}h2{font-size:12px;margin:8px 0 4px;color:#0a3b70}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#0c4b85;color:#fff;text-align:left;padding:3px}td{border:1px solid #d8e1eb;padding:3px;vertical-align:top;overflow-wrap:anywhere}td small{display:block;color:#5f7287;margin-top:2px}.main th:nth-child(1){width:3.5%}.main th:nth-child(2){width:9%}.main th:nth-child(3){width:11%}.main th:nth-child(n+4):nth-child(-n+12){width:5%}.main th:nth-child(13){width:15%}.main th:nth-child(14){width:8%}.netvalue{color:#11723a}.status{display:block;font-size:6.5px;font-weight:bold;padding:3px;border-radius:10px;text-align:center}.status.ok{background:#dcf5e4;color:#126d36}.status.warn{background:#fff0d1;color:#875100}.status.bad{background:#ffe1e1;color:#a91f1f}.status.cash{background:#e6eef8;color:#285175}.debts th:nth-child(1){width:18%}.debts th:nth-child(2){width:7%}.debts th:nth-child(3){width:8%}.debts th:nth-child(4){width:39%}.signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;margin-top:22px}.signatures span{border-top:1px solid #52677c;padding-top:4px;text-align:center}.foot{margin-top:7px;text-align:center;color:#65788b}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}`;
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pré-pagamento - ${E(r.choice.local)} - ${E(qLabel(r.choice.q))}</title><style>${styles}</style></head><body><div class="head"><img src="${E(logo)}"><div><h1>VALE DA SERRA LATICÍNIOS</h1><p>Relatório interno de conferência pré-pagamento</p></div><div class="draft">NÃO É COMPROVANTE<br>NÃO DÁ BAIXA</div></div><div class="context"><span>Localidade principal<b>${E(r.choice.local)}</b></span><span>Período<b>${E(qLabel(r.choice.q))} de ${E(month(r.choice.ym))}</b></span><span>Data e turno de corte<b>${date(r.choice.date)} • ${E(turnLabel(r.choice.turn))}</b></span><span>Emitido por<b>${E(r.operator||'Administrador')}</b></span></div>${totalsCards(r)}${locationNotice}<div class="alert"><b>${pending?`ATENÇÃO: ${pending} produtor(es) ainda precisam de conferência dos dados de pagamento.`:'Dados de pagamento conferidos para todos os produtores selecionados.'}</b></div><h2>Produtores, valores, locais de entrega e dados para depósito</h2><table class="main"><thead><tr><th>Cód.</th><th>Produtor</th><th>Onde entregou</th><th>Anterior</th><th>Atual</th><th>Leite</th><th>Bruto</th><th>PDV</th><th>Galpão</th><th>Outros</th><th>Débitos</th><th>Líquido</th><th>Pagamento / dados bancários</th><th>Conferência</th></tr></thead><tbody>${mainRows(r,true).replaceAll('v152-net','netvalue').replaceAll('v152-status','status')}</tbody></table><h2>Detalhamento dos débitos aplicados</h2><table class="debts"><thead><tr><th>Produtor</th><th>Data</th><th>Origem</th><th>Descrição / produtos</th><th>Saldo antes</th><th>Aplicado</th><th>Saldo depois</th></tr></thead><tbody>${debtRows(r)}</tbody></table><div class="signatures"><span>Conferido por</span><span>Autorizado por</span><span>Data</span></div><div class="foot">Emitido em ${E(new Date().toLocaleString('pt-BR',{timeZone:'America/Fortaleza'}))} • Vale da Serra Laticínios • V153</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);w.document.close();
  };

  function field(id){return document.getElementById(id)}
  window.v152OpenBankEditor=function(id){
    if(!admin())return alert('Somente o Administrador pode editar dados bancários.');
    const p=(Array.isArray(produtores)?produtores:[]).find(x=>String(x.id)===String(id));if(!p)return alert('Produtor não encontrado.');S.editingId=String(id);
    field('v152BankProducer').textContent=`${p.codigo?`Código ${p.codigo} • `:''}${p.nome}`;field('v152BankMethod').value=p.formaPagamento||'';field('v152BankName').value=p.banco||'';field('v152BankBranch').value=p.agencia||'';field('v152BankAccount').value=p.conta||'';field('v152BankAccountType').value=p.tipoConta||'';field('v152BankHolder').value=p.titularConta||'';field('v152BankDocument').value=p.documentoTitular||'';field('v152BankPixType').value=p.tipoChavePix||'';field('v152BankPixKey').value=p.chavePix||'';field('v152BankChecked').value=p.dadosBancariosConferidosEm||'';window.v152BankFormStatus();const m=field('v152BankModal');m.classList.add('on');m.style.display='flex';
  };
  window.v152CloseBankEditor=function(){const m=field('v152BankModal');if(m){m.classList.remove('on');m.style.display='none'}};
  window.v152BankFormStatus=function(){
    const p={id:S.editingId,formaPagamento:field('v152BankMethod')?.value,banco:field('v152BankName')?.value,agencia:field('v152BankBranch')?.value,conta:field('v152BankAccount')?.value,tipoConta:field('v152BankAccountType')?.value,titularConta:field('v152BankHolder')?.value,documentoTitular:field('v152BankDocument')?.value,tipoChavePix:field('v152BankPixType')?.value,chavePix:field('v152BankPixKey')?.value,dadosBancariosConferidosEm:field('v152BankChecked')?.value},status=bankStatus(p),box=field('v152BankStatus');if(box){box.className='v152-bank-form-status '+status.kind;box.innerHTML=`<b>${E(status.label)}</b><span>${E(status.detail)}</span>`}return status;
  };
  async function syncState(){
    let importacoesPdf=[];try{importacoesPdf=JSON.parse(localStorage.getItem('vds_pdf_import_batches_v137')||'[]')}catch(_){}
    const headers=typeof v4Headers==='function'?v4Headers():{};headers['Content-Type']='application/json';const response=await fetch('/api/state',{method:'PUT',headers,body:JSON.stringify({data:{produtores,lancamentos,pagamentos,debitos,pagamentosDebitos,importacoesPdf}}),cache:'no-store'});if(!response.ok){let message='O servidor não confirmou os dados bancários.';try{const body=await response.json();if(body.error)message=body.error}catch(_){}throw new Error(message)}
  }
  window.v152SaveBank=async function(){
    if(S.busy)return;if(!admin())return alert('Somente o Administrador pode editar dados bancários.');const p=prodById(S.editingId);if(!p)return alert('Produtor não encontrado.');
    const previous=clone(p),data={formaPagamento:field('v152BankMethod').value,banco:field('v152BankName').value.trim(),agencia:field('v152BankBranch').value.trim(),conta:field('v152BankAccount').value.trim(),tipoConta:field('v152BankAccountType').value,titularConta:field('v152BankHolder').value.trim(),documentoTitular:field('v152BankDocument').value.trim(),tipoChavePix:field('v152BankPixType').value,chavePix:field('v152BankPixKey').value.trim(),dadosBancariosConferidosEm:field('v152BankChecked').value};const button=field('v152BankSave');S.busy=true;if(button){button.disabled=true;button.textContent='Salvando...'}
    Object.assign(p,data);localStorage.setItem(KPROD,JSON.stringify(produtores));
    try{await syncState();if(typeof save==='function')save();try{await v25Audit('PRODUTOR_DADOS_BANCARIOS_EDITADOS',{produtor:p.nome,formaPagamento:p.formaPagamento||'não informada',dadosConferidosEm:p.dadosBancariosConferidosEm||'',camposAlterados:Object.keys(data).filter(key=>String(previous[key]||'')!==String(data[key]||''))})}catch(_){}window.v152CloseBankEditor();renderReport();alert('✅ Dados de pagamento salvos com segurança.');}
    catch(error){Object.keys(p).forEach(key=>delete p[key]);Object.assign(p,previous);localStorage.setItem(KPROD,JSON.stringify(produtores));if(typeof save==='function')save();alert('❌ Os dados anteriores foram mantidos.\n\n'+error.message)}
    finally{S.busy=false;if(button){button.disabled=false;button.textContent='💾 Salvar dados de pagamento'}}
  };

  function inject(){
    if(document.getElementById('v152ReportModal')){installPrivacyHook();return}
    document.body.insertAdjacentHTML('beforeend',`<div id="v152ReportModal" class="v139-modal v152-modal"><div class="v139-modal-box v152-report-box"><div class="v139-modal-head"><div><h2>🖨️ Relatório pré-pagamento</h2><p>Confira valores, débitos e dados para depósito antes de finalizar.</p></div><button type="button" onclick="v152CloseReport()">×</button></div><div id="v152ReportContent" class="v139-modal-body"></div><div class="v139-modal-footer"><button type="button" onclick="v152CloseReport()">Fechar</button><button type="button" onclick="v152RefreshReport()">🔄 Atualizar valores</button><button type="button" class="confirm" onclick="v152PrintPrepaymentReport()">🖨️ Imprimir A4 / Salvar PDF</button></div></div></div><div id="v152BankModal" class="v139-modal v152-modal"><div class="v139-modal-box v152-bank-box"><div class="v139-modal-head"><div><h2>🏦 Dados para pagamento</h2><p id="v152BankProducer"></p></div><button type="button" onclick="v152CloseBankEditor()">×</button></div><div class="v139-modal-body"><div class="v152-bank-grid"><label>Forma preferida<select id="v152BankMethod" onchange="v152BankFormStatus()"><option value="">Não informada</option><option value="pix">PIX</option><option value="transferencia">Transferência bancária</option><option value="dinheiro">Dinheiro</option></select></label><label>Banco<input id="v152BankName" oninput="v152BankFormStatus()"></label><label>Agência<input id="v152BankBranch" oninput="v152BankFormStatus()"></label><label>Conta e dígito<input id="v152BankAccount" oninput="v152BankFormStatus()"></label><label>Tipo de conta<select id="v152BankAccountType" onchange="v152BankFormStatus()"><option value="">Não informado</option><option value="corrente">Conta corrente</option><option value="poupanca">Poupança</option><option value="pagamento">Conta de pagamento</option></select></label><label>Titular da conta<input id="v152BankHolder" oninput="v152BankFormStatus()"></label><label>CPF/CNPJ do titular<input id="v152BankDocument" inputmode="numeric" oninput="v152BankFormStatus()"></label><label>Tipo da chave PIX<select id="v152BankPixType" onchange="v152BankFormStatus()"><option value="">Não informado</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="telefone">Telefone</option><option value="email">E-mail</option><option value="aleatoria">Chave aleatória</option></select></label><label>Chave PIX<input id="v152BankPixKey" oninput="v152BankFormStatus()"></label><label>Dados conferidos em<input id="v152BankChecked" type="date" onchange="v152BankFormStatus()"></label></div><div id="v152BankStatus" class="v152-bank-form-status"></div><div class="v152-security-note">🔒 Os dados bancários aparecem somente nas telas internas do Administrador e no relatório de depósito.</div></div><div class="v139-modal-footer"><button type="button" onclick="v152CloseBankEditor()">Cancelar</button><button id="v152BankSave" type="button" class="confirm" onclick="v152SaveBank()">💾 Salvar dados de pagamento</button></div></div></div>`);
    const style=document.createElement('style');style.id='v152Styles';style.textContent=`.v152-bank-title{padding:12px 14px!important;border:1px solid #c8d8e7;border-radius:11px;background:#eef6ff;color:#174a7d}.v152-bank-title b,.v152-bank-title small{display:block}.v152-bank-title small{margin-top:4px;color:#607a93}.v152-prepay-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.v152-report-button{background:#e3a700!important;color:#102f55!important}.v152-report-box{width:min(98vw,1560px)!important}.v152-bank-box{width:min(820px,96vw)!important}.v152-report-warning{display:grid;gap:4px;padding:12px 14px;border:2px solid #d99a00;border-radius:10px;background:#fff5d9;color:#805000}.v152-context{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}.v152-context span,.v152-kpis span{padding:10px;border:1px solid #d6e1ec;border-radius:9px;color:#64778b}.v152-context b,.v152-kpis b{display:block;color:#123f70;margin-top:4px}.v152-kpis{display:grid;grid-template-columns:repeat(8,minmax(120px,1fr));gap:7px;overflow:auto;padding-bottom:4px}.v152-kpis .net{background:#e5f7eb}.v152-kpis .net b{color:#127238}.v152-bank-alert{display:grid;gap:3px;margin:11px 0;padding:11px 13px;border-radius:9px}.v152-bank-alert.warn{background:#fff0dc;color:#815000}.v152-bank-alert.ok{background:#e5f7eb;color:#176a38}.v152-tablewrap{overflow:auto;border:1px solid #d5e0eb;border-radius:10px}.v152-table{width:100%;min-width:1520px;border-collapse:collapse;font-size:11px}.v152-table.debts{min-width:1050px}.v152-table th{position:sticky;top:0;background:#124f87;color:#fff;text-align:left;padding:8px}.v152-table td{border-top:1px solid #dfe7ef;padding:8px;vertical-align:top;color:#25445f}.v152-table td small{display:block;color:#6b7d8f;margin-top:3px}.v152-net{color:#11743a;font-size:14px}.v152-status{display:inline-block;padding:4px 6px;border-radius:999px;font-size:8px;font-weight:900}.v152-status.ok,.v152-bank-form-status.ok{background:#dff5e6;color:#176c38}.v152-status.warn,.v152-bank-form-status.warn{background:#fff0d3;color:#815000}.v152-status.bad,.v152-bank-form-status.bad{background:#ffe1e1;color:#a52121}.v152-status.cash,.v152-bank-form-status.cash{background:#e7eff8;color:#315a7f}.v152-edit-bank{margin-top:5px;border:1px solid #b9ccde;border-radius:6px;background:#f3f8fc;color:#1b568c;padding:4px 6px;font-weight:800}.v152-bank-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.v152-bank-grid label{font-size:11px;font-weight:900;color:#385b7b}.v152-bank-grid input,.v152-bank-grid select{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #c2d1df;border-radius:8px;background:#fff}.v152-bank-form-status{display:grid;gap:3px;margin-top:12px;padding:11px 13px;border-radius:9px}.v152-security-note{margin-top:9px;padding:9px 11px;border-radius:8px;background:#edf3f8;color:#5d7388}.v152-modal .v139-modal-head{z-index:2}.v152-modal h3{color:#123f70;margin:16px 0 8px}@media(max-width:800px){.v152-context{grid-template-columns:1fr 1fr}.v152-bank-grid{grid-template-columns:1fr}.v152-prepay-actions{display:grid;width:100%}.v152-prepay-actions button{width:100%}}@media(max-width:520px){.v152-context{grid-template-columns:1fr}}`;document.head.appendChild(style);
    const localityStyle=document.createElement('style');localityStyle.id='v153LocalityReportStyles';localityStyle.textContent='.v153-location-alert{display:grid;gap:3px;margin:11px 0;padding:11px 13px;border-radius:9px;background:#eaf3fd;color:#22517f}.v153-report-outside{color:#9a5600!important;font-weight:800}';document.head.appendChild(localityStyle);
    installPrivacyHook();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(inject,180),{once:true});else setTimeout(inject,180);
})();
