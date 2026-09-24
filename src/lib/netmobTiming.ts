import { haversineDistanceM } from "./geo";
import type { TransitLeg, TransitNetwork } from "./transitTypes";
export interface TransitTiming {
  version:string; networkVersion:string; source:{url:string;sha256:string;feedDates:string[];representativeDates:Record<string,string>;method:string;license:string};
  rides:Record<string,[number,number]>; waits:Record<string,[number,number]>; modeWaits:Record<string,[number,number]>;
  fallbackKmh:Record<string,number>;
}
export function timeBand(seconds:number):string {const h=seconds/3600%24;return h<7||h>=22?"night":h<10?"am":h<16?"day":h<20?"pm":"evening";}
export function departureBand(departure:string|null,offsetS=0):{day:string;band:string} {
  if(!departure)return {day:"weekday",band:"day"};
  const d=new Date(Date.parse(departure+"Z")+offsetS*1000);const week=d.getUTCDay();
  return {day:week===6?"saturday":week===0?"sunday":"weekday",band:timeBand(d.getUTCHours()*3600+d.getUTCMinutes()*60)};
}
export function estimateTransitLeg(leg:TransitLeg,network:TransitNetwork,timing:TransitTiming,departure:string|null,offsetS:number):{durationS:number;waitS:number;source:string} {
  const {day,band}=departureBand(departure,offsetS);const line=leg.line?.id;
  if(!line)return {durationS:0,waitS:0,source:"walking connector"};
  const matched=timing.networkVersion===network.version;
  const exactWait=matched?timing.waits[[line,leg.from.id,day,band].join("|")]:undefined;
  const modeWait=timing.modeWaits[[leg.mode,day,band].join("|")];const waitS=(exactWait??modeWait)?.[0]??300;
  const pattern=leg.patternIndex!==undefined?network.patterns[leg.patternIndex]:undefined;
  let durationS=0,observations=0,missing=false;
  if(pattern&&matched){
    const start=leg.fromPatternIndex??0;
    const end=leg.toPatternIndex??-1;
    if(end<0)missing=true;
    for(let i=start;i<end;i++){
      const a=network.stops[pattern.stops[i]],b=network.stops[pattern.stops[i+1]];
      const segmentBand=departureBand(departure,offsetS+waitS+durationS);
      const sample=timing.rides[[line,a.id,b.id,segmentBand.day,segmentBand.band].join("|")];
      if(sample){durationS+=sample[0];observations+=sample[1];}
      else {durationS+=haversineDistanceM(a,b)/(timing.fallbackKmh[leg.mode]/3.6);missing=true;}
    }
  }else missing=true;
  if(!durationS){for(let i=1;i<leg.coordinates.length;i++)durationS+=haversineDistanceM({lon:leg.coordinates[i-1][0],lat:leg.coordinates[i-1][1]},{lon:leg.coordinates[i][0],lat:leg.coordinates[i][1]})/(timing.fallbackKmh[leg.mode]/3.6);}
  return {durationS,waitS,source:`${timing.version}; ${day}/${band}; ${observations} ride samples; ${missing?"mode-speed fallback included":"scheduled segment medians"}; wait=${exactWait?"stop":modeWait?"mode":"assumed 300s"} (${(exactWait??modeWait)?.[1]??0} headway samples)`};
}
