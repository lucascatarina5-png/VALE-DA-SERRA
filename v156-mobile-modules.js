(function(){
  'use strict';
  const modules={
    pagamentos:{
      screen:'screen-v156-pagamentos',
      title:'Pagamentos',
      icon:'💰',
      description:'Corte por localidade<br>manhã e tarde',
      hash:'pagamentos'
    },
    tanques:{
      screen:'screen-v156-tanques',
      title:'Conferência de Tanques',
      icon:'⚖️',
      description:'Coletas e diferenças<br>a cada 2 dias',
      hash:'conferenciaTanques'
    }
  };

  const token=()=>localStorage.getItem('vale_token')||sessionStorage.getItem('vale_token')||'';
  function bridgeSession(){
    if(token())sessionStorage.setItem('vds_logged_v1','1');
  }
  function showHome(){
    document.querySelectorAll('.screen').forEach(screen=>screen.classList.remove('active'));
    const home=document.getElementById('homeScreen');if(home)home.style.display='block';
    document.querySelectorAll('.nav-btn').forEach(button=>button.classList.toggle('active',button.hasAttribute('data-home')));
    if(typeof window.v132MobileReloadState==='function')window.v132MobileReloadState();
    window.scrollTo(0,0);
  }
  function moduleUrl(item){
    return `/desktop.html?embed=mobile&v=156#${encodeURIComponent(item.hash)}`;
  }
  function openModule(key,refresh){
    const item=modules[key],screen=document.getElementById(item?.screen);if(!item||!screen)return;
    bridgeSession();
    document.getElementById('homeScreen').style.display='none';
    document.querySelectorAll('.screen').forEach(node=>node.classList.toggle('active',node===screen));
    document.querySelectorAll('.nav-btn').forEach(button=>button.classList.remove('active'));
    const frame=screen.querySelector('.v156-module-frame'),wrap=screen.querySelector('.v156-frame-wrap'),loading=screen.querySelector('.v156-frame-loading');
    wrap.classList.remove('ready');loading.classList.remove('v156-frame-error');
    loading.innerHTML=`Abrindo ${item.title}…<span>Usando o mesmo acesso do aplicativo.</span>`;
    if(refresh||!frame.dataset.loaded){frame.dataset.loaded='1';frame.src=moduleUrl(item)}
    else wrap.classList.add('ready');
    window.scrollTo(0,0);
  }
  function createScreen(key,item){
    const screen=document.createElement('section');
    screen.id=item.screen;screen.className='screen v156-native-module';
    screen.innerHTML=`<div class="screen-head"><button class="back v156-back" type="button" aria-label="Voltar ao início">←</button><div class="screen-title">${item.icon} ${item.title}</div><button class="icon-btn v156-reload" type="button" aria-label="Atualizar">↻</button></div><div class="v156-frame-wrap"><div class="v156-frame-loading">Abrindo ${item.title}…<span>Usando o mesmo acesso do aplicativo.</span></div><iframe class="v156-module-frame" title="${item.title}" loading="eager" referrerpolicy="same-origin"></iframe></div>`;
    screen.querySelector('.v156-back').addEventListener('click',showHome);
    screen.querySelector('.v156-reload').addEventListener('click',()=>openModule(key,true));
    const frame=screen.querySelector('iframe'),wrap=screen.querySelector('.v156-frame-wrap'),loading=screen.querySelector('.v156-frame-loading');
    frame.addEventListener('load',()=>{
      try{
        const doc=frame.contentDocument;
        if(!doc||!doc.documentElement.classList.contains('v156-mobile-embed'))throw new Error('Tela incompatível');
        wrap.classList.add('ready');
      }catch(_){
        loading.classList.add('v156-frame-error');
        loading.innerHTML=`Não foi possível abrir ${item.title}.<span>Toque em ↻ para tentar novamente.</span>`;
      }
    });
    document.getElementById('app').appendChild(screen);
  }
  function createTile(key,item){
    const grid=document.querySelector('.home-grid');if(!grid)return;
    const button=document.createElement('button');
    button.type='button';button.className='home-tile v156-module-tile';button.dataset.v156Module=key;
    button.innerHTML=`<span class="tile-ico">${item.icon}</span><span class="tile-title">${item.title}</span><small>${item.description}</small>`;
    button.addEventListener('click',()=>openModule(key,false));grid.appendChild(button);
  }
  bridgeSession();
  Object.entries(modules).forEach(([key,item])=>{createScreen(key,item);createTile(key,item)});
  window.V156MobileModules={open:openModule,home:showHome};
})();
