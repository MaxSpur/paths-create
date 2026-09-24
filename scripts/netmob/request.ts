import type {LocalRunRequest} from '../../src/lib/localRunTypes';
import {DEFAULT_SIMULATION} from '../../src/lib/movementSimulation';

export function integer(value:unknown,min:number,max:number,label:string):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${label} must be an integer from ${min} to ${max}.`);return value;
}
function finite(value:unknown,min:number,max:number,label:string):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`Invalid ${label}.`);return value;
}
export function safeName(value:unknown):string {
  if(typeof value!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value))throw new Error('Use a simple folder name (letters, numbers, dash or underscore).');return value;
}
/** Construct a fresh allowlisted snapshot; never spread arbitrary HTTP objects into configuration. */
export function validateRequest(value:unknown):LocalRunRequest {
  if(!value||typeof value!=='object')throw new Error('Missing job configuration.');
  const r=value as LocalRunRequest;safeName(r.name);safeName(r.sourceName);
  if(!r.sourceName.endsWith('.parquet')||! /^[a-f0-9]{64}$/.test(r.sourceHash))throw new Error('Choose an imported local Parquet source.');
  const filter:LocalRunRequest['filter']={};
  for(const key of ['origin','destination','mode','purpose','dateFrom','dateTo','timeFrom','timeTo'] as const){
    const v=r.filter?.[key];if(v!==undefined){if(typeof v!=='string'||v.length>200)throw new Error('Invalid filter.');filter[key]=v;}
  }
  for(const key of ['durationMin','durationMax'] as const)if(r.filter?.[key]!==undefined)filter[key]=finite(r.filter[key],0,100000,key);
  if(r.filter?.eligibleOnly!==undefined){if(typeof r.filter.eligibleOnly!=='boolean')throw new Error('Invalid eligibility filter.');filter.eligibleOnly=r.filter.eligibleOnly;}
  const s=r.settings;if(!s||!['routing','movement'].includes(s.durationModel??'movement'))throw new Error('Invalid fitting settings.');
  // The browser fitting form currently exposes the calibrated preset, not arbitrary movement profiles.
  if(s.movement&&JSON.stringify(s.movement)!==JSON.stringify(DEFAULT_SIMULATION))throw new Error('Local jobs currently use the calibrated movement preset.');
  const settings:LocalRunRequest['settings']={seed:integer(s.seed,0,2147483647,'Seed'),realization:integer(s.realization,0,1000000,'Realization'),trials:integer(s.trials,1,64,'Trials'),toleranceS:finite(s.toleranceS,0,86400,'Tolerance'),tolerancePercent:finite(s.tolerancePercent,0,1000,'Tolerance percent'),durationModel:s.durationModel??'movement',movement:DEFAULT_SIMULATION};
  const variation=r.variation===null?null:{seed:integer(r.variation?.seed,0,2147483647,'Variation seed'),maxOffsetM:finite(r.variation?.maxOffsetM,0,20,'Variation displacement'),knotSpacingM:finite(r.variation?.knotSpacingM,10,10000,'Variation spacing')};
  return {name:r.name,sourceName:r.sourceName,sourceHash:r.sourceHash,expectedRows:integer(r.expectedRows,1,1000000,'Matching rows'),filter,settings,variation,maxAccessM:finite(r.maxAccessM,1,100000,'Walking access limit'),maxCyclingM:finite(r.maxCyclingM,1,100000,'Cycling access limit'),partRows:integer(r.partRows,1,1000,'Part rows'),maxOutputMiB:integer(r.maxOutputMiB,1,1048576,'Output budget'),minFreeMiB:integer(r.minFreeMiB,64,1048576,'Free-space reserve')};
}
