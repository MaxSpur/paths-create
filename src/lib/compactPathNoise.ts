import {haversineDistanceM, toLatLon} from './geo';
import {createSeededRandom} from './sampling';
import type {LonLat} from './types';

/** Lightweight geometric variation, not a GNSS receiver/observation model. */
export interface CompactNoiseSettings {seed:number; maxOffsetM:number; knotSpacingM:number}
export const COMPACT_NOISE_VERSION='bounded-spatial-offset-1';
export const DEFAULT_COMPACT_NOISE:CompactNoiseSettings={seed:90322,maxOffsetM:3,knotSpacingM:100};

/** Existing vertices only; shared leg endpoints see exactly the same displacement.
 * Knots are keyed by distance, so adding collinear vertices does not consume RNG.
 * Interpolation stays inside the configured radius; clean input is never mutated. */
export function varyPathGeometry(legs:readonly (readonly LonLat[])[],identity:string,settings:CompactNoiseSettings=DEFAULT_COMPACT_NOISE):LonLat[][] {
  if(!Number.isInteger(settings.seed)||!Number.isFinite(settings.maxOffsetM)||settings.maxOffsetM<0||settings.maxOffsetM>100||!Number.isFinite(settings.knotSpacingM)||settings.knotSpacingM<=0)throw new Error('Invalid compact noise settings.');
  let hash=settings.seed>>>0;
  for(const c of identity)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  const knot=(index:number):[number,number]=>{
    const random=createSeededRandom((hash^Math.imul(index+1,0x9e3779b9))>>>0);
    const angle=random()*Math.PI*2,radius=Math.sqrt(random())*settings.maxOffsetM;
    return [Math.cos(angle)*radius,Math.sin(angle)*radius];
  };
  let previous:LonLat|undefined,distance=0,index=-1,left:[number,number]=[0,0],right:[number,number]=[0,0];
  return legs.map(leg=>leg.map(point=>{
    if(previous)distance+=haversineDistanceM(toLatLon(previous),toLatLon(point));
    previous=point;
    const next=Math.floor(distance/settings.knotSpacingM);
    if(next!==index){index=next;left=knot(index);right=knot(index+1);}
    const fraction=distance/settings.knotSpacingM-index,t=fraction*fraction*(3-2*fraction);
    const east=left[0]*(1-t)+right[0]*t,north=left[1]*(1-t)+right[1]*t;
    return [point[0]+east/(111320*Math.max(.01,Math.cos(point[1]*Math.PI/180))),point[1]+north/111320,...point.slice(2)] as LonLat;
  }));
}
