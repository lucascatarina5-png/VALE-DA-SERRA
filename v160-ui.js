/* Vale da Serra V160 — navegação rápida e organizada */
(function(){
  'use strict';

  const VERSION='V160';
  const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const isMobile=()=>!!document.querySelector('#homeScreen .home-grid')&&!document.querySelector('.sidebar');

  function installProgress(){
    if(!document.querySelector('.v160-progress')){
      const bar=document.createElement('div');bar.className='v160-progress';bar.setAttribute('aria-hidden','true');document.body.appendChild(bar);
    }
    let pending=0;
    const setBusy=value=>{
      pending=Math.max(0,pending+(value?1:-1));
      document.body.classList.toggle('v160-network-busy',pending>0);
      document.body.setAttribute('aria-busy',pending>0?'true':'false');
    };
    if(window.fetch&&!window.fetch.__v160Wrapped){
      const original=window.fetch.bind(window);
      const wrapped=function(input,options){
        let address='';try{address=typeof input==='string'?input:(input&&input.url)||''}catch(_e){}
        const track=/^\/api\//.test(address)||address.includes('/api/');
        if(track)setBusy(true);
        let request;
        try{request=original(input,options)}catch(error){if(track)setBusy(false);throw error}
        return Promise.resolve(request).finally(()=>{if(track)setBusy(false)});
      };
      wrapped.__v160Wrapped=true;window.fetch=wrapped;
    }
  }

  function actionButton(label){
    const wanted=norm(label);
    return Array.from(document.querySelectorAll('.sidebar .nav button')).find(button=>norm(button.textContent).includes(wanted));
  }
  function clickAction(label){
    const button=actionButton(label);
    if(button&&!button.hidden&&getComputedStyle(button).display!=='none'){button.click();return true}
    return false;
  }

  const desktopActions=[
    {icon:'🏠',title:'Painel',detail:'Visão geral e indicadores',keywords:'inicio dashboard resumo',run:()=>clickAction('painel')},
    {icon:'📄',title:'Importar relatório PDF',detail:'Registrar entradas com conferência segura',keywords:'leite arquivo milkwork',run:()=>typeof window.v108AbrirEntradaPDF==='function'?window.v108AbrirEntradaPDF():clickAction('nova entrada')},
    {icon:'💧',title:'Nova entrada de leite',detail:'Lançamento manual',keywords:'recebimento litros manha tarde',run:()=>clickAction('nova entrada')},
    {icon:'✏️',title:'Editar recebimentos',detail:'Corrigir lançamentos já registrados',keywords:'alterar leite',run:()=>clickAction('editar recebimentos')},
    {icon:'👥',title:'Produtores',detail:'Cadastro e gestão',keywords:'pessoas fornecedor',run:()=>clickAction('produtores')},
    {icon:'🔎',title:'Pesquisa do produtor',detail:'Ficha completa e movimentações',keywords:'buscar ficha cadastro',run:()=>clickAction('pesquisa')},
    {icon:'💰',title:'Pagamentos',detail:'Prévia e fechamento da quinzena',keywords:'pagar localidade quinzena',run:()=>clickAction('pagamentos')},
    {icon:'🏷️',title:'Débitos',detail:'Descontos do PDV e Galpão',keywords:'divida desconto',run:()=>clickAction('debitos')},
    {icon:'📦',title:'Estoque / Galpão',detail:'Pedidos, produtos e liberações',keywords:'racao soja milho pedido',run:()=>clickAction('estoque')},
    {icon:'🛒',title:'Loja / PDV',detail:'Vendas e caixa',keywords:'venda produto caixa',run:()=>clickAction('loja')},
    {icon:'⚖️',title:'Conferência de tanques',detail:'Coletas e diferenças a cada 2 dias',keywords:'caminhao retirada tanque',run:()=>clickAction('conferencia de tanques')},
    {icon:'🧾',title:'Comprovantes',detail:'Impressão e consulta',keywords:'imprimir recibo pagamento whatsapp',run:()=>clickAction('comprovantes')},
    {icon:'📊',title:'Relatórios',detail:'Gráficos e resultados',keywords:'relacao imprimir',run:()=>clickAction('relatorios')},
    {icon:'⚙️',title:'Configurações',detail:'Administração do sistema',keywords:'ajustes limpar dados localidade',run:()=>clickAction('configuracoes')}
  ];

  const mobileActions=[
    {icon:'🏠',title:'Início',detail:'Tela principal',keywords:'home painel',run:()=>{const b=document.querySelector('[data-home]');if(b)b.click()}},
    {icon:'💧',title:'Entrada de leite',detail:'Novo lançamento',keywords:'leite recebimento litros',run:()=>typeof window.go==='function'&&window.go('entrada')},
    {icon:'💰',title:'Pagamentos',detail:'Fechar quinzena por localidade',keywords:'pagar debitos',run:()=>window.V157Mobile&&window.V157Mobile.openPayments()},
    {icon:'⚖️',title:'Conferência de tanques',detail:'Coletas e diferenças',keywords:'tanque caminhao retirada',run:()=>window.V157Mobile&&window.V157Mobile.openTanks()},
    {icon:'👥',title:'Produtores',detail:'Cadastro e pesquisa',keywords:'buscar pessoa',run:()=>typeof window.go==='function'&&window.go('produtores')},
    {icon:'📦',title:'Estoque / Galpão',detail:'Produtos e estoque',keywords:'racao soja milho',run:()=>typeof window.go==='function'&&window.go('estoque')},
    {icon:'🛒',title:'Loja / PDV',detail:'Vendas e caixa',keywords:'produto venda',run:()=>typeof window.go==='function'&&window.go('pdv')},
    {icon:'📋',title:'Histórico',detail:'Movimentações registradas',keywords:'relatorio registro',run:()=>typeof window.go==='function'&&window.go('historico')}
  ];

  function producers(){
    if(window.V157MobileBridge&&typeof window.V157MobileBridge.getState==='function'){
      const current=window.V157MobileBridge.getState();return Array.isArray(current&&current.produtores)?current.produtores:[];
    }
    try{return typeof produtores!=='undefined'&&Array.isArray(produtores)?produtores:[]}catch(_e){return []}
  }

  function openProducer(producer){
    closeSearch();
    if(isMobile()){
      if(typeof window.go==='function')window.go('produtores');
      setTimeout(()=>{const input=document.getElementById('prodSearch');if(input){input.value=producer.nome||'';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus()}},100);
      return;
    }
    clickAction('pesquisa');
    setTimeout(()=>{const input=document.getElementById('busca');if(input){input.value=producer.nome||'';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus()}},80);
  }

  let modal,input,results;
  function createSearch(){
    if(document.querySelector('.v160-search-modal'))return;
    modal=document.createElement('div');modal.className='v160-search-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Pesquisa geral do sistema');
    modal.innerHTML='<div class="v160-search-dialog"><div class="v160-search-field"><span>⌕</span><input id="v160GlobalInput" autocomplete="off" placeholder="Pesquise produtor, código ou função do sistema"><button class="v160-search-close" type="button" aria-label="Fechar">×</button></div><div class="v160-search-results" id="v160GlobalResults"></div><div class="v160-search-foot"><span>Digite para pesquisar em todo o programa</span><span>ESC fecha • Enter abre</span></div></div>';
    document.body.appendChild(modal);input=modal.querySelector('input');results=modal.querySelector('.v160-search-results');
    modal.querySelector('.v160-search-close').addEventListener('click',closeSearch);
    modal.addEventListener('mousedown',event=>{if(event.target===modal)closeSearch()});
    input.addEventListener('input',renderSearch);
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){const first=results.querySelector('.v160-search-result');if(first)first.click()}});
    renderSearch();
  }
  function openSearch(seed){
    createSearch();modal.classList.add('on');document.body.style.overflow='hidden';input.value=seed||'';renderSearch();setTimeout(()=>input.focus(),20);
  }
  function closeSearch(){
    if(modal)modal.classList.remove('on');document.body.style.overflow='';
  }
  function addSearchResult(item,type){
    const button=document.createElement('button');button.type='button';button.className='v160-search-result';
    button.innerHTML='<span class="ri">'+esc(item.icon||'•')+'</span><span><strong>'+esc(item.title)+'</strong><small>'+esc(item.detail||'')+'</small></span><span class="ra">›</span>';
    button.addEventListener('click',()=>{closeSearch();item.run()});results.appendChild(button);
  }
  function renderSearch(){
    if(!results)return;
    const query=norm(input&&input.value),actions=isMobile()?mobileActions:desktopActions;
    const foundActions=actions.filter(item=>!query||norm(item.title+' '+item.detail+' '+item.keywords).includes(query)).slice(0,8);
    const foundProducers=query?producers().filter(p=>norm((p.nome||'')+' '+(p.codigo||p.cod||'')+' '+(p.local||'')).includes(query)).slice(0,12):[];
    results.innerHTML='';
    if(foundActions.length){const title=document.createElement('div');title.className='v160-search-section';title.textContent='Funções';results.appendChild(title);foundActions.forEach(item=>addSearchResult(item,'action'))}
    if(foundProducers.length){const title=document.createElement('div');title.className='v160-search-section';title.textContent='Produtores';results.appendChild(title);foundProducers.forEach(p=>addSearchResult({icon:'👤',title:p.nome||'Produtor',detail:'Código '+(p.codigo||p.cod||p.id||'—')+' • '+(p.local||'Sem localidade'),run:()=>openProducer(p)},'producer'))}
    if(!foundActions.length&&!foundProducers.length)results.innerHTML='<div class="v160-search-empty"><b>Nenhum resultado encontrado</b>Tente parte do nome, código do produtor ou o nome de uma função.</div>';
  }

  function createTopbar(){
    const hero=document.querySelector('.main>.hero');if(!hero||document.querySelector('.v160-topbar'))return;
    const bar=document.createElement('div');bar.className='v160-topbar';
    bar.innerHTML='<button class="v160-global-trigger" type="button"><span class="v160-search-icon">⌕</span><span>Pesquisar produtor, código ou função...</span><kbd>Ctrl K</kbd></button><span class="v160-connection" aria-live="polite">Sistema conectado</span>';
    hero.insertAdjacentElement('afterend',bar);bar.querySelector('button').addEventListener('click',()=>openSearch());
    updateConnection();
  }
  function updateConnection(){
    document.querySelectorAll('.v160-connection').forEach(element=>{const online=navigator.onLine;element.classList.toggle('offline',!online);element.textContent=online?'Sistema conectado':'Sem conexão'});
  }

  const groups=[
    {name:'Início',items:['painel','pesquisa']},
    {name:'Leite',items:['nova entrada','editar recebimentos','conferencia de tanques']},
    {name:'Financeiro',items:['pagamentos','debitos','comprovantes','alertas whatsapp']},
    {name:'Vendas e estoque',items:['estoque / galpao','loja / pdv']},
    {name:'Gestão',items:['produtores','relatorios','backup','usuarios e permissoes','historico / auditoria','configuracoes']}
  ];
  function organizeMenu(){
    const nav=document.querySelector('.sidebar .nav');if(!nav)return;
    if(!nav.querySelector('.v160-menu-head')){
      const head=document.createElement('div');head.className='v160-menu-head';head.innerHTML='<div class="v160-menu-search-wrap"><input class="v160-menu-search" type="search" placeholder="Filtrar opções do menu" aria-label="Filtrar opções do menu"></div><div class="v160-menu-hint"><span>Menu organizado por área</span><kbd>Ctrl K</kbd></div>';
      nav.insertBefore(head,nav.firstChild);head.querySelector('input').addEventListener('input',filterMenu);
      groups.forEach((group,index)=>{
        const box=document.createElement('div');box.className='v160-nav-group'+(index>1?' is-collapsed':'');box.dataset.group=norm(group.name);
        box.innerHTML='<div class="v160-nav-title" role="button" tabindex="0" aria-expanded="'+(index<=1?'true':'false')+'"><span>'+esc(group.name)+'</span></div><div class="v160-nav-items"></div>';
        const title=box.querySelector('.v160-nav-title');title.addEventListener('click',()=>toggleGroup(box));title.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleGroup(box)}});nav.appendChild(box);
      });
      const empty=document.createElement('div');empty.className='v160-nav-empty';empty.textContent='Nenhuma opção encontrada no menu.';nav.appendChild(empty);
    }
    const buttons=Array.from(nav.querySelectorAll('button')).filter(button=>!button.closest('.v160-menu-head'));
    buttons.forEach(button=>{
      const label=norm(button.textContent),group=groups.find(item=>item.items.some(name=>label.includes(norm(name))));
      if(label==='sair'){
        if(button.parentElement!==nav||button!==nav.lastElementChild)nav.appendChild(button);
        button.classList.add('v160-logout');return;
      }
      if(group){const box=Array.from(nav.querySelectorAll('.v160-nav-group')).find(node=>node.dataset.group===norm(group.name));const items=box&&box.querySelector('.v160-nav-items');if(items&&button.parentElement!==items)items.appendChild(button)}
    });
    nav.classList.add('v160-ready');syncActiveGroup();
  }
  function toggleGroup(box){
    const collapsed=box.classList.toggle('is-collapsed');box.querySelector('.v160-nav-title').setAttribute('aria-expanded',String(!collapsed));
  }
  function filterMenu(event){
    const nav=document.querySelector('.sidebar .nav'),query=norm(event.target.value);if(!nav)return;
    let visible=0;
    nav.querySelectorAll('.v160-nav-group').forEach(group=>{
      let groupVisible=0;group.querySelectorAll('.v160-nav-items>button').forEach(button=>{const show=!query||norm(button.textContent).includes(query);button.classList.toggle('v160-menu-filtered',!show);if(show)groupVisible++});
      group.classList.toggle('is-searching',!!query);group.style.display=groupVisible?'':'none';visible+=groupVisible;
    });
    nav.classList.toggle('v160-nav-no-results',visible===0);
  }
  function syncActiveGroup(){
    document.querySelectorAll('.v160-nav-group').forEach(group=>{
      const active=!!group.querySelector('.v160-nav-items>button.active');group.classList.toggle('has-active',active);
      if(active){group.classList.remove('is-collapsed');const title=group.querySelector('.v160-nav-title');if(title)title.setAttribute('aria-expanded','true')}
    });
  }

  function quickButton(icon,label,kind,handler){
    const button=document.createElement('button');button.type='button';button.className=kind||'';button.innerHTML='<span class="qi">'+icon+'</span><span>'+esc(label)+'</span>';button.addEventListener('click',handler);return button;
  }
  function createQuickbar(){
    const panel=document.getElementById('painel');if(!panel||panel.querySelector('.v160-quickbar'))return;
    const bar=document.createElement('div');bar.className='v160-quickbar';bar.innerHTML='<div class="v160-quick-title"><strong>⚡ Operações rápidas</strong><small>Acesse as tarefas mais usadas com um clique</small></div>';
    bar.appendChild(quickButton('📄','Importar PDF','pdf',()=>typeof window.v108AbrirEntradaPDF==='function'?window.v108AbrirEntradaPDF():clickAction('nova entrada')));
    bar.appendChild(quickButton('💧','Nova entrada','primary',()=>clickAction('nova entrada')));
    bar.appendChild(quickButton('💰','Pagamentos','',()=>clickAction('pagamentos')));
    bar.appendChild(quickButton('🏷️','Débitos','',()=>clickAction('debitos')));
    bar.appendChild(quickButton('⚖️','Tanques','',()=>clickAction('conferencia de tanques')));
    const anchor=panel.querySelector('.kpis,.v103-summary,.v144-filter-card');panel.insertBefore(bar,anchor||panel.firstChild);
  }

  function createMobileTools(){
    const grid=document.querySelector('#homeScreen .home-grid');if(!grid||document.querySelector('.v160-mobile-tools'))return;
    document.body.classList.add('v160-mobile');
    const tools=document.createElement('div');tools.className='v160-mobile-tools';
    tools.innerHTML='<label class="v160-mobile-search"><span>⌕</span><input type="search" placeholder="Buscar produtor ou função" aria-label="Buscar produtor ou função"></label><div class="v160-mobile-actions"><button class="primary" type="button" data-action="entrada"><span>💧</span>Entrada</button><button type="button" data-action="pagamento"><span>💰</span>Pagamentos</button><button type="button" data-action="tanques"><span>⚖️</span>Tanques</button><button type="button" data-action="produtores"><span>👥</span>Produtores</button></div>';
    grid.parentNode.insertBefore(tools,grid);tools.querySelector('input').addEventListener('focus',event=>{event.target.blur();openSearch()});
    tools.querySelector('[data-action="entrada"]').addEventListener('click',()=>typeof window.go==='function'&&window.go('entrada'));
    tools.querySelector('[data-action="pagamento"]').addEventListener('click',()=>window.V157Mobile&&window.V157Mobile.openPayments());
    tools.querySelector('[data-action="tanques"]').addEventListener('click',()=>window.V157Mobile&&window.V157Mobile.openTanks());
    tools.querySelector('[data-action="produtores"]').addEventListener('click',()=>typeof window.go==='function'&&window.go('produtores'));
  }

  function installKeyboard(){
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&modal&&modal.classList.contains('on')){closeSearch();return}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch()}
    });
  }
  function watchNavigation(){
    const nav=document.querySelector('.sidebar .nav');if(!nav)return;
    nav.addEventListener('click',event=>{if(event.target.closest('button'))setTimeout(syncActiveGroup,20)});
    let scheduled=false;const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;organizeMenu()},30)});observer.observe(nav,{childList:true,subtree:true});
  }

  function init(){
    installProgress();createSearch();installKeyboard();window.addEventListener('online',updateConnection);window.addEventListener('offline',updateConnection);
    if(isMobile()){createMobileTools()}else{organizeMenu();createTopbar();createQuickbar();watchNavigation()}
    document.documentElement.dataset.vdsVersion=VERSION;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
