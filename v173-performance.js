(function(){
  'use strict';
  if(window.ValePerformance?.version>=173)return;
  const nativeFetch=window.fetch.bind(window),inflight=new Map(),recent=new Map();
  const normalizedUrl=input=>typeof input==='string'?input:String(input?.url||'');
  const eligible=(url,method)=>method==='GET'&&(/^\/api\/(?:state|inventory\/products|inventory\/orders)/.test(url)||url.includes('/api/state'));
  window.fetch=function(input,init){
    const method=String(init?.method||input?.method||'GET').toUpperCase(),url=normalizedUrl(input);
    if(!eligible(url,method))return nativeFetch(input,init);
    const key=method+' '+url,now=Date.now(),cached=recent.get(key);
    if(cached&&now-cached.at<900)return Promise.resolve(cached.response.clone());
    if(inflight.has(key))return inflight.get(key).then(response=>response.clone());
    const pending=nativeFetch(input,init).then(response=>{if(response.ok)recent.set(key,{at:Date.now(),response:response.clone()});return response});
    inflight.set(key,pending);pending.finally(()=>setTimeout(()=>inflight.delete(key),80));
    return pending.then(response=>response.clone());
  };
  const metrics={longTasks:0,lastLongTask:0};
  if('PerformanceObserver'in window){try{const observer=new PerformanceObserver(list=>{for(const item of list.getEntries()){metrics.longTasks++;metrics.lastLongTask=Math.round(item.duration)}});observer.observe({type:'longtask',buffered:true})}catch(_){}}
  window.addEventListener('unhandledrejection',event=>{console.warn('V173 operação não concluída:',event.reason?.message||event.reason||'erro')});
  window.ValePerformance=Object.freeze({version:173,metrics,status:()=>({requests:inflight.size,cache:recent.size,...metrics})});
})();
