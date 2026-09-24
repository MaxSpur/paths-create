import type {FitSettings, NetmobFilter, SourceValues} from './netmobTypes';
import type {CompactNoiseSettings} from './compactPathNoise';
import type {GpxTripInput} from './gpxWriter';

/** JSON protocol shared by the optional loopback companion and the lazy browser panel. */
export interface LocalRunRequest {
  name:string; sourceName:string; sourceHash:string; expectedRows:number;
  filter:NetmobFilter; settings:FitSettings; maxAccessM:number; maxCyclingM:number;
  variation:CompactNoiseSettings|null; partRows:number; maxOutputMiB:number; minFreeMiB:number;
}
export interface LocalRunProgress {
  processed:number; committed:number; total:number; parts:number; counts:Record<string,number>;
  bytes:number; maxOutputBytes:number; requestsThisInvocation?:number; rssMiB?:number;
  rowIndex?:number; trial?:number; trials?:number; elapsedS?:number; paused?:string|null;
}
export interface LocalJob {
  id:string; output:string; label:string; state:'ready'|'initializing'|'running'|'pausing'|'paused'|'complete'|'error';
  progress?:LocalRunProgress; error?:string;
  configuration?:{source:string;sourceHash:string;filter:NetmobFilter;settings:FitSettings;variation:CompactNoiseSettings|null;partRows:number;maxAccessM?:number;maxCyclingM?:number;minFreeBytes:number};
}
export interface LocalRunSnapshot {
  outputRoot:string; freeBytes:number; activeId:string|null; orsReady:boolean; orsMessage:string;
  sources:Array<{name:string;bytes:number}>; jobs:LocalJob[];
}
export interface LocalOutcome {
  rowIndex:number;sourceKey:string;status:string;reasons?:string[];tripId?:string;
  errorS?:number|null;modeledS?:number;requests?:number;
}
export interface LocalOutcomePage {offset:number;total:number;rows:LocalOutcome[]}
export interface LocalPreview {input?:GpxTripInput;raw:SourceValues;outcome:LocalOutcome;geometryVariation?:unknown}
