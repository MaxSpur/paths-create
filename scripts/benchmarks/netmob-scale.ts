/** Bounded, matched feasibility experiment. No path or observation files are written. */
import {readFileSync,writeFileSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {deepStrictEqual} from 'node:assert';
import {asyncBufferFromFile,parquetReadObjects} from 'hyparquet';
import {compressors} from 'hyparquet-compressors';
import init from 'parquet-wasm/esm';
import {importNetmob,normalizeMode} from '../../src/lib/netmobData';
import {DEFAULT_FIT} from '../../src/lib/netmobTypes';
import {routingContext,fitRecord,serviceFailure} from '../../src/lib/netmobRouting';
import {OrsClient} from '../../src/lib/orsClient';
import {DEFAULT_SIMULATION} from '../../src/lib/movementSimulation';
import {varyPathGeometry,DEFAULT_COMPACT_NOISE,COMPACT_NOISE_VERSION} from '../../src/lib/compactPathNoise';
import {writePathParquet} from '../../src/lib/parquetWriter';
import {buildTripSegments,type GpxTripInput} from '../../src/lib/gpxWriter';

const count=Number(process.argv[2]),sampleSeed='netmob-scale-20260922-a';
const source='local/emg-base-des-deplacements.parquet',hash=createHash('sha256');
for await(const chunk of createReadStream(source))hash.update(chunk);
const dataset=await importNetmob(await asyncBufferFromFile(source),'EMG',hash.digest('hex'),JSON.parse(readFileSync('public/data/netmob-boundaries.json','utf8')).areas);
const eligibleModes:Record<string,number>={};for(const r of dataset.records)if(!r.exclusions.length){const m=normalizeMode(r.raw.mode_principal);eligibleModes[m]=(eligibleModes[m]??0)+1;}
const records=dataset.records.map(r=>({r,rank:createHash('sha256').update(`${sampleSeed}:${r.rowIndex}:${r.key}`).digest('hex')})).sort((a,b)=>a.rank.localeCompare(b.rank)).slice(0,count).map(x=>x.r);
const rows:Array<Record<string,unknown>>=[],chunks:Array<Record<string,number>>=[];
let requests=0,cacheHits=0,serviceStopped=false;
const started=performance.now();
if(count){
  const network=JSON.parse(gunzipSync(readFileSync('public/data/idfm-netmob-transit.json.gz')).toString());
  const timing=JSON.parse(gunzipSync(readFileSync('public/data/idfm-timing.json.gz')).toString());
  await init({module_or_path:readFileSync('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm')});
  const ctx=routingContext(new OrsClient({apiKey:'',local:true,maxRetries:0}),new AbortController().signal,network,timing);
  let pending:GpxTripInput[]=[];
  async function flush(){
    if(!pending.length)return;
    global.gc?.();const baselineRss=process.memoryUsage().rss;
    const begin=performance.now();
    const noisy=pending.map(trip=>{
      const coordinates=varyPathGeometry(trip.orderedLegs!.map(l=>l.coordinates),JSON.stringify([dataset.summary.id,trip.netmob!.rowIndex,trip.id]));
      return {...trip,orderedLegs:trip.orderedLegs!.map((leg,i)=>({...leg,coordinates:coordinates[i]}))};
    });
    const noiseMs=performance.now()-begin;
    const metrics:Record<string,number>={trips:pending.length,points:pending.reduce((n,t)=>n+t.orderedLegs!.reduce((s,l)=>s+l.coordinates.length,0),0),noiseMs,baselineRss};
    // Alternate ordering to reduce systematic warm-codec bias. No forced GC is timed.
    const variants=chunks.length%2?[['noisy',noisy],['clean',pending]] as const:[['clean',pending],['noisy',noisy]] as const;
    for(const [name,trips]of variants){
      const start=performance.now();const bytes=writePathParquet([{id:'scale-sample',trips:pending}],{variation:name==='noisy'?DEFAULT_COMPACT_NOISE:undefined});
      metrics[`${name}Ms`]=performance.now()-start;metrics[`${name}Bytes`]=bytes.length;
      // Independent full readback; buffers/decoded rows are released per variant.
      const decoded=await parquetReadObjects({file:Uint8Array.from(bytes).buffer,compressors});let index=0;
      for(const trip of trips)for(const [legIndex,leg]of buildTripSegments(trip).entries()){
        const row=decoded[index++];
        deepStrictEqual([row.trip_id,row.leg_index,row.mode],[trip.id,legIndex,leg.mode]);
        deepStrictEqual(row.geometry,{type:leg.coords.length===1?'Point':'LineString',coordinates:leg.coords.length===1?leg.coords[0]:leg.coords});
        deepStrictEqual(JSON.parse(row.trip_json as string).netmob,JSON.parse(JSON.stringify(trip.netmob)));
      }
      deepStrictEqual(index,decoded.length);
    }
    pending=[];global.gc?.();metrics.endRss=process.memoryUsage().rss;metrics.heapUsed=process.memoryUsage().heapUsed;chunks.push(metrics);
    console.error(`Verified chunk ${chunks.length}: ${metrics.trips} trips, clean ${Math.round(metrics.cleanBytes/1024)} KiB, varied ${Math.round(metrics.noisyBytes/1024)} KiB, RSS ${Math.round(metrics.endRss/2**20)} MiB`);
  }
  for(const [i,record]of records.entries()){
    const start=performance.now(),before=ctx.requests;
    const row:Record<string,unknown>={row:record.rowIndex,mode:normalizeMode(record.raw.mode_principal),within:record.origin===record.destination};
    if(record.exclusions.length){row.status='excluded';row.reasons=record.exclusions;}
    else try{
      const trip=await fitRecord(ctx,dataset.summary.id,record,dataset.areas,{...DEFAULT_FIT,durationModel:'movement',movement:DEFAULT_SIMULATION});
      const input=trip.exportInput!;pending.push(input);Object.assign(row,{status:input.netmob!.fit.status,points:input.orderedLegs!.reduce((s,l)=>s+l.coordinates.length,0),legs:input.orderedLegs!.length});
    }catch(error){row.status='failed';row.reason=String(error);if(serviceFailure(error))serviceStopped=true;}
    row.routingMs=performance.now()-start;row.requests=ctx.requests-before;rows.push(row);
    if((i+1)%100===0||serviceStopped)await flush();
    if((i+1)%20===0)console.error(`${i+1}/${count} source rows; ${ctx.requests} requests; ${Math.round((performance.now()-started)/1000)} s`);
    if(serviceStopped)break;
  }
  await flush();requests=ctx.requests;cacheHits=ctx.cacheHits;
}
const report={created:new Date().toISOString(),node:process.version,sampleSeed,count,source:dataset.summary,eligibleModes,settings:{...DEFAULT_FIT,durationModel:'movement',movement:DEFAULT_SIMULATION},noise:{version:COMPACT_NOISE_VERSION,...DEFAULT_COMPACT_NOISE},requests,cacheHits,serviceStopped,elapsedMs:performance.now()-started,peakRssMiB:process.resourceUsage().maxRSS/1024,chunks,rows};
const output='local/netmob-scale-results.json',json=JSON.stringify(report,null,2)+'\n';
if(Buffer.byteLength(json)>5*1024*1024)throw new Error('Report exceeded 5 MiB safety bound.');
writeFileSync(output,json);console.log(JSON.stringify({...report,rows:undefined,chunks:undefined},null,2));
console.log(`Verified geometry/source metadata in memory; only report written: ${output} (${Buffer.byteLength(json)} bytes)`);
