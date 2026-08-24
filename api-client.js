/* Vale da Serra - PostgreSQL + autenticação centralizada */
(() => {
  const KEYS=['vds_produtores_v1','vds_lancamentos_v1','vds_pagamentos_v1','vds_debitos_v1','vds_debitos_pagamentos_v1','vds_fechamentos_v1'];
  let applyingRemote=false,timer=null; const originalSetItem=localStorage.setItem.bind(localStorage);
  const token=()=>sessionStorage.getItem('vds_token_v2')||'';
  const headers=()=>({'Content-Type':'application/json','Authorization':'Bearer '+token()});
  function readLocal(){const out={};for(const k of KEYS){try{out[k]=JSON.parse(localStorage.getItem(k)||'[]')}catch{out[k]=[]}}return out;}
  function hasUsefulData(s){return KEYS.some(k=>Array.isArray(s[k])&&s[k].length)}
  async function pushNow(){if(!token())return;try{const r=await fetch('/api/state',{method:'PUT',headers:headers(),body:JSON.stringify({data:readLocal()})});if(!r.ok)throw new Error(await r.text());window.vdsServidorOnline=true;}catch(e){window.vdsServidorOnline=false;console.error('Falha ao sincronizar:',e)}}
  function schedulePush(){if(applyingRemote||!token())return;clearTimeout(timer);timer=setTimeout(pushNow,350)}
  localStorage.setItem=function(k,v){originalSetItem(k,v);if(KEYS.includes(k))schedulePush()};
  function applyToRuntime(state){applyingRemote=true;for(const k of KEYS)originalSetItem(k,JSON.stringify(state[k]||[]));try{produtores=state.vds_produtores_v1||[];lancamentos=state.vds_lancamentos_v1||[];pagamentos=state.vds_pagamentos_v1||[];debitos=state.vds_debitos_v1||[];pagamentosDebitos=state.vds_debitos_pagamentos_v1||[];fechamentos=state.vds_fechamentos_v1||[];if(typeof renderAll==='function')renderAll(typeof secaoAtivaAtual==='function'?secaoAtivaAtual():'painel')}catch(e){console.warn('Atualize a tela.',e)}applyingRemote=false;}
  async function start(){if(!token())return;try{const r=await fetch('/api/state',{headers:headers(),cache:'no-store'});if(!r.ok)throw new Error(await r.text());const j=await r.json(),local=readLocal();if(j.exists&&j.data&&hasUsefulData(j.data))applyToRuntime(j.data);else if(hasUsefulData(local))await pushNow();else if(j.exists&&j.data)applyToRuntime(j.data);window.vdsServidorOnline=true;}catch(e){console.error('Servidor indisponível:',e)}}
  window.vdsSincronizarAgora=pushNow; window.vdsCarregarServidor=start; window.vdsApiHeaders=headers;
  if(token())start();
})();
