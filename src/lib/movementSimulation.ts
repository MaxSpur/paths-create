import {haversineDistanceM,toLatLon} from './geo';
import {createSeededRandom} from './sampling';
import type {LonLat} from './types';
import type {ModeledLeg} from './netmobTypes';
export const MOVEMENT_VERSION='movement-gnss-2';
export type MovementMode=ModeledLeg['mode'];
export interface SimulationSettings {seed:number;intervalS:number;roadStopsPerKm:number;roadWaitS:number;stationDwellS:number;noise:boolean;smoothSigmaM:number;smoothRangeM:number;localSigmaM:number;localRangeM:number;whiteSigmaM:number;stationaryCorrelationS:number;cruiseKmh?:Partial<Record<MovementMode,number>>;roadCruiseSource?:'fixed'|'routing';roadCruiseFactor?:number}
export const DEFAULT_SIMULATION:SimulationSettings={seed:90320,intervalS:2,roadStopsPerKm:0,roadWaitS:15,stationDwellS:25,noise:true,smoothSigmaM:0.5,smoothRangeM:100,localSigmaM:5,localRangeM:20,whiteSigmaM:1,stationaryCorrelationS:30,cruiseKmh:{walking:5.4,driving:40},roadCruiseSource:'routing',roadCruiseFactor:1};
export const MAX_OBSERVATIONS=50000;
export interface MotionPhase {leg:number;startS:number;endS:number;fromM:number;toM:number;v0:number;v1:number;kind:'move'|'wait';reason:string}
export interface MovementPlan {version:string;settings:SimulationSettings;phases:MotionPhase[];durationS:number;baselineS:number;targetS:number|null;distanceM:number;roadStops:number;stationStops:number;warnings:string[];sampleCount:number}
export interface Observation {timeS:number;leg:number;distanceM:number;speedMps:number;truePosition:LonLat;position:LonLat;phase:'move'|'wait'}
const dynamics:Record<ModeledLeg['mode'],{speed:number;acceleration:number}>={walking:{speed:1.3333,acceleration:0.8},cycling:{speed:5,acceleration:0.7},driving:{speed:11.1111,acceleration:1.2},metro:{speed:16.6667,acceleration:1},rer:{speed:25,acceleration:0.8},train:{speed:30.5556,acceleration:0.7},tram:{speed:11.1111,acceleration:0.8},bus:{speed:8.3333,acceleration:0.8}};
export function simulationSeed(identity:string,seed:number){let h=seed>>>0;for(let i=0;i<identity.length;i++)h=Math.imul(h^identity.charCodeAt(i),16777619)>>>0;return h;}
export function validateSimulation(s:SimulationSettings){
 const ranges:Record<keyof Omit<SimulationSettings,'noise'|'cruiseKmh'|'roadCruiseSource'|'roadCruiseFactor'>,[number,number]>={seed:[0,4294967295],intervalS:[0.2,60],roadStopsPerKm:[0,5],roadWaitS:[0,120],stationDwellS:[0,120],smoothSigmaM:[0,100],smoothRangeM:[1,1000],localSigmaM:[0,100],localRangeM:[1,1000],whiteSigmaM:[0,100],stationaryCorrelationS:[1,300]};
 for(const [k,[min,max]] of Object.entries(ranges)){const n=s[k as keyof typeof ranges];if(!Number.isFinite(n)||n<min||n>max)throw new Error(`Invalid simulation setting: ${k}`);}
 if(s.roadCruiseSource!==undefined&&!['fixed','routing'].includes(s.roadCruiseSource))throw new Error('Invalid road cruise source');
 if(s.roadCruiseFactor!==undefined&&(!Number.isFinite(s.roadCruiseFactor)||s.roadCruiseFactor<0.5||s.roadCruiseFactor>2))throw new Error('Invalid road cruise factor');
 for(const [mode,speed] of Object.entries(s.cruiseKmh??{}))if(!(mode in dynamics)||!Number.isFinite(speed)||speed!<=0||speed!>160)throw new Error(`Invalid cruise speed: ${mode}`);
}
export function cumulativeDistances(coords:LonLat[]){const values=[0];for(let i=1;i<coords.length;i++)values.push(values[i-1]+haversineDistanceM(toLatLon(coords[i-1]),toLatLon(coords[i])));return values;}
/** Observed durations are comparisons, never per-trip parameter-fitting targets. */
export function buildMovementPlan(legs:ModeledLeg[],settings:SimulationSettings,targetS:number|null=null,identity='',options:{durationOnly?:boolean}={}):MovementPlan {
 validateSimulation(settings);if(!legs.length)throw new Error('No ordered legs to simulate.');
 const random=createSeededRandom(simulationSeed(identity,settings.seed));const phases:MotionPhase[]=[];const warnings=new Set<string>(['Synthetic motion; cruise-speed rules and accelerations are shared assumptions, not measured traffic.']);let time=0,totalDistance=0,roadStops=0,stationStops=0;
 const append=(leg:number,fromM:number,toM:number,seconds:number,v0:number,v1:number,kind:MotionPhase['kind'],reason:string)=>{if(seconds>1e-9){phases.push({leg,startS:time,endS:time+seconds,fromM,toM,v0,v1,kind,reason});time+=seconds;}};
 legs.forEach((leg,index)=>{
  if(!leg.coordinates.length||leg.coordinates.some(p=>!p.every(Number.isFinite)))throw new Error('Invalid route coordinates.');
  const distances=cumulativeDistances(leg.coordinates),length=distances.at(-1)!;const {acceleration}=dynamics[leg.mode];let speed=leg.sourceMode==="VAE"?20/3.6:leg.sourceMode==="TROTTINETTE"?12/3.6:(settings.cruiseKmh?.[leg.mode]??dynamics[leg.mode].speed*3.6)/3.6;
  if(leg.mode==='driving'&&settings.roadCruiseSource==='routing'&&leg.durationS>0&&leg.distanceM>0){speed=Math.min(130/3.6,Math.max(10/3.6,leg.distanceM/leg.durationS*(settings.roadCruiseFactor??1)));warnings.add('Road cruise uses the ORS leg-average speed with a fixed shared factor (10–130 km/h bounds); no observed-duration adjustment or road-specific signal verification.');}
  const anchors:Array<{distance:number;wait:number;reason:string}>=[{distance:0,wait:Math.max(0,leg.waitS??0),reason:'modeled boarding wait'}];
  if(leg.stops?.length){for(const stop of leg.stops.slice(1,-1)){const d=distances[stop.coordinateIndex];if(d>0&&d<length){anchors.push({distance:d,wait:settings.stationDwellS,reason:`assumed station dwell: ${stop.name}`});stationStops++;}}}
  else if(['metro','rer','train','tram','bus'].includes(leg.mode))warnings.add('A transit leg has no intermediate-stop anchors; its internal stops cannot be simulated.');
  if((['driving','cycling'].includes(leg.mode)||leg.sourceMode==='TROTTINETTE')&&settings.roadStopsPerKm>0&&length>40){
   // Deterministic Poisson stop spacing; waits vary around the configured mean.
   let d=20;while(true){d+=-Math.log(Math.max(1e-12,1-random()))*1000/settings.roadStopsPerKm;if(d>=length-20)break;anchors.push({distance:d,wait:settings.roadWaitS*(0.5+random()),reason:'assumed road delay; traffic signal not verified'});roadStops++;}
  }
  anchors.push({distance:length,wait:0,reason:'leg end'});anchors.sort((a,b)=>a.distance-b.distance);
  for(let i=0;i<anchors.length;i++){
   const anchor=anchors[i];append(index,anchor.distance,anchor.distance,anchor.wait,0,0,'wait',anchor.reason);
   const next=anchors[i+1];if(!next)break;const d=next.distance-anchor.distance;if(d<=0)continue;
   const peak=Math.min(speed,Math.sqrt(d*acceleration));const rampS=peak/acceleration,rampM=peak*peak/(2*acceleration);const cruiseM=Math.max(0,d-2*rampM);
   append(index,anchor.distance,anchor.distance+rampM,rampS,0,peak,'move','acceleration');append(index,anchor.distance+rampM,next.distance-rampM,cruiseM/peak,peak,peak,'move','cruise');append(index,next.distance-rampM,next.distance,rampS,peak,0,'move','braking');
  }
  if(index>0&&haversineDistanceM(toLatLon(legs[index-1].coordinates.at(-1)!),toLatLon(leg.coordinates[0]))>2)warnings.add('Discontinuous source legs: an unmodeled positional jump remains.');totalDistance+=length;
 });
 if(roadStops)warnings.add('Road stops are sampled along the path, not matched to real intersections or red-light phases.');
 if(legs.some(l=>['metro','rer','train'].includes(l.mode)))warnings.add('Continuous observations include potentially underground segments; reception gaps are not modeled.');
 const sampleCount=Math.ceil(time/settings.intervalS)+1;if(!options.durationOnly&&sampleCount>MAX_OBSERVATIONS)throw new Error(`Would create ${sampleCount.toLocaleString()} observations; increase the interval (limit ${MAX_OBSERVATIONS.toLocaleString()}).`);
 return {version:MOVEMENT_VERSION,settings:{...settings},phases,durationS:time,baselineS:legs.reduce((s,l)=>s+l.durationS+(l.waitS??0),0),targetS,distanceM:totalDistance,roadStops,stationStops,warnings:[...warnings],sampleCount};
}
function normal(random:()=>number){return Math.sqrt(-2*Math.log(Math.max(random(),1e-12)))*Math.cos(2*Math.PI*random());}
/** Gaussian-kernel covariance approximated by seeded random Fourier features (32 per axis).
 * Exponential local drift uses an exact OU recurrence with distance + elapsed-time decay.
 * Sigma is per horizontal axis; range is the e-folding distance. No elevation noise. */
