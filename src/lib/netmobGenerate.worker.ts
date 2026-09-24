import { readNetmobJson } from "./netmobAssets";
import { OrsClient } from "./orsClient";
import { generateNetmobBatch, routingContext, isUnknownMode } from "./netmobRouting";
import type { FitSettings, NetmobArea, NetmobRecord } from "./netmobTypes";
import type { TransitNetwork } from "./transitTypes";
import type { TransitTiming } from "./netmobTiming";
let controller:AbortController|undefined;
let network:TransitNetwork|undefined,timing:TransitTiming|undefined;
let running=false;let assetFailure:string|undefined;
async function resource<T>(name:string,assetBaseUrl:string,signal:AbortSignal):Promise<T>{return readNetmobJson<T>(await fetch(new URL(`data/${name}`,assetBaseUrl),{signal}));}
self.onmessage=async({data}:{data:{id:number;action:string;assetBaseUrl:string;datasetId:string;records:NetmobRecord[];areas:NetmobArea[];settings:FitSettings;provider:"hosted"|"local";key:string;maxAccessM:number;maxCyclingM:number}})=>{
  if(data.action==="cancel"){controller?.abort();return;}
  if(running){self.postMessage({id:data.id,error:"A routing job is already running."});return;}
  running=true;controller=new AbortController();
  try{
    // Street-only records can still run if a transit asset is unavailable.
    const needsTransit=data.records.some(r=>!r.modes.length||r.modes.some(m=>isUnknownMode(m)||["METRO","RER/TRAIN","RER/METRO","TRAM","BUS","TGV/INTERCITES/TER"].includes(m)));
    if(needsTransit&&(!network||!timing)){try{[network,timing]=await Promise.all([resource<TransitNetwork>("idfm-netmob-transit.json.gz",data.assetBaseUrl,controller.signal),resource<TransitTiming>("idfm-timing.json.gz",data.assetBaseUrl,controller.signal)]);}catch(error){assetFailure=`Transit assets unavailable: ${error instanceof Error?error.message:String(error)}`;self.postMessage({id:data.id,progress:assetFailure});}}
    const context=routingContext(new OrsClient({apiKey:data.key,local:data.provider==="local"}),controller.signal,network,timing);
    let completed=0;
    context.onTrial=(pair,trial,total,modes)=>self.postMessage({id:data.id,progress:`Trip ${completed+1} · ${modes.join(" → ")} · trial ${trial}/${total}`,completed,total:data.records.length,trial:{rowIndex:pair.record.rowIndex,pair:{origin:pair.origin,destination:pair.destination,candidate:pair.candidate}}});
    context.transitUnavailableReason=assetFailure;
    context.maxAccessM=data.maxAccessM;context.maxCyclingM=data.maxCyclingM;
    const result=await generateNetmobBatch(context,data.datasetId,data.records,new Map(data.areas.map(a=>[a.code,a])),data.settings,(done,total,trip)=>{
      completed=done;
      if(trip){const {gpx:_gpx,...plain}=Object.getOwnPropertyDescriptors(trip);const safe=Object.fromEntries(Object.entries(plain).map(([key,d])=>[key,d.value]));self.postMessage({id:data.id,completed:done,total,progress:"Route completed",trip:safe});}
      else self.postMessage({id:data.id,completed:done,total,progress:"Record processed"});
    });
    self.postMessage({id:data.id,result:{report:result.report}});
  }catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
  finally{running=false;controller=undefined;}
};
