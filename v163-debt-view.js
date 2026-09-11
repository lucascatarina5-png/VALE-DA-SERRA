(function(root){
 'use strict';
 const excluded=d=>[d?.status,d?.situacao,d?.situacaoPagamento].some(x=>/^(cancelad[oa]|excluid[oa])$/i.test(String(x||'')));
 function merge(current,incoming){
   const rows=(Array.isArray(incoming)?incoming:[]).map(d=>({...d,_v163Confirmed:true})),map=new Map(rows.map((d,i)=>[String(d.id),i]));
   for(const d of current||[]){
     if(!d?.id)continue;const i=map.get(String(d.id));
     if(i===undefined){if(d.serverSavedV162||d._v163Confirmed||d.saleId||d.movementId||d.releaseId){map.set(String(d.id),rows.length);rows.push(d)}continue;}
     // Exclusions are explicit permanent markers; a late earlier read must not resurrect them.
     if(excluded(d)&&!excluded(rows[i])||String(d.alteradoEm||'')>String(rows[i].alteradoEm||''))rows[i]=d;
   }
   return rows;
 }
 root.V163DebtView={merge,busy:false};
 if(typeof module!=='undefined'&&module.exports)module.exports={merge};
})(typeof window!=='undefined'?window:{});
