// @vitest-environment node
import {readFileSync} from "node:fs";
import {beforeAll,describe,it,expect} from "vitest";
import {Binary,Float64,Table,Utf8,tableToIPC,vectorFromArray} from "apache-arrow";
import init,* as parquet from "parquet-wasm/esm";
import {parquetReadObjects} from "hyparquet";
import {compressors} from "hyparquet-compressors";
import {importNetmob} from "../lib/netmobData";
import {writePathParquet} from "../lib/parquetWriter";
import {fitRecord,routingContext} from "../lib/netmobRouting";
import {DEFAULT_FIT} from "../lib/netmobTypes";
import type {OrsClient} from "../lib/orsClient";

beforeAll(async()=>{await init({module_or_path:readFileSync("node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm")});});
function polygon(){const coords=[[2.3,48.8],[2.4,48.8],[2.4,48.9],[2.3,48.9],[2.3,48.8]];const data=new Uint8Array(13+coords.length*16),v=new DataView(data.buffer);v.setUint8(0,1);v.setUint32(1,3,true);v.setUint32(5,1,true);v.setUint32(9,coords.length,true);coords.flat().forEach((n,i)=>v.setFloat64(13+i*8,n,true));return data;}
function fixture(columns:Record<string,Array<string|number|Uint8Array|null>>){const vectors=Object.fromEntries(Object.entries(columns).map(([key,values])=>{const value=values.find(v=>v!==null);const type=value instanceof Uint8Array?new Binary():typeof value==="number"?new Float64():new Utf8();return [key,vectorFromArray(values as never,type)];}));return Uint8Array.from(parquet.writeParquet(parquet.Table.fromIPCStream(tableToIPC(new Table(vectors),"stream")))).buffer;}
const emg=()=>fixture({key:["one","one","three"],code_insee_o:["75101","75101","75102"],code_insee_d:["75101","75102","75101"],geom_o:[polygon(),polygon(),polygon()],mode_1:["Vae","MAP",null],mode_principal:["Vae","MAP",null],date_o:["2023-01-02",null,null],heure_o:["09:00:00",null,null],heure_d:["2001-01-01",null,null],duree:[10,20,null],poids_jour:[2,3,4]});
describe("NetMob Parquet inputs and outputs",()=>{
 it("reads EMG, deduplicates polygons, joins destination areas and excludes duplicate keys",async()=>{const data=await importNetmob(emg(),"EMG","fixture");expect(data.summary).toMatchObject({kind:"emg",rows:3,areas:2,eligible:2,weight:9});expect(data.records[0].modes).toEqual(["VAE"]);expect(data.records[0].raw.heure_d).toBe("2001-01-01");expect(data.records[1].exclusions).toEqual(["Duplicate source key"]);expect(data.records[2].durationS).toBeNull();expect(data.query({},0,2).rows).toHaveLength(2);expect(data.query({},1,2).rows[0].rowIndex).toBe(2);});
 it("recognizes the cube separately with volume totals and no generation",async()=>{const data=await importNetmob(fixture({origine:["7001","7002"],destination:["7002","7001"],volume:[5,8],date:["2024-11-04","2024-11-04"],tranchehoraire:["09:00","10:00"]}),"cube","cube");expect(data.summary).toMatchObject({kind:"cube",rows:2,weight:13,eligible:0,areas:0});expect(data.records[0].exclusions[0]).toContain("crosswalk");});
 it("reports missing geography/modes/times without inventing values and rejects unrelated schemas",async()=>{const data=await importNetmob(fixture({code_insee_o:["75101"],code_insee_d:["75102"]}),"sparse","sparse");expect(data.records[0]).toMatchObject({key:"row-0",modes:[],durationS:null,departure:null,exclusions:["Missing boundary geometry"]});await expect(importNetmob(fixture({unrelated:["test"]}),"bad","bad")).rejects.toThrow("neither");});
 it("independently reads exported source identity, ordered geometry, timing and proxy labels",async()=>{const data=await importNetmob(emg(),"EMG","fixture");const client={cacheIdentity:"test",async getRouteDetails(_profile:string,a:{lon:number;lat:number},b:{lon:number;lat:number}){return {coordinates:[[a.lon,a.lat],[b.lon,b.lat]],distanceM:1000,durationS:180};}} as unknown as OrsClient;const record=data.records[0];record.modes=["MAP","VAE"];
 const trip=await fitRecord(routingContext(client,new AbortController().signal),"fixture",record,data.areas,{...DEFAULT_FIT,trials:1});
 const rows=await parquetReadObjects({file:Uint8Array.from(writePathParquet([{id:"batch",trips:[trip.exportInput!]}])).buffer,compressors});
 expect(rows.map(r=>r.leg_index)).toEqual([0,1]);expect(rows.map(r=>r.mode)).toEqual(["walking","cycling"]);
 const meta=JSON.parse(rows[0].trip_json as string).netmob;expect(meta.raw).toEqual(record.raw);expect(meta).toMatchObject({version:1,datasetId:"fixture",sourceKey:"one",raw:{mode_1:"Vae"},fit:{fidelity:"proxy"}});
 for(const [i,row]of rows.entries()){const leg=trip.exportInput!.orderedLegs![i];expect(row.geometry).toEqual({type:"LineString",coordinates:leg.coordinates});expect(JSON.parse(row.leg_json as string).modeled).toMatchObject({sourceMode:leg.sourceMode,durationS:leg.durationS,startOffsetS:leg.startOffsetS,endOffsetS:leg.endOffsetS,assumptions:leg.assumptions});}
 expect(meta.fit.modeledS).toBe(360);
 });
});
