const sharp=require('sharp');
const cache=new Map();const pending=new Map();let bytes=0;
module.exports=async function thumbnail(id,version,photo){
 if(!photo||!/^data:image\/(png|jpeg|webp);base64,/.test(photo))return photo;
 const key=id+':'+version;if(cache.has(key))return cache.get(key);
 if(pending.has(key))return pending.get(key);
 const job=(async()=>{try{
 const raw=Buffer.from(photo.slice(photo.indexOf(',')+1),'base64');
 const buf=await sharp(raw,{limitInputPixels:40000000}).rotate().resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer();
 const result=buf.length<raw.length?'data:image/webp;base64,'+buf.toString('base64'):photo;
 if(result.length<=2000000){while(cache.size&&(bytes+result.length>24000000||cache.size>=120)){const first=cache.keys().next().value;bytes-=cache.get(first).length;cache.delete(first)}cache.set(key,result);bytes+=result.length}return result;
 }catch(_){return photo}finally{pending.delete(key)}})();pending.set(key,job);return job;
};
