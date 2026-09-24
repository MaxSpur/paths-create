import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {asyncBufferFromFile,parquetReadObjects} from 'hyparquet';
import {compressors} from 'hyparquet-compressors';
import type {Checkpoint,Outcome} from './jobStore';
import type {LocalPreview,LocalOutcomePage} from '../../src/lib/localRunTypes';
import type {LonLat} from '../../src/lib/types';
import type {ModeledLeg} from '../../src/lib/netmobTypes';

async function outcomes(folder:string,name:string):Promise<Outcome[]> {
  const file=path.join(folder,name,'outcomes.json.gz');const stat=await lstat(file);
  if(!stat.isFile()||stat.size>16*2**20)throw new Error('Outcome preview exceeds its file limit.');
  return JSON.parse(gunzipSync(await readFile(file),{maxOutputLength:32*2**20}).toString());
}
export async function outcomePage(folder:string,checkpoint:Checkpoint,offset:number):Promise<LocalOutcomePage>{
  const rows:LocalOutcomePage['rows']=[];
  for(const {name,receipt}of checkpoint.receipts){
    if(receipt.end<=offset||receipt.start>=offset+25)continue;
    rows.push(...(await outcomes(folder,name)).slice(Math.max(0,offset-receipt.start),offset+25-receipt.start).map(({raw:_raw,...row})=>row));
  }
  return {offset,total:checkpoint.nextRow,rows};
}
export function decodeLine(geometry:unknown):LonLat[]{
  // hyparquet recognizes GeoParquet metadata and already decodes WKB to GeoJSON.
  const g=geometry as {type?:string;coordinates?:unknown};
  const coords=g?.type==='Point'?[g.coordinates]:g?.type==='LineString'?g.coordinates:undefined;
  if(!Array.isArray(coords)||coords.length>100000||coords.some(c=>!Array.isArray(c)||![2,3].includes(c.length)||!c.every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90))throw new Error('Invalid or oversized preview geometry.');
  return coords as LonLat[];
}
export async function previewRow(folder:string,checkpoint:Checkpoint,cursor:number):Promise<LocalPreview>{
  const part=checkpoint.receipts.find(p=>p.receipt.start<=cursor&&p.receipt.end>cursor);if(!part)throw new Error('This row is not checkpointed yet.');
  const outcome=(await outcomes(folder,part.name))[cursor-part.receipt.start];const {raw,...summary}=outcome;
  if(!outcome.tripId)return {outcome:summary,raw};
  const file=path.join(folder,part.name,'routes.parquet');const stat=await lstat(file);
  if(!stat.isFile()||stat.size>32*2**20)throw new Error('Part is too large for interactive preview; inspect its Parquet directly.');
  // One part at a time, no retained geometry cache; only the requested trip crosses HTTP.
  const rows=(await parquetReadObjects({file:await asyncBufferFromFile(file),compressors})).filter(r=>r.trip_id===outcome.tripId).sort((a,b)=>Number(a.leg_index)-Number(b.leg_index));
  if(!rows.length)throw new Error('Missing exported trip.');
  const metadata=JSON.parse(String(rows[0].trip_json));let count=0;
  const orderedLegs=rows.map(row=>{const leg=JSON.parse(String(row.leg_json));const coordinates=decodeLine(row.geometry);count+=coordinates.length;return {...leg.modeled,coordinates} as ModeledLeg;});
  if(count>100000)throw new Error('Trip is too large for interactive preview.');
  const {geometryVariation,...input}=metadata;
  return {outcome:summary,raw,input:{...input,orderedLegs},geometryVariation};
}
