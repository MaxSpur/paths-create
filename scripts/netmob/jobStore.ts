import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,lstat,rename,rm,open,statfs} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import path from 'node:path';
import {hostname} from 'node:os';
import type {FitSettings,SourceValues,NetmobFilter} from '../../src/lib/netmobTypes';
import type {CompactNoiseSettings} from '../../src/lib/compactPathNoise';

export const sha256=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export interface RunConfig {
  schemaVersion:1|2;source:string;sourceHash:string;sourceRows:number;versions:Record<string,string>;
  selection?:number[];filter?:NetmobFilter;label?:string;maxAccessM?:number;maxCyclingM?:number;
  settings:FitSettings;variation:CompactNoiseSettings|null;partRows:number;maxOutputBytes:number;minFreeBytes:number;
}
export const runRows=(config:RunConfig)=>config.selection?.length??config.sourceRows;
export const sourceRow=(config:RunConfig,cursor:number)=>config.selection?.[cursor]??cursor;
export interface Outcome {
  rowIndex:number;sourceKey:string;raw:SourceValues;status:'acceptable'|'poor'|'unassessed'|'excluded'|'failed';
  reasons?:string[];tripId?:string;errorS?:number|null;modeledS?:number;requests?:number;
}
interface Receipt {schemaVersion:1;configHash:string;start:number;end:number;counts:Record<string,number>;files:Record<string,{bytes:number;sha256:string}>}
export interface Checkpoint {nextRow:number;bytes:number;parts:number;counts:Record<string,number>;receipts:Array<{name:string;receipt:Receipt}>}
// Resource limits are operational; raising them must not invalidate completed data.
const configHash=({maxOutputBytes:_max,minFreeBytes:_free,...identity}:RunConfig)=>sha256(JSON.stringify(identity));
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
async function syncDirectory(folder:string){const handle=await open(folder,'r');try{await handle.sync();}finally{await handle.close();}}
async function regularFile(file:string){if(!(await lstat(file)).isFile())throw new Error(`Expected a regular file: ${file}`);}

export async function createRun(folder:string,config:RunConfig):Promise<void>{
  const bytes=Buffer.byteLength(json(config));const disk=await statfs(path.dirname(folder));
  if(bytes>config.maxOutputBytes||disk.bavail*disk.bsize<config.minFreeBytes+bytes+65536)throw new Error('Insufficient output budget or free-space reserve for the manifest.');
  await mkdir(folder); // exclusive directory creation; never replaces an existing job
  await writeFile(path.join(folder,'run.json'),json(config),{flag:'wx',flush:true});await syncDirectory(folder);
}
export async function readRun(folder:string):Promise<RunConfig>{
  if(!(await lstat(folder)).isDirectory())throw new Error('Output must be a real directory, not a symlink.');
  const file=path.join(folder,'run.json');await regularFile(file);const config=JSON.parse(await readFile(file,'utf8')) as RunConfig;
  if(![1,2].includes(config.schemaVersion)||!Number.isSafeInteger(config.sourceRows)||config.sourceRows<0||!Number.isInteger(config.partRows)||config.partRows<1||config.partRows>1000||!Number.isFinite(config.maxOutputBytes)||config.maxOutputBytes<=0||!Number.isFinite(config.minFreeBytes)||config.minFreeBytes<0)throw new Error('Invalid run configuration.');
  if(config.selection&&(config.schemaVersion!==2||!Array.isArray(config.selection)||config.selection.some((v,i)=>!Number.isInteger(v)||v<0||v>=config.sourceRows||(i>0&&v<=config.selection![i-1]))))throw new Error('Invalid source selection.');
  return config;
}

/** Lock and pending files are explicit in the selected folder. Only dead local locks
 * and recognized, uncommitted staging files can be recovered automatically. */
