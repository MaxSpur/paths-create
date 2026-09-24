import {describe,it,expect,beforeAll} from 'vitest';
import {readFileSync} from 'node:fs';
import init from 'parquet-wasm/esm';
import {parquetReadObjects,parquetMetadataAsync} from 'hyparquet';
import {compressors} from 'hyparquet-compressors';
import {DEFAULT_SIMULATION,buildMovementPlan,sampleMovement} from '../lib/movementSimulation';
import {writeObservationParquet} from '../lib/observationParquet';
import type {ModeledLeg} from '../lib/netmobTypes';
import type {GpxTripInput} from '../lib/gpxWriter';
const leg:ModeledLeg={mode:'driving',sourceMode:'VPC',coordinates:[[2,48],[2.01,48],[2.02,48]],distanceM:1500,durationS:200,geometrySource:'ors',timingSource:'ors',assumptions:[]};
const settings={...DEFAULT_SIMULATION,roadStopsPerKm:1,intervalS:1,roadCruiseSource:'fixed' as const};
describe('movement and observations',()=>{
 it('is seeded independently by trip and never changes geometry or target duration to force fit',()=>{
  const input=structuredClone(leg),p=buildMovementPlan([input],settings,200,'a');expect(p).toEqual(buildMovementPlan([input],settings,200,'a'));expect(input).toEqual(leg);expect(p.durationS).toBe(buildMovementPlan([input],settings,900,'a').durationS);expect(sampleMovement([input],p,'a')).toEqual(sampleMovement([input],p,'a'));expect(sampleMovement([input],p,'b')).not.toEqual(sampleMovement([input],p,'a'));
 });
 it('has continuous phases, bounded acceleration, monotonic distance/time and exact clean endpoints',()=>{
  const p=buildMovementPlan([leg],{...settings,noise:false},null,'c'),samples=sampleMovement([leg],p,'c');for(let i=1;i<p.phases.length;i++){expect(p.phases[i].startS).toBeCloseTo(p.phases[i-1].endS);expect(p.phases[i].fromM).toBeCloseTo(p.phases[i-1].toM);}for(const phase of p.phases)expect(Math.abs((phase.v1-phase.v0)/(phase.endS-phase.startS))).toBeLessThanOrEqual(1.200001);for(let i=1;i<samples.length;i++){expect(samples[i].timeS).toBeGreaterThan(samples[i-1].timeS);expect(samples[i].distanceM).toBeGreaterThanOrEqual(samples[i-1].distanceM-1e-8);}expect(samples[0].truePosition).toEqual(leg.coordinates[0]);expect(samples.at(-1)!.truePosition[0]).toBeCloseTo(2.02);expect(samples.at(-1)!.speedMps).toBeCloseTo(0);expect(samples.every(s=>s.position.every((v,i)=>v===s.truePosition[i]))).toBe(true);
 });
 it('includes intermediate transit dwell and evolves noise while stationary',()=>{
  const transit={...leg,mode:'metro' as const,waitS:60,stops:[{stopId:'a',name:'A',coordinateIndex:0},{stopId:'b',name:'B',coordinateIndex:1},{stopId:'c',name:'C',coordinateIndex:2}]};const p=buildMovementPlan([transit],settings);expect(p.stationStops).toBe(1);expect(p.phases.filter(p=>p.kind==='wait').map(p=>p.endS-p.startS)).toEqual([60,25]);const samples=sampleMovement([transit],p);expect(samples[0].truePosition).toEqual(samples[1].truePosition);expect(samples[0].position).not.toEqual(samples[1].position);
 });
 it('keeps scooter timing independent of its routing geometry proxy',()=>{
 const a={...leg,sourceMode:'TROTTINETTE',mode:'walking' as const},b={...a,mode:'cycling' as const};const x=buildMovementPlan([a],{...settings,roadStopsPerKm:0}),y=buildMovementPlan([b],{...settings,roadStopsPerKm:0});expect(Math.max(...x.phases.map(p=>p.v1))).toBeCloseTo(12/3.6);expect(Math.max(...y.phases.map(p=>p.v1))).toBeCloseTo(12/3.6);
 });
 it('bounds samples before allocating output and handles singleton geometry',()=>{
  expect(()=>buildMovementPlan([{...leg,waitS:100000}],{...settings,intervalS:0.2})).toThrow(/limit/);expect(()=>buildMovementPlan([leg],{...settings,intervalS:NaN})).toThrow(/Invalid/);const one={...leg,coordinates:[[2,48]] as [number,number][]};const p=buildMovementPlan([one],settings);expect(sampleMovement([one],p)).toHaveLength(1);
 });
 it('has zero-mean noise with the configured marginal scale over many independent realizations',()=>{
  const xs:number[]=[];for(let seed=0;seed<1500;seed++){const p=buildMovementPlan([leg],{...settings,seed,intervalS:60});const o=sampleMovement([leg],p)[0];xs.push((o.position[0]-o.truePosition[0])*111320*Math.cos(48*Math.PI/180));}const mean=xs.reduce((s,x)=>s+x,0)/xs.length;const variance=xs.reduce((s,x)=>s+(x-mean)**2,0)/xs.length;expect(Math.abs(mean)).toBeLessThan(0.5);expect(Math.sqrt(variance)).toBeGreaterThan(4.6);expect(Math.sqrt(variance)).toBeLessThan(5.7);
 });
});
describe('observation Parquet',()=>{
 beforeAll(async()=>{await init({module_or_path:readFileSync('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm')});});
 it('preserves truth, noise, elapsed seconds, source metadata and model settings',async()=>{
  const p=buildMovementPlan([leg],settings,200,'export'),samples=sampleMovement([leg],p,'export');const input={id:'export',orderedLegs:[leg],netmob:{raw:{mode_1:'VPC',heure_d:'damaged'},sourceKey:'row-1'}} as unknown as GpxTripInput;const bytes=writeObservationParquet(input,p,samples),file=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;const rows=await parquetReadObjects({file,compressors});expect(rows.length).toBe(samples.length);expect(rows[4].elapsed_s).toBe(samples[4].timeS);expect(rows[4].geometry.coordinates).toEqual(samples[4].position);expect(rows[4].truth_geometry.coordinates).toEqual(samples[4].truePosition);const meta=await parquetMetadataAsync(file);const extension=JSON.parse(meta.key_value_metadata!.find(m=>m.key==='odc.observations')!.value!);expect(extension.source.raw).toEqual(input.netmob!.raw);expect(extension.plan.settings).toEqual(settings);
 });
});

