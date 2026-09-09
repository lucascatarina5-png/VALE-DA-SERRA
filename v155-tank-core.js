(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V155TankCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const number=value=>{
    const n=Number(String(value??0).replace(',','.'));
    return Number.isFinite(n)?n:0;
  };
  const round=value=>Math.round((number(value)+Number.EPSILON)*100)/100;
  const norm=value=>String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');

  function validLocalDateTime(value){
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value||''));
  }
  function abstractDate(value){
    if(!validLocalDateTime(value))return null;
    const d=new Date(String(value)+':00.000Z');
    return Number.isNaN(d.getTime())?null:d;
  }
  function addHours(value,hours){
    const d=abstractDate(value);
    if(!d)return '';
    d.setUTCHours(d.getUTCHours()+number(hours));
    return d.toISOString().slice(0,16);
  }
  function hoursBetween(start,end){
    const a=abstractDate(start),b=abstractDate(end);
    return !a||!b?0:round((b-a)/3600000);
  }
  function entryMoment(entry){
    const date=String(entry?.data||entry?.date||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';
    const exact=String(entry?.hora||entry?.time||'').match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)/);
    if(exact)return `${date}T${String(exact[1]).padStart(2,'0')}:${exact[2]}`;
    const turn=norm(entry?.turno||entry?.periodo||entry?.turn||'');
    return `${date}T${turn==='T'||turn.includes('TARDE')?'16:00':'08:00'}`;
  }
  function actualLocality(entry,producer){
    return String(entry?.local||entry?.localidadeEntrega||entry?.deliveryLocality||producer?.local||'').trim();
  }
  function calculateBalance(input){
    const opening=number(input?.opening);
    const registered=number(input?.registered);
    const transfersIn=number(input?.transfersIn);
    const collected=number(input?.collected);
    const ending=number(input?.ending);
    const transfersOut=number(input?.transfersOut);
    const discarded=number(input?.discarded);
    const available=round(opening+registered+transfersIn);
    const accounted=round(collected+ending+transfersOut+discarded);
    const difference=round(available-accounted);
    const base=Math.max(registered,available,0);
    const warning=Math.max(number(input?.warningLiters),base*number(input?.warningPercent)/100);
    const critical=Math.max(number(input?.criticalLiters),base*number(input?.criticalPercent)/100,warning);
    const absolute=Math.abs(difference);
    const status=absolute<=warning?'ok':absolute<=critical?'atencao':'critica';
    return {
      opening:round(opening),registered:round(registered),transfersIn:round(transfersIn),
      collected:round(collected),ending:round(ending),transfersOut:round(transfersOut),discarded:round(discarded),
      available,accounted,difference,absolute:round(absolute),warning:round(warning),critical:round(critical),status
    };
  }
  function statusLabel(status){
    return ({ok:'Conferido',atencao:'Atenção',critica:'Diferença crítica',cancelada:'Cancelada'})[String(status||'')]||'Pendente';
  }

  return {number,round,norm,validLocalDateTime,addHours,hoursBetween,entryMoment,actualLocality,calculateBalance,statusLabel};
});