export async function lockRun(folder:string):Promise<()=>Promise<void>>{
  const file=path.join(folder,'runner.lock');
  try{await writeFile(file,json({pid:process.pid,host:hostname()}),{flag:'wx',flush:true});}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    await regularFile(file);const owner=JSON.parse(await readFile(file,'utf8'));
    if(owner.host!==hostname()||!Number.isInteger(owner.pid)||owner.pid<=0)throw new Error('Unrecognized runner lock; inspect it before recovery.');
    let alive=true;try{process.kill(owner.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')alive=false;}
    if(alive)throw new Error(`Runner process ${owner.pid} still owns this output folder.`);
    await rm(file);return lockRun(folder);
  }
  return async()=>{await rm(file);};
}
export async function recoverPending(folder:string,config:RunConfig){
  const staging=path.join(folder,'pending');let entries:string[];
  try{if(!(await lstat(staging)).isDirectory())throw new Error('Unexpected pending path.');entries=await readdir(staging);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
  for(const entry of entries){if(!['owner.json','routes.parquet','outcomes.json.gz','receipt.json'].includes(entry))throw new Error('Unknown file in pending part; recovery stopped.');await regularFile(path.join(staging,entry));}
  if(entries.includes('owner.json')){
    const owner=JSON.parse(await readFile(path.join(staging,'owner.json'),'utf8'));if(owner.configHash!==configHash(config))throw new Error('Pending part belongs to different settings.');
  }else if(entries.length)throw new Error('Pending part has no ownership record.');
  await rm(staging,{recursive:true});
}
export async function inspectRun(folder:string,config:RunConfig,ignorePending=false):Promise<Checkpoint>{
  const result:Checkpoint={nextRow:0,bytes:0,parts:0,counts:{},receipts:[]};
  const entries=(await readdir(folder)).sort();
  for(const entry of entries){
    if(['run.json','runner.lock'].includes(entry)){await regularFile(path.join(folder,entry));result.bytes+=(await lstat(path.join(folder,entry))).size;continue;}
    if(entry==='pending'&&ignorePending)continue;
    if(entry==='pending')throw new Error('An uncommitted pending part exists; resume recovers it before inspection.');
    if(!/^part-\d{6}$/.test(entry))throw new Error(`Unexpected output entry: ${entry}`);
    const dir=path.join(folder,entry);if(!(await lstat(dir)).isDirectory())throw new Error('Part must be a real directory.');
    await regularFile(path.join(dir,'receipt.json'));
    const receipt=JSON.parse(await readFile(path.join(dir,'receipt.json'),'utf8')) as Receipt;
    if(receipt.schemaVersion!==1||receipt.configHash!==configHash(config)||receipt.start!==result.nextRow||!Number.isInteger(receipt.end)||receipt.end<=receipt.start||receipt.end>runRows(config)||entry!==`part-${String(receipt.start).padStart(6,'0')}`)throw new Error(`Invalid checkpoint range/settings: ${entry}`);
    const expected=['outcomes.json.gz',...(receipt.files['routes.parquet']?['routes.parquet']:[])];
    if(Object.keys(receipt.files).sort().join()!==expected.sort().join())throw new Error('Unexpected receipt files.');
    if((await readdir(dir)).sort().join()!==[...expected,'owner.json','receipt.json'].sort().join())throw new Error('Unexpected part contents.');
    for(const name of ['owner.json','receipt.json',...expected]){await regularFile(path.join(dir,name));result.bytes+=(await lstat(path.join(dir,name))).size;}
    for(const [name,info]of Object.entries(receipt.files)){
      const bytes=await readFile(path.join(dir,name));if(bytes.length!==info.bytes||sha256(bytes)!==info.sha256)throw new Error(`Checksum failed: ${entry}/${name}`);
    }
    const outcomes=JSON.parse(gunzipSync(await readFile(path.join(dir,'outcomes.json.gz'))).toString()) as Outcome[];
    if(outcomes.length!==receipt.end-receipt.start||outcomes.some((r,i)=>r.rowIndex!==sourceRow(config,receipt.start+i)))throw new Error('Outcome rows are missing, duplicated, or reordered.');
    for(const outcome of outcomes)result.counts[outcome.status]=(result.counts[outcome.status]??0)+1;
    result.nextRow=receipt.end;result.parts++;result.receipts.push({name:entry,receipt});
  }
  return result;
}

/** One directory rename commits geometry and outcomes together. No global cursor can
 * get ahead of the durable parts. Encoded bytes are bounded to one part. */
export async function commitPart(folder:string,config:RunConfig,checkpoint:Checkpoint,outcomes:Outcome[],routes?:Uint8Array):Promise<void>{
  if(!outcomes.length||outcomes.length>config.partRows||outcomes.some((r,i)=>r.rowIndex!==sourceRow(config,checkpoint.nextRow+i))||checkpoint.nextRow+outcomes.length>runRows(config))throw new Error('Invalid part row sequence.');
  const successful=outcomes.filter(r=>['acceptable','poor','unassessed'].includes(r.status));
  if(Boolean(successful.length)!==Boolean(routes?.length))throw new Error('Geometry/outcome success mismatch.');
  const data:Record<string,Uint8Array>={'outcomes.json.gz':gzipSync(JSON.stringify(outcomes))};if(routes)data['routes.parquet']=routes;
  const counts:Record<string,number>={};for(const r of outcomes)counts[r.status]=(counts[r.status]??0)+1;
  const receipt:Receipt={schemaVersion:1,configHash:configHash(config),start:checkpoint.nextRow,end:checkpoint.nextRow+outcomes.length,counts,files:Object.fromEntries(Object.entries(data).map(([name,bytes])=>[name,{bytes:bytes.length,sha256:sha256(bytes)}]))};
  const owner=json({configHash:configHash(config)}),receiptText=json(receipt);
  const newBytes=Object.values(data).reduce((s,b)=>s+b.length,0)+Buffer.byteLength(owner)+Buffer.byteLength(receiptText);
  if(checkpoint.bytes+newBytes>config.maxOutputBytes)throw new Error('Output byte budget reached; completed parts remain safe.');
  const fs=await statfs(folder);if(fs.bavail*fs.bsize<config.minFreeBytes+newBytes+65536)throw new Error('Free-space reserve reached; completed parts remain safe.');
  const pending=path.join(folder,'pending');await mkdir(pending);
  await writeFile(path.join(pending,'owner.json'),owner,{flag:'wx',flush:true});
  for(const [name,bytes]of Object.entries(data))await writeFile(path.join(pending,name),bytes,{flag:'wx',flush:true});
  await writeFile(path.join(pending,'receipt.json'),receiptText,{flag:'wx',flush:true});await syncDirectory(pending);
  const name=`part-${String(receipt.start).padStart(6,'0')}`;
  await rename(pending,path.join(folder,name));await syncDirectory(folder);
  checkpoint.nextRow=receipt.end;checkpoint.bytes+=newBytes;checkpoint.parts++;checkpoint.receipts.push({name,receipt});
  for(const [status,n]of Object.entries(counts))checkpoint.counts[status]=(checkpoint.counts[status]??0)+n;
}