describe('duration-only fitting',()=>{
 it('matches dense preview timing without allocating observations or applying the preview cap',()=>{
  const input={...leg,waitS:100000};const p=buildMovementPlan([input],settings,null,'score',{durationOnly:true});expect(p.sampleCount).toBeGreaterThan(50000);expect(()=>buildMovementPlan([input],settings,null,'score')).toThrow(/limit/);
  const normal=buildMovementPlan([leg],settings,null,'same');expect(buildMovementPlan([leg],settings,null,'same',{durationOnly:true})).toEqual(normal);
 });
 it('applies fixed shared cruise parameters independently of target and noise',()=>{
  const slower={...settings,cruiseKmh:{driving:30}},faster={...settings,cruiseKmh:{driving:50}};
  expect(buildMovementPlan([leg],slower,10,'fixed').durationS).toBeGreaterThan(buildMovementPlan([leg],faster,10000,'fixed').durationS);
  expect(buildMovementPlan([leg],slower,10,'fixed').durationS).toBe(buildMovementPlan([leg],{...slower,noise:false},10,'fixed').durationS);
  expect(()=>buildMovementPlan([leg],{...settings,cruiseKmh:{driving:NaN}})).toThrow(/cruise/);
 });
});
it('uses ORS road speed without deriving it from the survey duration',()=>{
 const source={...leg,distanceM:1500,durationS:100},s={...settings,roadStopsPerKm:0,roadCruiseSource:'routing' as const,roadCruiseFactor:1.1};
 const a=buildMovementPlan([source],s,60,'road'),b=buildMovementPlan([source],s,6000,'road');expect(a.durationS).toBe(b.durationS);expect(Math.max(...a.phases.map(p=>p.v1))).toBeCloseTo(16.5);
 const bounded=buildMovementPlan([{...source,durationS:1}],s);expect(Math.max(...bounded.phases.map(p=>p.v1))).toBeLessThanOrEqual(130/3.6);
});
