// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import init from 'parquet-wasm/esm';
import {writePathParquet} from '../../src/lib/parquetWriter';
import {fitRecord,routingContext} from '../../src/lib/netmobRouting';
import {normalizeRecord} from '../../src/lib/netmobData';
import {DEFAULT_FIT,type NetmobArea} from '../../src/lib/netmobTypes';
import {DEFAULT_COMPACT_NOISE,varyPathGeometry} from '../../src/lib/compactPathNoise';
import type {OrsClient} from '../../src/lib/orsClient';
import {createRun,commitPart,inspectRun,type RunConfig} from './jobStore';
import {previewRow,decodeLine,outcomePage} from './preview';
it('previews exact exported variation, original fields and ordered timing without loading another trip',async()=>{
  await init({module_or_path:await readFile('node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm')});
  const root=await mkdtemp(path.join(tmpdir(),'netmob-preview-test-')),folder=path.join(root,'job');
  try{
    const area:NetmobArea={code:'75101',name:'fixture',source:'fixture',geometry:{type:'Polygon',coordinates:[[[2.3,48.8],[2.4,48.8],[2.4,48.9],[2.3,48.9],[2.3,48.8]]]}};
    const record=normalizeRecord({key:'record',code_insee_o:'75101',code_insee_d:'75101',mode_1:'MAP',duree:20,heure_d:'damaged'},7,'emg');
    const ors={cacheIdentity:'fixture',getRouteDetails:async(_p:string,a:{lat:number;lon:number},b:{lat:number;lon:number})=>({coordinates:[[a.lon,a.lat],[b.lon,b.lat]],durationS:1200,distanceM:100})} as unknown as OrsClient;
    const trip=(await fitRecord(routingContext(ors,new AbortController().signal),'dataset',record,new Map([[area.code,area]]),{...DEFAULT_FIT,trials:1})).exportInput!;
    const config:RunConfig={schemaVersion:2,source:'fixture',sourceHash:'dataset',sourceRows:10,selection:[7,9],settings:DEFAULT_FIT,versions:{fixture:'1'},variation:DEFAULT_COMPACT_NOISE,partRows:2,maxOutputBytes:2**20,minFreeBytes:0};
    await createRun(folder,config);const cp=await inspectRun(folder,config);
    await commitPart(folder,config,cp,[{rowIndex:7,sourceKey:record.key,raw:record.raw,status:'acceptable',tripId:trip.id},{rowIndex:9,sourceKey:'failed',raw:{mode_1:'METRO'},status:'failed',reasons:['fixture']}],writePathParquet([{id:'dataset',trips:[trip]}],{variation:DEFAULT_COMPACT_NOISE}));
    const preview=await previewRow(folder,cp,0);
    expect(preview.raw).toEqual(record.raw);expect(preview.input?.netmob).toEqual(JSON.parse(JSON.stringify(trip.netmob)));
    expect(preview.input?.orderedLegs?.map(l=>l.coordinates)).toEqual(varyPathGeometry(trip.orderedLegs!.map(l=>l.coordinates),JSON.stringify(['dataset',7,trip.id]),DEFAULT_COMPACT_NOISE));
    expect(preview.input?.orderedLegs?.[0].durationS).toBe(1200);expect(preview.geometryVariation).toBeDefined();
    expect((await previewRow(folder,cp,1)).input).toBeUndefined();expect((await outcomePage(folder,cp,0)).rows).toHaveLength(2);
    await expect(previewRow(folder,cp,2)).rejects.toThrow('checkpointed');
    expect(()=>decodeLine({type:'LineString',coordinates:[[NaN,48]]})).toThrow();
  }finally{await rm(root,{recursive:true,force:true});}
});
