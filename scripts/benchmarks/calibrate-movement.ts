/** Bounded experiment: route each candidate once, retain scalar scores only, never export paths. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {asyncBufferFromFile} from 'hyparquet';
import {importNetmob} from '../../src/lib/netmobData';
import {DEFAULT_FIT,type NetmobRecord} from '../../src/lib/netmobTypes';
import {fitRecord,routingContext} from '../../src/lib/netmobRouting';
import {OrsClient} from '../../src/lib/orsClient';
import {buildMovementPlan,DEFAULT_SIMULATION,type SimulationSettings} from '../../src/lib/movementSimulation';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const seed='movement-calibration-20260920-b';
const source='local/emg-base-des-deplacements.parquet';
const dataset=await importNetmob(await asyncBufferFromFile(source),'emg',createHash('sha256').update(readFileSync(source)).digest('hex'),JSON.parse(readFileSync('public/data/netmob-boundaries.json','utf8')).areas);
const participant=(r:NetmobRecord)=>r.key.split('-')[0];
const stage=process.env.MOVEMENT_CALIBRATION_STAGE==='fixed'?'fixed':'road';
const oldPath=existsSync('local/movement-pilot-results.json')?'local/movement-pilot-results.json':'.benchmark-output/movement/results.json';
const old=existsSync(oldPath)?JSON.parse(readFileSync(oldPath,'utf8')):{experiments:[{rows:[]}]};
const excludedParticipants=new Set<string>(old.experiments[0].rows.map((r:{row:number})=>participant(dataset.records[r.row])));
const eligible=dataset.records.filter(r=>!r.exclusions.length&&r.durationS!==null&&r.durationS>0&&r.departure&&!excludedParticipants.has(participant(r)));
const split=(r:NetmobRecord)=>parseInt(digest(seed+':split:'+participant(r)).slice(0,8),16)%5;
const splits=['train','validation','test'] as const;
const counts=stage==='fixed'?[240,120,240]:[240,120,0];
const groups=splits.map((_,i)=>eligible.filter(r=>{const n=split(r);return i===0?n<2:i===1?n===2:n>2;}).sort((a,b)=>digest(seed+':row:'+a.key).localeCompare(digest(seed+':row:'+b.key))).slice(0,counts[i]));
// Register the complete modest grid before viewing any held-out scores. Cruise values are assumptions.
const profiles:SimulationSettings[]=[];
let base:number;
if(stage==='fixed'){
 for(const walking of [4.2,4.8,5.4])for(const driving of [30,40,50])for(const rate of [0,.5,1,1.5,2])for(const dwell of [15,25,35])profiles.push({...DEFAULT_SIMULATION,roadStopsPerKm:rate,roadWaitS:25,stationDwellS:dwell,cruiseKmh:{walking,driving},roadCruiseSource:'fixed'});
 base=profiles.findIndex(p=>p.cruiseKmh!.walking===4.8&&p.cruiseKmh!.driving===40&&p.roadStopsPerKm===1&&p.stationDwellS===25);
}else{
 for(const walking of [4.8,5.4])for(const factor of [1,1.1,1.2])for(const rate of [0,.25,.5,1])for(const wait of [15,25])for(const dwell of [15,25])profiles.push({...DEFAULT_SIMULATION,roadStopsPerKm:rate,roadWaitS:wait,stationDwellS:dwell,cruiseKmh:{walking,driving:40},roadCruiseSource:'routing',roadCruiseFactor:factor});
 base=profiles.length;profiles.push({...DEFAULT_SIMULATION,roadStopsPerKm:1,roadWaitS:25,stationDwellS:25,cruiseKmh:{walking:4.8,driving:40},roadCruiseSource:'fixed'});
}
const network=JSON.parse(gunzipSync(readFileSync('public/data/idfm-netmob-transit.json.gz')).toString());
const timing=JSON.parse(gunzipSync(readFileSync('public/data/idfm-timing.json.gz')).toString());
const ctx=routingContext(new OrsClient({apiKey:'',local:true,maxRetries:0}),new AbortController().signal,network,timing);
type Scores={routing:number;duration:number[];candidate:number};
type Row={row:number;key:string;participant:string;split:typeof splits[number];mode:string;within:boolean;target:number;candidates:Scores[];error?:string};
const rows:Row[]=[];let simulationMs=0,candidates=0,vertices=0;const start=performance.now();
for(let group=0;group<groups.length;group++)for(const record of groups[group]){
 const row:Row={row:record.rowIndex,key:record.key,participant:participant(record),split:splits[group],mode:String(record.raw.mode_principal),within:record.origin===record.destination,target:record.durationS!,candidates:[]};
 ctx.onCandidate=(pair,legs,routing,identity)=>{const t=performance.now();const duration=profiles.map(p=>buildMovementPlan(legs,p,null,identity,{durationOnly:true}).durationS);simulationMs+=performance.now()-t;candidates++;vertices+=legs.reduce((n,l)=>n+l.coordinates.length,0);row.candidates.push({routing,duration,candidate:pair.candidate});};
 try{await fitRecord(ctx,dataset.summary.id,record,dataset.areas,{...DEFAULT_FIT,durationModel:'routing'});}catch(e){row.error=String(e);if(e instanceof TypeError)throw e;}
 rows.push(row);if(rows.length%20===0)console.error(`${rows.length}/${counts.reduce((a,b)=>a+b,0)} ${stage} records; ${ctx.requests} local requests; ${Math.round((performance.now()-start)/1000)} s`);
}
const tolerance=(r:Row)=>Math.max(180,r.target*.2);
function metrics(data:Row[],profile:number,selectMovement:boolean){
 const results=data.filter(r=>r.candidates.length).map(r=>{const byRoute=r.candidates.reduce((a,b)=>Math.abs(b.routing-r.target)<Math.abs(a.routing-r.target)?b:a);const candidate=selectMovement?r.candidates.reduce((a,b)=>Math.abs(b.duration[profile]-r.target)<Math.abs(a.duration[profile]-r.target)?b:a):byRoute;const error=candidate.duration[profile]-r.target;return {error,acceptable:Math.abs(error)<=tolerance(r),normalized:Math.min(5,Math.abs(error)/tolerance(r)),changed:candidate!==byRoute};});
 const sorted=results.map(r=>Math.abs(r.error)).sort((a,b)=>a-b);
 return {requested:data.length,routed:results.length,acceptable:results.filter(r=>r.acceptable).length,changed:results.filter(r=>r.changed).length,maeMin:results.reduce((s,r)=>s+Math.abs(r.error),0)/results.length/60,biasMin:results.reduce((s,r)=>s+r.error,0)/results.length/60,medianMin:sorted[Math.floor(sorted.length/2)]/60,p90Min:sorted[Math.floor(sorted.length*.9)]/60,loss:results.reduce((s,r)=>s+r.normalized,0)/results.length};
}
const train=rows.filter(r=>r.split==='train'),validation=rows.filter(r=>r.split==='validation'),test=rows.filter(r=>r.split==='test');
// Calibrate on the ORIGINAL fixed routing winners, then assess endpoint re-ranking separately.
const ranked=profiles.map((_,i)=>({i,train:metrics(train,i,false)})).sort((a,b)=>a.train.loss-b.train.loss);
const shortlist=ranked.slice(0,5).map(p=>({...p,validation:metrics(validation,p.i,false)})).sort((a,b)=>a.validation.loss-b.validation.loss);
const selected=shortlist[0].i;
const original=(data:Row[])=>({requested:data.length,routed:data.filter(r=>r.candidates.length).length,acceptable:data.filter(r=>r.candidates.some(c=>Math.abs(c.routing-r.target)<=tolerance(r))).length});
const comparison=(data:Row[])=>({routing:original(data),oldPostRoute:metrics(data,base,false),calibratedPostRoute:metrics(data,selected,false),calibratedDuringSelection:metrics(data,selected,true)});
const report={date:new Date().toISOString(),seed,stage,source:dataset.summary.id,eligible:eligible.length,excludedParticipants:excludedParticipants.size,settings:profiles[selected],base,selected,shortlist,counts,developmentScores:profiles.map((_,i)=>({i,train:metrics(train,i,false),validation:metrics(validation,i,false)})),profileSettings:profiles,profiles:profiles.length,elapsedS:(performance.now()-start)/1000,simulationMs,candidates,vertices,maxRssKiB:process.resourceUsage().maxRSS,requests:ctx.requests,cacheHits:ctx.cacheHits,splitSummary:Object.fromEntries(splits.map(s=>[s,comparison(rows.filter(r=>r.split===s))])),testByMode:Object.fromEntries([...new Set(test.map(r=>r.mode))].map(mode=>[mode,comparison(test.filter(r=>r.mode===mode))])),testWithinArea:comparison(test.filter(r=>r.within)),failures:rows.filter(r=>!r.candidates.length).map(({candidates,...r})=>r),rows:rows.map(r=>{const chosen=r.candidates.reduce<Scores|undefined>((a,b)=>!a||Math.abs(b.duration[selected]-r.target)<Math.abs(a.duration[selected]-r.target)?b:a,undefined);return {row:r.row,key:r.key,split:r.split,mode:r.mode,within:r.within,target:r.target,candidates:r.candidates.length,selectedCandidate:chosen?.candidate,simulatedS:chosen?.duration[selected],routingS:chosen?.routing};})};
writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined,developmentScores:undefined,profileSettings:undefined,failures:report.failures.length},null,2));
