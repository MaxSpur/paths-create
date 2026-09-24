import {createLocalRunsPanel} from './netmobLocalRuns';
import {createMovementPanel} from './movementPanel';
import {DEFAULT_SIMULATION,type Observation} from '../lib/movementSimulation';
import {createAppearancePanel,defaultPalette} from './netmobAppearance';
import { createNetmobOverlay } from "./netmobMap";
import { escapeHtml as esc } from "./html";
import { candidatePairs } from "../lib/netmobGeometry";
import { DEFAULT_FIT, type FitSettings, type NetmobArea, type NetmobFilter, type NetmobPage, type NetmobPair, type NetmobRecord, type NetmobSummary } from "../lib/netmobTypes";
import { buildTripGpx } from "../lib/gpxWriter";
import { pageTrips, TRIP_PAGE_SIZE } from "../lib/tripBatches";
import type { NetmobRunReport } from "../lib/netmobRouting";
import type { GeneratedBatch, GeneratedTrip } from "../lib/types";
import type { MapView } from "./map";

class DatasetWorker {
  readonly worker = new Worker(new URL("../lib/netmob.worker.ts",import.meta.url),{type:"module"});
  private next=0;
  private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;progress?:(text:string)=>void}>();
  constructor(){
    this.worker.onmessage=({data})=>{const request=this.pending.get(data.id);if(!request)return;if(data.progress){request.progress?.(data.progress);return;}this.pending.delete(data.id);data.error?request.reject(new Error(data.error)):request.resolve(data.result);};
    this.worker.onerror=e=>{for(const p of this.pending.values())p.reject(new Error(e.message||"Dataset worker failed"));this.pending.clear();};
  }
  call<T>(action:string,values:Record<string,unknown>={},progress?:(text:string)=>void):Promise<T>{const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve:resolve as(value:unknown)=>void,reject,progress});this.worker.postMessage({id,action,...values});});}
  close(){this.worker.terminate();for(const p of this.pending.values())p.reject(new Error("Import cancelled"));this.pending.clear();}
}
interface DatasetView {worker:DatasetWorker;summary:NetmobSummary;filter:NetmobFilter;page:NetmobPage;selected:number|null;offset:number}
interface PreparedJob {datasetId:string;records:NetmobRecord[];areas:NetmobArea[];settings:FitSettings;label?:string}
interface Settings {provider:"hosted"|"local";key:string;maxAccessM:number;maxCyclingM:number}
export interface NetmobView {renderMap:()=>void;selectTrip:(id:string)=>void;setVisible:(visible:boolean)=>void}
const emptyPage:NetmobPage={rows:[],total:0,weight:0,page:0};
const blankReport=():NetmobRunReport=>({requestedTrips:0,generatedTrips:0,failedTrips:0,failures:[],pairingStats:{uniquePairsUsed:0,maxPairReuse:0},reuseStats:{metroPath:false,walkingLegs:0,walkingLegRequests:0},serviceStats:{overpassFallback:false},netmob:{version:1,datasetId:"",requestedKeys:[],settings:{...DEFAULT_FIT},completedKeys:[],failed:[],cancelled:false,serviceStopped:false,elapsedMs:0,requests:0,cacheHits:0,acceptable:0,poor:0,unassessed:0,timeBandAssumption:""}});
const number=(value:number)=>value.toLocaleString(undefined,{maximumFractionDigits:1});
const mins=(seconds:number|null|undefined)=>seconds==null?"—":`${(seconds/60).toFixed(1)} min`;
function metadata(trip:GeneratedTrip){return trip.exportInput!.netmob!;}