export function sampleMovement(legs:ModeledLeg[],plan:MovementPlan,identity=''):Observation[]{
 const s=plan.settings,random=createSeededRandom(simulationSeed(identity,s.seed)^0x9e3779b9);
 const features=Array.from({length:2},()=>Array.from({length:32},()=>({w:Math.SQRT2*normal(random)/s.smoothRangeM,a:normal(random),b:normal(random)})));
 let local=[normal(random)*s.localSigmaM,normal(random)*s.localSigmaM];let previousDistance=0,previousTime=0,phaseIndex=0,legIndex=-1,vertex=1;let distances:number[]=[],coords:LonLat[]=[];const prefix=[0];legs.forEach(l=>prefix.push(prefix.at(-1)!+cumulativeDistances(l.coordinates).at(-1)!));const output:Observation[]=[];
 for(let i=0;i<plan.sampleCount;i++){
  const timeS=Math.min(i*s.intervalS,plan.durationS);while(phaseIndex<plan.phases.length-1&&timeS>=plan.phases[phaseIndex].endS)phaseIndex++;
  const p=plan.phases[phaseIndex];if(!p){output.push({timeS:0,leg:0,distanceM:0,speedMps:0,truePosition:legs[0].coordinates[0],position:legs[0].coordinates[0],phase:'wait'});break;}
  const dt=Math.max(0,Math.min(p.endS-p.startS,timeS-p.startS)),acc=(p.v1-p.v0)/(p.endS-p.startS);
  const distance=Math.min(p.toM,Math.max(p.fromM,p.fromM+p.v0*dt+0.5*acc*dt*dt)),along=prefix[p.leg]+distance;
  if(legIndex!==p.leg){legIndex=p.leg;coords=legs[legIndex].coordinates;distances=cumulativeDistances(coords);vertex=1;}
  while(vertex<distances.length-1&&distances[vertex]<distance)vertex++;
  const a=coords[Math.max(0,vertex-1)]??coords[0],b=coords[Math.min(vertex,coords.length-1)];const span=(distances[vertex]??0)-(distances[vertex-1]??0),f=span>0?(distance-distances[vertex-1])/span:0;
  const truth=a.map((n,j)=>n!+(b[j]!-n!)*f) as LonLat;const rho=Math.exp(-Math.max(0,along-previousDistance)/s.localRangeM-(timeS-previousTime)/s.stationaryCorrelationS);
  local=local.map(n=>rho*n+Math.sqrt(Math.max(0,1-rho*rho))*s.localSigmaM*normal(random));
  const offset=features.map((fs,axis)=>s.noise?s.smoothSigmaM/Math.sqrt(fs.length)*fs.reduce((n,v)=>n+v.a*Math.cos(v.w*along)+v.b*Math.sin(v.w*along),0)+local[axis]+s.whiteSigmaM*normal(random):0);
  const position=[truth[0]+offset[0]/(111320*Math.max(0.01,Math.cos(truth[1]*Math.PI/180))),truth[1]+offset[1]/111320,...truth.slice(2)] as LonLat;
  output.push({timeS,leg:p.leg,distanceM:along,speedMps:Math.max(0,p.v0+acc*dt),truePosition:truth,position,phase:p.kind});previousDistance=along;previousTime=timeS;
 }
 return output;
}
