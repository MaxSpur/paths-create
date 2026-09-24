import wasmUrl from "parquet-wasm/esm/parquet_wasm_bg.wasm?url";
import {buildMovementPlan,sampleMovement} from './movementSimulation';
import type {SimulationSettings} from './movementSimulation';
import type {GpxTripInput} from './gpxWriter';
self.onmessage=async({data}:{data:{id:number;action:'simulate'|'export';input:GpxTripInput;settings:SimulationSettings}})=>{
 try{const legs=data.input.orderedLegs;if(!legs)throw new Error('Simulation currently requires a generated NetMob route.');const plan=buildMovementPlan(legs,data.settings,data.input.netmob?.fit.targetS??null,data.input.id);const samples=sampleMovement(legs,plan,data.input.id);
 if(data.action==='export'){const {default:init}=await import('parquet-wasm/esm');await init({module_or_path:wasmUrl});const {writeObservationParquet}=await import('./observationParquet');const bytes=await writeObservationParquet(data.input,plan,samples);self.postMessage({id:data.id,bytes},{transfer:[bytes.buffer as ArrayBuffer]});}
 else self.postMessage({id:data.id,plan,samples});
 }catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
};
