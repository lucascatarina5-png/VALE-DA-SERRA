(function(){
'use strict';
if(window.ValeMascotAssistant?.version>=170)return;
const E=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const token=()=>localStorage.getItem('vale_token')||sessionStorage.getItem('vale_token')||'';
const time=value=>{try{return new Date(value).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}catch(_){return''}};
let panel,currentResult=null;
let memory=[];try{memory=JSON.parse(localStorage.getItem('vds_v170_conversation')||'[]');if(!Array.isArray(memory))memory=[]}catch(_){memory=[]}
let lastContext=memory.length?memory[memory.length-1]:null;

function ensurePanel(){
 if(panel)return panel;
 const style=document.createElement('style');style.textContent=`#v169Assistant{position:fixed;z-index:2147483000;left:12px;right:12px;bottom:82px;max-width:590px;margin:auto;background:#fff;color:#172033;border:2px solid #f3c72d;border-radius:20px;box-shadow:0 18px 55px rgba(7,32,70,.28);display:none;overflow:hidden;font-family:Arial,sans-serif}#v169Assistant.open{display:block}#v169Assistant header{background:#074993;color:#fff;padding:13px 15px;display:flex;align-items:center;gap:10px}#v169Assistant header b{flex:1;font-size:16px}#v169AssistantClose{border:0;background:rgba(255,255,255,.16);color:#fff;width:34px;height:34px;border-radius:10px;font-size:20px}#v169AssistantBody{padding:14px;max-height:56vh;overflow:auto}.v169-q{font-size:12px;color:#637083;margin-bottom:8px}.v169-a{font-weight:800;line-height:1.45;color:#103966}.v169-meta{font-size:11px;color:#778397;margin:8px 0}.v169-row{padding:10px 0;border-top:1px solid #e9edf3}.v169-row b{display:block;font-size:14px}.v169-row small{display:block;color:#657184;margin-top:4px;line-height:1.35}.v169-loading{color:#657184}.v169-action{width:100%;min-height:45px;border:0;border-radius:11px;background:#0b57b7;color:#fff;font-weight:900;margin-top:10px}.v169-alert{border-left:5px solid #efa900;padding-left:10px}.v169-alert.critical{border-color:#d72e2e}`;document.head.appendChild(style);
 style.textContent+=' .v170-calculation{margin-top:10px;padding:10px;border-radius:10px;background:#eef6ff;color:#31587f;font-size:12px;line-height:1.45}@media print{body>*{display:none!important}#v170Print{display:block!important;position:static!important;color:#111!important;font:13px Arial!important}#v170Print table{width:100%;border-collapse:collapse}#v170Print td{border-bottom:1px solid #ddd;padding:8px}}';
 panel=document.createElement('section');panel.id='v169Assistant';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Resposta da vaquinha inteligente');panel.innerHTML='<header><span>🐮</span><b>Assistente Administrativa • V170</b><button id="v169AssistantClose" aria-label="Fechar">×</button></header><div id="v169AssistantBody"></div>';document.body.appendChild(panel);document.getElementById('v169AssistantClose').onclick=()=>panel.classList.remove('open');return panel;
}
function actionHtml(action){return action?.label?`<button class="v169-action" id="v169AssistantAction">${E(action.label)}</button>`:''}
function show(question,result,loading=false){
 const box=ensurePanel(),body=box.querySelector('#v169AssistantBody');box.classList.add('open');currentResult=result;
 body.innerHTML=loading?'<div class="v169-loading">Consultando e analisando os dados atualizados...</div>':'<div class="v169-q">'+(question?'Pergunta: '+E(question):'Aviso automático')+'</div><div class="v169-a">'+E(result.answer||'')+'</div><div class="v169-meta">Dados consultados às '+E(time(result.generated_at||new Date()))+'</div>'+((result.details||[]).map(row=>'<div class="v169-row"><b>'+E(row.title||'')+'</b><small>'+E(row.subtitle||row.message||'')+'</small></div>').join(''))+(result.calculation?'<div class="v170-calculation"><b>Como calculei:</b><br>'+E(result.calculation)+'</div>':'')+actionHtml(result.action);
 const actionButton=box.querySelector('#v169AssistantAction');if(actionButton)actionButton.onclick=()=>handleAction(result.action,result);
}
function deliver(result){try{if(window.ValeMascot?.answer)window.ValeMascot.answer(JSON.stringify(result));else if(window.ValeMascot?.speak)window.ValeMascot.speak(result.answer||'')}catch(_){}document.dispatchEvent(new CustomEvent('vds:mascot-answer',{detail:result}))}
function navigate(action){
 if(!action)return false;const desktop=action.target,mobile=action.mobileTarget||desktop;
 try{
  if(typeof window.showSection==='function'&&document.getElementById(desktop)){window.showSection(desktop);if(desktop==='estoque'&&typeof window.estoqueCarregar==='function')setTimeout(window.estoqueCarregar,50);if(desktop==='loja'&&typeof window.lojaCarregar==='function')setTimeout(window.lojaCarregar,50);return true}
  if(typeof window.go==='function'){window.go(mobile);return true}
  const button=document.querySelector(`[data-go="${CSS.escape(mobile)}"]`);if(button){button.click();return true}
 }catch(_){}return false;
}
function printResult(result=currentResult){
 if(!result)return;let paper=document.getElementById('v170Print');if(!paper){paper=document.createElement('article');paper.id='v170Print';document.body.appendChild(paper)}
 paper.innerHTML='<h1>Vale da Serra</h1><h2>Relatório da Vaquinha Inteligente</h2><p>'+E(result.answer||'')+'</p><p><small>Gerado em '+E(new Date(result.generated_at||Date.now()).toLocaleString('pt-BR'))+'</small></p><table>'+((result.details||[]).map(row=>'<tr><td><b>'+E(row.title||'')+'</b><br><small>'+E(row.subtitle||row.message||'')+'</small></td></tr>').join(''))+'</table>'+(result.calculation?'<h3>Critério do cálculo</h3><p>'+E(result.calculation)+'</p>':'');window.print();
}
function handleAction(action,result){if(action?.type==='report'){printResult(result);return true}return navigate(action)}
async function request(url,options={}){const headers={...(options.headers||{})},tk=token();if(tk)headers.Authorization='Bearer '+tk;if(options.body)headers['Content-Type']='application/json';const response=await fetch(url,{...options,headers,cache:'no-store'});let result={};try{result=await response.json()}catch(_){result={ok:false,error:'Resposta inválida do servidor.'}}if(!response.ok||result.ok===false)throw new Error(result.error||'Não foi possível consultar.');return result}
async function ask(question){
 question=String(question||'').trim();if(!question)return;show(question,{},true);
 try{const result=await request('/api/mascot/query',{method:'POST',body:JSON.stringify({question,context:{...lastContext,history:memory.slice(-6)}})});lastContext={intent:result.intent||'',entity:result.entity||'',question};memory.push(lastContext);memory=memory.slice(-6);try{localStorage.setItem('vds_v170_conversation',JSON.stringify(memory))}catch(_){}show(question,result);deliver(result);if(['navigate','safe-draft'].includes(result.intent))setTimeout(()=>navigate(result.action),450);return result}
 catch(error){const result={ok:false,question,answer:error.message||'Não foi possível consultar os dados.',details:[],generated_at:new Date().toISOString()};show(question,result);deliver(result);return result}
}
async function checkAlerts(force=false){
 if(!token())return null;const key='vds_v170_alert_check',last=Number(localStorage.getItem(key)||0);if(!force&&Date.now()-last<30*60*1000)return null;
 localStorage.setItem(key,String(Date.now()));
 try{const result=await request('/api/mascot/alerts');if(!(result.alerts||[]).length)return result;const important=result.alerts.filter(x=>x.severity==='critical'||x.severity==='warning');if(!important.length)return result;const first=important[0];const view={...result,details:important.map(x=>({title:x.title,subtitle:x.message})),action:{type:'navigate',target:first.target,mobileTarget:first.mobileTarget,label:'Ver primeiro aviso'}};show('',view);deliver({...view,answer:result.answer+' O primeiro aviso é: '+first.title+'. '+first.message});return result}catch(_){return null}
}
window.ValeMascotAssistant=Object.freeze({version:170,ask,checkAlerts,printResult,open:ensurePanel,close:()=>panel?.classList.remove('open'),navigate});
document.dispatchEvent(new CustomEvent('vds:mascot-assistant-ready',{detail:{version:170}}));setTimeout(()=>checkAlerts(false),5500);
})();
