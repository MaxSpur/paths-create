import {Binary,Float64,Int32,Table,Utf8,tableToIPC,vectorFromArray} from 'apache-arrow';
import * as parquet from 'parquet-wasm/esm';
import {encodePathWkb} from './parquetWriter';
import type {MovementPlan,Observation} from './movementSimulation';
import type {GpxTripInput} from './gpxWriter';
export function writeObservationParquet(input:GpxTripInput,plan:MovementPlan,samples:Observation[]):Uint8Array{
 const table=new Table({sample_index:vectorFromArray(samples.map((_,i)=>i),new Int32()),elapsed_s:vectorFromArray(samples.map(p=>p.timeS),new Float64()),leg_index:vectorFromArray(samples.map(p=>p.leg),new Int32()),distance_m:vectorFromArray(samples.map(p=>p.distanceM),new Float64()),speed_mps:vectorFromArray(samples.map(p=>p.speedMps),new Float64()),phase:vectorFromArray(samples.map(p=>p.phase),new Utf8()),geometry:vectorFromArray(samples.map(p=>encodePathWkb([p.position]).bytes),new Binary()),truth_geometry:vectorFromArray(samples.map(p=>encodePathWkb([p.truePosition]).bytes),new Binary())});
 const props=new parquet.WriterPropertiesBuilder().setCompression(parquet.Compression.ZSTD).setMaxRowGroupSize(4096).setKeyValueMetadata(new Map([
 ['geo',JSON.stringify({version:'1.1.0',primary_column:'geometry',columns:{geometry:{encoding:'WKB',geometry_types:[...new Set(samples.map(s=>s.position.length===3?'Point Z':'Point'))]},truth_geometry:{encoding:'WKB',geometry_types:[...new Set(samples.map(s=>s.truePosition.length===3?'Point Z':'Point'))]}}})],
 ['odc.observations',JSON.stringify({schemaVersion:1,tripId:input.id,source:input.netmob,plan,noiseMethod:'Gaussian spatial Fourier approximation (32 features/axis) + exponential space/time OU + white Gaussian; sigma per axis; no vertical noise',timeMeaning:'Elapsed synthetic seconds from source departure when available; not historical observations',attribution:'Île-de-France Mobilités / © OpenStreetMap contributors; source licenses retained in the original path export'})]
 ])).build();
 const arrow=parquet.Table.fromIPCStream(tableToIPC(table,'stream'));return parquet.writeParquet(arrow,props); // writeParquet consumes both WASM objects.
}
