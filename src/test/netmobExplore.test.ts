import {afterEach,describe,it,expect,vi} from 'vitest';
import {dataFacets,NetmobDataset,normalizeRecord,matchesFilter} from '../lib/netmobData';
import {createNetmobView} from '../ui/netmob';
import type {MapView} from '../ui/map';
import {DEFAULT_FIT,type NetmobArea,type NetmobSummary} from '../lib/netmobTypes';
import {fitRecord,routingContext} from '../lib/netmobRouting';
import type {OrsClient} from '../lib/orsClient';
const area:NetmobArea={code:'75101',name:'Fixture',source:'fixture',geometry:{type:'Polygon',coordinates:[[[2.3,48.8],[2.4,48.8],[2.4,48.9],[2.3,48.9],[2.3,48.8]]]}};
const rows=Array.from({length:205},(_,i)=>normalizeRecord({key:`row-${i}`,code_insee_o:'75101',code_insee_d:'75101',mode_1:i%2?'METRO':'MAP',mode_2:i===1?'BUS':null,date_o:i%2?'2023-01-03':'2023-01-02',heure_o:'09:00',duree:i%2?20:10,motif_o:i%2?'WORK':'HOME',motif_d:'SHOP'},i,'emg'));
const summary:NetmobSummary={id:'fixture',name:'fixture.parquet',kind:'emg',rows:205,eligible:205,weight:205,areas:1,columns:[],modes:{},exclusions:{},importMs:1};
const dataset=new NetmobDataset(summary,rows,new Map([[area.code,area]]));
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';});
describe('NetMob exploration and batch navigation',()=>{
 it('selects successive filtered windows including the final partial window',()=>{
   expect(dataset.select({},100,undefined,100).map(r=>r.rowIndex)).toEqual(Array.from({length:100},(_,i)=>100+i));
   expect(dataset.select({},100,undefined,200)).toHaveLength(5);
   expect(dataset.select({},100,undefined,205)).toEqual([]);
   expect(dataset.select({},100,[4],100)[0].rowIndex).toBe(4);
   expect(dataset.select({mode:'METRO'},100,undefined,100).map(r=>r.rowIndex)).toEqual([201,203]);
 });
 it('offers complete normalized modes, sequences, purposes, dates and duration bounds',()=>{
   const facets=dataFacets(rows,{});expect(facets.modes).toMatchObject({MAP:103,METRO:102,BUS:1,'METRO → BUS':1});
   expect(facets.purposes).toEqual({HOME:103,SHOP:205,WORK:102});expect(facets.dates).toEqual({'2023-01-02':103,'2023-01-03':102});
   expect(facets.durationMin).toBe(10);expect(facets.durationMax).toBe(20);
 });
 it('conditions each facet on other filters while allowing its own selection to widen',()=>{
   const facets=dataFacets(rows,{mode:'METRO',purpose:'WORK',durationMin:15});
   expect(facets.modes.MAP).toBeUndefined();expect(facets.purposes.HOME).toBeUndefined();
   expect(facets.dates).toEqual({'2023-01-03':102});expect(facets.durationMin).toBe(20);
   expect(dataFacets(rows,{mode:'MAP'}).modes.METRO).toBe(102);
   for(const mode of Object.keys(facets.modes))expect(rows.some(r=>matchesFilter(r,{mode,purpose:'WORK',durationMin:15}))).toBe(true);
 });
 it('omits invalid dates and unavailable durations without inventing ranges',()=>{
   const r=normalizeRecord({date_o:'2023-02-30',duree:null},0,'emg');expect(dataFacets([r],{})).toMatchObject({dates:{},durationMin:null,durationMax:null});
 });
 it('Inspect draws boundaries; source navigation changes generation input; map paging does not; repeats are blocked',async()=>{
   const jobs:Array<Record<string,any>>=[];
   class WorkerMock {
     onmessage?:(e:{data:any})=>void;onerror?:unknown;
     postMessage(data:any){
       if(data.action==='generate'){jobs.push(data);queueMicrotask(()=>this.onmessage?.({data:{id:data.id,error:'test interruption'}}));return;}
       let result:any;if(data.action==='import')result=summary;
       if(data.action==='query')result={...dataset.query(data.filter,data.page),facets:dataFacets(rows,data.filter??{})};
       if(data.action==='select')result={records:dataset.select(data.filter??{},data.limit,data.indices,data.offset),areas:[area]};
       queueMicrotask(()=>this.onmessage?.({data:{id:data.id,result}}));
     }
     terminate(){}
   }
   vi.stubGlobal('Worker',WorkerMock);vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({areas:[]})})));
   const panel=document.createElement('div');document.body.append(panel);
   const map={render:vi.fn(),showNetmobPairs:vi.fn(),focusOnTrip:vi.fn()} as unknown as MapView;
   const view=createNetmobView(panel,map,()=>({provider:'local',key:'',maxAccessM:1000,maxCyclingM:1000}));view.setVisible(true);
   const input=panel.querySelector<HTMLInputElement>('#netmobFiles')!;Object.defineProperty(input,'files',{value:[new File(['fixture'],'fixture.parquet')]});input.dispatchEvent(new Event('change'));
   await vi.waitFor(()=>expect(panel.textContent).toContain('205 matching rows'));
   const click=(action:string)=>(panel.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();
   (panel.querySelector('[data-row="0"]') as HTMLButtonElement).click();
   await vi.waitFor(()=>expect(map.showNetmobPairs).toHaveBeenCalledWith([],true,[area,area]));
   click('prepare-filtered');await vi.waitFor(()=>expect(panel.textContent).toContain('100 candidate pairs'));
   click('preview-trials');expect(vi.mocked(map.showNetmobPairs).mock.calls.at(-1)![0]).toHaveLength(12);
   click('next-pair');expect(panel.textContent).toContain('Map only: 2 / 2');
   click('generate');await vi.waitFor(()=>expect(jobs).toHaveLength(1));expect(jobs[0].records[0].rowIndex).toBe(0);expect(jobs[0].settings.durationModel).toBe('movement');expect(jobs[0].settings.movement.roadCruiseSource).toBe('routing');
   await vi.waitFor(()=>expect((panel.querySelector('[data-action="generate"]') as HTMLButtonElement).disabled).toBe(true));
   click('generate');expect(jobs).toHaveLength(1);
   click('next-window');await vi.waitFor(()=>expect(panel.textContent).toContain('rows 101–200 of 205'));
   await vi.waitFor(()=>expect((panel.querySelector('[data-action="generate"]') as HTMLButtonElement).disabled).toBe(false));
   click('generate');await vi.waitFor(()=>expect(jobs).toHaveLength(2));expect(jobs[1].records[0].rowIndex).toBe(100);
   click('next-window');await vi.waitFor(()=>expect(panel.textContent).toContain('5 candidate pairs'));
   expect(panel.textContent).toContain('rows 201–205 of 205');
 });
 it('keeps route and batch visibility independent of details and supports area/endpoint selection beyond a page',async()=>{
   const client={cacheIdentity:'fixture',getRouteDetails:async(_p:string,a:any,b:any)=>({coordinates:[[a.lon,a.lat],[b.lon,b.lat]],durationS:600,distanceM:500})} as unknown as OrsClient;
   const template=await fitRecord(routingContext(client,new AbortController().signal),'fixture',rows[0],dataset.areas,{...DEFAULT_FIT,trials:1});
   class WorkerMock {
     onmessage?:(e:{data:any})=>void;
     postMessage(data:any){queueMicrotask(()=>{
       if(data.action==='generate'){
         for(const row of data.records){const id=`fixture-${row.rowIndex}`;const trip={...template,id,exportInput:{...template.exportInput!,netmob:{...template.exportInput!.netmob!,rowIndex:row.rowIndex,sourceKey:row.key,raw:row.raw}}};
           this.onmessage?.({data:{id:data.id,trip,completed:row.rowIndex+1,total:data.records.length}});
         }
         this.onmessage?.({data:{id:data.id,result:{report:{failedTrips:0,netmob:{failed:[],acceptable:data.records.length,poor:0}}}}});return;
       }
       const result=data.action==='import'?summary:data.action==='query'?{...dataset.query(data.filter,data.page),facets:dataFacets(rows,{})}:{records:dataset.select(data.filter??{},data.limit,data.indices,data.offset),areas:[area]};this.onmessage?.({data:{id:data.id,result}});
     });}
     terminate(){}
   }
   vi.stubGlobal('Worker',WorkerMock);vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({areas:[]})})));
   const panel=document.createElement('div');document.body.append(panel);const map={render:vi.fn(),showNetmobPairs:vi.fn(),focusOnTrip:vi.fn()} as unknown as MapView;
   createNetmobView(panel,map,()=>({provider:'local',key:'',maxAccessM:1000,maxCyclingM:1000})).setVisible(true);
   const input=panel.querySelector<HTMLInputElement>('#netmobFiles')!;Object.defineProperty(input,'files',{value:[new File(['fixture'],'fixture.parquet')]});input.dispatchEvent(new Event('change'));
   await vi.waitFor(()=>expect(panel.textContent).toContain('205 matching rows'));
   const click=(action:string)=>(panel.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();
   const state=()=>vi.mocked(map.showNetmobPairs).mock.calls.at(-1)![3]!;
   click('prepare-filtered');await vi.waitFor(()=>expect(panel.textContent).toContain('100 candidate pairs'));click('generate');
   await vi.waitFor(()=>expect(state().trips).toHaveLength(100));
   expect(panel.querySelectorAll('[data-visible-trip]:checked')).toHaveLength(0);state().onTrip!('fixture-70');expect(panel.querySelectorAll('[data-visible-trip]:checked')).toHaveLength(0);expect(panel.textContent).toContain('Selected route · row-70');expect(state().highlighted?.has('fixture-70')).toBe(true);
   state().onClear!();expect(state().highlighted?.size).toBe(0);state().onArea!('75101');expect(state().highlighted?.size).toBe(100);const pinBatch=panel.querySelector<HTMLInputElement>('[data-visible-batch]')!;pinBatch.checked=true;pinBatch.dispatchEvent(new Event('change'));
   click('next-window');await vi.waitFor(()=>expect((panel.querySelector('[data-action="generate"]') as HTMLButtonElement).disabled).toBe(false));click('generate');
   await vi.waitFor(()=>expect(state().trips).toHaveLength(200));
   const checkbox=panel.querySelector<HTMLInputElement>('[data-visible-trip="fixture-100"]')!;checkbox.checked=true;checkbox.dispatchEvent(new Event('change'));
   state().onTrip!('fixture-101');expect(state().pinned?.has('fixture-100')).toBe(true);expect(state().pinned?.has('fixture-101')).toBe(false);expect(panel.querySelectorAll('[data-visible-trip]:checked')).toHaveLength(1);
   const slider=panel.querySelector<HTMLInputElement>('[data-appearance="unfocused"]')!;slider.value='35';slider.dispatchEvent(new Event('input'));expect(state().appearance?.unfocused).toBe(35);
   state().onClear!();expect(state().highlighted?.size).toBe(0);expect(state().pinned?.has('fixture-100')).toBe(true);
   click('hide-map');expect(state().trips).toHaveLength(0);
   expect(panel.querySelector<HTMLProgressElement>('#netmobProgress')?.value).toBe(100);
 });
 it('live trial events carry the actual routed endpoints and cancellation remains effective',async()=>{
   const controller=new AbortController();const getRouteDetails=vi.fn(async(_p:string,a:any,b:any)=>({coordinates:[[a.lon,a.lat],[b.lon,b.lat]],durationS:600,distanceM:500}));
   const ctx=routingContext({cacheIdentity:'fixture',getRouteDetails} as unknown as OrsClient,controller.signal);
   const events:any[]=[];ctx.onTrial=(pair,trial,total,modes)=>{events.push({pair,trial,total,modes});if(trial===3)controller.abort();};
   await expect(fitRecord(ctx,'fixture',rows[0],dataset.areas,DEFAULT_FIT)).rejects.toThrow();
   expect(events.map(e=>e.trial)).toEqual([1,2,3]);expect(events[0].total).toBe(12);
   expect(getRouteDetails.mock.calls[0][1]).toEqual(events[0].pair.origin);
 });
});
