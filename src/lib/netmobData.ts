import { parquetMetadataAsync, parquetRead, parquetReadObjects, type AsyncBuffer } from "hyparquet";
import { DEFAULT_PARSERS } from "hyparquet/src/convert.js";
import { compressors } from "hyparquet-compressors";
import { validGeometry } from "./netmobGeometry";
import type { NetmobArea, NetmobFacets, NetmobFilter, NetmobPage, NetmobRecord, NetmobSummary, SourceValues } from "./netmobTypes";

export function normalizeMode(value: unknown): string {return String(value ?? "").trim().toUpperCase();}
export function isIdfCode(code: string): boolean {return /^(75|77|78|91|92|93|94|95)\d{3}$/.test(code);}
function scalar(value: unknown): string | number | null {
  if(value == null) return null;
  if(value instanceof Date) return Number.isFinite(value.getTime())?value.toISOString().slice(0,10):null;
  if(typeof value === "bigint") return value.toString();
  return typeof value === "number" ? Number.isFinite(value)?value:null : String(value);
}
export function normalizeRecord(values: Record<string, unknown>, rowIndex: number, kind: "emg" | "cube"): NetmobRecord {
  const raw: SourceValues={};for(const [k,v]of Object.entries(values))if(!["geom_o","centroid_o"].includes(k))raw[k]=scalar(v);
  const issues:string[]=[];
  const origin=String(raw[kind==="emg"?"code_insee_o":"origine"]??"");
  const destination=String(raw[kind==="emg"?"code_insee_d":"destination"]??"");
  const modes=Array.from({length:5},(_,i)=>normalizeMode(raw[`mode_${i+1}`])).filter(Boolean);
  if(!modes.length && raw.mode_principal)modes.push(normalizeMode(raw.mode_principal));
  const durationS=typeof raw.duree==="number" && raw.duree>0?raw.duree*60:null;
  const date=String(raw.date_o??"");const time=String(raw.heure_o??"");
  const dateValid=/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
  const timeValid=/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time);
  const departure=dateValid&&timeValid?`${date}T${time.length===5?time+":00":time}`:null;
  if(kind==="emg") {
    if(!departure)issues.push("Missing or invalid departure date/time; local Europe/Paris time is not repaired.");
    if(durationS&&durationS>86400)issues.push("Duration exceeds 24 hours; retained as anomalous source data.");
    if(!durationS)issues.push("Duration missing or nonpositive; fit will not be assessed.");
    if(dateValid&&(date<"2022-10-01"||date>"2023-05-31"))issues.push("Departure date outside the main survey period.");
    if(raw.date_emg&&raw.date_o&&raw.date_emg!==raw.date_o)issues.push("Survey and departure dates differ.");
    if(raw.heure_d!==null&&raw.heure_d!==undefined)issues.push("Source arrival time is unusable; retained only as raw data.");
    if(departure&&durationS&&raw.date_d&&new Date(Date.parse(departure+"Z")+durationS*1000).toISOString().slice(0,10)!==raw.date_d)issues.push("Recorded arrival date disagrees with departure plus duration.");
  }
  return {key:String(raw.key??`row-${rowIndex}`),rowIndex,raw,origin,destination,modes,departure,durationS,
    weight:typeof raw.poids_jour==="number"&&raw.poids_jour>=0?raw.poids_jour:kind==="cube"?Number(raw.volume)||0:null,issues,exclusions:[]};
}
export function eligibility(record: NetmobRecord, kind: "emg" | "cube", areas: ReadonlyMap<string, NetmobArea>): string[] {
  if(kind==="cube")return ["Missing area crosswalk and transport modes"];
  const why:string[]=[];
  if(record.modes.includes("AVION")||normalizeMode(record.raw.mode_principal)==="AVION")why.push("Flight excluded");
  if(!isIdfCode(record.origin)||!isIdfCode(record.destination))why.push("Outside IDF or missing area code");
  if(!areas.has(record.origin)||!areas.has(record.destination))why.push("Missing boundary geometry");
  return why;
}
export function matchesFilter(r:NetmobRecord,f:NetmobFilter):boolean {
  const contains=(value:unknown,query?:string)=>!query||String(value??"").toLocaleLowerCase().includes(query.toLocaleLowerCase());
  if(!contains(`${r.origin} ${r.raw.com_o??""}`,f.origin)||!contains(`${r.destination} ${r.raw.com_d??""}`,f.destination))return false;
  if(!contains(`${r.modes.join(" ")} ${r.raw.mode_principal??""}`,f.mode?.replace(/\s*(?:→|>|,)\s*/g," "))||!contains(`${r.raw.motif_o??""} ${r.raw.motif_d??""}`,f.purpose))return false;
  const date=String(r.raw.date_o??r.raw.date??""); const time=String(r.raw.heure_o??r.raw.tranchehoraire??"").slice(0,5);
  if((f.dateFrom||f.dateTo)&&!date)return false;
  if((f.timeFrom||f.timeTo)&&!time)return false;
  if(f.dateFrom&&date<f.dateFrom||f.dateTo&&date>f.dateTo)return false;
  const interval=String(r.raw.tranchehoraire??"").match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if(interval&&(f.timeFrom||f.timeTo)){
    const minute=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
    const ranges=(a:number,b:number)=>b>=a?[[a,b]]:[[a,1440],[0,b]];
    const source=ranges(minute(interval[1]),minute(interval[2]));
    const requested=ranges(f.timeFrom?minute(f.timeFrom):0,f.timeTo?minute(f.timeTo):1440);
    if(!source.some(([a,b])=>requested.some(([c,d])=>b>c&&a<=d)))return false;
  }else if(f.timeFrom&&f.timeTo&&f.timeFrom>f.timeTo){if(time<f.timeFrom&&time>f.timeTo)return false;}
  else if(f.timeFrom&&time<f.timeFrom||f.timeTo&&time>f.timeTo)return false;
  if(f.durationMin!==undefined&&(r.durationS===null||r.durationS<f.durationMin*60)||f.durationMax!==undefined&&(r.durationS===null||r.durationS>f.durationMax*60))return false;
  return !f.eligibleOnly||r.exclusions.length===0;
}
/** Facets exclude their own filter, allowing users to widen a selection again. */
export function dataFacets(records: NetmobRecord[], filter: NetmobFilter): NetmobFacets {
  const result: NetmobFacets = {modes:{}, purposes:{}, dates:{}, durationMin:null, durationMax:null};
  const modeFilter={...filter,mode:undefined}, purposeFilter={...filter,purpose:undefined};
  const dateFilter={...filter,dateFrom:undefined,dateTo:undefined};
  const durationFilter={...filter,durationMin:undefined,durationMax:undefined};
  const count=(values: Record<string,number>, value: string)=>{if(value)values[value]=(values[value]??0)+1;};
  for(const row of records){
    if(matchesFilter(row,modeFilter))for(const mode of new Set([...row.modes,normalizeMode(row.raw.mode_principal),row.modes.join(" → ")]))count(result.modes,mode);
    if(matchesFilter(row,purposeFilter))for(const purpose of new Set([row.raw.motif_o,row.raw.motif_d].map(v=>String(v??"").trim().toUpperCase())))count(result.purposes,purpose);
    if(matchesFilter(row,dateFilter)){
      const date=String(row.raw.date_o??row.raw.date??"");
      if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date)count(result.dates,date);
    }
    if(row.durationS!==null&&matchesFilter(row,durationFilter)){
      const minutes=row.durationS/60;
      result.durationMin=Math.min(result.durationMin??minutes,minutes);
      result.durationMax=Math.max(result.durationMax??minutes,minutes);
    }
  }
  return result;
}
export class NetmobDataset {
  constructor(readonly summary:NetmobSummary,readonly records:NetmobRecord[],readonly areas:Map<string,NetmobArea>){}
  query(filter:NetmobFilter={},page=0,size=50):NetmobPage {
    const matching=this.records.filter(r=>matchesFilter(r,filter));
    page=Math.min(Math.max(0,Math.floor(page)),Math.max(0,Math.ceil(matching.length/size)-1));
    return {rows:matching.slice(page*size,(page+1)*size),total:matching.length,weight:matching.reduce((s,r)=>s+(r.weight??0),0),page};
  }
  select(filter:NetmobFilter,limit:number,indices?:number[],offset=0):NetmobRecord[] {
    const selected=indices?new Set(indices):null;
    const start=selected?0:Math.max(0,Math.floor(offset)||0);
    return this.records.filter(r=>selected?selected.has(r.rowIndex):matchesFilter(r,filter)).slice(start,start+Math.max(1,Math.min(1000,Math.floor(limit)||100)));
  }
}
/** Geometry stays as WKB until its area's first usable row, avoiding repeated polygon decoding. */
export async function importNetmob(file:AsyncBuffer,name:string,id:string,supplements:NetmobArea[]=[],progress:(text:string)=>void=()=>{}):Promise<NetmobDataset> {
  const started=performance.now();const metadata=await parquetMetadataAsync(file);
  const columns=metadata.schema.filter(s=>s.type!==undefined).map(s=>({name:s.name,type:s.logical_type?.type??s.converted_type??s.type!}));
  const names=columns.map(c=>c.name);
  const kind=names.includes("code_insee_o")&&names.includes("code_insee_d")?"emg":names.includes("origine")&&names.includes("destination")&&names.includes("volume")?"cube":null;
  if(!kind)throw new Error("This Parquet schema is neither an EMG trip table nor the NetMob OD/time cube.");
  if(Number(metadata.num_rows)>1_000_000)throw new Error("The pilot supports files up to 1,000,000 records.");
  progress("Reading source columns…");
  const rows=await parquetReadObjects({file,metadata,compressors,columns:names.filter(n=>!["geom_o","centroid_o"].includes(n))});
  const records=rows.map((r,i)=>normalizeRecord(r,i,kind));rows.length=0;
  const areas=new Map<string,NetmobArea>();
  if(kind==="emg"&&names.includes("geom_o")) {
    progress("Indexing unique area polygons…");
    await parquetRead({file,metadata,compressors,columns:["geom_o"],utf8:false,parsers:{...DEFAULT_PARSERS,geometryFromBytes:b=>b},onChunk:chunk=>{
      for(let i=0;i<chunk.columnData.length;i++) {
        const r=records[chunk.rowStart+i];const bytes=chunk.columnData[i] as Uint8Array|null;
        if(!bytes||!r.origin||areas.has(r.origin))continue;
        try {
          const geometry=DEFAULT_PARSERS.geometryFromBytes(bytes);
          if(validGeometry(geometry))areas.set(r.origin,{code:r.origin,name:String(r.raw.com_o??r.origin),geometry,source:`EMG ${id}:geom_o`});
          else r.issues.push("Invalid or unsupported origin polygon.");
        } catch {r.issues.push("Invalid origin WKB geometry.");}
      }
    }});
  }
  for(const area of kind==="emg"?supplements:[])if(!areas.has(area.code)&&validGeometry(area.geometry))areas.set(area.code,area);
  const modes:Record<string,number>={}, exclusions:Record<string,number>={}; const keys=new Set<string>();let eligible=0,weight=0;
  for(const r of records){r.exclusions=eligibility(r,kind,areas);if(keys.has(r.key)){r.exclusions.push("Duplicate source key");}keys.add(r.key);
    if(!r.exclusions.length)eligible++;weight+=r.weight??0;
    const mode=normalizeMode(r.raw.mode_principal)||"Unknown";modes[mode]=(modes[mode]??0)+1;
    for(const why of r.exclusions)exclusions[why]=(exclusions[why]??0)+1;
  }
  return new NetmobDataset({id,name,kind,rows:records.length,eligible,weight,areas:areas.size,columns,modes,exclusions,importMs:performance.now()-started},records,areas);
}
