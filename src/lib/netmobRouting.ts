import {buildMovementPlan,DEFAULT_SIMULATION,MOVEMENT_VERSION,type SimulationSettings} from './movementSimulation';
import { OrsClient, OrsHttpError } from "./orsClient";
import { haversineDistanceM, toLatLon } from "./geo";
import { findTransitJourney } from "./transitRouter";
import { estimateTransitLeg, departureBand, type TransitTiming } from "./netmobTiming";
import { candidatePairs, containsPoint } from "./netmobGeometry";
import { buildTripGpx, segmentDistanceM, type GpxTripInput } from "./gpxWriter";
import type { GeneratedTrip, GenerationReport, LatLon } from "./types";
import type { TransitMode, TransitNetwork } from "./transitTypes";
import type { FitSettings, ModeledLeg, NetmobArea, NetmobFit, NetmobPair, NetmobRecord } from "./netmobTypes";

type StreetMode="walking"|"cycling"|"driving";
export const TRANSIT_MODES:Record<string,TransitMode[]>={METRO:["metro"],"RER/TRAIN":["rer","train"],"RER/METRO":["rer","metro"],TRAM:["tram"],BUS:["bus"],"TGV/INTERCITES/TER":["train"]};
const KNOWN_STREET=new Set(["MAP","VELO","VAE","VPC","VPP","VUL","TAXI/VTC","2RM","TROTTINETTE","TAD"]);
export function isUnknownMode(mode:string):boolean{return !KNOWN_STREET.has(mode)&&!TRANSIT_MODES[mode];}
function streetMode(mode:string,scooter:StreetMode="cycling"):StreetMode{return mode==="MAP"?"walking":mode==="TROTTINETTE"?scooter:["VELO","VAE"].includes(mode)?"cycling":"driving";}
export function serviceFailure(error:unknown):boolean {return error instanceof TypeError||error instanceof OrsHttpError&&([401,403,429].includes(error.status)||error.status>=500);}
export interface RoutingContext {
  ors:OrsClient; network?:TransitNetwork; timing?:TransitTiming; signal:AbortSignal;
  cache:Map<string,Awaited<ReturnType<OrsClient["getRouteDetails"]>>>; requests:number; cacheHits:number;
  onCandidate?:(pair:NetmobPair,legs:ModeledLeg[],routingS:number,identity:string)=>void;
  onTrial?:(pair:NetmobPair,trial:number,total:number,modes:string[])=>void;
  maxAccessM?:number; maxCyclingM?:number; transitUnavailableReason?:string;
}
export function routingContext(ors:OrsClient,signal:AbortSignal,network?:TransitNetwork,timing?:TransitTiming):RoutingContext{return {ors,signal,network,timing,cache:new Map(),requests:0,cacheHits:0};}
function proxyAssumptions(sourceMode:string):string[]{
  if(sourceMode==="2RM")return ["Motorbike uses car-accessible road geometry and car travel times."];
  if(sourceMode==="VAE")return ["Electric bicycle uses cycling geometry; timing assumes 20 km/h."];
  if(sourceMode==="TROTTINETTE")return ["Scooter uses a pedestrian/cycling geometry proxy; timing assumes 12 km/h. Access permissions are not verified for a specific scooter type."];
  if(sourceMode==="TAD")return ["Demand-responsive transport uses road routing; booking and actual service are unverified."];
  if(["VUL","TAXI/VTC","VPP"].includes(sourceMode))return ["Recorded vehicle category retained; standard car routing profile."];
  return [];
}
async function street(ctx:RoutingContext,sourceMode:string,from:LatLon,to:LatLon,scooter?:StreetMode):Promise<ModeledLeg> {
  ctx.signal.throwIfAborted();const mode=streetMode(sourceMode,scooter);
  const profile=mode==="walking"?"foot-walking":mode==="cycling"?"cycling-regular":"driving-car";
  const key=JSON.stringify([ctx.ors.cacheIdentity,profile,from,to]);
  let route=ctx.cache.get(key);
  if(route)ctx.cacheHits++;else {ctx.requests++;route=await ctx.ors.getRouteDetails(profile,from,to,ctx.signal);ctx.cache.set(key,route);if(ctx.cache.size>512)ctx.cache.delete(ctx.cache.keys().next().value!);}
  const start=toLatLon(route.coordinates[0]),end=toLatLon(route.coordinates.at(-1)!);
  if(haversineDistanceM(from,start)>500||haversineDistanceM(to,end)>500)throw new Error("Route snapping exceeds 500 m.");
  const durationS=sourceMode==="VAE"?route.distanceM/(20/3.6):sourceMode==="TROTTINETTE"?route.distanceM/(12/3.6):route.durationS;
  return {mode,sourceMode,coordinates:route.coordinates,durationS,distanceM:route.distanceM,
    timingSource:["VAE","TROTTINETTE"].includes(sourceMode)?"Fixed proxy speed on ORS geometry":"ORS profile duration",geometrySource:"ors",assumptions:proxyAssumptions(sourceMode)};
}
/** Explicit short connections account for separate ORS snaps and platform geometry. */
export function connectOrderedLegs(legs:ModeledLeg[]):ModeledLeg[] {
  const result:ModeledLeg[]=[];
  for(const leg of legs){
    const previous=result.at(-1);
    if(previous){const a=previous.coordinates.at(-1)!,b=leg.coordinates[0];const distance=haversineDistanceM(toLatLon(a),toLatLon(b));
      if(distance>500)throw new Error("Unresolved connection between route legs exceeds 500 m.");
      if(distance>0.5)result.push({mode:"walking",sourceMode:"MAP",coordinates:[[a[0],a[1]],[b[0],b[1]]],distanceM:distance,durationS:distance/(4.8/3.6),geometrySource:"station-connector",timingSource:"4.8 km/h connector estimate",assumptions:["Connection between snapped route endpoints is approximate; pedestrian access is unverified."]});
    }
    result.push(leg);
  }
  return result;
}
function candidates(ctx:RoutingContext,point:LatLon,sourceMode:string,modes:TransitMode[]|undefined):Map<number,number> {
  const network=ctx.network!;const mode=streetMode(sourceMode);const radius=mode==="walking"?ctx.maxAccessM??1500:mode==="cycling"?ctx.maxCyclingM??5000:20000;
  const allowed=new Set<number>();for(const p of network.patterns)if(!modes||modes.includes(network.lines[p.line].mode))for(const s of p.stops)allowed.add(s);
  const entries=[...allowed].map(i=>[i,haversineDistanceM(point,network.stops[i])] as [number,number]).filter(([,d])=>d<=radius).sort((a,b)=>a[1]-b[1]);
  // Keep all nearby platforms for walking, and bounded candidates for vehicle access.
  return new Map(entries.slice(0,mode==="walking"?200:40).map(([i,d])=>[i,d*(mode==="walking"?3:mode==="cycling"?1:0.4)]));
}
async function transitBlock(ctx:RoutingContext,sequence:string[],from:LatLon,to:LatLon,inMode:string,outMode:string,departure:string|null,offset:number,scooter?:StreetMode):Promise<ModeledLeg[]> {
  const {network,timing}=ctx;if(!network||!timing)throw new Error(ctx.transitUnavailableReason??"Transit network or timetable estimates unavailable.");
  const unconstrained=sequence.length===1&&sequence[0]==="TRANSIT";
  const boardingSequence=unconstrained?undefined:sequence.map(m=>TRANSIT_MODES[m]);
  const boardingLineIds=sequence.map(mode=>mode==="TGV/INTERCITES/TER"?new Set(network.lines.filter(l=>l.railClass).map(l=>l.id)):undefined);
  const starts=candidates(ctx,from,inMode,boardingSequence?.[0]),ends=candidates(ctx,to,outMode,boardingSequence?.at(-1));
  const verified=new Map<string,ModeledLeg>();
  for(let attempt=0;attempt<12;attempt++) {
    ctx.signal.throwIfAborted();
    const journey=findTransitJourney(network,from,to,{boardingSequence,boardingLineIds,maxTransfers:4,originStopCosts:starts,destinationStopCosts:ends,walkingWeight:3});
    if(!journey)throw new Error("No itinerary follows the recorded boarding sequence within access limits.");
    const a=network.stops.findIndex(s=>s.id===journey.from.id),b=network.stops.findIndex(s=>s.id===journey.to.id);
    let changed=false;
    for(const [inbound,index,point,stop,source]of [[true,a,from,journey.from,inMode],[false,b,to,journey.to,outMode]] as const){
      const key=`${inbound}:${index}`;if(verified.has(key))continue;
      try {
        const leg=await street(ctx,source,inbound?point:stop,inbound?stop:point,scooter);
        const limit=streetMode(source)==="walking"?ctx.maxAccessM??1500:streetMode(source)==="cycling"?ctx.maxCyclingM??5000:20000;
        if(leg.distanceM>limit)throw new Error("Routed station access exceeds the configured limit.");
        verified.set(key,leg);(inbound?starts:ends).set(index,leg.distanceM*(streetMode(source)==="walking"?3:streetMode(source)==="cycling"?1:0.4));
      }catch(error){if(serviceFailure(error)||ctx.signal.aborted)throw error;(inbound?starts:ends).delete(index);}
      changed=true;
    }
    if(changed)continue;
    const first=verified.get(`true:${a}`)!,last=verified.get(`false:${b}`)!;
    const result:ModeledLeg[]=[first];let clock=offset+first.durationS;let ride=0;
    const append=(item:ModeledLeg)=>{const connected=connectOrderedLegs([result.at(-1)!,item]).slice(1);result.push(...connected);clock+=connected.reduce((sum,l)=>sum+l.durationS+(l.waitS??0),0);};
    for(const leg of journey.legs){
      if(leg.kind==="transfer"){
        const distance=segmentDistanceM(leg.coordinates);
        const transfer=distance>350?await street(ctx,"MAP",leg.from,leg.to):{mode:"walking" as const,sourceMode:"MAP",coordinates:leg.coordinates,distanceM:distance,durationS:distance/(4.8/3.6),geometrySource:"station-connector",timingSource:"4.8 km/h connector estimate",assumptions:["Internal station connector geometry is approximate."]};
        append(transfer);
      }else{
        const connectionM=haversineDistanceM(toLatLon(result.at(-1)!.coordinates.at(-1)!),toLatLon(leg.coordinates[0]));
        const estimate=estimateTransitLeg(leg,network,timing,departure,clock+connectionM/(4.8/3.6));
        const sourceMode=unconstrained?"TRANSIT":sequence[ride++];
        const item:ModeledLeg={mode:leg.mode,sourceMode,coordinates:leg.coordinates,distanceM:segmentDistanceM(leg.coordinates),
          durationS:estimate.durationS,waitS:estimate.waitS,timingSource:estimate.source,geometrySource:leg.geometrySource,
          traversal:leg.patternIndex===undefined?undefined:{patternIndex:leg.patternIndex,fromIndex:leg.fromPatternIndex!,toIndex:leg.toPatternIndex!},
          lineId:leg.line?.id,lineName:leg.line?.name,lineColor:leg.line?.color,fromStopId:leg.from.id,toStopId:leg.to.id,assumptions:["Recent scheduled-service estimates; not verified historical service."]};
        append(item);
      }
    }
    append(last);
    if(inMode!=="MAP"||outMode!=="MAP")first.assumptions=[...first.assumptions,"Vehicle availability/parking at interchanges is assumed; no linked daily vehicle itinerary."];
    return result;
  }
  throw new Error("Transit access refinement reached its bounded limit.");
}
/** Explicit pairs bypass random pool pairing entirely. Transit chains retain each boarding. */
export async function routeExplicitPair(ctx:RoutingContext,pair:NetmobPair,modes:string[],scooter?:StreetMode):Promise<ModeledLeg[]> {
  const isTransit=(m:string)=>Boolean(TRANSIT_MODES[m])||m==="TRANSIT";
  const groups:string[][]=[];
  for(const mode of modes){const last=groups.at(-1);if(last&&isTransit(last[0])===isTransit(mode))last.push(mode);else groups.push([mode]);}
  const transitGroups=groups.filter(g=>isTransit(g[0]));
  if(transitGroups.length>1 || transitGroups.length===1&&groups.some(g=>!isTransit(g[0])&&g.length>1)){
    const result:ModeledLeg[]=[];let from=pair.origin,clock=0;
    for(let i=0;i<groups.length;i++){
      const to=i===groups.length-1?pair.destination:{lat:pair.origin.lat+(pair.destination.lat-pair.origin.lat)*(i+1)/groups.length,lon:pair.origin.lon+(pair.destination.lon-pair.origin.lon)*(i+1)/groups.length};
      const legs=isTransit(groups[i][0])?await transitBlock(ctx,groups[i],from,to,"MAP","MAP",pair.record.departure,clock,scooter):await routeExplicitPair(ctx,{...pair,origin:from,destination:to},groups[i],scooter);
      legs[0].assumptions.push("Intermediate mode-change checkpoint sampled on OD corridor; exact interchange location was not observed.");
      result.push(...legs);clock+=legs.reduce((s,l)=>s+l.durationS+(l.waitS??0),0);from=to;
    }
    return result;
  }
  if(!modes.some(isTransit)){
    const result:ModeledLeg[]=[];let from=pair.origin;
    for(let i=0;i<modes.length;i++){
      const to=i===modes.length-1?pair.destination:{lat:pair.origin.lat+(pair.destination.lat-pair.origin.lat)*(i+1)/modes.length,lon:pair.origin.lon+(pair.destination.lon-pair.origin.lon)*(i+1)/modes.length};
      const leg=await street(ctx,modes[i],from,to,scooter);if(modes.length>1)leg.assumptions.push("Intermediate street mode-change location sampled on the OD corridor.");result.push(leg);from=to;
    }
    return result;
  }
  // Maximal transit runs with the adjacent street legs. Multiple separated runs
  // get deterministic intermediate OD-corridor checkpoints, explicitly disclosed.
  const runs:Array<{sequence:string[];incoming:string;outgoing:string}>=[];
  let cursor=0;let incoming="MAP";
  while(cursor<modes.length){
    if(!isTransit(modes[cursor])){incoming=modes[cursor++];continue;}
    const sequence:string[]=[];while(cursor<modes.length&&isTransit(modes[cursor]))sequence.push(modes[cursor++]);
    const outgoing=cursor<modes.length?modes[cursor]:"MAP";
    runs.push({sequence,incoming,outgoing});incoming="MAP";
    if(cursor<modes.length)cursor++;
  }
  const result:ModeledLeg[]=[];let from=pair.origin;let offset=0;
  for(let i=0;i<runs.length;i++){
    const to=i===runs.length-1?pair.destination:{lat:pair.origin.lat+(pair.destination.lat-pair.origin.lat)*(i+1)/runs.length,lon:pair.origin.lon+(pair.destination.lon-pair.origin.lon)*(i+1)/runs.length};
    const run=runs[i];const legs=await transitBlock(ctx,run.sequence,from,to,run.incoming,run.outgoing,pair.record.departure,offset,scooter);
    if(runs.length>1)legs[0].assumptions.push("Intermediate mode-change checkpoint sampled on OD corridor.");
    result.push(...legs);offset+=legs.reduce((s,l)=>s+l.durationS+(l.waitS??0),0);from=to;
  }
  return result;
}
export function fitStatus(targetS:number|null,modeledS:number,settings:FitSettings):Pick<NetmobFit,"status"|"errorS"> {
  const errorS=targetS===null?null:modeledS-targetS;
  return {status:errorS===null?"unassessed":Math.abs(errorS)<=Math.max(settings.toleranceS,targetS!*settings.tolerancePercent/100)?"acceptable":"poor",errorS};
}
export function attachTransitStops(legs:ModeledLeg[],network?:TransitNetwork):void {
  if(!network)return;
  for(const leg of legs){const ref=leg.traversal;if(!ref||leg.stops)continue;const pattern=network.patterns[ref.patternIndex];leg.stops=[];for(let i=ref.fromIndex;i<=ref.toIndex;i++){const stop=network.stops[pattern.stops[i]];leg.stops.push({stopId:stop.id,name:stop.name,coordinateIndex:pattern.offsets[i]-pattern.offsets[ref.fromIndex]});}}
}
export function movementSettings(settings:FitSettings):SimulationSettings{return {...DEFAULT_SIMULATION,...settings.movement,cruiseKmh:{...DEFAULT_SIMULATION.cruiseKmh,...settings.movement?.cruiseKmh}};}
export async function fitRecord(ctx:RoutingContext,datasetId:string,record:NetmobRecord,areas:Map<string,NetmobArea>,settings:FitSettings):Promise<GeneratedTrip> {
  if(record.exclusions.length)throw new Error(record.exclusions.join("; "));
  const origin=areas.get(record.origin),destination=areas.get(record.destination);
  if(!origin||!destination)throw new Error("Missing boundary geometry.");
  const requests=ctx.requests,hits=ctx.cacheHits;const candidates=candidatePairs(datasetId,record,origin,destination,settings);
  const unknown=!record.modes.length||record.modes.some(isUnknownMode);
  const base=record.modes.length?record.modes:["UNKNOWN"];
  const variants=unknown?["VPC","TRANSIT","MAP"].map(fallback=>base.map(m=>isUnknownMode(m)?fallback:m)):[base];
  const scooters=base.includes("TROTTINETTE")?["cycling","walking"] as const:["cycling"] as const;
  const id=`netmob-${datasetId.slice(0,16)}-${record.rowIndex}-${settings.seed}-${settings.realization}`;
  const simulation=movementSettings(settings);
  let best:{pair:NetmobPair;legs:ModeledLeg[];duration:number;error:number;routingS:number;movementS?:number}|undefined;
  let trials=0;let lastError="No valid route found.";
  // Total trials, including inferred modes and scooter profiles, never exceeds settings.trials.
  for(let i=0;i<candidates.length;i++){
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    ctx.signal.throwIfAborted();const pair=candidates[Math.floor(i/(variants.length*scooters.length))]??candidates[i];
    const modes=variants[i%variants.length];const scooter=scooters[Math.floor(i/variants.length)%scooters.length];trials++;
    ctx.onTrial?.(pair,trials,candidates.length,modes);
    try{
      const legs=connectOrderedLegs(await routeExplicitPair(ctx,pair,modes,scooter));
      if(!legs.length||!containsPoint(origin.geometry,toLatLon(legs[0].coordinates[0]))||!containsPoint(destination.geometry,toLatLon(legs.at(-1)!.coordinates.at(-1)!)))throw new Error("Snapped endpoint leaves its source area.");
      let duration=0;
      for(const leg of legs){leg.startOffsetS=duration;duration+=leg.durationS+(leg.waitS??0);leg.endOffsetS=duration;}
      const routingS=duration;
      if(settings.durationModel==='movement'||ctx.onCandidate)attachTransitStops(legs,ctx.network);
      ctx.onCandidate?.(pair,legs,routingS,id);
      const movementS=settings.durationModel==='movement'?buildMovementPlan(legs,simulation,record.durationS,id,{durationOnly:true}).durationS:undefined;
      duration=movementS??routingS;
      const error=record.durationS===null?0:Math.abs(duration-record.durationS);
      if(!best||error<best.error)best={pair,legs,duration,error,routingS,movementS};
    }catch(error){if(serviceFailure(error)||ctx.signal.aborted)throw error;lastError=error instanceof Error?error.message:String(error);}
  }
  if(!best)throw new Error(lastError);
  attachTransitStops(best.legs,ctx.network);
  const assumptions=[...new Set(best.legs.flatMap(l=>l.assumptions))];
  if(unknown)assumptions.push(record.durationS===null?"Unknown source mode: first geographically valid proxy selected because duration is unavailable.":"Unknown source mode inferred by comparing route durations; inference is not an observation.");
  if(!record.departure)assumptions.push("Missing departure: weekday daytime timing estimates used.");
  const fidelity=unknown?"inferred":base.some(m=>proxyAssumptions(m).length)||assumptions.some(a=>a.includes("checkpoint")||a.includes("mode-change"))?"proxy":"matched";
  if(settings.durationModel==='movement')assumptions.push('Endpoints ranked by seeded movement duration with fixed shared parameters; routing/timetable leg estimates remain separate.');
  const fit:NetmobFit={durationModel:settings.durationModel??'routing',movementVersion:settings.durationModel==='movement'?MOVEMENT_VERSION:undefined,routingS:best.routingS,movementS:best.movementS,...fitStatus(record.durationS,best.duration,settings),targetS:record.durationS,modeledS:best.duration,trials,requests:ctx.requests-requests,cacheHits:ctx.cacheHits-hits,fidelity,assumptions};
  const point=(p:LatLon,suffix:string)=>({...p,id:`${id}-${suffix}`,addressStatus:"skipped" as const});
  const originPoint=point(best.pair.origin,"o"),destinationPoint=point(best.pair.destination,"d");
  const routeMode=best.legs.every(l=>l.mode==="driving")?"driving":best.legs.every(l=>l.mode==="cycling")?"cycling":"metro";
  const input:GpxTripInput={id,name:`${record.raw.com_o??record.origin} → ${record.raw.com_d??record.destination}`,pairKey:id,routeMode,places:true,
    originStation:{...originPoint,name:origin.name,radiusM:0,kind:"point"},destinationStation:{...destinationPoint,name:destination.name,radiusM:0,kind:"point"},originPoint,destinationPoint,
    walkIn:[],metro:[],walkOut:[],orderedLegs:best.legs,
    netmob:{version:1,datasetId,sourceKey:record.key,rowIndex:record.rowIndex,raw:record.raw,issues:record.issues,settings:{...settings,...(settings.durationModel==='movement'?{movement:simulation}:{})},candidate:best.pair.candidate,
      departure:record.departure,origin:best.pair.origin,destination:best.pair.destination,boundaries:{origin:origin.source,destination:destination.source},fit,networkVersion:ctx.network?.version,timingVersion:ctx.timing?.version,timingSource:best.legs.some(l=>l.geometrySource==="gtfs")?ctx.timing?.source:undefined}};
  return {id,pairKey:id,fileName:`${id}.gpx`,get gpx(){return buildTripGpx(input);},exportInput:input,routeMode,originPoint,destinationPoint,walkInCoords:[],walkOutCoords:[],metroCoords:[],drivingCoords:[]};
}
export interface NetmobRunReport extends GenerationReport {
  netmob:{version:1;datasetId:string;requestedKeys:string[];settings:FitSettings;completedKeys:string[];failed:Array<{rowIndex:number;key:string;reason:string}>;cancelled:boolean;serviceStopped:boolean;elapsedMs:number;requests:number;cacheHits:number;acceptable:number;poor:number;unassessed:number;timeBandAssumption:string};
}
export async function generateNetmobBatch(ctx:RoutingContext,datasetId:string,records:NetmobRecord[],areas:Map<string,NetmobArea>,settings:FitSettings,onProgress:(done:number,total:number,trip?:GeneratedTrip)=>void=()=>{}):Promise<{trips:GeneratedTrip[];report:NetmobRunReport}> {
  if(settings.durationModel==='movement')settings={...settings,movement:movementSettings(settings)};
  if(records.length>1000)throw new Error("Pilot batches are limited to 1,000 records.");
  const started=performance.now(),requests=ctx.requests,hits=ctx.cacheHits;const trips:GeneratedTrip[]=[];
  const failed:Array<{rowIndex:number;key:string;reason:string}>=[];let cancelled=false,serviceStopped=false;
  for(const record of records){
    if(ctx.signal.aborted){cancelled=true;break;}
    try{const trip=await fitRecord(ctx,datasetId,record,areas,settings);trips.push(trip);onProgress(trips.length+failed.length,records.length,trip);}
    catch(error){if(ctx.signal.aborted){cancelled=true;break;}failed.push({rowIndex:record.rowIndex,key:record.key,reason:error instanceof Error?error.message:String(error)});onProgress(trips.length+failed.length,records.length);if(serviceFailure(error)){serviceStopped=true;break;}}
  }
  const statuses=trips.map(t=>t.exportInput!.netmob!.fit.status);
  const report:NetmobRunReport={requestedTrips:records.length,generatedTrips:trips.length,failedTrips:failed.length,failures:failed.map(f=>({code:"NETMOB_RECORD",message:`${f.key}: ${f.reason}`})),
    pairingStats:{uniquePairsUsed:trips.length,maxPairReuse:trips.length?1:0},reuseStats:{metroPath:false,walkingLegs:ctx.cacheHits-hits,walkingLegRequests:ctx.requests-requests},serviceStats:{overpassFallback:false,transitNetwork:Boolean(ctx.network)},
    netmob:{version:1,datasetId,requestedKeys:records.map(r=>r.key),settings:{...settings},completedKeys:trips.map(t=>t.exportInput!.netmob!.sourceKey),failed,cancelled,serviceStopped,elapsedMs:performance.now()-started,
      requests:ctx.requests-requests,cacheHits:ctx.cacheHits-hits,acceptable:statuses.filter(s=>s==="acceptable").length,poor:statuses.filter(s=>s==="poor").length,unassessed:statuses.filter(s=>s==="unassessed").length,timeBandAssumption:JSON.stringify(departureBand(null))}};
  return {trips,report};
}
