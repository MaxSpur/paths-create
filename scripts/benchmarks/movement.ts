import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {asyncBufferFromFile} from 'hyparquet';
import init from 'parquet-wasm/esm';
import {importNetmob} from '../../src/lib/netmobData';
import {DEFAULT_FIT} from '../../src/lib/netmobTypes';
import {generateNetmobBatch,routingContext} from '../../src/lib/netmobRouting';
import {OrsClient} from '../../src/lib/orsClient';
import {buildMovementPlan,sampleMovement,DEFAULT_SIMULATION} from '../../src/lib/movementSimulation';
import {writeObservationParquet} from '../../src/lib/observationParquet';
const path='local/emg-base-des-deplacements.parquet',bytes=readFileSync(path),dataset=await importNetmob(await asyncBufferFromFile(path),'emg',createHash('sha256').update(bytes).digest('hex'),JSON.parse(readFileSync('public/data/netmob-boundaries.json','utf8')).areas);
const network=JSON.parse(gunzipSync(readFileSync('public/data/idfm-netmob-transit.json.gz')).toString()),timing=JSON.parse(gunzipSync(readFileSync('public/data/idfm-timing.json.gz')).toString());
const modes=['MAP','VPC','VELO','VAE','METRO','BUS','RER/TRAIN','TROTTINETTE','2RM','AUTRE'];const rank=(key:string)=>createHash('sha256').update('movement-pilot-90320:'+key).digest('hex');const groups=modes.map(m=>dataset.records.filter(r=>!r.exclusions.length&&r.durationS&&r.departure&&String(r.raw.mode_principal).toUpperCase()===m).sort((a,b)=>rank(a.key).localeCompare(rank(b.key))));
const records=Array.from({length:100},(_,i)=>groups[i%groups.length][Math.floor(i/groups.length)]);
const ctx=routingContext(new OrsClient({apiKey:'',local:true,maxRetries:0}),new AbortController().signal,network,timing);
const result=await generateNetmobBatch(ctx,dataset.summary.id,records,dataset.areas,DEFAULT_FIT,(done)=>{if(done%10===0)console.error(`${done}/100 routed`);});
await init({module_or_path:readFileSync('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm')});
const experiments=[];
for(const rate of [0,0.5,1,2]){
 const rows=[];for(const trip of result.trips){const input=trip.exportInput!,legs=input.orderedLegs!,start=performance.now();const plan=buildMovementPlan(legs,{...DEFAULT_SIMULATION,roadStopsPerKm:rate,roadWaitS:25,stationDwellS:25,cruiseKmh:{walking:4.8,driving:40},roadCruiseSource:'fixed'},input.netmob!.fit.targetS,input.id);const samples=sampleMovement(legs,plan,input.id);const ms=performance.now()-start;const exported=writeObservationParquet(input,plan,samples);
 rows.push({row:input.netmob!.rowIndex,mode:String(input.netmob!.raw.mode_principal),sampleCount:samples.length,ms,bytes:exported.length,baselineS:plan.baselineS,targetS:plan.targetS,simulatedS:plan.durationS,roadStops:plan.roadStops,stationStops:plan.stationStops,split:parseInt(createHash('sha256').update(input.netmob!.sourceKey.split('-')[0]).digest('hex').slice(0,8),16)%2?'holdout':'calibration'});
 }
 experiments.push({rate,rows});console.error(`Simulated rate ${rate}`);
}
const report={date:new Date().toISOString(),settings:DEFAULT_SIMULATION,routeReport:result.report.netmob,sample:'Ten deterministic hash-ranked keys per ten equal mode strata; not population representative. Participant-prefix hash calibration/holdout split.',experiments};
writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log('Saved small summary only; no observation or route files written.');
