import {readFile,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {deepStrictEqual} from 'node:assert';
import {asyncBufferFromFile,parquetReadObjects} from 'hyparquet';
import {compressors} from 'hyparquet-compressors';
import initParquet from 'parquet-wasm/esm';
import {importNetmob,matchesFilter} from '../../src/lib/netmobData';
import {DEFAULT_FIT} from '../../src/lib/netmobTypes';
import {DEFAULT_SIMULATION} from '../../src/lib/movementSimulation';
import {DEFAULT_COMPACT_NOISE} from '../../src/lib/compactPathNoise';
import {fitRecord,routingContext,serviceFailure} from '../../src/lib/netmobRouting';
import {OrsClient} from '../../src/lib/orsClient';
import {writePathParquet} from '../../src/lib/parquetWriter';
import {buildTripSegments,type GpxTripInput} from '../../src/lib/gpxWriter';
import {createRun,readRun,lockRun,recoverPending,inspectRun,commitPart,runRows,sourceRow,type RunConfig,type Outcome} from './jobStore';

import {validateRequest} from './request';

const controller=new AbortController(),stop=()=>controller.abort();
process.on('SIGINT',stop);process.on('SIGTERM',stop);
process.on('disconnect',stop); // A lost supervisor checkpoints rather than leaving an orphan worker.
const emit=(event:unknown)=>{if(process.connected)process.send?.(event);else console.log(JSON.stringify(event));};
try {
const {values:args,positionals}=parseArgs({allowPositionals:true,options:{output:{type:'string'},source:{type:'string'},'max-rows':{type:'string'},'max-output-mb':{type:'string'},'min-free-mb':{type:'string'},'part-rows':{type:'string'},clean:{type:'boolean'},help:{type:'boolean'}}});
const command=positionals[0];
if(args.help||!command){console.log('Usage: npm run netmob:run -- init|run|status|verify --output <folder>\ninit: [--source <emg.parquet>] [--max-output-mb 512] [--min-free-mb 1024] [--part-rows 100] [--clean]\nrun: [--max-rows 100|all] (default 100; Ctrl-C checkpoints completed records)\nNo ZIP, dense observations, automatic full run, or persistent cache.');process.exit(0);}
if(!['init','run','status','verify'].includes(command)||!args.output||positionals.length!==1)throw new Error('Choose init, run, status, or verify and an explicit --output folder.');
const output=path.resolve(args.output);
const number=(value:string|undefined,fallback:number,min:number,max:number)=>{const n=value===undefined?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`Expected an integer between ${min} and ${max}.`);return n;};
async function hashFile(file:string){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');}
async function versions(){
  const files=['package-lock.json',...(await readdir('src/lib')).filter(f=>f.endsWith('.ts')).map(f=>`src/lib/${f}`),'scripts/netmob/run.ts','scripts/netmob/jobStore.ts','scripts/netmob/request.ts'];
  const hash=createHash('sha256');for(const file of files.sort()){hash.update(file);hash.update(await readFile(file));}
  const result:Record<string,string>={code:hash.digest('hex')};
  if(process.env.NETMOB_BUNDLE_CODE&&process.env.NETMOB_BUNDLE_CODE!==result.code)throw new Error('Runner source changed. Restart npm run netmob:serve before creating or resuming jobs.');
  for(const file of ['public/data/netmob-boundaries.json','public/data/idfm-netmob-transit.json.gz','public/data/idfm-timing.json.gz',...['driving-car','cycling-regular','foot-walking'].map(p=>`.local-ors/graphs/${p}/graph_build_info.yml`)])result[file]=await hashFile(file);
  return result;
}
async function load(source:string,id:string){return importNetmob(await asyncBufferFromFile(source),'EMG',id,JSON.parse(await readFile('public/data/netmob-boundaries.json','utf8')).areas);}
if(command==='init'){
  const source=path.resolve(args.source??'local/emg-base-des-deplacements.parquet'),sourceHash=await hashFile(source),dataset=await load(source,sourceHash);
  if(dataset.summary.kind!=='emg')throw new Error('Only EMG has the geography and modes required for generation.');
  const request=process.env.NETMOB_REQUEST?validateRequest(JSON.parse(process.env.NETMOB_REQUEST)):undefined;
  if(request&&request.sourceHash!==sourceHash)throw new Error('Browser and local source checksums differ.');
  const selection=request?dataset.records.filter(r=>matchesFilter(r,request.filter)).map(r=>r.rowIndex):undefined;
  if(request&&selection!.length!==request.expectedRows)throw new Error('Local selection count differs from the browser; reimport and apply filters again.');
  controller.signal.throwIfAborted();
  const config:RunConfig={schemaVersion:1,source,sourceHash,sourceRows:dataset.records.length,versions:await versions(),settings:{...DEFAULT_FIT,durationModel:'movement',movement:DEFAULT_SIMULATION},variation:args.clean?null:DEFAULT_COMPACT_NOISE,partRows:number(args['part-rows'],100,1,1000),maxOutputBytes:number(args['max-output-mb'],512,1,1048576)*2**20,minFreeBytes:number(args['min-free-mb'],1024,0,1048576)*2**20};
  if(request)Object.assign(config,{schemaVersion:2,...(selection!.length===dataset.records.length?{}:{selection}),filter:request.filter,label:request.name,settings:request.settings,variation:request.variation,maxAccessM:request.maxAccessM,maxCyclingM:request.maxCyclingM,partRows:request.partRows,maxOutputBytes:request.maxOutputMiB*2**20,minFreeBytes:request.minFreeMiB*2**20});
  await createRun(output,config);
  console.log(JSON.stringify({output,rows:config.sourceRows,eligible:dataset.summary.eligible,exclusions:dataset.summary.exclusions,maxOutputMiB:config.maxOutputBytes/2**20,partRows:config.partRows,variation:config.variation,message:'Initialized only. Run defaults to 100 additional source rows.'},null,2));
}else{
  const config=await readRun(output);
  if(command==='run'){
    if(args['max-output-mb'])config.maxOutputBytes=number(args['max-output-mb'],512,1,1048576)*2**20;
    if(args['min-free-mb'])config.minFreeBytes=number(args['min-free-mb'],1024,0,1048576)*2**20;
  }
  const unlock=command==='run'?await lockRun(output):async()=>{};
  try{
    if(command==='run')await recoverPending(output,config);
    const checkpoint=await inspectRun(output,config,command!=='run');
    const status=()=>({output,processed:checkpoint.nextRow,committed:checkpoint.nextRow,total:runRows(config),complete:checkpoint.nextRow===runRows(config),parts:checkpoint.parts,counts:checkpoint.counts,bytes:checkpoint.bytes,maxOutputBytes:config.maxOutputBytes});
    if(command==='status')console.log(JSON.stringify(status(),null,2));
    else if(command==='verify'){
      for(const {name}of checkpoint.receipts){
        const dir=path.join(output,name),outcomes=JSON.parse(gunzipSync(await readFile(path.join(dir,'outcomes.json.gz'))).toString()) as Outcome[];
        const successes=outcomes.filter(o=>o.tripId),byId=new Map(successes.map(o=>[o.tripId,o]));
        if(successes.length){
          const rows=await parquetReadObjects({file:await asyncBufferFromFile(path.join(dir,'routes.parquet')),compressors});const legs=new Map<string,number>();
          for(const row of rows){const id=String(row.trip_id),outcome=byId.get(id);if(!outcome)throw new Error('Unlinked exported trip.');
            const metadata=JSON.parse(String(row.trip_json));deepStrictEqual(metadata.netmob.raw,outcome.raw);deepStrictEqual(metadata.netmob.rowIndex,outcome.rowIndex);deepStrictEqual(metadata.netmob.datasetId,config.sourceHash);
            deepStrictEqual(metadata.netmob.fit.status,outcome.status);deepStrictEqual(Boolean(metadata.geometryVariation),Boolean(config.variation));
            deepStrictEqual(row.leg_index,legs.get(id)??0);legs.set(id,(legs.get(id)??0)+1);
          }
          deepStrictEqual([...legs.keys()].sort(),[...byId.keys()].sort());
        }
      }
      console.log(JSON.stringify({...status(),verified:'Checksums, contiguous outcomes, complete source metadata, trip linkage and ordered legs'},null,2));
    }else{
      if(args.source||args.clean||args['part-rows'])throw new Error('Generation settings are pinned at init. Use a new output folder to change them.');
      if(await hashFile(config.source)!==config.sourceHash)throw new Error('Source checksum changed.');
      deepStrictEqual(await versions(),config.versions,'Code, transit, boundaries or ORS build metadata changed; use the pinned versions or initialize a new job.');
      const maxRows=args['max-rows']==='all'?runRows(config):number(args['max-rows'],100,1,Math.max(100,runRows(config)));
      const end=Math.min(runRows(config),checkpoint.nextRow+maxRows);
      if(checkpoint.nextRow===end){console.log(JSON.stringify(status(),null,2));}
      else{
        const ready=await fetch('http://127.0.0.1:8082/ors/v2/health',{signal:AbortSignal.timeout(5000)});if(!ready.ok)throw new Error('Local ORS is not ready.');
        const dataset=await load(config.source,config.sourceHash);
        const network=JSON.parse(gunzipSync(await readFile('public/data/idfm-netmob-transit.json.gz')).toString());
        const timing=JSON.parse(gunzipSync(await readFile('public/data/idfm-timing.json.gz')).toString());
        await initParquet({module_or_path:await readFile('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm')});
        const ctx=routingContext(new OrsClient({apiKey:'',local:true,maxRetries:0}),controller.signal,network,timing);
        ctx.maxAccessM=config.maxAccessM;ctx.maxCyclingM=config.maxCyclingM;
        const started=performance.now();let lastEvent=0;
        const progress=(extra:Record<string,unknown>={})=>emit({...status(),requestsThisInvocation:ctx.requests,rssMiB:Math.round(process.memoryUsage().rss/2**20),elapsedS:(performance.now()-started)/1000,...extra});
        let trips:GpxTripInput[]=[],outcomes:Outcome[]=[],paused:string|undefined,vertices=0;
        ctx.onTrial=(pair,trial,trials)=>{if(performance.now()-lastEvent<250)return;lastEvent=performance.now();progress({processed:checkpoint.nextRow+outcomes.length,rowIndex:pair.record.rowIndex,trial,trials});};
        progress();
        async function flush(){
          if(!outcomes.length)return;
          const bytes=trips.length?writePathParquet([{id:config.sourceHash,trips}],{variation:config.variation??undefined}):undefined;
          if(bytes){
            const readback=await parquetReadObjects({file:Uint8Array.from(bytes).buffer,compressors});let i=0;
            for(const trip of trips)for(const [legIndex,leg]of buildTripSegments(trip).entries()){
              const row=readback[i++];deepStrictEqual([row.trip_id,row.leg_index,row.mode,row.point_count],[trip.id,legIndex,leg.mode,leg.coords.length]);
              deepStrictEqual(JSON.parse(String(row.trip_json)).netmob,JSON.parse(JSON.stringify(trip.netmob)));
            }
            deepStrictEqual(i,readback.length);
          }
          await commitPart(output,config,checkpoint,outcomes,bytes);trips=[];outcomes=[];vertices=0;global.gc?.();
          progress();
        }
        try{
          for(let i=checkpoint.nextRow;i<end;i++){
            if(controller.signal.aborted){paused='Cancelled; completed records checkpointed.';break;}
            if(process.memoryUsage().rss>4*2**30){paused='4 GiB process RSS guard reached; resume in a fresh process.';break;}
            const rowIndex=sourceRow(config,i),r=dataset.records[rowIndex],requests=ctx.requests,timeout=AbortSignal.timeout(60000);ctx.signal=AbortSignal.any([controller.signal,timeout]);
            const outcome:Outcome={rowIndex,sourceKey:r.key,raw:r.raw,status:'excluded'};
            if(r.exclusions.length)outcome.reasons=r.exclusions;
            else try{
              const input=(await fitRecord(ctx,config.sourceHash,r,dataset.areas,config.settings)).exportInput!;
              trips.push(input);vertices+=input.orderedLegs!.reduce((s,l)=>s+l.coordinates.length,0);
              Object.assign(outcome,{status:input.netmob!.fit.status,tripId:input.id,errorS:input.netmob!.fit.errorS,modeledS:input.netmob!.fit.modeledS});
            }catch(error){
              if(controller.signal.aborted||timeout.aborted||serviceFailure(error)){paused=`Paused before source row ${rowIndex+1}: ${String(error)}`;break;}
              outcome.status='failed';outcome.reasons=[String(error)];
            }
            outcome.requests=ctx.requests-requests;outcomes.push(outcome);
            if(performance.now()-lastEvent>=250){lastEvent=performance.now();progress({processed:i+1,rowIndex,trial:undefined,trials:undefined});}
            if(outcomes.length>=config.partRows||vertices>=100000)await flush();
          }
          await flush();progress({rowIndex:undefined,trial:undefined,trials:undefined,paused:paused??null,peakRssMiB:process.resourceUsage().maxRSS/1024});
        }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
      }
    }
  }finally{await unlock();}
}
} catch(error) {
  const message=error instanceof Error?error.message:String(error);
  if(process.connected)emit({error:message});else console.error(message);
  process.exitCode=1;
} finally {
  // A disconnect listener retains the IPC channel until explicitly closed.
  if(process.connected)process.disconnect?.();
}
