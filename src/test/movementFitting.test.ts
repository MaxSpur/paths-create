import {describe,it,expect} from 'vitest';
import {fitRecord,routingContext} from '../lib/netmobRouting';
import {DEFAULT_FIT,type NetmobArea,type ModeledLeg} from '../lib/netmobTypes';
import {normalizeRecord} from '../lib/netmobData';
import {buildMovementPlan,DEFAULT_SIMULATION} from '../lib/movementSimulation';
import type {OrsClient} from '../lib/orsClient';
const area:NetmobArea={code:'75101',name:'fixture',source:'fixture',geometry:{type:'Polygon',coordinates:[[[2.3,48.8],[2.4,48.8],[2.4,48.9],[2.3,48.9],[2.3,48.8]]]}};
const record=normalizeRecord({key:'fixture',code_insee_o:'75101',code_insee_d:'75101',mode_1:'MAP',mode_principal:'MAP',duree:20,date_o:'2023-01-02',heure_o:'12:00:00'},0,'emg');
const client={cacheIdentity:'fixture',async getRouteDetails(_p:string,a:{lat:number;lon:number},b:{lat:number;lon:number}){return {coordinates:[[a.lon,a.lat],[b.lon,b.lat]],durationS:1200,distanceM:500};}} as unknown as OrsClient;
describe('movement during endpoint fitting',()=>{
 it('selects the smallest simulated error and reproduces its score in the later preview',async()=>{
  const ctx=routingContext(client,new AbortController().signal),scores:number[]=[];
  ctx.onCandidate=(_pair,legs:ModeledLeg[],_routing,id)=>scores.push(buildMovementPlan(legs,DEFAULT_SIMULATION,1200,id,{durationOnly:true}).durationS);
  const settings={...DEFAULT_FIT,trials:12,durationModel:'movement' as const};
  const trip=await fitRecord(ctx,'fixture',record,new Map([[area.code,area]]),settings),input=trip.exportInput!,fit=input.netmob!.fit;
  expect(Math.abs(fit.modeledS-1200)).toBe(Math.min(...scores.map(s=>Math.abs(s-1200))));
  expect(fit.routingS).toBe(1200);expect(fit.movementS).toBe(fit.modeledS);expect(fit.durationModel).toBe('movement');
  expect(input.orderedLegs![0].durationS).toBe(1200);
  expect(buildMovementPlan(input.orderedLegs!,input.netmob!.settings.movement!,1200,input.id).durationS).toBe(fit.modeledS);
  const again=await fitRecord(routingContext(client,new AbortController().signal),'fixture',record,new Map([[area.code,area]]),settings);
  expect(again.exportInput!.netmob!.candidate).toBe(input.netmob!.candidate);expect(again.exportInput!.netmob!.fit.modeledS).toBe(fit.modeledS);
 });
 it('keeps legacy routing scoring available and accepts missing observed duration',async()=>{
  const trip=await fitRecord(routingContext(client,new AbortController().signal),'fixture',record,new Map([[area.code,area]]),{...DEFAULT_FIT,trials:2,durationModel:'routing'});expect(trip.exportInput!.netmob!.fit.modeledS).toBe(1200);
  const unassessed=await fitRecord(routingContext(client,new AbortController().signal),'fixture',{...record,durationS:null},new Map([[area.code,area]]),{...DEFAULT_FIT,trials:2,durationModel:'movement'});expect(unassessed.exportInput!.netmob!.fit.status).toBe('unassessed');
 });
});
