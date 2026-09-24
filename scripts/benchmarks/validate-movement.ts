/** Fresh participants, frozen development settings, matched 12/24/48 candidate budgets. */
import {readFileSync,writeFileSync,createReadStream} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {asyncBufferFromFile} from 'hyparquet';
import {importNetmob} from '../../src/lib/netmobData';
import {DEFAULT_FIT,type NetmobRecord} from '../../src/lib/netmobTypes';
import {fitRecord,routingContext} from '../../src/lib/netmobRouting';
import {OrsClient} from '../../src/lib/orsClient';
import {buildMovementPlan,sampleMovement,DEFAULT_SIMULATION} from '../../src/lib/movementSimulation';
const development=JSON.parse(readFileSync('local/movement-calibration-road-results.json','utf8'));
const frozen=development.settings;
const prior=JSON.parse(readFileSync('local/movement-calibration-results.json','utf8'));
const pilot=JSON.parse(readFileSync('local/movement-pilot-results.json','utf8'));
const digest=(s:string)=>createHash('sha256').update(s).digest('hex'),seed='movement-final-validation-20260920-c';
const path='local/emg-base-des-deplacements.parquet',hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
const importedAt=performance.now();const dataset=await importNetmob(await asyncBufferFromFile(path),'emg',hash.digest('hex'),JSON.parse(readFileSync('public/data/netmob-boundaries.json','utf8')).areas);
const importMs=performance.now()-importedAt;
const participant=(r:NetmobRecord)=>r.key.split('-')[0];
const excluded=new Set<string>([...prior.rows.map((r:{key:string})=>r.key.split('-')[0]),...pilot.experiments[0].rows.map((r:{row:number})=>participant(dataset.records[r.row]))]);
const records=dataset.records.filter(r=>!r.exclusions.length&&r.durationS!==null&&r.durationS>0&&r.departure&&!excluded.has(participant(r))).sort((a,b)=>digest(seed+':'+a.key).localeCompare(digest(seed+':'+b.key))).slice(0,400);
const network=JSON.parse(gunzipSync(readFileSync('public/data/idfm-netmob-transit.json.gz')).toString()),timing=JSON.parse(gunzipSync(readFileSync('public/data/idfm-timing.json.gz')).toString());
const ctx=routingContext(new OrsClient({apiKey:'',local:true,maxRetries:0}),new AbortController().signal,network,timing);
const rows:any[]=[];let movementMs=0,previewMs=0,previewCount=0;const start=performance.now();
for(const record of records){
 const row:any={row:record.rowIndex,key:record.key,mode:String(record.raw.mode_principal).toUpperCase(),within:record.origin===record.destination,target:record.durationS,budgets:[]};
 for(const trials of [12,24,48]){
  const calls=ctx.requests,hits=ctx.cacheHits,began=performance.now();let baseline:{routingS:number;oldMovementS:number}|undefined;const candidates:number[]=[];
  ctx.onCandidate=(_pair,legs,routingS,id)=>{const now=performance.now();const p=buildMovementPlan(legs,frozen,null,id,{durationOnly:true});movementMs+=performance.now()-now;candidates.push(p.durationS);if(!baseline||Math.abs(routingS-record.durationS!)<Math.abs(baseline.routingS-record.durationS!)){baseline={routingS,oldMovementS:buildMovementPlan(legs,{...DEFAULT_SIMULATION,roadStopsPerKm:1,roadWaitS:25,stationDwellS:25,cruiseKmh:{walking:4.8,driving:40},roadCruiseSource:'fixed'},null,id,{durationOnly:true}).durationS};}};
  try{const trip=await fitRecord(ctx,dataset.summary.id,record,dataset.areas,{...DEFAULT_FIT,trials,durationModel:'movement',movement:frozen});const input=trip.exportInput!,fit=input.netmob!.fit;
   if(trials===12){const before=performance.now();try{const plan=buildMovementPlan(input.orderedLegs!,frozen,record.durationS,input.id);sampleMovement(input.orderedLegs!,plan,input.id);if(Math.abs(plan.durationS-fit.modeledS)>1e-8)throw new Error('Preview duration disagrees with fit');previewCount++;}catch(e){if(!String(e).includes('limit'))throw e;}previewMs+=performance.now()-before;}
   row.budgets.push({trials,simulatedS:fit.modeledS,acceptable:fit.status==='acceptable',routingS:fit.routingS,baseline,candidate:input.netmob!.candidate,validCandidates:candidates.length,minS:Math.min(...candidates),maxS:Math.max(...candidates),requests:ctx.requests-calls,cacheHits:ctx.cacheHits-hits,ms:performance.now()-began});
  }catch(error){if(error instanceof TypeError||String(error).includes('disagrees'))throw error;row.budgets.push({trials,error:String(error),requests:ctx.requests-calls,cacheHits:ctx.cacheHits-hits,ms:performance.now()-began});}
 }
 rows.push(row);if(rows.length%20===0)console.error(`${rows.length}/400 fresh rows; ${ctx.requests} local requests; ${Math.round((performance.now()-start)/1000)} s`);
}
function summarize(data:typeof rows,trials:number){const ok=data.map(r=>({r,b:r.budgets.find((b:any)=>b.trials===trials)})).filter(x=>x.b.simulatedS!==undefined);const errors=ok.map(x=>Math.abs(x.b.simulatedS-x.r.target)/60).sort((a,b)=>a-b);const tol=(r:any)=>Math.max(180,.2*r.target);return {requested:data.length,routed:ok.length,acceptable:ok.filter(x=>x.b.acceptable).length,routingAcceptable:ok.filter(x=>Math.abs(x.b.baseline.routingS-x.r.target)<=tol(x.r)).length,oldPostRouteAcceptable:ok.filter(x=>Math.abs(x.b.baseline.oldMovementS-x.r.target)<=tol(x.r)).length,medianErrorMin:errors[Math.floor(errors.length/2)]??null,p90ErrorMin:errors[Math.floor(errors.length*.9)]??null,maeMin:errors.reduce((a,b)=>a+b,0)/(errors.length||1),belowCandidateRange:ok.filter(x=>x.r.target+tol(x.r)<x.b.minS).length,aboveCandidateRange:ok.filter(x=>x.r.target-tol(x.r)>x.b.maxS).length,requests:data.reduce((s,r)=>s+r.budgets.find((b:any)=>b.trials===trials).requests,0),ms:data.reduce((s,r)=>s+r.budgets.find((b:any)=>b.trials===trials).ms,0)};}
const summary=(data:typeof rows)=>Object.fromEntries([12,24,48].map(n=>[n,summarize(data,n)]));
const report={date:new Date().toISOString(),seed,settings:frozen,participantExclusions:excluded.size,requested:records.length,source:dataset.summary.id,networkVersion:network.version,timingVersion:timing.version,importMs,elapsedS:(performance.now()-start)/1000,movementMs,previewMs,previewCount,maxRssKiB:process.resourceUsage().maxRSS,requests:ctx.requests,cacheHits:ctx.cacheHits,summary:summary(rows),withinArea:summary(rows.filter(r=>r.within)),byMode:Object.fromEntries([...new Set(rows.map(r=>r.mode))].map(mode=>[mode,summary(rows.filter(r=>r.mode===mode))])),rows};
writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined,byMode:undefined},null,2));
