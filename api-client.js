/* Vale da Serra - sincronização automática Railway/PostgreSQL */
(() => {
  const KEYS = ['vds_produtores_v1','vds_lancamentos_v1','vds_pagamentos_v1','vds_debitos_v1','vds_debitos_pagamentos_v1','vds_fechamentos_v1'];
  let applyingRemote = false;
  let timer = null;
  const originalSetItem = localStorage.setItem.bind(localStorage);

  function readLocal() {
    const out = {};
    for (const k of KEYS) {
      try { out[k] = JSON.parse(localStorage.getItem(k) || '[]'); } catch { out[k] = []; }
    }
    return out;
  }
  function hasUsefulData(s) { return KEYS.some(k => Array.isArray(s[k]) && s[k].length); }
  async function pushNow() {
    try {
      const r = await fetch('/api/state', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:readLocal()})});
      if (!r.ok) throw new Error(await r.text());
      window.vdsServidorOnline = true;
    } catch (e) { window.vdsServidorOnline = false; console.error('Falha ao sincronizar:', e); }
  }
  function schedulePush() {
    if (applyingRemote) return;
    clearTimeout(timer); timer = setTimeout(pushNow, 350);
  }
  localStorage.setItem = function(k,v) { originalSetItem(k,v); if (KEYS.includes(k)) schedulePush(); };

  function applyToRuntime(state) {
    applyingRemote = true;
    for (const k of KEYS) originalSetItem(k, JSON.stringify(state[k] || []));
    try {
      produtores = state.vds_produtores_v1 || [];
      lancamentos = state.vds_lancamentos_v1 || [];
      pagamentos = state.vds_pagamentos_v1 || [];
      debitos = state.vds_debitos_v1 || [];
      pagamentosDebitos = state.vds_debitos_pagamentos_v1 || [];
      fechamentos = state.vds_fechamentos_v1 || [];
      if (typeof renderAll === 'function') renderAll(typeof secaoAtivaAtual === 'function' ? secaoAtivaAtual() : 'painel');
    } catch (e) { console.warn('Dados salvos; atualização visual ocorrerá ao recarregar.', e); }
    applyingRemote = false;
  }

  async function start() {
    try {
      const r = await fetch('/api/state', {cache:'no-store'});
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const local = readLocal();
      if (j.exists && j.data && hasUsefulData(j.data)) applyToRuntime(j.data);
      else if (hasUsefulData(local)) await pushNow();
      else if (j.exists && j.data) applyToRuntime(j.data);
      window.vdsServidorOnline = true;
      console.log('Vale da Serra: PostgreSQL sincronizado.');
    } catch (e) { window.vdsServidorOnline = false; console.error('Servidor indisponível; mantendo dados locais.', e); }
  }
  window.vdsSincronizarAgora = pushNow;
  start();
})();
