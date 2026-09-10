// Explicit, manual local-server benchmark; never part of public-service tests.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const count=Number(process.argv[2]??100);
if(!Number.isInteger(count)||count<1||count>10000)throw new Error('Choose 1–10000 pairs.');
const network=JSON.parse(readFileSync(path.join(root,'public/data/idfm-transit.json'),'utf8'));
const points=[...new Map(network.stops.map(s=>[`${s.lon},${s.lat}`,[s.lon,s.lat]])).values()];
let seed=90310;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let i=points.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[points[i],points[j]]=[points[j],points[i]];}
if(count*2>points.length)throw new Error('Not enough distinct endpoints in the fixture.');
const pairs=Array.from({length:count},(_,i)=>[points[i*2],points[i*2+1]]);
const result={date:new Date().toISOString(),pairs:count,concurrency:2,fixture:'Distinct GTFS stop coordinates, shuffled seed 90310; identical pairs per profile; full GeoJSON; no response cache',profiles:[]};
for(const profile of ['foot-walking','cycling-regular','driving-car']){
 const timings=[],errors={};let next=0,success=0,vertices=0,bytes=0;
 const start=performance.now();
 await Promise.all(Array.from({length:2},async()=>{
   while(next<count){const index=next++;const at=performance.now();
     try{
       const response=await fetch(`http://127.0.0.1:8082/ors/v2/directions/${profile}/geojson`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({coordinates:pairs[index],elevation:false}),signal:AbortSignal.timeout(60000)});
       const text=await response.text();const data=JSON.parse(text);
       if(response.ok && data.features?.[0]?.geometry?.coordinates?.length>1){success++;vertices+=data.features[0].geometry.coordinates.length;bytes+=Buffer.byteLength(text);}
       else{const key=`${response.status}:${data.error?.code??'invalid-geometry'}`;errors[key]=(errors[key]??0)+1;}
     }catch(error){errors[error.name]=(errors[error.name]??0)+1;}
     timings.push(performance.now()-at);
   }
 }));
 const seconds=(performance.now()-start)/1000;timings.sort((a,b)=>a-b);
 const row={profile,success,failed:count-success,seconds,requestsPerSecond:count/seconds,p50Ms:timings[Math.floor(timings.length*.5)],p95Ms:timings[Math.min(timings.length-1,Math.floor(timings.length*.95))],vertices,bytes,errors};
 result.profiles.push(row);console.log(JSON.stringify(row));
}
const output=path.join(root,'.local-ors',`benchmark-${count}.json`);
writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(output);