export function createNetmobView(panel:HTMLElement,map:MapView,getSettings:()=>Settings,mapHost?:HTMLElement):NetmobView {
  map.installNetmobOverlay?.(createNetmobOverlay);
  const visibleBatches=new Set<string>(),visibleTrips=new Set<string>();
  let mapHidden=false;const appearance={unfocused:0,points:100,paths:100,outlines:100,saturation:100,brightness:100};
  const palette=defaultPalette();const appearancePanel=createAppearancePanel(appearance,palette,()=>renderMap());
  let observations:Observation[]|null=null;const movementPanel=createMovementPanel(samples=>{observations=samples;renderMap();});
  let highlightedArea:string|null=null;let liveTrials=true,processed=0,runTotal=0,completedRoutes=0,lastPaint=0;
  let mapCacheKey="",mapCacheTrips:GeneratedTrip[]=[],mapCachePairs:NetmobPair[]=[];
  const datasets:DatasetView[]=[];let active=0,visible=false,importing:DatasetWorker|null=null;
  let importCancelled=false;
  let status="Choose one or both NetMob Parquet files. Files stay on this computer.";
  let fit:FitSettings={...DEFAULT_FIT,durationModel:"movement"},batchSize=100;
  let preparedLabel="";let prepared:NetmobPair[]=[],preparedDataset="";let preparedRecords:NetmobRecord[]=[],preparedAreas:NetmobArea[]=[];
  let consumed=false, preparing=false, inspecting=false;let inspectedAreas:NetmobArea[]=[];let trialPairs:NetmobPair[]=[];let trialRow=0;let calendarMonth="",calendarTarget="dateFrom";
  let pairPage=0,selectedTrip:string|null=null,batchPage=0,tripPage=0,openBatch:string|null=null;
  const batchJobs=new Map<string,PreparedJob>();
  let batches:GeneratedBatch[]=[];let busy=false,exporting=false,exportController:AbortController|null=null;
  let generator:Worker|undefined;let jobId=0;let queryId=0;let routeRevision=0;
  let onlyFits=false,format:"parquet"|"gpx"="parquet",scope:"batch"|"all"="batch";
  const current=()=>datasets[active];
  let localPreview:GeneratedTrip|undefined;
  const localRuns=createLocalRunsPanel(()=>{const view=current();return view?.summary.kind==='emg'?{sourceName:view.summary.name,sourceHash:view.summary.id,rows:view.page.total,filter:view.filter,settings:fit,maxAccessM:getSettings().maxAccessM,maxCyclingM:getSettings().maxCyclingM,browserBusy:busy}:undefined;},preview=>{
    const input=preview?.input;localPreview=input?.originPoint&&input.destinationPoint?{id:input.id,pairKey:input.pairKey??input.id,fileName:'',gpx:'',exportInput:input,routeMode:input.routeMode??'metro',originPoint:{...input.originPoint,addressStatus:'skipped'},destinationPoint:{...input.destinationPoint,addressStatus:'skipped'},walkInCoords:[],walkOutCoords:[],metroCoords:[],drivingCoords:[]}:undefined;
    observations=null;renderMap();if(localPreview&&visible)map.focusOnTrip(localPreview);appearancePanel.update(localPreview?[localPreview]:batches.flatMap(b=>b.trips));
  });

  const setStatus=(text:string)=>{status=text;for(const el of panel.querySelectorAll("[data-status], [data-run-status]"))el.textContent=text;};
  const tripPinned=(trip:GeneratedTrip,batch:GeneratedBatch)=>visibleBatches.has(batch.id)||visibleTrips.has(trip.id);
  const tripVisible=(trip:GeneratedTrip,batch:GeneratedBatch)=>!mapHidden&&(batch.id===openBatch||tripPinned(trip,batch)||trip.id===selectedTrip);
  function mapSelection(){
    const trips=batches.flatMap(batch=>batch.trips.filter(trip=>tripVisible(trip,batch)));
    const key=trips.map(t=>t.id).join("|");
    if(key!==mapCacheKey){mapCacheKey=key;mapCacheTrips=trips;mapCachePairs=[];
      const jobs=new Map(batches.map(b=>[b.id,batchJobs.get(b.id)]));
      for(const batch of batches){const job=jobs.get(batch.id);if(!job)continue;const areas=new Map(job.areas.map(a=>[a.code,a])),records=new Map(job.records.map(r=>[r.rowIndex,r]));
        for(const trip of batch.trips){if(!tripVisible(trip,batch))continue;const m=metadata(trip),record=records.get(m.rowIndex),originArea=record&&areas.get(record.origin),destinationArea=record&&areas.get(record.destination);
          if(record&&originArea&&destinationArea)mapCachePairs.push({record,originArea,destinationArea,origin:m.origin,destination:m.destination,candidate:m.candidate,tripId:trip.id} as NetmobPair);
        }
      }
    }
    return {trips:mapCacheTrips,pairs:mapCachePairs};
  }
  function renderMap(){if(!visible)return;
    if(localPreview){map.render({stations:[],activeStationId:null,selectedPointId:null,selectedTripId:null,selectedOriginStationId:null,selectedDestinationStationId:null,previewTrips:[]});map.showNetmobPairs([],false,[],{trips:[localPreview],highlighted:new Set([localPreview.id]),appearance,palette,onClear:()=>{localPreview=undefined;renderMap();},onTrip:()=>{}});return;}

    const selection=mapSelection();const sourcePreview=inspecting||trialPairs.length||!openBatch;
    const trips=sourcePreview?[]:selection.trips;
    const highlighted=new Set(trips.filter(t=>highlightedArea?String(metadata(t).raw.code_insee_o)===highlightedArea||String(metadata(t).raw.code_insee_d)===highlightedArea:t.id===selectedTrip).map(t=>t.id));
    map.render({stations:[],activeStationId:null,selectedPointId:null,selectedTripId:null,selectedOriginStationId:null,selectedDestinationStationId:null,previewTrips:[]});
    map.showNetmobPairs(trialPairs.length?trialPairs:inspecting?[]:openBatch?selection.pairs:prepared.slice(pairPage*50,pairPage*50+50),false,inspectedAreas,{trips,highlighted,appearance,palette,observations:observations?.map(p=>p.position),pinned:new Set(batches.flatMap(b=>b.trips.filter(t=>tripPinned(t,b)).map(t=>t.id))),onClear:()=>{selectedTrip=null;highlightedArea=null;render();},onTrip:selectTrip,onArea:code=>{
      highlightedArea=code;selectedTrip=null;setStatus(`${trips.filter(t=>String(metadata(t).raw.code_insee_o)===code||String(metadata(t).raw.code_insee_d)===code).length} visible routes originate or end in ${code}.`);render();
    }});
  }
  function paintProgress(){
    const bar=panel.querySelector<HTMLProgressElement>("#netmobProgress");if(bar){bar.max=Math.max(1,runTotal);bar.value=processed;}
    const text=panel.querySelector("[data-completed]");if(text)text.textContent=`${processed} / ${runTotal} processed · ${completedRoutes} routes completed`;
  }
  async function query(page=0,nextFilter?:NetmobFilter){const view=current();if(!view)return;const id=++queryId;try{
    const result=await view.worker.call<NetmobPage>("query",{filter:nextFilter??view.filter,page});if(id!==queryId||view!==current())return;
    if(nextFilter&&result.total===0){setStatus("These filters match no rows. The previous selection is retained; clear or widen a filter.");render();return;}
    if(nextFilter){view.filter=nextFilter;view.offset=0;clearPrepared();}
    view.page=result;view.selected=null;inspecting=false;inspectedAreas=[];trialPairs=[];render();
  }catch(e){setStatus(String(e));}}
  async function inspect(index:number){localPreview=undefined;const view=current();if(!view||busy)return;view.selected=index;inspecting=true;const revision=++routeRevision;
    try{const result=await view.worker.call<{records:NetmobRecord[];areas:NetmobArea[]}>("select",{indices:[index],limit:1});
      if(revision!==routeRevision||view!==current())return;
      const record=result.records[0];inspectedAreas=[record.origin,record.destination].flatMap(code=>result.areas.filter(a=>a.code===code));trialPairs=[];
      setStatus(`Inspecting ${record.key}: ${inspectedAreas.length?"origin in teal, destination in amber. Same-area trips share one boundary.":"No geographical boundary is available for this row."}`);render();if(visible)map.showNetmobPairs([],true,inspectedAreas);
    }catch(e){setStatus(String(e));}
  }
  function previewTrials(index:number){localPreview=undefined;const pair=prepared[index];if(!pair)return;trialRow=index;inspecting=false;inspectedAreas=[];openBatch=null;
    trialPairs=candidatePairs(preparedDataset,pair.record,pair.originArea,pair.destinationArea,fit);render();if(visible)map.showNetmobPairs(trialPairs,true);
  }
  function clearPrepared(){consumed=false;inspecting=false;inspectedAreas=[];trialPairs=[];trialRow=0;prepared=[];preparedRecords=[];preparedAreas=[];preparedDataset="";pairPage=0;routeRevision++;}
  async function importFiles(files:File[]){if(busy||importing)return;importCancelled=false;for(const file of files){if(importCancelled)break;const worker=new DatasetWorker();importing=worker;render();try{
      const r=await fetch(`${import.meta.env.BASE_URL}data/netmob-boundaries.json`);if(!r.ok)throw new Error("Boundary supplement is unavailable.");const supplements=(await r.json()).areas;
      const summary=await worker.call<NetmobSummary>("import",{file,supplements},setStatus);
      if(datasets.some(d=>d.summary.id===summary.id)){worker.close();setStatus(`${file.name} is already open.`);continue;}
      datasets.push({worker,summary,filter:{},page:{...emptyPage},selected:null,offset:0});active=datasets.length-1;clearPrepared();
      setStatus(`${summary.name}: ${number(summary.rows)} rows, ${number(summary.eligible)} geographically eligible; imported in ${(summary.importMs/1000).toFixed(2)} s.`);await query();
    }catch(e){worker.close();setStatus(e instanceof Error?e.message:String(e));}finally{importing=null;render();}}}
  async function prepare(indices?:number[]){localPreview=undefined;const view=current();if(!view||view.summary.kind!=="emg"||busy||preparing)return;preparing=true;render();const revision=++routeRevision;setStatus("Preparing deterministic pairs…");try{
    const result=await view.worker.call<{records:NetmobRecord[];areas:NetmobArea[]}>("select",{filter:view.filter,limit:indices?indices.length:batchSize,indices,offset:view.offset});
    if(revision!==routeRevision||view!==current())return;
    const areas=new Map(result.areas.map(a=>[a.code,a]));const ready:NetmobPair[]=[];const excluded:string[]=[];
    for(const record of result.records){if(record.exclusions.length){excluded.push(`${record.key}: ${record.exclusions.join("; ")}`);continue;}try{ready.push(candidatePairs(view.summary.id,record,areas.get(record.origin)!,areas.get(record.destination)!,fit)[0]);}catch(e){excluded.push(`${record.key}: ${String(e)}`);}}
    consumed=false;inspecting=false;inspectedAreas=[];trialPairs=[];trialRow=0;openBatch=null;selectedTrip=null;prepared=ready;preparedRecords=result.records;preparedAreas=result.areas;preparedDataset=view.summary.id;pairPage=0;
    const f=view.filter;preparedLabel=indices?`Row ${indices[0]+1} · ${result.records[0]?.modes.join(" → ")||"Unknown"}`:[f.mode||"All modes",f.durationMin!==undefined||f.durationMax!==undefined?`${f.durationMin??0}–${f.durationMax??"∞"} min`:"",f.origin?`from ${f.origin}`:"",f.destination?`to ${f.destination}`:"",f.purpose||"",f.dateFrom||f.dateTo?`${f.dateFrom||"…"}–${f.dateTo||"…"}`:"",`rows ${view.offset+1}–${view.offset+result.records.length}`].filter(Boolean).join(" · ");
    setStatus(`${ready.length} pairs prepared from ${result.records.length} selected rows. ${excluded.length} excluded or unsampleable.${excluded.length?" Inspect eligibility and the run report for reasons.":""}`);render();if(visible)map.showNetmobPairs(prepared.slice(0,50),true);
  }catch(e){setStatus(e instanceof Error?e.message:String(e));}finally{preparing=false;render();}}
  function selectTrip(id:string){localPreview=undefined;highlightedArea=null;mapHidden=false;inspecting=false;inspectedAreas=[];trialPairs=[];const batch=batches.find(b=>b.trips.some(t=>t.id===id));if(!batch)return;openBatch=batch.id;selectedTrip=id;tripPage=Math.floor(batch.trips.findIndex(t=>t.id===id)/TRIP_PAGE_SIZE);render();const trip=batch.trips.find(t=>t.id===id)!;if(visible)map.focusOnTrip(trip);}
  async function generate(retry=false){localPreview=undefined;
    if(busy||(!retry&&consumed))return;
    const prior=batches.find(b=>b.id===openBatch);
    const snapshot=retry&&prior?batchJobs.get(prior.id):{datasetId:preparedDataset,records:preparedRecords,areas:preparedAreas,settings:{...fit,...(fit.durationModel==="movement"?{movement:structuredClone(fit.movement??DEFAULT_SIMULATION)}:{})},label:preparedLabel};
    if(!snapshot)return;
    let records=snapshot.records;
    const completed=new Set(batches.flatMap(b=>b.trips).filter(t=>{const m=metadata(t);return m.datasetId===snapshot.datasetId&&m.settings.seed===snapshot.settings.seed&&m.settings.realization===snapshot.settings.realization;}).map(t=>metadata(t).rowIndex));
    records=records.filter(r=>!completed.has(r.rowIndex));
    if(!records.length){setStatus("These rows already have results for this seed and realization. Prepare the next batch, or change Realization for a new sample.");if(!retry)consumed=true;render();return;}
    const settings=getSettings();if(settings.provider==="hosted"&&!settings.key.trim()){setStatus("Set your ORS key in Manual mode, or choose Local ORS there.");return;}
    processed=0;completedRoutes=0;runTotal=records.length;lastPaint=0;busy=true;consumed=true;inspecting=false;inspectedAreas=[];trialPairs=[];const id=++jobId;const batch:GeneratedBatch={id:`netmob-batch-${Date.now()}-${id}`,name:`#${batches.length+1} · ${snapshot.label||"Mixed modes"} · ${records.length} rows`,createdAt:new Date().toISOString(),trips:[],report:blankReport()};
    const job={...snapshot,records};batchJobs.set(batch.id,job);mapHidden=false;
    batch.report.requestedTrips=records.length;
    Object.assign((batch.report as NetmobRunReport).netmob,{datasetId:job.datasetId,settings:job.settings,requestedKeys:records.map(r=>r.key)});
    const interrupted=(message:string)=>{const report=batch.report as NetmobRunReport;report.generatedTrips=batch.trips.length;report.failures.push({code:"WORKER",message});report.netmob.completedKeys=batch.trips.map(t=>metadata(t).sourceKey);for(const status of ["acceptable","poor","unassessed"] as const)report.netmob[status]=batch.trips.filter(t=>metadata(t).fit.status===status).length;};
    batches=[batch,...batches];openBatch=batch.id;batchPage=0;tripPage=0;selectedTrip=null;setStatus("Loading offline transit estimates and starting route fitting…");render();
    generator??=new Worker(new URL("../lib/netmobGenerate.worker.ts",import.meta.url),{type:"module"});
    generator.onmessage=({data})=>{if(data.id!==jobId)return;if(data.completed!==undefined){processed=data.completed;runTotal=data.total;}if(data.progress)setStatus(data.progress);paintProgress();
      if(data.trial&&liveTrials&&visible&&performance.now()-lastPaint>=250){lastPaint=performance.now();const r=job.records.find(r=>r.rowIndex===data.trial.rowIndex);const a=job.areas.find(a=>a.code===r?.origin),b=job.areas.find(a=>a.code===r?.destination);
        if(r&&a&&b){trialPairs=[{record:r,originArea:a,destinationArea:b,...data.trial.pair}];renderMap();}
      }
      if(data.trip){const trip=data.trip as GeneratedTrip;Object.defineProperty(trip,"gpx",{get:()=>buildTripGpx(trip.exportInput!)});batch.trips.push(trip);completedRoutes=batch.trips.length;paintProgress();if(!liveTrials&&performance.now()-lastPaint>=250){lastPaint=performance.now();renderMap();}}
      if(data.result||data.error){busy=false;trialPairs=[];if(data.result)batch.report=data.result.report;else interrupted(data.error);
        const report=(batch.report as NetmobRunReport).netmob;processed=batch.trips.length+report.failed.length;
        setStatus(data.error?`Run interrupted: ${data.error}. ${batch.trips.length} completed trips retained.`:`${batch.trips.length} routes · ${report.acceptable} acceptable · ${report.poor} poor · ${batch.report.failedTrips} failed/excluded${report.cancelled?" · cancelled":""}${report.serviceStopped?" · service failure stopped the run":""}.`);render();}
    };
    generator.onerror=e=>{busy=false;trialPairs=[];interrupted(e.message||"Routing worker failed");setStatus(`Routing worker failed: ${e.message}. Completed results retained.`);generator?.terminate();generator=undefined;render();};
    generator.postMessage({id,action:"generate",assetBaseUrl:new URL(import.meta.env.BASE_URL,document.baseURI).href,...job,...settings});
  }
  async function exportResults(){if(exporting)return;const source=scope==="all"?batches:batches.filter(b=>b.id===openBatch);const selected=source.map(b=>({...b,trips:b.trips.filter(t=>!onlyFits||metadata(t).fit.status==="acceptable")}));exporting=true;exportController=new AbortController();render();try{const {exportBatches,saveExport}=await import("../lib/batchExport");const result=await exportBatches(selected,format,exportController.signal,setStatus);saveExport(result.bytes,result.name);setStatus("Export complete.");}catch(e){setStatus(e instanceof Error?e.message:String(e));}finally{exporting=false;exportController=null;render();}}
  function render(){
    const focused=panel.contains(document.activeElement)?(document.activeElement as HTMLElement).id:"";
    const scroll=panel.parentElement?.scrollTop??0;
    const view=current(),summary=view?.summary,filter=view?.filter??{},page=view?.page??emptyPage;
    const row=page.rows.find(r=>r.rowIndex===view?.selected);
    const batch=batches.find(b=>b.id===openBatch),trip=batch?.trips.find(t=>t.id===selectedTrip),report=batch?.report as NetmobRunReport|undefined;
    const disabled=busy||Boolean(importing)||preparing;
    const facets=page.facets;const dates=Object.keys(facets?.dates??{}).sort();const months=[...new Set(dates.map(d=>d.slice(0,7)))];if(!months.includes(calendarMonth))calendarMonth=months[0]??"";
    const input=(label:string,name:string,type="text",value:unknown="",attrs="")=>`<label>${label}<input id="netmob-${name}" name="${name}" type="${type}" value="${esc(String(value??""))}" ${attrs}></label>`;
    const choices=(label:string,name:string,values:Record<string,number>,value:string|undefined)=>{
      const entries=Object.keys(values).sort((a,b)=>a.localeCompare(b));
      const options=(list:string[])=>list.map(v=>`<option value="${esc(v)}" ${v===value?"selected":""}>${esc(v)}</option>`).join("");
      return `<label>${label}<select id="netmob-${name}" name="${name}"><option value="">All</option>${name==="mode"?`<optgroup label="Modes (any recorded stage)">${options(entries.filter(v=>!v.includes(" → ")))}</optgroup><optgroup label="Recorded sequences (contains)">${options(entries.filter(v=>v.includes(" → ")))}</optgroup>`:options(entries)}</select></label>`;
    };
    const dateBounds=`min="${dates[0]??""}" max="${dates.at(-1)??""}"`;
    const durationBounds=`min="${facets?.durationMin??0}" max="${facets?.durationMax??0}" step="any"`;
    const calendar=calendarMonth?`<details class="netmob-calendar"><summary>Date availability · darker means more rows</summary><div class="netmob-grid"><label>Month<select id="netmobMonth">${months.map(m=>`<option ${m===calendarMonth?"selected":""}>${m}</option>`).join("")}</select></label><label>Set date<select id="netmobDateTarget"><option value="dateFrom" ${calendarTarget==="dateFrom"?"selected":""}>From</option><option value="dateTo" ${calendarTarget==="dateTo"?"selected":""}>To</option></select></label></div><div class="netmob-days">${["Mo","Tu","We","Th","Fr","Sa","Su"].map(d=>`<span>${d}</span>`).join("")}${Array.from({length:(new Date(calendarMonth+"-01T12:00:00Z").getUTCDay()+6)%7},()=>"<span></span>").join("")}${Array.from({length:new Date(Number(calendarMonth.slice(0,4)),Number(calendarMonth.slice(5)),0).getDate()},(_,i)=>{const d=`${calendarMonth}-${String(i+1).padStart(2,"0")}`,n=facets?.dates[d]??0;return `<button type="button" data-date="${d}" ${!n||disabled?"disabled":""} style="--heat:${n?0.15+0.7*Math.log1p(n)/Math.log1p(Math.max(...Object.values(facets!.dates))):0}" title="${d}: ${number(n)} rows" aria-label="${d}: ${number(n)} rows">${i+1}</button>`;}).join("")}</div><p class="muted">Counts respect other filters, excluding the date range. Missing and anomalous dates remain visible in record details.</p></details>`:"";
    panel.innerHTML=`<div class="netmob">
      <h1>NetMob</h1><p class="muted">Explore → Prepare pairs → Generate → Review/export</p>
      <p class="muted">Browser imports and pilot results are session-only. Local runs below save directly to disk and reconnect after reload.</p>
      <label class="netmob-import">Open Parquet files<input id="netmobFiles" type="file" accept=".parquet" multiple ${disabled?"disabled":""}></label>
      ${importing?'<button data-action="cancel-import">Cancel import</button>':""}
      <div class="netmob-status" role="status" aria-live="polite" data-status>${esc(status)}</div>
      ${datasets.length?`<label>Dataset<select id="netmobDataset" ${disabled?"disabled":""}>${datasets.map((d,i)=>`<option value="${i}" ${i===active?"selected":""}>${esc(d.summary.name)}</option>`).join("")}</select></label><button data-action="close-dataset" ${disabled?"disabled":""}>Close dataset</button>`:""}
      <div data-local-runs></div>
      ${summary?`<section><h2>1 · Explore</h2><p><b>${number(summary.rows)}</b> source rows · <b>${number(summary.eligible)}</b> geographically eligible · ${number(summary.areas)} area polygons</p>
      <p class="muted">${summary.kind==="cube"?"Volume total":"Survey-weight total"}: ${number(summary.weight)}. ${summary.kind==="cube"?"This cube has no area crosswalk or modes; route generation is unavailable.":"Eligibility does not guarantee a route or a duration match."}</p>
      <details><summary>Schema, modes, and exclusions</summary><pre>${esc(JSON.stringify({columns:summary.columns,modes:summary.modes,exclusions:summary.exclusions,sha256:summary.id},null,2))}</pre></details>
      <form id="netmobFilter"><div class="netmob-grid">${input("Origin code/name","origin","text",filter.origin)}${input("Destination code/name","destination","text",filter.destination)}${choices("Mode / sequence","mode",facets?.modes??{},filter.mode)}${choices("Purpose (origin or destination)","purpose",facets?.purposes??{},filter.purpose)}${input("Date from","dateFrom","date",filter.dateFrom,dateBounds)}${input("Date to","dateTo","date",filter.dateTo,dateBounds)}${input("Time from","timeFrom","time",filter.timeFrom)}${input("Time to","timeTo","time",filter.timeTo)}${input("Duration min (min)","durationMin","number",filter.durationMin,durationBounds)}${input("Duration max (min)","durationMax","number",filter.durationMax,durationBounds)}</div>
      <label><input name="eligibleOnly" type="checkbox" ${filter.eligibleOnly?"checked":""}> Geographically eligible only</label><button ${disabled?"disabled":""}>Apply filters</button><button type="button" data-action="reset-filters" ${disabled?"disabled":""}>Clear filters</button>${calendar}<p class="muted">Choices and limits follow the other applied filters. Unavailable combinations are rejected.</p></form>
      <p>${number(page.total)} matching rows · ${summary.kind==="cube"?"volume":"weight"} ${number(page.weight)}</p>
      <div class="netmob-table"><table><thead><tr><th>OD</th><th>Mode / time</th><th>Duration</th><th></th></tr></thead><tbody>${page.rows.map(r=>`<tr class="${r.rowIndex===view?.selected?"selected":""}"><td>${esc(r.origin||"?")} → ${esc(r.destination||"?")}<small>${esc(String(r.raw.com_o??r.raw.type??""))}</small></td><td>${esc(r.modes.join(" → ")||String(r.raw.tranchehoraire??"Unknown"))}<small>${esc(r.departure??String(r.raw.date??""))}</small></td><td>${mins(r.durationS)}<small>${r.exclusions.length?"Excluded":"Eligible"}</small></td><td><button data-row="${r.rowIndex}" aria-label="Inspect row ${r.rowIndex+1}">Inspect</button></td></tr>`).join("")}</tbody></table></div>
      <div class="btn-row"><button data-action="prev-row" ${page.page===0||disabled?"disabled":""}>Previous</button><span>Page ${page.page+1} / ${Math.max(1,Math.ceil(page.total/50))}</span><button data-action="next-row" ${(page.page+1)*50>=page.total||disabled?"disabled":""}>Next</button></div>
      ${row?`<details open><summary>Selected record · ${esc(row.key)}</summary><p>${esc([...row.exclusions,...row.issues].join(" "))}</p><pre>${esc(JSON.stringify(row.raw,null,2))}</pre></details>`:""}</section>`:""}
      ${summary?.kind==="emg"?`<section><h2>2 · Prepare pairs</h2><p class="muted">Trials are route attempts per row (default 12), not a limit on routing requests. The closest valid duration wins. Movement fitting simulates acceleration, stops and waits during every trial; dense GNSS observations are only created on request. Realization is an alternative sample number: change it to draw another reproducible trip for the same row. One row still produces one best route.</p><form id="netmobSettings"><div class="netmob-grid">${input("Seed","seed","number",fit.seed)}${input("Realization","realization","number",fit.realization)}${input("Trials (1–64)","trials","number",fit.trials)}${input("Tolerance (minutes)","toleranceMinutes","number",fit.toleranceS/60)}${input("Tolerance (%)","tolerancePercent","number",fit.tolerancePercent)}${input("Batch rows (1–1,000)","batchSize","number",batchSize)}</div><label>Fit duration using<select name="durationModel" aria-label="Fit duration using"><option value="movement" ${fit.durationModel==="movement"?"selected":""}>Simulated movement (calibrated preset)</option><option value="routing" ${fit.durationModel!=="movement"?"selected":""}>ORS / timetable estimates</option></select></label><button ${disabled?"disabled":""}>Apply settings</button></form><p>Filtered batch: rows ${page.total?number((view?.offset??0)+1):0}–${number(Math.min((view?.offset??0)+batchSize,page.total))} of ${number(page.total)}. Set Batch rows, then Apply settings to use up to 1,000 rows per run.</p>
      <div class="btn-row"><button data-action="prepare-selected" ${row&&!disabled?"":"disabled"}>Prepare selected</button><button data-action="prepare-filtered" ${disabled||!page.total?"disabled":""}>Prepare filtered batch</button></div>
      ${preparedRecords.length?`<div class="btn-row"><button data-action="previous-window" ${!view?.offset||disabled?"disabled":""}>Previous source batch</button><button data-action="next-window" ${(view?.offset??0)+batchSize>=page.total||disabled?"disabled":""}>Prepare next source batch</button></div>`:""}
      <p>${prepared.length} candidate pairs · ${preparedRecords.length} selected rows. ${consumed?"This preparation has been run. Use Retry unfinished or prepare the next source batch.":"Fitting can choose different endpoints within the same areas."}</p>
      ${prepared.length?`<label>Preview endpoints for row<select id="netmobTrialRow" ${disabled?"disabled":""}>${prepared.map((p,i)=>`<option value="${i}" ${i===trialRow?"selected":""}>${esc(p.record.key)}</option>`).join("")}</select></label><button data-action="preview-trials" ${disabled?"disabled":""}>Show endpoint proposals</button><button data-action="pair-overview" ${disabled?"disabled":""}>Show batch overview</button><p class="muted">Endpoint preview shows up to ${fit.trials} geographical proposals for one row. Unknown modes compare three routing choices and scooters two proxies, sharing the trial budget across fewer endpoint pairs. During generation the map shows the active trial.</p>`:""}
      ${prepared.length>50?`<div class="btn-row"><button data-action="prev-pair" ${pairPage===0?"disabled":""}>Previous map page</button><span>Map only: ${pairPage+1} / ${Math.ceil(prepared.length/50)}</span><button data-action="next-pair" ${(pairPage+1)*50>=prepared.length?"disabled":""}>Next map page</button></div>`:""}
      <h2>3 · Generate</h2><p class="muted">Provider: ${getSettings().provider==="local"?"Local ORS":"Hosted ORS"} (configured in Manual). Transit uses recent timetable estimates; source survey times are retained separately.</p><p class="muted">Transit: Île-de-France Mobilités / © OpenStreetMap contributors. Boundaries: EMG, Ville de Paris, data.gouv.fr / IGN. <a href="${import.meta.env.BASE_URL}data/netmob-data.LICENSE.md" target="_blank" rel="noopener">Sources and licenses</a></p>
      <label><input id="netmobLiveTrials" type="checkbox" ${liveTrials?"checked":""}> Show live trial locations (at most 4 updates/s)</label>${runTotal?`<div class="netmob-progress"><span data-completed>${processed} / ${runTotal} processed · ${completedRoutes} routes completed</span><progress id="netmobProgress" aria-label="Batch records processed" max="${runTotal}" value="${processed}"></progress></div>`:""}<p data-run-status>${busy||consumed?esc(status):"The map shows each active endpoint trial while routing."}</p><div class="btn-row"><button data-action="generate" ${!preparedRecords.length||consumed||disabled?"disabled":""}>Generate prepared</button>${busy?'<button data-action="cancel">Cancel generation</button>':""}</div></section>`:""}
      <section><h2>4 · Review / export</h2><p>${mapSelection().trips.length} routes in view. Click an entry to focus; check a toggle to keep it visible when focusing elsewhere. Toggles start off and never change on selection.</p>${mapSelection().trips.length>1000?'<p class="muted">Large selections may slow map interaction. Hide batches to reduce rendering work.</p>':""}<button data-action="clear-focus">Clear focus</button><button data-action="hide-map">${mapHidden?"Show open batch":"Hide routes"}</button>
      ${batches.length?`<div class="netmob-batches">${batches.slice(batchPage*10,(batchPage+1)*10).map(b=>`<div class="netmob-visibility-row"><label title="Keep this batch visible while focusing or viewing another batch"><input type="checkbox" data-visible-batch="${esc(b.id)}" aria-label="Keep ${esc(b.name)} visible" ${visibleBatches.has(b.id)?"checked":""}></label><button data-batch="${esc(b.id)}" aria-pressed="${b.id===openBatch}">${esc(b.name)} · ${b.trips.length} routes</button></div>`).join("")}</div><div class="btn-row"><button data-action="prev-batch" ${batchPage===0?"disabled":""}>Previous batches</button><span>${batchPage+1} / ${Math.ceil(batches.length/10)}</span><button data-action="next-batch" ${(batchPage+1)*10>=batches.length?"disabled":""}>Next batches</button></div>`:'<p class="muted">Generated routes will appear here.</p>'}
      ${batch?`<div class="netmob-results">${pageTrips(batch,tripPage).map(t=>{const m=metadata(t);return `<div class="netmob-visibility-row"><label><input type="checkbox" data-visible-trip="${esc(t.id)}" title="Keep this route visible while focusing" aria-label="Keep route ${batch.trips.indexOf(t)+1} visible" ${visibleTrips.has(t.id)?"checked":""}></label><button data-trip="${esc(t.id)}" aria-pressed="${t.id===selectedTrip}"><b>#${batch.trips.indexOf(t)+1} · ${esc(Array.from({length:5},(_,i)=>m.raw[`mode_${i+1}`]).filter(Boolean).join(" → ")||String(m.raw.mode_principal??"Unknown"))}</b><span class="fit-${m.fit.status}">${m.fit.status} · ${m.fit.fidelity}</span><small>${mins(m.fit.modeledS)} ${m.fit.durationModel==="movement"?"simulated":"modeled"} / ${mins(m.fit.targetS)} recorded · error ${mins(m.fit.errorS)}</small></button></div>`;}).join("")}</div><div class="btn-row"><button data-action="prev-trip" ${tripPage===0?"disabled":""}>Previous routes</button><span>${tripPage+1} / ${Math.max(1,Math.ceil(batch.trips.length/50))}</span><button data-action="next-trip" ${(tripPage+1)*50>=batch.trips.length?"disabled":""}>Next routes</button></div>
      ${trip?`<details open><summary>Selected route · ${esc(metadata(trip).sourceKey)}</summary><p>${metadata(trip).fit.trials} trials · ${metadata(trip).fit.requests} routing requests · ${esc(metadata(trip).departure??"Departure unavailable")}</p><p>Fit uses ${metadata(trip).fit.durationModel==="movement"?"simulated movement":"routing/timetable estimates"}${metadata(trip).fit.routingS!==undefined?` · original routing estimate ${mins(metadata(trip).fit.routingS!)}`:""}. Movement settings are fixed across trials; per-leg estimates below remain the original routing estimates.</p><p><b>Source sequence:</b> ${esc(Array.from({length:5},(_,i)=>metadata(trip).raw[`mode_${i+1}`]).filter(Boolean).join(" → ")||String(metadata(trip).raw.mode_principal??"Unknown"))}<br><b>Principal mode:</b> ${esc(String(metadata(trip).raw.mode_principal??"Unknown"))}<br><b>Generated sequence:</b> ${esc(trip.exportInput!.orderedLegs?.map(l=>l.mode).join(" → ")??"")}<br>Mode fidelity: ${esc(metadata(trip).fit.fidelity)}. Walking access/transfer legs can be added.</p><details><summary>Original source metadata (preserved in export)</summary><pre>${esc(JSON.stringify(metadata(trip).raw,null,2))}</pre></details><p class="muted">${esc(metadata(trip).fit.assumptions.join(" "))}</p><ol class="netmob-legs">${trip.exportInput!.orderedLegs?.map(l=>`<li><b>${esc(l.sourceMode)}${l.lineName?` · ${esc(l.lineName)}`:""}</b> · ${esc(l.mode)} · ${mins(l.durationS)}${l.waitS?` + ${mins(l.waitS)} wait`:""}<small>${esc(l.timingSource)}</small></li>`).join("")}</ol><details><summary>Full fit and leg metadata</summary><pre>${esc(JSON.stringify({fit:metadata(trip).fit,departure:metadata(trip).departure,legs:trip.exportInput!.orderedLegs?.map(({coordinates,...leg})=>({...leg,pointCount:coordinates.length}))},null,2))}</pre></details></details>`:""}
      <details><summary>Batch report / failures</summary><pre>${esc(JSON.stringify(report,null,2))}</pre></details>
      <div class="netmob-grid"><label>Format<select id="netmobFormat"><option value="parquet" ${format==="parquet"?"selected":""}>GeoParquet</option><option value="gpx" ${format==="gpx"?"selected":""}>GPX ZIP</option></select></label><label>Scope<select id="netmobScope"><option value="batch" ${scope==="batch"?"selected":""}>Open batch</option><option value="all" ${scope==="all"?"selected":""}>All batches</option></select></label></div>
      <label><input id="netmobOnlyFits" type="checkbox" ${onlyFits?"checked":""}> Export acceptable fits only</label><div class="btn-row"><button data-action="export" ${busy||exporting?"disabled":""}>Export</button>${exporting?'<button data-action="cancel-export">Cancel export</button>':""}<button data-action="report">Save report</button><button data-action="retry" ${!batchJobs.has(batch.id)||disabled?"disabled":""}>Retry unfinished</button><button data-action="delete-batch" ${busy||exporting?"disabled":""}>Delete batch</button></div>`:""}</section></div>`;
    panel.querySelector<HTMLInputElement>("#netmobFiles")?.addEventListener("change",e=>void importFiles(Array.from((e.target as HTMLInputElement).files??[])));
    panel.querySelector<HTMLSelectElement>("#netmobDataset")?.addEventListener("change",e=>{active=Number((e.target as HTMLSelectElement).value);clearPrepared();setStatus(`${current().summary.name}: imported in ${(current().summary.importMs/1000).toFixed(2)} s.`);render();});
    panel.querySelector<HTMLFormElement>("#netmobFilter")?.addEventListener("submit",e=>{e.preventDefault();if(disabled)return;const data=new FormData(e.currentTarget as HTMLFormElement);const next:NetmobFilter={};for(const key of ["origin","destination","mode","purpose","dateFrom","dateTo","timeFrom","timeTo"]as const)next[key]=String(data.get(key)??"");for(const key of ["durationMin","durationMax"]as const){const val=String(data.get(key)??"");if(val!==""&&Number.isFinite(Number(val)))next[key]=Number(val);}next.eligibleOnly=data.has("eligibleOnly");void query(0,next);});
    panel.querySelector<HTMLFormElement>("#netmobSettings")?.addEventListener("submit",e=>{e.preventDefault();if(disabled)return;const data=new FormData(e.currentTarget as HTMLFormElement);const read=(key:string,def:number,min:number,max:number)=>{const n=Number(data.get(key));return Number.isFinite(n)?Math.min(max,Math.max(min,n)):def;};fit={durationModel:data.get("durationModel")==="movement"?"movement":"routing",seed:Math.floor(read("seed",90314,0,4294967295)),realization:Math.floor(read("realization",0,0,1000000)),trials:Math.floor(read("trials",12,1,64)),toleranceS:read("toleranceMinutes",3,0,120)*60,tolerancePercent:read("tolerancePercent",20,0,1000)};batchSize=Math.floor(read("batchSize",100,1,1000));if(view)view.offset=0;clearPrepared();setStatus("Settings updated. Prepare pairs again before generating.");render();});
    panel.querySelectorAll<HTMLButtonElement>("[data-row]").forEach(button=>button.onclick=()=>void inspect(Number(button.dataset.row)));
    panel.querySelectorAll<HTMLButtonElement>("[data-trip]").forEach(button=>button.onclick=()=>selectTrip(button.dataset.trip!));
    panel.querySelectorAll<HTMLButtonElement>("[data-batch]").forEach(button=>button.onclick=()=>{inspecting=false;inspectedAreas=[];trialPairs=[];highlightedArea=null;mapHidden=false;openBatch=button.dataset.batch!;tripPage=0;selectedTrip=null;render();});
    panel.querySelector<HTMLSelectElement>("#netmobFormat")?.addEventListener("change",e=>{format=(e.target as HTMLSelectElement).value as typeof format;});
    panel.querySelector<HTMLSelectElement>("#netmobScope")?.addEventListener("change",e=>{scope=(e.target as HTMLSelectElement).value as typeof scope;});
    panel.querySelector<HTMLInputElement>("#netmobOnlyFits")?.addEventListener("change",e=>{onlyFits=(e.target as HTMLInputElement).checked;});
    panel.querySelector<HTMLSelectElement>("#netmobTrialRow")?.addEventListener("change",e=>previewTrials(Number((e.target as HTMLSelectElement).value)));
    const filterForm=panel.querySelector<HTMLFormElement>("#netmobFilter");
    filterForm?.querySelectorAll<HTMLSelectElement>("select[name]").forEach(select=>select.onchange=()=>filterForm.requestSubmit());
    panel.querySelector<HTMLSelectElement>("#netmobMonth")?.addEventListener("change",e=>{calendarMonth=(e.target as HTMLSelectElement).value;render();panel.querySelector(".netmob-calendar")?.setAttribute("open","");});
    panel.querySelector<HTMLSelectElement>("#netmobDateTarget")?.addEventListener("change",e=>{calendarTarget=(e.target as HTMLSelectElement).value;});
    panel.querySelectorAll<HTMLButtonElement>("[data-date]").forEach(button=>button.onclick=()=>{const input=filterForm?.elements.namedItem(calendarTarget) as HTMLInputElement;input.value=button.dataset.date!;filterForm?.requestSubmit();});
    panel.querySelector<HTMLInputElement>("#netmobLiveTrials")?.addEventListener("change",e=>{liveTrials=(e.target as HTMLInputElement).checked;if(!liveTrials)trialPairs=[];renderMap();});
    panel.querySelectorAll<HTMLInputElement>("[data-visible-batch]").forEach(input=>input.onchange=()=>{
      input.checked?visibleBatches.add(input.dataset.visibleBatch!):visibleBatches.delete(input.dataset.visibleBatch!);mapHidden=false;inspecting=false;trialPairs=[];openBatch??=input.dataset.visibleBatch!;render();
    });
    panel.querySelectorAll<HTMLInputElement>("[data-visible-trip]").forEach(input=>input.onchange=()=>{
      const id=input.dataset.visibleTrip!;input.checked?visibleTrips.add(id):visibleTrips.delete(id);mapHidden=false;inspecting=false;trialPairs=[];openBatch??=batches.find(b=>b.trips.some(t=>t.id===id))?.id??null;render();
    });
    const actions:Record<string,()=>void>={"clear-focus":()=>{selectedTrip=null;highlightedArea=null;render();},"hide-map":()=>{mapHidden=!mapHidden;selectedTrip=null;highlightedArea=null;render();},"reset-filters":()=>void query(0,{}),"previous-window":()=>{if(view&&!disabled){view.offset=Math.max(0,view.offset-batchSize);void prepare();}},"next-window":()=>{if(view&&!disabled&&view.offset+batchSize<page.total){view.offset+=batchSize;void prepare();}},"preview-trials":()=>previewTrials(trialRow),"pair-overview":()=>{inspecting=false;inspectedAreas=[];trialPairs=[];openBatch=null;render();},"close-dataset":()=>{current()?.worker.close();datasets.splice(active,1);active=Math.max(0,active-1);clearPrepared();setStatus("Dataset closed. Its completed batches remain available for export or retry.");render();},"cancel-import":()=>{importCancelled=true;importing?.close();importing=null;render();},"prev-row":()=>void query(page.page-1),"next-row":()=>void query(page.page+1),"prepare-selected":()=>void prepare(view?.selected===null||view?.selected===undefined?undefined:[view.selected]),"prepare-filtered":()=>void prepare(),"generate":()=>void generate(),"retry":()=>void generate(true),"cancel":()=>{generator?.postMessage({action:"cancel"});setStatus("Cancelling; completed results will be retained…");},"prev-pair":()=>{inspecting=false;inspectedAreas=[];trialPairs=[];openBatch=null;pairPage--;render();},"next-pair":()=>{inspecting=false;inspectedAreas=[];trialPairs=[];openBatch=null;pairPage++;render();},"prev-trip":()=>{tripPage--;render();},"next-trip":()=>{tripPage++;render();},"prev-batch":()=>{batchPage--;render();},"next-batch":()=>{batchPage++;render();},"export":()=>void exportResults(),"cancel-export":()=>exportController?.abort(),"delete-batch":()=>{if(openBatch)batchJobs.delete(openBatch);batches=batches.filter(b=>b.id!==openBatch);openBatch=batches[0]?.id??null;selectedTrip=null;tripPage=0;render();},"report":()=>{void import("../lib/batchExport").then(({saveExport})=>saveExport(new TextEncoder().encode(JSON.stringify(report,null,2)),"netmob-report.json"));}};
    panel.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(button=>button.onclick=()=>actions[button.dataset.action!]?.());
    if(focused)panel.querySelectorAll<HTMLElement>("[id]").forEach(el=>{if(el.id===focused)el.focus({preventScroll:true});});if(panel.parentElement)panel.parentElement.scrollTop=scroll;
    panel.querySelector('[data-local-runs]')!.append(localRuns.element);localRuns.update();
    movementPanel.update(batches.flatMap(b=>b.trips).find(t=>t.id===selectedTrip));panel.append(movementPanel.element);
    if(appearancePanel.element.parentElement!==(mapHost??panel))(mapHost??panel).append(appearancePanel.element);appearancePanel.element.hidden=!visible;appearancePanel.update(batches.flatMap(b=>b.trips));
    renderMap();
  }
  render();return {renderMap,selectTrip,setVisible(value){visible=value;localRuns.setVisible(value);appearancePanel.element.hidden=!value;if(value){render();renderMap();}}};
}
